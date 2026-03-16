function logLine(deviceId, payload) {
  const entry = {
    ts: new Date().toISOString(),
    device_id: deviceId,
    ...payload
  };
  // stdout JSONL; in production this would go to a sink.
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

module.exports = {
  logLine
};

