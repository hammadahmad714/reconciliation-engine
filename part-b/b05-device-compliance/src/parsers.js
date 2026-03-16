function normalize(val) {
  if (val == null) return "";
  const v = String(val).trim();
  if (!v || v === "null" || v === "unknown") return "";
  return v;
}

function parseLocale(props) {
  const v = (k) => normalize(props[k] && props[k].value);
  const persist = v("persist.sys.locale");
  const prod = v("ro.product.locale");
  const lang = v("ro.product.locale.language") || v("persist.sys.language");
  const region = v("ro.product.locale.region") || v("persist.sys.country");

  let effective = "";
  if (persist) effective = persist.replace("_", "-");
  else if (prod) effective = prod.replace("_", "-");
  else if (lang && region) effective = `${lang}-${region}`;

  const all = [persist, prod, lang && region && `${lang}-${region}`].filter(Boolean);
  const distinct = Array.from(new Set(all));

  return { effective, distinctLocales: distinct };
}

function parseWifiEnabled(dumpsysWifi) {
  const out = dumpsysWifi.stdout || "";
  if (!out) return null;
  if (/Wi-Fi is enabled|wifiEnabled=true|Wi-Fi enabled state: 2/.test(out)) return true;
  if (/Wi-Fi is disabled|wifiEnabled=false|Wi-Fi enabled state: 1/.test(out)) return false;
  return null;
}

function parseSavedNetworks(listNetworks, dumpsysWifi) {
  let count = 0;
  let hidden = 0;
  const src = (listNetworks.stdout || "") + "\n" + (dumpsysWifi ? dumpsysWifi.stdout || "" : "");
  const lines = src.split("\n");
  for (const line of lines) {
    if (/networkId|SSID|configured network/.test(line)) {
      count++;
      if (/hiddenSSID=|hiddenSSID: true/i.test(line)) hidden++;
    }
  }
  return { count, hidden };
}

function parseIpInfo(raw) {
  try {
    const json = JSON.parse(raw.stdout || "{}");
    return {
      ok: true,
      data: {
        ip: json.ip || null,
        country: json.country || null,
        org: json.org || "",
        asn: json.asn || json.org || ""
      }
    };
  } catch {
    return { ok: false, data: null };
  }
}

function detectDatacenterOrg(org, hints) {
  const o = (org || "").toLowerCase();
  return hints.some((h) => o.includes(h.toLowerCase()));
}

function parseSimState(simStateRaw, operatorNumericRaw) {
  const stateStr = normalize(simStateRaw.value);
  const opNum = normalize(operatorNumericRaw.value);
  const states = stateStr.split(",").map((s) => s.trim()).filter(Boolean);
  const absent = states.every((s) => s === "ABSENT" || s === "NOT_READY" || s === "UNKNOWN");
  if (absent) {
    if (opNum) {
      return { category: "STALE_MCC", mcc: opNum.slice(0, 3), rawState: stateStr, rawOperator: opNum };
    }
    return { category: "ABSENT", mcc: null, rawState: stateStr, rawOperator: opNum };
  }
  if (!opNum) {
    return { category: "PRESENT_NO_SIGNAL", mcc: null, rawState: stateStr, rawOperator: opNum };
  }
  return { category: "PRESENT_VALID", mcc: opNum.slice(0, 3), rawState: stateStr, rawOperator: opNum };
}

function hasBackgroundLocationPermission(bgStatus) {
  const dumpsys = (bgStatus.dumpsys.stdout || "") + (bgStatus.dumpsys.stderr || "");
  const appops = (bgStatus.appops.stdout || "") + (bgStatus.appops.stderr || "");
  if (/ACCESS_BACKGROUND_LOCATION.*granted=true/i.test(dumpsys)) return true;
  if (/ACCESS_BACKGROUND_LOCATION.*allow/i.test(appops)) return true;
  return false;
}

function parseScreenLock(screenLock) {
  const lockOut = normalize(screenLock.lock.stdout);
  if (lockOut === "true") return { disabled: true };
  if (lockOut === "false") return { disabled: false };
  const pattern = normalize(screenLock.lockPattern.stdout);
  if (pattern === "1") return { disabled: false };
  if (pattern === "0") return { disabled: true };
  return { disabled: null };
}

function parseUsbDebug(usb) {
  const v = normalize(usb.value);
  return v === "1";
}

function parsePackageInstalled(pkgState) {
  const out = normalize(pkgState.path.stdout);
  if (!out) return false;
  return /package:/.test(out);
}

function parseDeviceName(names) {
  const host = normalize(names.hostname.value);
  const dev = normalize(names.deviceName.value);
  return { hostname: host, deviceName: dev };
}

function deviceNameLooksAutomated(name) {
  const n = (name || "").toLowerCase();
  if (!n) return false;
  if (/emulator|test|qa|automation/.test(n)) return true;
  if (/android-\d+|pixel-\d+|device-\d+/.test(n)) return true;
  if (/\d{2,}$/.test(n)) return true;
  return false;
}

function parseAppDataFootprint(foot) {
  const permsDenied =
    /Permission denied/i.test(foot.prefs.stderr || "") ||
    /Permission denied/i.test(foot.dbs.stderr || "");
  const prefsLines = (foot.prefs.stdout || "").split("\n").filter((l) => l.trim());
  const dbLines = (foot.dbs.stdout || "").split("\n").filter((l) => l.trim());
  return {
    permissionDenied: permsDenied,
    hasPrefs: prefsLines.length > 0,
    hasDbs: dbLines.length > 0
  };
}

module.exports = {
  normalize,
  parseLocale,
  parseWifiEnabled,
  parseSavedNetworks,
  parseIpInfo,
  detectDatacenterOrg,
  parseSimState,
  hasBackgroundLocationPermission,
  parseScreenLock,
  parseUsbDebug,
  parsePackageInstalled,
  parseDeviceName,
  deviceNameLooksAutomated,
  parseAppDataFootprint
};

