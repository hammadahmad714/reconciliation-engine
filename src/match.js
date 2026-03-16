const { normalizeUrl } = require("./normalize");

function toUtc(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function captionsTruncationMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const maxPrefix = 150;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

  if (!shorter.endsWith("...")) return false;
  const core = shorter.slice(0, -3);
  if (core.length === 0) return false;
  if (core.length > maxPrefix) return false;
  if (!longer.startsWith(core)) return false;
  // ensure longer has more content beyond prefix
  if (longer.length === core.length) return false;
  return true;
}

function buildKeyByPlatformId(posts) {
  const map = new Map();
  for (const p of posts) {
    if (!p.id) continue;
    const key = p.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return map;
}

function indexByCanonical(posts) {
  const map = new Map();
  for (const p of posts) {
    const n = normalizeUrl(p.url);
    if (!n.canonical) continue;
    const key = n.canonical;
    const item = { ...p, _norm: n, posted_at_utc: toUtc(p.posted_at) };
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function withinMinutes(aIso, bIso, minutes) {
  if (!aIso || !bIso) return false;
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  const diff = Math.abs(a - b) / 60000;
  return diff <= minutes;
}

function matchPosts(providerA, providerB) {
  const allCurrent = [];
  const matches = [];
  const usedB = new Set();

  const mapBById = buildKeyByPlatformId(providerB);

  // 1) platform id match
  for (const a of providerA) {
    const candidates = a.id ? mapBById.get(a.id) || [] : [];
    const nA = normalizeUrl(a.url);
    const base = {
      platform_id: a.id || (nA && nA.platformId) || null,
      canonical_url: nA.canonical,
      account: a.account || (nA && nA.account) || null,
      posted_at_utc: toUtc(a.posted_at),
      sources: [{ provider: "A", post: a, norm: nA }]
    };
    if (candidates.length) {
      const b = candidates[0];
      const nB = normalizeUrl(b.url);
      usedB.add(b);
      matches.push({
        ...base,
        sources: [
          ...base.sources,
          { provider: "B", post: b, norm: nB, posted_at_utc: toUtc(b.posted_at) }
        ]
      });
    } else {
      matches.push(base);
    }
  }

  // 2) remaining B-only posts
  const remainingB = providerB.filter((b) => !Array.from(usedB).includes(b));

  const canonIndex = indexByCanonical(matches.map((m) => m.sources[0].post));
  for (const b of remainingB) {
    const nB = normalizeUrl(b.url);
    const pUtc = toUtc(b.posted_at);
    let attached = false;
    if (nB.canonical) {
      const bucket = canonIndex.get(nB.canonical);
      if (bucket && bucket.length === 1) {
        const existing = matches.find(
          (m) => m.sources[0].post === bucket[0]
        );
        if (existing) {
          existing.sources.push({ provider: "B", post: b, norm: nB, posted_at_utc: pUtc });
          attached = true;
        }
      }
    }
    if (!attached) {
      matches.push({
        platform_id: nB.platformId || b.id || null,
        canonical_url: nB.canonical,
        account: b.account || nB.account || null,
        posted_at_utc: pUtc,
        sources: [{ provider: "B", post: b, norm: nB }]
      });
    }
  }

  // 3) caption-based fallback between unmatched A/B posts
  // For simplicity, we rely on previous steps and keep any remaining distinct.

  for (const m of matches) {
    allCurrent.push(m);
  }
  return allCurrent;
}

module.exports = {
  toUtc,
  captionsTruncationMatch,
  matchPosts
};

