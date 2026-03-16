### Overview

This orchestrator coordinates staged rollouts across a fleet of Android devices reachable via ADB over a proxy. It batches devices into waves, enforces a strict canary first wave, runs pre-flight checks, executes a configuration script with connection-drop handling, validates post-rollout compliance, and performs automatic rollback when a wave exceeds the failure threshold. All behavior is driven via dependency injection so device APIs, ADB adapters, and validators can be swapped in tests or production.

### Wave planning and canary behavior

`wave-planner.js` builds waves from the normalized device list. Wave 1 selects up to five idle devices with good connections, favoring one per Android version where possible. Wave 2 defaults to 20 devices, and later waves grow by a scale factor. If any device in wave 1 fails, the orchestrator treats this as a hard canary failure: the wave is rolled back and no subsequent waves run. For later waves, scaling stops and rollback triggers when that wave’s failure rate exceeds the configured threshold.

### Interrupted vs failed, rollback, and support window

`executor.js` performs pre-flight checks (connectivity, idleness, snapshot), applies support-window policy (`policies.isSupportWindowOpen`) and device risk (`policies.isDeviceRisky`), and then runs the rollout script via `adb-client`. If the connection drops mid-script, it retries up to three times; after that the device is marked `interrupted`, which does not increment failure counters and does not participate in wave rollback decisions. Rollback is wave-scoped: `rollback.js` iterates devices in the affected wave and applies their snapshotted configuration, tracking `rolled_back` vs `rollback_failed`. Risky devices outside the on-site support window are deferred at pre-flight and never started.

### Android versions, dashboard, and hardening

Android version differences are modeled by passing the version into `adbClient.runScript` and leaving concrete command differences in the adapter layer, keeping the orchestration logic version-agnostic. `dashboard.js` maintains per-device status and a simple summary of counts by state (`pending`, `deferred`, `in_progress`, `succeeded`, `failed`, `interrupted`, `rolled_back`, `rollback_failed`). To productionize this, you’d harden snapshotting and rollback semantics, add real-time streaming of dashboard state, incorporate per-version rollout policies, and wire in real compliance validators and device-status APIs, but the control flow and failure/rollback semantics are already enforced here.

