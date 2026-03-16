const { getWindowSize, swipe, tapBounds, tapNormalized } = require("./adb");
const { detectState, waitForState, findByText } = require("./detectors");
const { logLine } = require("./logger");

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

async function handlePopup(deviceId, cfg) {
  const state = await detectState(deviceId, cfg.app.package);
  if (state.name !== "popup") return false;
  const btn = findByText(state.nodes, cfg.popupButtons);
  if (btn && btn.bounds) {
    await tapBounds(deviceId, btn.bounds);
    return true;
  }
  // Fallback back press
  await tapNormalized(deviceId, await getWindowSize(deviceId), 0.1, 0.1);
  return true;
}

async function ensureHomeFeed(deviceId, cfg) {
  const { stateMs, stateMs: timeout } = cfg.timeouts;
  const poll = cfg.pollIntervals.stateMs;
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await detectState(deviceId, cfg.app.package);
    if (state.name === "home_feed") return state;
    if (state.name === "popup") {
      await handlePopup(deviceId, cfg);
    } else if (state.name === "app_not_open") {
      await openApp(deviceId, cfg);
    } else {
      // Try back to unwind
      await tapNormalized(deviceId, await getWindowSize(deviceId), 0.05, 0.05);
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  throw new Error("Failed to reach home_feed");
}

async function openApp(deviceId, cfg) {
  await require("./adb").runAdb(
    ["shell", "am", "start", "-n", `${cfg.app.package}/${cfg.app.launchActivity}`],
    { deviceId }
  );
}

async function swipeHuman(deviceId, cfg) {
  const size = await getWindowSize(deviceId);
  const distRatio = randBetween(cfg.scroll.distanceRatio.min, cfg.scroll.distanceRatio.max);
  const duration = randBetween(cfg.scroll.durationMs.min, cfg.scroll.durationMs.max);
  const startY = Math.round(size.height * 0.8);
  const endY = Math.round(size.height * (0.8 - distRatio));
  const x = Math.round(size.width * 0.5);
  await swipe(deviceId, x, startY, x, endY, Math.round(duration));
}

function extractPostNodes(nodes) {
  // Heuristic: clickable containers with like buttons underneath.
  return nodes.filter((n) => n.clickable && n.bounds);
}

async function likePosts(deviceId, cfg, count) {
  const liked = new Set();
  let likedCount = 0;

  while (likedCount < count) {
    const state = await detectState(deviceId, cfg.app.package);
    if (state.name !== "home_feed") {
      await ensureHomeFeed(deviceId, cfg);
      continue;
    }
    const posts = extractPostNodes(state.nodes);
    for (const post of posts) {
      const key = post.bounds.join(",");
      if (liked.has(key)) continue;

      const before = await detectState(deviceId, cfg.app.package);
      await tapBounds(deviceId, post.bounds);
      await new Promise((r) => setTimeout(r, cfg.pollIntervals.elementMs));
      const after = await detectState(deviceId, cfg.app.package);

      logLine(deviceId, {
        action: "like_tap",
        state_before: before.name,
        state_after: after.name,
        success: true,
        details: { bounds: post.bounds }
      });

      liked.add(key);
      likedCount += 1;
      if (likedCount >= count) break;
    }
    if (likedCount >= count) break;
    await swipeHuman(deviceId, cfg);
  }
}

async function navigateToAccount(deviceId, cfg) {
  // Simplified: assume search is accessible from home via text
  const state = await ensureHomeFeed(deviceId, cfg);
  const accountNode = findByText(state.nodes, cfg.targetAccount);
  if (accountNode && accountNode.bounds) {
    await tapBounds(deviceId, accountNode.bounds);
    await waitForState(
      deviceId,
      cfg.app.package,
      ["account_profile"],
      cfg.timeouts.stateMs,
      cfg.pollIntervals.stateMs
    );
    return;
  }
}

async function runPostFlow(deviceId, cfg) {
  await ensureHomeFeed(deviceId, cfg);

  // Assume an entry point button like "+" or "Create"
  const state = await detectState(deviceId, cfg.app.package);
  const createBtn = findByText(state.nodes, ["Create", "+", "New"]);
  if (createBtn && createBtn.bounds) {
    await tapBounds(deviceId, createBtn.bounds);
  } else {
    await tapNormalized(deviceId, await getWindowSize(deviceId), 0.9, 0.9);
  }

  await waitForState(
    deviceId,
    cfg.app.package,
    ["gallery_picker"],
    cfg.timeouts.stateMs,
    cfg.pollIntervals.stateMs
  );

  const gallery = await detectState(deviceId, cfg.app.package);
  const firstItem = gallery.nodes.find((n) => n.clickable && n.bounds);
  if (!firstItem) throw new Error("No gallery item found");
  await tapBounds(deviceId, firstItem.bounds);

  await waitForState(
    deviceId,
    cfg.app.package,
    ["caption_editor", "post_submit"],
    cfg.timeouts.stateMs,
    cfg.pollIntervals.stateMs
  );

  const captionState = await detectState(deviceId, cfg.app.package);
  const captionNode = findByText(captionState.nodes, ["Write a caption", "Describe your video"]);
  if (captionNode && captionNode.bounds) {
    await tapBounds(deviceId, captionNode.bounds);
    // Use input text via ADB
    await require("./adb").runAdb(
      ["shell", "input", "text", cfg.captionText.replace(/\s+/g, "%s")],
      { deviceId }
    );
  }

  const submitState = await detectState(deviceId, cfg.app.package);
  const postBtn = findByText(submitState.nodes, ["Post", "Share", "Next"]);
  if (!postBtn || !postBtn.bounds) throw new Error("No post/submit button");
  await tapBounds(deviceId, postBtn.bounds);

  await waitForState(
    deviceId,
    cfg.app.package,
    ["posting_in_progress", "post_success"],
    cfg.timeouts.postSubmitMs,
    cfg.pollIntervals.stateMs
  );
}

async function recoverToKnownState(deviceId, cfg) {
  for (let i = 0; i < cfg.retries.recover; i++) {
    const state = await detectState(deviceId, cfg.app.package);
    if (state.name === "popup") {
      await handlePopup(deviceId, cfg);
    } else if (state.name === "home_feed") {
      return;
    } else if (state.name === "app_not_open") {
      await openApp(deviceId, cfg);
    } else {
      await tapNormalized(deviceId, await getWindowSize(deviceId), 0.05, 0.05);
    }
  }
}

module.exports = {
  handlePopup,
  ensureHomeFeed,
  swipeHuman,
  likePosts,
  navigateToAccount,
  runPostFlow,
  recoverToKnownState
};

