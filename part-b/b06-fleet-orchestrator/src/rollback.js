async function rollbackDevice(device, snapshotId, { rollbackClient }) {
  try {
    await rollbackClient.applySnapshot(device.deviceId, snapshotId);
    return { attempted: true, succeeded: true, error: null };
  } catch (err) {
    return { attempted: true, succeeded: false, error: err.message };
  }
}

async function rollbackWave(devicesResults, deps) {
  const out = [];
  for (const r of devicesResults) {
    if (!r.preflight || !r.preflight.snapshotId) continue;
    const rb = await rollbackDevice(r, r.preflight.snapshotId, deps);
    out.push({ deviceId: r.deviceId, rollback: rb });
  }
  return out;
}

module.exports = {
  rollbackDevice,
  rollbackWave
};

