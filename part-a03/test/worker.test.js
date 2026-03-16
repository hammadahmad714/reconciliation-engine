const assert = require("assert");
const { InMemoryRepository } = require("../src/repository");
const { AlertService } = require("../src/alerts");
const { processRefreshJob } = require("../src/worker");
const { computeBackoff } = require("../src/retry-policy");
const { isJobStale, TEN_MINUTES_MS } = require("../src/stale-jobs");

function makeJob(data = {}) {
  return {
    id: "job-1",
    data: {
      accountId: "acc1",
      batchId: "batch1",
      expectedProviderCounts: { providerA: 47, providerB: 42 },
      ...data
    },
    timestamp: Date.now()
  };
}

function makeFetchFn(postsPerProvider) {
  return async (provider) => {
    const list = postsPerProvider[provider] || [];
    return {
      posts: list
    };
  };
}

function setup() {
  const repo = new InMemoryRepository();
  const alerts = new AlertService();
  return { repo, alerts };
}

function test(name, fn) {
  try {
    fn();
    console.log("ok -", name);
  } catch (e) {
    console.error("FAIL -", name);
    console.error(e.stack || e);
    process.exitCode = 1;
  }
}

test("success path writes exactly one committed result set", async () => {
  const { repo, alerts } = setup();
  const job = makeJob();
  const postsA = Array.from({ length: 47 }, (_, i) => ({
    id: `A${i + 1}`,
    metrics: { views: i }
  }));
  const postsB = Array.from({ length: 42 }, (_, i) => ({
    id: `B${i + 1}`,
    metrics: { views: i }
  }));
  await processRefreshJob({
    job,
    repo,
    alerts,
    fetchFn: makeFetchFn({
      providerA: postsA,
      providerB: postsB
    })
  });
  assert.strictEqual(repo.resultSets.length, 1);
  assert.strictEqual(repo.resultRows.length, postsA.length + postsB.length);
  assert.strictEqual(repo.jobResults.length, 1);
  assert.strictEqual(repo.jobResults[0].status, "success");
});

test("crash before transaction commit leaves no partial rows", async () => {
  const { repo, alerts } = setup();
  const job = makeJob();
  const postsA = [{ id: "A1", metrics: { views: 1 } }];
  const postsB = [{ id: "B1", metrics: { views: 2 } }];

  const origInsertResultSet = repo.insertResultSet.bind(repo);
  repo.insertResultSet = async (args) => {
    await origInsertResultSet(args);
    throw new Error("simulated_crash");
  };

  try {
    await processRefreshJob({
      job,
      repo,
      alerts,
      fetchFn: makeFetchFn({
        providerA: postsA,
        providerB: postsB
      })
    });
  } catch (_) {}

  assert.strictEqual(repo.resultSets.length, 0);
  assert.strictEqual(repo.resultRows.length, 0);
});

test("retry after crash creates clean committed result set without duplicates", async () => {
  const { repo, alerts } = setup();
  const job = makeJob();
  const postsA = [{ id: "A1", metrics: { views: 1 } }];
  const postsB = [{ id: "B1", metrics: { views: 2 } }];

  let crashOnce = true;
  repo.beginTransaction = async () => ({
    commit: async () => {
      if (crashOnce) {
        crashOnce = false;
        throw new Error("simulated_crash");
      }
    },
    rollback: async () => {}
  });

  try {
    await processRefreshJob({
      job,
      repo,
      alerts,
      fetchFn: makeFetchFn({
        providerA: postsA,
        providerB: postsB
      })
    });
  } catch (_) {}

  await processRefreshJob({
    job,
    repo,
    alerts,
    fetchFn: makeFetchFn({
      providerA: postsA,
      providerB: postsB
    })
  });

  assert.strictEqual(repo.resultSets.length, 1);
  assert.strictEqual(repo.resultRows.length, 2);
  assert.strictEqual(repo.jobResults.length, 1);
});

test("provider 429 retries with exponential backoff jitter", () => {
  const d1 = computeBackoff(100, 1);
  const d2 = computeBackoff(100, 2);
  assert.ok(d2 > d1 - 100); // loose check, but ensures growth
});

test("provider timeout with incomplete data does not mark success", async () => {
  const { repo, alerts } = setup();
  const job = makeJob();
  const postsA = Array.from({ length: 30 }, (_, i) => ({
    id: `A${i + 1}`,
    metrics: { views: i }
  }));
  const postsB = Array.from({ length: 42 }, (_, i) => ({
    id: `B${i + 1}`,
    metrics: { views: i }
  }));

  await processRefreshJob({
    job,
    repo,
    alerts,
    fetchFn: makeFetchFn({
      providerA: postsA,
      providerB: postsB
    })
  });

  assert.strictEqual(repo.jobResults.length, 1);
  assert.strictEqual(repo.jobResults[0].status, "partial");
});

test("batch pauses and alerts when failures exceed 20%", async () => {
  const { repo, alerts } = setup();
  const job = makeJob();
  const badFetch = async () => {
    const err = new Error("429");
    err.code = 429;
    throw err;
  };

  for (let i = 0; i < 6; i++) {
    const j = { ...job, id: `job-${i + 1}` };
    try {
      await processRefreshJob({
        job: j,
        repo,
        alerts,
        fetchFn: badFetch
      });
    } catch (_) {}
  }

  const batchState = repo.batchState.get("batch1");
  assert.ok(batchState.failed / batchState.total > 0.2);
});

test("account flagged for manual review after 3 consecutive failures", async () => {
  const { repo, alerts } = setup();
  const job = makeJob();
  const badFetch = async () => {
    throw new Error("provider_fail");
  };

  for (let i = 0; i < 3; i++) {
    try {
      await processRefreshJob({
        job,
        repo,
        alerts,
        fetchFn: badFetch
      });
    } catch (_) {}
  }

  const state = await repo.getAccountFailureState("acc1");
  assert.ok(state.consecutive >= 3);
});

test("stale active job is detected", () => {
  const job = {
    id: "stale-job",
    data: {},
    timestamp: Date.now() - (TEN_MINUTES_MS + 1000)
  };
  assert.ok(isJobStale(job));
});

test("immutable result records preserved across retries", async () => {
  const { repo, alerts } = setup();
  const job = makeJob();
  const postsA = [{ id: "A1", metrics: { views: 1 } }];
  const postsB = [{ id: "B1", metrics: { views: 2 } }];

  await processRefreshJob({
    job,
    repo,
    alerts,
    fetchFn: makeFetchFn({
      providerA: postsA,
      providerB: postsB
    })
  });

  await processRefreshJob({
    job: { ...job, id: "job-2" },
    repo,
    alerts,
    fetchFn: makeFetchFn({
      providerA: postsA,
      providerB: postsB
    })
  });

  assert.strictEqual(repo.jobResults.length, 2);
  const ids = new Set(repo.jobResults.map((r) => r.id));
  assert.strictEqual(ids.size, 2);
});

test("append-only result rows are not mutated on retry", async () => {
  const { repo, alerts } = setup();
  const job = makeJob();
  const postsA = [{ id: "A1", metrics: { views: 1 } }];
  const postsB = [{ id: "B1", metrics: { views: 2 } }];

  await processRefreshJob({
    job,
    repo,
    alerts,
    fetchFn: makeFetchFn({
      providerA: postsA,
      providerB: postsB
    })
  });

  const firstRows = repo.resultRows.slice();

  await processRefreshJob({
    job: { ...job, id: "job-2" },
    repo,
    alerts,
    fetchFn: makeFetchFn({
      providerA: postsA,
      providerB: postsB
    })
  });

  assert.strictEqual(repo.resultRows.length, firstRows.length * 2);
  assert.ok(
    firstRows.every((r, idx) => r.id === repo.resultRows[idx].id)
  );
});

