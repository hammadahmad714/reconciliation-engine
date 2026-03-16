const { isSupportWindowOpen, isDeviceRisky } = require("./policies");

async function executeDevice(device, waveIndex, deps) {
  const {
    adbClient,
    snapshotClient,
    complianceValidator,
    policies,
    now
  } = deps;

  const res = {
    deviceId: device.deviceId,
    wave: waveIndex,
    androidVersion: device.androidVersion,
    preflight: null,
    execution: null,
    compliance: null,
    finalStatus: "pending",
    rollback: { attempted: false, succeeded: false, error: null }
  };

  if (device.currentTask) {
    res.preflight = { passed: false, reason: "device_busy", snapshotId: null };
    res.finalStatus = "deferred";
    return res;
  }

  const windowOpen = isSupportWindowOpen(now(), policies);
  if (!windowOpen && isDeviceRisky(device)) {
    res.preflight = { passed: false, reason: "support_window_closed_risky", snapshotId: null };
    res.finalStatus = "deferred";
    return res;
  }

  try {
    await adbClient.ping(device.deviceId);
    await adbClient.echo(device.deviceId);
  } catch (err) {
    res.preflight = { passed: false, reason: "connectivity_failed", snapshotId: null };
    res.finalStatus = "deferred";
    return res;
  }

  const snapshotId = await snapshotClient.snapshot(device.deviceId);
  res.preflight = { passed: true, reason: null, snapshotId };

  let retries = 0;
  let execStatus = "succeeded";
  let execError = null;

  while (retries <= 3) {
    try {
      await adbClient.runScript(device.deviceId, device.androidVersion, "rollout");
      break;
    } catch (err) {
      if (err && err.code === "CONNECTION_LOST") {
        retries += 1;
        if (retries > 3) {
          execStatus = "interrupted";
          execError = err.message;
          break;
        }
        continue;
      }
      execStatus = "failed";
      execError = err.message;
      break;
    }
  }

  res.execution = { status: execStatus, retries, error: execError };

  if (execStatus === "interrupted") {
    res.compliance = { passed: null, failures: [], warnings: [] };
    res.finalStatus = "interrupted";
    return res;
  }

  if (execStatus === "failed") {
    res.compliance = { passed: false, failures: ["script_failed"], warnings: [] };
    res.finalStatus = "failed";
    return res;
  }

  const comp = await complianceValidator.validate(device.deviceId);
  res.compliance = comp;
  if (!comp.pass) {
    res.finalStatus = "failed";
  } else {
    res.finalStatus = "succeeded";
  }

  return res;
}

module.exports = {
  executeDevice
};

