let WorkerClass;
try {
  // Optional at runtime; tests don't require a live Worker instance.
  ({ Worker: WorkerClass } = require("bullmq"));
} catch (_) {
  WorkerClass = class DummyWorker {};
}
const { fetchProviderPosts } = require("./providers");
const { reconcilePosts } = require("./reconcile");
const { handleBatchOutcome } = require("./batch-guard");
const { isJobStale } = require("./stale-jobs");

async function processRefreshJob({ job, repo, alerts, fetchFn }) {
  const { accountId, batchId, expectedProviderCounts } = job.data;

  const failureState = await repo.getAccountFailureState(accountId);
  if (failureState.flagged) {
    await alerts.emit({ type: "account_manual_review_block", accountId });
    return;
  }

  if (isJobStale(job)) {
    await alerts.emit({ type: "job_stale_requeued", jobId: job.id });
    throw new Error("job_stale");
  }

  const attempt = await repo.insertAttempt({
    jobId: job.id,
    accountId,
    batchId
  });

  try {
    const [aRes, bRes] = await Promise.all([
      fetchProviderPosts("providerA", accountId, {
        expectedCount: expectedProviderCounts?.providerA,
        timeoutMs: 8000,
        fetchFn
      }),
      fetchProviderPosts("providerB", accountId, {
        expectedCount: expectedProviderCounts?.providerB,
        timeoutMs: 8000,
        fetchFn
      })
    ]);

    const incomplete =
      !aRes.complete ||
      !bRes.complete ||
      aRes.posts.length !== expectedProviderCounts?.providerA ||
      bRes.posts.length !== expectedProviderCounts?.providerB;

    const reconciled = reconcilePosts(aRes, bRes);

    const tx = await repo.beginTransaction();
    try {
      const resultSet = await repo.insertResultSet({
        attemptId: attempt.id,
        providerSummary: {
          providerA: { count: aRes.posts.length, complete: aRes.complete },
          providerB: { count: bRes.posts.length, complete: bRes.complete }
        }
      });
      await repo.insertResultRows({
        resultSetId: resultSet.id,
        rows: reconciled
      });

      const status = incomplete ? "partial" : "success";
      const detail = incomplete
        ? "incomplete_provider_data"
        : "full_success";

      await repo.insertImmutableJobResult({
        attemptId: attempt.id,
        status,
        detail
      });

      if (!incomplete) {
        await repo.resetAccountFailure(accountId);
        await repo.markAttemptSucceeded(attempt.id);
      } else {
        await repo.incrementAccountFailure(accountId);
        await repo.markAttemptFailed(attempt.id, detail);
      }

      await tx.commit();
      await handleBatchOutcome(repo, alerts, batchId, !incomplete);

      const state = await repo.getAccountFailureState(accountId);
      if (state.consecutive >= 3 && !state.flagged) {
        await repo.flagManualReview(accountId);
        await alerts.emit({
          type: "account_manual_review_required",
          accountId
        });
      }
    } catch (err) {
      await tx.rollback();
      await repo.incrementAccountFailure(accountId);
      await repo.markAttemptFailed(attempt.id, "write_failure");
      await handleBatchOutcome(repo, alerts, batchId, false);
      throw err;
    }
  } catch (err) {
    await repo.incrementAccountFailure(accountId);
    await repo.markAttemptFailed(attempt.id, err.message || "error");
    await handleBatchOutcome(repo, alerts, batchId, false);
    throw err;
  }
}

function createWorker(queueName, repo, alerts, fetchFn, connection) {
  return new WorkerClass(
    queueName,
    (job) =>
      processRefreshJob({
        job,
        repo,
        alerts,
        fetchFn
      }),
    {
      connection,
      lockDuration: 600000
    }
  );
}

module.exports = {
  processRefreshJob,
  createWorker
};

