const { parseStringPromise } = require("xml2js");
const { dumpUiHierarchy, getCurrentFocus } = require("./adb");

async function parseNodes(xml) {
  const doc = await parseStringPromise(xml);
  const nodes = [];

  function walk(node) {
    if (!node) return;
    if (node.node) {
      for (const n of node.node) {
        const attrs = n.$ || {};
        const bounds = attrs.bounds
          ? attrs.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/).slice(1).map(Number)
          : null;
        nodes.push({
          text: attrs.text || "",
          contentDesc: attrs["content-desc"] || "",
          clickable: attrs.clickable === "true",
          bounds,
          className: attrs.class || ""
        });
        walk(n);
      }
    }
  }

  walk(doc.hierarchy);
  return nodes;
}

function findByText(nodes, texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  return nodes.find((n) =>
    list.some((t) => n.text.includes(t) || n.contentDesc.includes(t))
  );
}

async function detectState(deviceId, appPackage) {
  const focus = await getCurrentFocus(deviceId);
  if (!focus || focus.pkg !== appPackage) {
    return { name: "app_not_open", nodes: [], focus };
  }
  const xml = await dumpUiHierarchy(deviceId);
  const nodes = await parseNodes(xml);

  const popupBtn = findByText(nodes, ["Not now", "Cancel", "Close", "Allow", "No thanks"]);
  if (popupBtn) return { name: "popup", nodes, focus };

  const homeHints = ["Home", "For you", "Following"];
  if (findByText(nodes, homeHints)) return { name: "home_feed", nodes, focus };

  if (findByText(nodes, ["Edit profile", "Followers"])) {
    return { name: "account_profile", nodes, focus };
  }

  if (findByText(nodes, ["New post", "Create"])) {
    return { name: "upload_entry", nodes, focus };
  }

  if (findByText(nodes, ["Gallery", "Recents"])) {
    return { name: "gallery_picker", nodes, focus };
  }

  if (findByText(nodes, ["Write a caption", "Describe your video"])) {
    return { name: "caption_editor", nodes, focus };
  }

  if (findByText(nodes, ["Post", "Share"])) {
    return { name: "post_submit", nodes, focus };
  }

  if (findByText(nodes, ["Posting...", "Uploading"])) {
    return { name: "posting_in_progress", nodes, focus };
  }

  if (findByText(nodes, ["Posted", "Your post is live"])) {
    return { name: "post_success", nodes, focus };
  }

  return { name: "unknown_state", nodes, focus };
}

async function waitForState(deviceId, appPackage, expected, timeoutMs, pollMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const state = await detectState(deviceId, appPackage);
    if (Array.isArray(expected) ? expected.includes(state.name) : state.name === expected) {
      return state;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timeout waiting for state ${expected}`);
}

module.exports = {
  parseNodes,
  detectState,
  waitForState,
  findByText
};

