const { execFile } = require("child_process");

function runAdb(args, { deviceId, timeoutMs = 15000 } = {}) {
  const fullArgs = [];
  if (deviceId) {
    fullArgs.push("-s", deviceId);
  }
  fullArgs.push(...args);

  return new Promise((resolve, reject) => {
    const child = execFile("adb", fullArgs, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
    child.on("error", reject);
  });
}

async function getConnectedDevices() {
  const { stdout } = await runAdb(["devices"]);
  return stdout
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\t")[0]);
}

async function getWindowSize(deviceId) {
  const { stdout } = await runAdb(["shell", "wm", "size"], { deviceId });
  const m = stdout.match(/Physical size:\s*(\d+)x(\d+)/);
  if (!m) return { width: 1080, height: 1920 };
  return { width: Number(m[1]), height: Number(m[2]) };
}

async function getCurrentFocus(deviceId) {
  const { stdout } = await runAdb(["shell", "dumpsys", "window", "windows"], {
    deviceId
  });
  const m = stdout.match(/mCurrentFocus.+ (.+)\/(.+)\}/);
  if (!m) return null;
  return { pkg: m[1], activity: m[2] };
}

async function dumpUiHierarchy(deviceId, tmpPath = "/sdcard/window_dump.xml") {
  await runAdb(["shell", "uiautomator", "dump", tmpPath], { deviceId });
  const { stdout } = await runAdb(["shell", "cat", tmpPath], { deviceId });
  return stdout;
}

async function tap(deviceId, x, y) {
  await runAdb(["shell", "input", "tap", String(x), String(y)], { deviceId });
}

async function swipe(deviceId, x1, y1, x2, y2, durationMs) {
  await runAdb(
    ["shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2), String(durationMs)],
    { deviceId }
  );
}

async function tapBounds(deviceId, bounds) {
  const [x1, y1, x2, y2] = bounds;
  const x = Math.round((x1 + x2) / 2);
  const y = Math.round((y1 + y2) / 2);
  await tap(deviceId, x, y);
}

async function tapNormalized(deviceId, { width, height }, xRatio, yRatio) {
  const x = Math.round(width * xRatio);
  const y = Math.round(height * yRatio);
  await tap(deviceId, x, y);
}

module.exports = {
  runAdb,
  getConnectedDevices,
  getWindowSize,
  getCurrentFocus,
  dumpUiHierarchy,
  tapBounds,
  tapNormalized,
  swipe
};

