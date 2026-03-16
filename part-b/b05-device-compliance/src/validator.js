const {
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
} = require("./parsers");
const { defaultPolicy } = require("./config");

function addFailure(out, code, message, details) {
  out.failures.push({ code, message, details });
}

function addWarning(out, code, message, details) {
  out.warnings.push({ code, message, details });
}

function evaluate(raw, policy = defaultPolicy()) {
  const result = {
    pass: true,
    failures: [],
    warnings: [],
    details: raw
  };

  // Locale
  const localeInfo = parseLocale(raw.locale);
  if (!localeInfo.effective || localeInfo.effective !== policy.expectedLocale) {
    addFailure(result, "LOCALE_MISMATCH", "Effective locale not compliant", {
      effective: localeInfo.effective,
      expected: policy.expectedLocale,
      props: raw.locale
    });
  }
  if (localeInfo.distinctLocales.length > 1) {
    addWarning(result, "LOCALE_INCONSISTENT", "Locale-related props disagree", {
      distinct: localeInfo.distinctLocales
    });
  }

  // Timezone
  if (raw.timezone.value !== policy.expectedTimezone) {
    addFailure(result, "TIMEZONE_MISMATCH", "Timezone not compliant", {
      value: raw.timezone.value,
      expected: policy.expectedTimezone
    });
  }
  if (raw.autoTimezone.value !== "0") {
    addFailure(result, "AUTO_TZ_ENABLED", "Auto time zone must be disabled", {
      value: raw.autoTimezone.value
    });
  }

  // Location mode and background location
  if (raw.locationMode.value !== "0") {
    addFailure(result, "LOCATION_MODE_ON", "location_mode must be off (0)", {
      value: raw.locationMode.value
    });
  }
  if (raw.backgroundLocation) {
    for (const pkg of raw.backgroundLocation) {
      if (hasBackgroundLocationPermission(pkg.status)) {
        addFailure(
          result,
          "BACKGROUND_LOCATION_RISK",
          `Package ${pkg.package} has background location permission`,
          {}
        );
      }
    }
  }

  // WiFi
  const wifiEnabled = parseWifiEnabled(raw.wifiState);
  const nets = parseSavedNetworks(raw.savedNetworks, raw.wifiState);
  if (wifiEnabled === true) {
    addFailure(result, "WIFI_ENABLED", "WiFi must be disabled", {});
  }
  if (nets.count > 0) {
    addFailure(result, "WIFI_SAVED_NETWORKS", "Saved WiFi networks present", {
      count: nets.count,
      hidden: nets.hidden
    });
  }

  // IP validation
  const ipParsed = parseIpInfo(raw.ipInfo);
  if (!ipParsed.ok || !ipParsed.data) {
    addWarning(result, "IP_CHECK_UNAVAILABLE", "Could not validate IP from device", {
      stdout: raw.ipInfo.stdout,
      stderr: raw.ipInfo.stderr
    });
  } else {
    const { country, org } = ipParsed.data;
    if (country !== policy.allowedIpCountry) {
      addFailure(result, "IP_COUNTRY_MISMATCH", "IP country not allowed", {
        country,
        expected: policy.allowedIpCountry
      });
    }
    if (detectDatacenterOrg(org, policy.datacenterOrgHints)) {
      addWarning(result, "DATACENTER_IP", "IP org looks like datacenter/hosting", {
        org
      });
    }
  }

  // SIM / MCC
  const simInfo = parseSimState(raw.simState, raw.operatorNumeric);
  if (simInfo.category === "STALE_MCC") {
    addWarning(result, "STALE_MCC", "Stale MCC with SIM absent", simInfo);
  }
  if (simInfo.category === "PRESENT_VALID" && simInfo.mcc && !policy.allowedMcc.includes(simInfo.mcc)) {
    addFailure(result, "MCC_NOT_ALLOWED", "SIM MCC not allowed", simInfo);
  }

  // Device name
  const dn = parseDeviceName(raw.deviceNames);
  if (deviceNameLooksAutomated(dn.hostname) || deviceNameLooksAutomated(dn.deviceName)) {
    addWarning(result, "DEVICE_NAME_AUTOMATION", "Device name looks like automation/test", dn);
  }

  // Screen lock
  const lock = parseScreenLock(raw.screenLock);
  if (lock.disabled === true) {
    addFailure(result, "LOCK_DISABLED", "Screen lock is disabled", {});
  } else if (lock.disabled === null) {
    addWarning(result, "LOCK_UNKNOWN", "Could not determine lock screen state", {});
  }

  // USB debugging
  const usbOn = parseUsbDebug(raw.usbDebug);
  if (usbOn) {
    addFailure(result, "ADB_ENABLED", "USB debugging must be disabled", {
      value: raw.usbDebug.value
    });
  }

  // App state
  const installed = parsePackageInstalled(raw.packageState);
  if (!installed) {
    addFailure(result, "APP_NOT_INSTALLED", "Target app is not installed", {});
  }

  const appData = parseAppDataFootprint(raw.appDataFootprint);
  if (appData.permissionDenied) {
    addWarning(
      result,
      "APP_DATA_UNCHECKED",
      "App data footprint could not be inspected due to permissions",
      {}
    );
  } else if (appData.hasPrefs || appData.hasDbs) {
    addWarning(
      result,
      "APP_DATA_LEFTOVER",
      "Target app has leftover prefs/databases",
      { hasPrefs: appData.hasPrefs, hasDbs: appData.hasDbs }
    );
  }

  result.pass = result.failures.length === 0;
  return result;
}

async function validateDevice(adb, deviceId, policy = defaultPolicy()) {
  const [locale, timezone, autoTz, locMode, simState, opNum, devNames, screenLock, usbDebug] =
    await Promise.all([
      adb.getLocaleProps(deviceId),
      adb.getTimezone(deviceId),
      adb.getAutoTimezone(deviceId),
      adb.getLocationMode(deviceId),
      adb.getSimState(deviceId),
      adb.getOperatorNumeric(deviceId),
      adb.getDeviceNames(deviceId),
      adb.getScreenLockState(deviceId),
      adb.getUsbDebuggingState(deviceId)
    ]);

  const wifiState = await adb.getWifiState(deviceId);
  const savedNetworks = await adb.getSavedNetworks(deviceId);
  const ipInfo = await adb.getIpInfo(deviceId);

  const backgroundLocation = [];
  for (const pkg of policy.backgroundLocationPackages) {
    const status = await adb.getBackgroundLocationStatus(deviceId, pkg);
    backgroundLocation.push({ package: pkg, status });
  }

  const packageState = await adb.getPackageState(deviceId, policy.targetPackage);
  const appDataFootprint = await adb.getAppDataFootprint(deviceId, policy.targetPackage);

  const raw = {
    locale,
    timezone,
    autoTimezone: autoTz,
    locationMode: locMode,
    backgroundLocation,
    wifiState,
    savedNetworks,
    ipInfo,
    simState,
    operatorNumeric: opNum,
    deviceNames: devNames,
    screenLock,
    usbDebug,
    packageState,
    appDataFootprint
  };

  return evaluate(raw, policy);
}

module.exports = {
  evaluate,
  validateDevice
};

