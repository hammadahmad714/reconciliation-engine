#!/usr/bin/env node

const { loadConfig } = require("./config");
const { getConnectedDevices } = require("./adb");
const { runAutomation } = require("./state-machine");
const { logLine } = require("./logger");

async function main() {
  const cfg = loadConfig();
  const devices = await getConnectedDevices();
  const deviceId = cfg.deviceId || devices[0];
  if (!deviceId) {
    throw new Error("No connected devices");
  }

  logLine(deviceId, {
    action: "start_run",
    state_before: "init",
    state_after: "init",
    success: true
  });

  try {
    await runAutomation(deviceId, cfg);
    logLine(deviceId, {
      action: "run_complete",
      state_before: "unknown",
      state_after: "done",
      success: true
    });
  } catch (err) {
    logLine(deviceId, {
      action: "run_failed",
      state_before: "unknown",
      state_after: "failed",
      success: false,
      error: err.message
    });
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

