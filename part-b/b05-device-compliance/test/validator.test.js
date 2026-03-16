const assert = require("assert");
const { evaluate } = require("../src/validator");
const { defaultPolicy } = require("../src/config");

function baseRaw() {
  const policy = defaultPolicy();
  return {
    locale: {
      "persist.sys.locale": { value: policy.expectedLocale },
      "ro.product.locale": { value: policy.expectedLocale },
      "ro.product.locale.language": { value: "en" },
      "ro.product.locale.region": { value: "US" },
      "persist.sys.language": { value: "en" },
      "persist.sys.country": { value: "US" }
    },
    timezone: { value: policy.expectedTimezone },
    autoTimezone: { value: "0" },
    locationMode: { value: "0" },
    backgroundLocation: [],
    wifiState: { stdout: "Wi-Fi is disabled" },
    savedNetworks: { stdout: "" },
    ipInfo: { stdout: JSON.stringify({ ip: "1.1.1.1", country: "US", org: "ISP Inc" }) },
    simState: { value: "ABSENT" },
    operatorNumeric: { value: "" },
    deviceNames: {
      hostname: { value: "user-phone" },
      deviceName: { value: "User Phone" }
    },
    screenLock: {
      lock: { stdout: "false" },
      lockPattern: { stdout: "1" }
    },
    usbDebug: { value: "0" },
    packageState: {
      path: { stdout: "package:/data/app/com.example.app-1/base.apk" }
    },
    appDataFootprint: {
      prefs: { stdout: "", stderr: "" },
      dbs: { stdout: "", stderr: "" }
    }
  };
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

test("stale MCC trap: SIM absent but operator numeric set", () => {
  const raw = baseRaw();
  raw.simState.value = "ABSENT";
  raw.operatorNumeric.value = "45201";
  const out = evaluate(raw);
  const warn = out.warnings.find((w) => w.code === "STALE_MCC");
  assert.ok(warn, "expected STALE_MCC warning");
  assert.ok(out.pass, "overall pass should still be true");
});

test("conflicting locale properties across getprop values", () => {
  const raw = baseRaw();
  raw.locale["persist.sys.locale"].value = "en-US";
  raw.locale["ro.product.locale"].value = "vi-VN";
  const out = evaluate(raw);
  const warn = out.warnings.find((w) => w.code === "LOCALE_INCONSISTENT");
  assert.ok(warn, "expected LOCALE_INCONSISTENT warning");
});

test("location_mode off but package holds background location permission", () => {
  const raw = baseRaw();
  raw.backgroundLocation = [
    {
      package: "com.risky.app",
      status: {
        dumpsys: { stdout: "ACCESS_BACKGROUND_LOCATION: granted=true", stderr: "" },
        appops: { stdout: "", stderr: "" }
      }
    }
  ];
  const out = evaluate(raw);
  const fail = out.failures.find((f) => f.code === "BACKGROUND_LOCATION_RISK");
  assert.ok(fail);
  assert.strictEqual(out.pass, false);
});

test("no saved WiFi networks", () => {
  const raw = baseRaw();
  const out = evaluate(raw);
  const wifiFail = out.failures.find((f) => f.code === "WIFI_SAVED_NETWORKS");
  assert.ok(!wifiFail);
});

test("hidden saved WiFi network exists", () => {
  const raw = baseRaw();
  raw.savedNetworks.stdout = "networkId: 0 SSID: <hidden> hiddenSSID=true";
  const out = evaluate(raw);
  const wifiFail = out.failures.find((f) => f.code === "WIFI_SAVED_NETWORKS");
  assert.ok(wifiFail);
  assert.ok(wifiFail.details.hidden >= 1);
});

test("timezone correct but auto_time_zone enabled", () => {
  const raw = baseRaw();
  raw.autoTimezone.value = "1";
  const out = evaluate(raw);
  const fail = out.failures.find((f) => f.code === "AUTO_TZ_ENABLED");
  assert.ok(fail);
});

test("device name contains automation-style sequential numbering", () => {
  const raw = baseRaw();
  raw.deviceNames.hostname.value = "qa-device-07";
  const out = evaluate(raw);
  const warn = out.warnings.find((w) => w.code === "DEVICE_NAME_AUTOMATION");
  assert.ok(warn);
});

test("usb debugging enabled", () => {
  const raw = baseRaw();
  raw.usbDebug.value = "1";
  const out = evaluate(raw);
  const fail = out.failures.find((f) => f.code === "ADB_ENABLED");
  assert.ok(fail);
});

test("target app not installed", () => {
  const raw = baseRaw();
  raw.packageState.path.stdout = "";
  const out = evaluate(raw);
  const fail = out.failures.find((f) => f.code === "APP_NOT_INSTALLED");
  assert.ok(fail);
});

test("package installed but app data inspection permission denied", () => {
  const raw = baseRaw();
  raw.appDataFootprint.prefs.stderr = "Permission denied";
  const out = evaluate(raw);
  const warn = out.warnings.find((w) => w.code === "APP_DATA_UNCHECKED");
  assert.ok(warn);
});

test("IP country not US", () => {
  const raw = baseRaw();
  raw.ipInfo.stdout = JSON.stringify({ ip: "2.2.2.2", country: "DE", org: "ISP" });
  const out = evaluate(raw);
  const fail = out.failures.find((f) => f.code === "IP_COUNTRY_MISMATCH");
  assert.ok(fail);
});

test("datacenter-looking IP org warning", () => {
  const raw = baseRaw();
  raw.ipInfo.stdout = JSON.stringify({
    ip: "3.3.3.3",
    country: "US",
    org: "DigitalOcean, LLC"
  });
  const out = evaluate(raw);
  const warn = out.warnings.find((w) => w.code === "DATACENTER_IP");
  assert.ok(warn);
});

