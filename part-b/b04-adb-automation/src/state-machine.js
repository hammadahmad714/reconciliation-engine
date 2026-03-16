const { detectState, waitForState } = require("./detectors");
const { handlePopup, ensureHomeFeed, likePosts, navigateToAccount, runPostFlow, recoverToKnownState } = require("./actions");
const { logLine } = require("./logger");

async function runAutomation(deviceId, cfg) {
  let state = await detectState(deviceId, cfg.app.package);

  const steps = [
    async () => {
      if (state.name === "popup") {
        await handlePopup(deviceId, cfg);
        state = await detectState(deviceId, cfg.app.package);
      }
    },
    async () => {
      await ensureHomeFeed(deviceId, cfg);
      state = await detectState(deviceId, cfg.app.package);
    },
    async () => {
      await likePosts(deviceId, cfg, cfg.likeCount);
      state = await detectState(deviceId, cfg.app.package);
    },
    async () => {
      await navigateToAccount(deviceId, cfg);
      state = await waitForState(
        deviceId,
        cfg.app.package,
        ["account_profile", "home_feed"],
        cfg.timeouts.stateMs,
        cfg.pollIntervals.stateMs
      );
    },
    async () => {
      await runPostFlow(deviceId, cfg);
      state = await detectState(deviceId, cfg.app.package);
    }
  ];

  for (const step of steps) {
    try {
      const before = state.name;
      await step();
      const after = (await detectState(deviceId, cfg.app.package)).name;
      logLine(deviceId, {
        action: "state_step",
        state_before: before,
        state_after: after,
        success: true
      });
      state = { name: after };
    } catch (err) {
      logLine(deviceId, {
        action: "state_step_error",
        state_before: state.name,
        state_after: "unknown",
        success: false,
        error: err.message
      });
      await recoverToKnownState(deviceId, cfg);
      state = await detectState(deviceId, cfg.app.package);
      if (state.name !== "home_feed") {
        throw err;
      }
    }
  }
}

module.exports = {
  runAutomation
};

