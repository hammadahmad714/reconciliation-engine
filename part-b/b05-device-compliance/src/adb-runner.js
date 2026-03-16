const { execFile } = require("child_process");

function runAdb(args, { deviceId, timeoutMs = 15000 } = {}) {
  const fullArgs = [];
  if (deviceId) fullArgs.push("-s", deviceId);
  fullArgs.push(...args);

  return new Promise((resolve) => {
    const cmd = "adb";
    execFile(
      cmd,
      fullArgs,
      { timeout: timeoutMs },
      (error, stdout = "", stderr = "") => {
        resolve({
          command: cmd,
          args: fullArgs,
          stdout,
          stderr,
          exitCode: error && typeof error.code === "number" ? error.code : 0,
          error: error ? error.message : null
        });
      }
    );
  });
}

async function getLocaleProps(deviceId) {
  const keys = [
    "persist.sys.locale",
    "ro.product.locale",
    "ro.product.locale.language",
    "ro.product.locale.region",
    "persist.sys.language",
    "persist.sys.country"
  ];
  const results = {};
  for (const k of keys) {
    const res = await runAdb(["shell", "getprop", k], { deviceId });
    results[k] = { ...res, value: res.stdout.trim() };
  }
  return results;
}

async function getTimezone(deviceId) {
  const res = await runAdb(["shell", "getprop", "persist.sys.timezone"], {
    deviceId
  });
  return { ...res, value: res.stdout.trim() };
}

async function getAutoTimezone(deviceId) {
  const res = await runAdb(["shell", "settings", "get", "global", "auto_time_zone"], {
    deviceId
  });
  return { ...res, value: res.stdout.trim() };
}

async function getLocationMode(deviceId) {
  const res = await runAdb(["shell", "settings", "get", "secure", "location_mode"], {
    deviceId
  });
  return { ...res, value: res.stdout.trim() };
}

async function getBackgroundLocationStatus(deviceId, packageName) {
  const dumpsys = await runAdb(["shell", "dumpsys", "package", packageName], {
    deviceId
  });
  const appops = await runAdb(
    ["shell", "cmd", "appops", "get", packageName, "ACCESS_BACKGROUND_LOCATION"],
    { deviceId }
  );
  return { dumpsys, appops };
}

async function getWifiState(deviceId) {
  const wifi = await runAdb(["shell", "dumpsys", "wifi"], { deviceId });
  return wifi;
}

async function getSavedNetworks(deviceId) {
  const list = await runAdb(["shell", "cmd", "wifi", "list-networks"], { deviceId });
  return list;
}

async function getIpInfo(deviceId, endpoint = "https://ipinfo.io/json") {
  const curl = await runAdb(["shell", "curl", "-s", endpoint], { deviceId, timeoutMs: 20000 });
  if (curl.exitCode === 0 && curl.stdout.trim()) {
    return { method: "curl", ...curl };
  }
  const wget = await runAdb(
    ["shell", "toybox", "wget", "-qO-", endpoint],
    { deviceId, timeoutMs: 20000 }
  );
  return { method: curl.exitCode === 0 ? "curl" : "wget", ...wget };
}

async function getSimState(deviceId) {
  const res = await runAdb(["shell", "getprop", "gsm.sim.state"], { deviceId });
  return { ...res, value: res.stdout.trim() };
}

async function getOperatorNumeric(deviceId) {
  const res = await runAdb(["shell", "getprop", "gsm.sim.operator.numeric"], { deviceId });
  return { ...res, value: res.stdout.trim() };
}

async function getTelephonyDump(deviceId) {
  const reg = await runAdb(["shell", "dumpsys", "telephony.registry"], { deviceId });
  const sub = await runAdb(["shell", "dumpsys", "telephony.subscription"], { deviceId });
  const op = await runAdb(["shell", "getprop", "gsm.operator.numeric"], { deviceId });
  return { registry: reg, subscription: sub, operatorNumeric: op };
}

async function getDeviceNames(deviceId) {
  const host = await runAdb(["shell", "getprop", "net.hostname"], { deviceId });
  const name = await runAdb(["shell", "settings", "get", "global", "device_name"], {
    deviceId
  });
  return {
    hostname: { ...host, value: host.stdout.trim() },
    deviceName: { ...name, value: name.stdout.trim() }
  };
}

async function getScreenLockState(deviceId) {
  const lock = await runAdb(["shell", "locksettings", "get-disabled"], { deviceId });
  const secure = await runAdb(
    ["shell", "settings", "get", "secure", "lock_pattern_autolock"],
    { deviceId }
  );
  return { lock, lockPattern: secure };
}

async function getUsbDebuggingState(deviceId) {
  const res = await runAdb(["shell", "settings", "get", "global", "adb_enabled"], {
    deviceId
  });
  return { ...res, value: res.stdout.trim() };
}

async function getPackageState(deviceId, packageName) {
  const path = await runAdb(["shell", "pm", "path", packageName], { deviceId });
  const dumpsys = await runAdb(["shell", "dumpsys", "package", packageName], { deviceId });
  return { path, dumpsys };
}

async function getAppDataFootprint(deviceId, packageName) {
  const prefs = await runAdb(
    ["shell", "ls", `/data/data/${packageName}/shared_prefs`],
    { deviceId }
  );
  const dbs = await runAdb(
    ["shell", "ls", `/data/data/${packageName}/databases`],
    { deviceId }
  );
  return { prefs, dbs };
}

module.exports = {
  runAdb,
  getLocaleProps,
  getTimezone,
  getAutoTimezone,
  getLocationMode,
  getBackgroundLocationStatus,
  getWifiState,
  getSavedNetworks,
  getIpInfo,
  getSimState,
  getOperatorNumeric,
  getTelephonyDump,
  getDeviceNames,
  getScreenLockState,
  getUsbDebuggingState,
  getPackageState,
  getAppDataFootprint
};

