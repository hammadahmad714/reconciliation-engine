### Overview

This module validates Android device compliance by executing real ADB shell commands and evaluating their outputs against a policy. `src/adb-runner.js` centralizes all `adb` invocations; `src/validator.js` consumes those raw results and returns `{ pass, failures, warnings, details }` for downstream reporting.

### ADB commands by check

- **Locale**: `adb shell getprop` for `persist.sys.locale`, `ro.product.locale`, `ro.product.locale.language`, `ro.product.locale.region`, `persist.sys.language`, `persist.sys.country`. Multiple properties are pulled because OEMs often disagree across properties; the validator derives an effective locale while also flagging inconsistent values.
- **Timezone**: `adb shell getprop persist.sys.timezone` and `adb shell settings get global auto_time_zone`.
- **Location**: `adb shell settings get secure location_mode`, plus for each configured package: `adb shell dumpsys package <pkg>` and `adb shell cmd appops get <pkg> ACCESS_BACKGROUND_LOCATION`.
- **WiFi**: `adb shell dumpsys wifi` and `adb shell cmd wifi list-networks` to detect enabled state and both visible and hidden saved networks.
- **IP**: `adb shell curl -s https://ipinfo.io/json` first, then `adb shell toybox wget -qO- https://ipinfo.io/json` as fallback. If both fail, the validator records a warning instead of pretending success.
- **SIM / MCC**: `adb shell getprop gsm.sim.state`, `adb shell getprop gsm.sim.operator.numeric`, and `adb shell dumpsys telephony.*` for additional context. SIM state `ABSENT` with a non-empty operator numeric is treated as a stale MCC and only warned on.
- **Device name**: `adb shell getprop net.hostname` and `adb shell settings get global device_name`.
- **Screen lock**: `adb shell locksettings get-disabled` with a fallback of `adb shell settings get secure lock_pattern_autolock`, using only non-destructive reads.
- **USB debugging**: `adb shell settings get global adb_enabled`.
- **App state**: `adb shell pm path <pkg>`, `adb shell dumpsys package <pkg>`, and `adb shell ls /data/data/<pkg>/shared_prefs` / `databases`. Permission-denied results are treated as a separate warning, not a silent pass.

### Policy and limitations

Policy defaults (expected locale/timezone, allowed MCCs, datacenter org hints, target package) live in `src/config.js` and can be adjusted per environment. The validator treats location_mode=0 as necessary but not sufficient; background location access in monitored packages is an explicit failure even if system location is off. Hidden WiFi networks are detected by scanning both `list-networks` and `dumpsys wifi` output for hiddenSSID flags. On-device IP checks are limited by the presence of curl/wget and the fidelity of the IP metadata service; when clients are missing or responses are unparsable, the module records a warning instead of inferring compliance. App data inspection without root or a debuggable context is also limited; permission errors are surfaced as structured warnings so reviewers can factor that uncertainty into their decision.

