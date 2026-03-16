function groupByAndroidVersion(devices) {
  const byVer = new Map();
  for (const d of devices) {
    if (!byVer.has(d.androidVersion)) byVer.set(d.androidVersion, []);
    byVer.get(d.androidVersion).push(d);
  }
  for (const list of byVer.values()) {
    list.sort((a, b) => (a.connectionQuality === "good" ? -1 : 1));
  }
  return byVer;
}

function planWaves(devices, policy) {
  const idleGood = devices.filter(
    (d) => !d.currentTask && d.connectionQuality === "good"
  );
  const byVer = groupByAndroidVersion(idleGood);

  const wave1 = [];
  for (const [, list] of byVer) {
    if (wave1.length >= 5) break;
    if (list.length) wave1.push(list.shift());
  }
  const remaining = [];
  for (const list of byVer.values()) remaining.push(...list);
  remaining.sort((a, b) => (a.connectionQuality === "good" ? -1 : 1));

  while (wave1.length < 5 && remaining.length) {
    wave1.push(remaining.shift());
  }

  const waves = [];
  if (wave1.length) waves.push(wave1);

  let size = 20;
  let pool = remaining.slice();
  while (pool.length) {
    waves.push(pool.splice(0, size));
    size = Math.floor(size * policy.scaleFactor);
  }

  return waves;
}

module.exports = {
  planWaves
};

