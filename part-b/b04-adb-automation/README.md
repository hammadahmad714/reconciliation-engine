### Overview

This module is an ADB-based harness that opens a social app, scrolls the feed, likes a configurable number of posts, navigates to a target account, and uploads a post from the gallery. All orchestration goes through `state-machine.js`, which drives the app by repeatedly detecting the current state and applying small, verifiable transitions.

### State detection

`detectors.js` uses `adb shell uiautomator dump` and parses the resulting XML into a flat node list. Screen states such as `home_feed`, `account_profile`, `gallery_picker`, and `popup` are inferred from focused package/activity plus semantic hints like visible text and layout class names. Screenshot-based logic is intentionally avoided in the core path; hierarchy parsing is more stable across app versions and densities, and exposes bounds we can tap without hardcoded coordinates.

### Resolution handling

`adb.js` queries `wm size` and all taps/swipes are either derived from UI node bounds (center of `bounds`) or from normalized ratios (e.g. 0.5x, 0.8y) converted to actual pixels. Scrolls use randomized distance and duration within configured ranges, so the same script behaves sensibly on 720p, 1080p, or 1440p devices without rewriting coordinates.

### Popups and recovery

`actions.handlePopup` detects common dialog buttons using config-driven text labels and closes them via bounds taps or a conservative back-tap. The state machine treats `popup` as a first-class state and will dismiss it before continuing. On unexpected failures, `recoverToKnownState` backs out toward `home_feed` using a mix of popup handling, app relaunch, and soft back navigations.

### Debugging missed likes and limitations

Every action logs a JSON line with timestamp, `device_id`, `action`, `state_before`, `state_after`, success flag, and details. When a device consistently misses the like button, you can inspect these logs plus `uiautomator` XML dumps to refine post-node heuristics or add device-specific fallbacks while keeping the main interactions bounds-based. Real apps still change layouts, throttle automation, and occasionally hide elements; hardening this for production would involve per-version layouts, visual checks on critical paths, and live metrics on failure modes.

### Running and config

Edit `config.json` to set `app.package`, `app.launchActivity`, `targetAccount`, `captionText`, `likeCount`, and timing/scroll ranges. Then run:

```bash
node part-b/b04-adb-automation/src/script.js
```

The design avoids brittle fixed coordinates and blind sleeps by always re-detecting state between actions and polling for conditions within bounded timeouts.

