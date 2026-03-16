const assert = require("assert");
const { runRollout } = require("../src/orchestrator");

function makeDeps(overrides = {}) {
  const devices = overrides.devices || [];
  const deviceService = {
    fetchDevices: async () => devices
  };
  const adbClient = {
    ping: async () => {},
    echo: async () => {},
    runScript: async () => {}
  };
  const snapshotClient = {
    snapshot: async () => "snap-1"
  };
  const complianceValidator = {
    validate: async () => ({ pass: true, failures: [], warnings: [] })
  };
  const rollbackClient = {
    applySnapshot: async () => {}
  };
  const policies = {
    supportWindow: { startHour: 9, endHour: 17 },
    tzOffsetHours: 0,
    maxFailureRate: 0.02,
    scaleFactor: 2
  };
  const now = () => new Date(Date.UTC(2025, 0, 1, 10, 0, 0));

  return {
    deviceService,
    adbClient,
    snapshotClient,
    complianceValidator,
    rollbackClient,
    policies,
    now,
    ...overrides
  };
}

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(
      () => console.log("ok -", name),
      (e) => {
        console.error("FAIL -", name);
        console.error(e.stack || e);
        process.exitCode = 1;
      }
    );
}

const baseDevices = [
  { deviceId: "d1", androidVersion: "8", currentTask: null, connectionQuality: "good" },
  { deviceId: "d2", androidVersion: "9", currentTask: null, connectionQuality: "good" },
  { deviceId: "d3", androidVersion: "10", currentTask: null, connectionQuality: "good" },
  { deviceId: "d4", androidVersion: "11", currentTask: null, connectionQuality: "good" },
  { deviceId: "d5", androidVersion: "11", currentTask: null, connectionQuality: "good" }
];

test("wave 1 where 1 of 5 fails halts everything", async () => {
  const devices = baseDevices;
  let count = 0;
  const deps = makeDeps({
    devices,
    complianceValidator: {
      validate: async () => {
        count += 1;
        if (count === 1) return { pass: false, failures: ["bad"], warnings: [] };
        return { pass: true, failures: [], warnings: [] };
      }
    }
  });
  const { results, dashboard } = await runRollout(deps);
  assert.strictEqual(results.length, 5);
  const failed = results.filter((r) => r.finalStatus === "failed").length;
  assert.strictEqual(failed, 1);
  assert.ok(dashboard.counts["rolled_back"] || dashboard.counts["rollback_failed"]);
});

test("connection drop mid-script retries then marks interrupted", async () => {
  const devices = [baseDevices[0]];
  let attempts = 0;
  const deps = makeDeps({
    devices,
    adbClient: {
      ping: async () => {},
      echo: async () => {},
      runScript: async () => {
        attempts += 1;
        const err = new Error("lost");
        err.code = "CONNECTION_LOST";
        throw err;
      }
    }
  });
  const { results } = await runRollout(deps);
  assert.strictEqual(attempts, 4); // initial + 3 retries
  assert.strictEqual(results[0].finalStatus, "interrupted");
});

test("rollback scenario when failure rate exceeds threshold", async () => {
  const devices = baseDevices.concat(
    { deviceId: "d6", androidVersion: "11", currentTask: null, connectionQuality: "good" }
  );
  const deps = makeDeps({
    devices,
    complianceValidator: {
      validate: async (id) => {
        if (id === "d1" || id === "d2") return { pass: false, failures: ["bad"], warnings: [] };
        return { pass: true, failures: [], warnings: [] };
      }
    },
    policies: {
      supportWindow: { startHour: 9, endHour: 17 },
      tzOffsetHours: 0,
      maxFailureRate: 0.1,
      scaleFactor: 2
    }
  });
  const { results, dashboard } = await runRollout(deps);
  const wave1 = results.filter((r) => r.wave === 1);
  const rbCount = (dashboard.counts["rolled_back"] || 0) + (dashboard.counts["rollback_failed"] || 0);
  assert.ok(wave1.length >= 5);
  assert.ok(rbCount >= 1);
});

test("device busy with current_task is deferred", async () => {
  const devices = [
    { deviceId: "busy1", androidVersion: "10", currentTask: "campaign", connectionQuality: "good" }
  ];
  const deps = makeDeps({ devices });
  const { results } = await runRollout(deps);
  assert.strictEqual(results[0].finalStatus, "deferred");
  assert.strictEqual(results[0].preflight.reason, "device_busy");
});

test("flaky connection but successful retry continues", async () => {
  const devices = [baseDevices[0]];
  let calls = 0;
  const deps = makeDeps({
    devices,
    adbClient: {
      ping: async () => {},
      echo: async () => {},
      runScript: async () => {
        calls += 1;
        if (calls === 1) {
          const err = new Error("lost");
          err.code = "CONNECTION_LOST";
          throw err;
        }
      }
    }
  });
  const { results } = await runRollout(deps);
  assert.strictEqual(results[0].finalStatus, "succeeded");
});

test("compliance validator failure after update counted as failure", async () => {
  const devices = [baseDevices[0]];
  const deps = makeDeps({
    devices,
    complianceValidator: {
      validate: async () => ({ pass: false, failures: ["post"], warnings: [] })
    }
  });
  const { results } = await runRollout(deps);
  assert.strictEqual(results[0].finalStatus, "failed");
});

test("failure rate under threshold proceeds to next wave", async () => {
  const devices = baseDevices.concat(
    { deviceId: "d6", androidVersion: "10", currentTask: null, connectionQuality: "good" },
    { deviceId: "d7", androidVersion: "9", currentTask: null, connectionQuality: "good" }
  );
  let count = 0;
  const deps = makeDeps({
    devices,
    complianceValidator: {
      validate: async () => {
        count += 1;
        if (count === 1) return { pass: false, failures: ["bad"], warnings: [] };
        return { pass: true, failures: [], warnings: [] };
      }
    },
    policies: {
      supportWindow: { startHour: 9, endHour: 17 },
      tzOffsetHours: 0,
      maxFailureRate: 0.5,
      scaleFactor: 2
    }
  });
  const { results } = await runRollout(deps);
  const waves = new Set(results.map((r) => r.wave));
  assert.ok(waves.size >= 2);
});

test("support window closed for risky device is deferred", async () => {
  const devices = [
    { deviceId: "risk1", androidVersion: "9", currentTask: null, connectionQuality: "flaky" }
  ];
  const deps = makeDeps({
    devices,
    now: () => new Date(Date.UTC(2025, 0, 1, 2, 0, 0)) // outside 9-17
  });
  const { results } = await runRollout(deps);
  assert.strictEqual(results[0].finalStatus, "deferred");
  assert.strictEqual(results[0].preflight.reason, "support_window_closed_risky");
});

