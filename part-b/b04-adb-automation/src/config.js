const fs = require("fs");
const path = require("path");

function loadConfig() {
  const file = path.join(__dirname, "..", "config.json");
  const raw = fs.readFileSync(file, "utf8");
  const cfg = JSON.parse(raw);

  if (!cfg.app || !cfg.app.package || !cfg.app.launchActivity) {
    throw new Error("Invalid config: app.package and app.launchActivity required");
  }
  if (!cfg.likeCount || cfg.likeCount <= 0) {
    throw new Error("Invalid config: likeCount must be > 0");
  }

  return cfg;
}

module.exports = {
  loadConfig
};

