const { planWaves } = require("./wave-planner");
const { Dashboard } = require("./dashboard");
const { failureRate } = require("./policies");
const { rollbackWave } = require("./rollback");
const { executeDevice } = require("./executor");

async function runRollout(deps) {
  const {
    deviceService,
    adbClient,
    snapshotClient,
    complianceValidator,
    rollbackClient,
    policies,
    now
  } = deps;

  const devices = await deviceService.fetchDevices();
  const dashboard = new Dashboard();
  dashboard.setInitial(devices);

  let waves = planWaves(devices, policies);
  if (!waves.length && devices.length) {
    waves = [devices];
  }
  const allResults = [];
  let globalCompleted = 0;
  let globalFailures = 0;

  for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
    const wave = waves[waveIndex];
    const waveResults = [];

    for (const device of wave) {
      dashboard.update(device.deviceId, { wave: waveIndex + 1, status: "in_progress" });
      const res = await executeDevice(device, waveIndex + 1, {
        adbClient,
        snapshotClient,
        complianceValidator,
        policies,
        now
      });
      waveResults.push(res);
      allResults.push(res);

      dashboard.update(device.deviceId, { status: res.finalStatus, preflight: res.preflight, execution: res.execution, compliance: res.compliance, rollback: res.rollback });

      if (res.finalStatus === "succeeded" || res.finalStatus === "failed") {
        globalCompleted += 1;
        if (res.finalStatus === "failed") globalFailures += 1;
      }
    }

    const waveFailures = waveResults.filter((r) => r.finalStatus === "failed").length;
    const waveCompleted = waveResults.filter(
      (r) => r.finalStatus === "succeeded" || r.finalStatus === "failed"
    ).length;

    const waveFailureRate = failureRate(waveFailures, waveCompleted);

    if (waveFailureRate > policies.maxFailureRate) {
      const rb = await rollbackWave(waveResults, { rollbackClient });
      for (const r of rb) {
        dashboard.update(r.deviceId, {
          status: r.rollback.succeeded ? "rolled_back" : "rollback_failed",
          rollback: r.rollback
        });
      }
      break;
    }
  }

  return {
    results: allResults,
    dashboard: dashboard.summary()
  };
}

module.exports = {
  runRollout
};

