const { normalizeUrl } = require("./normalize");
const { toUtc, matchPosts } = require("./match");
const { reconcileAllMetrics } = require("./metrics");
const { pickClient } = require("./attribution");
const { buildAnomalies } = require("./anomalies");

function classifyDisappeared(previousSnapshots, reconciled) {
  const currentIds = new Set(
    reconciled
      .map((p) => p.platform_id)
      .filter((id) => id != null)
  );
  const out = [];
  for (const s of previousSnapshots) {
    if (!currentIds.has(s.platform_id)) {
      out.push({
        platform_id: s.platform_id,
        last_seen_views: s.views,
        last_source: s.source,
        status: "historical_only",
        reason: "missing_from_providers"
      });
    }
  }
  return out;
}

function reconcile(providerA, providerB, previousSnapshots, assignments) {
  const matched = matchPosts(providerA, providerB);

  const posts = [];

  for (const m of matched) {
    const history = previousSnapshots.find(
      (s) => s.platform_id === m.platform_id
    );
    const metricRecon = reconcileAllMetrics(history, m.sources);
    const postedAtUtc =
      m.posted_at_utc ||
      (m.sources[0] && toUtc(m.sources[0].post.posted_at)) ||
      null;
    const client = pickClient(assignments, m.account, postedAtUtc);

    const viewsA = m.sources
      .filter((s) => s.provider === "A" && s.post.views != null)
      .map((s) => s.post.views);
    const viewsB = m.sources
      .filter((s) => s.provider === "B" && s.post.views != null)
      .map((s) => s.post.views);
    let providerDisagreement = null;
    if (viewsA.length && viewsB.length) {
      providerDisagreement = Math.abs(viewsA[0] - viewsB[0]);
    }

    const p = {
      platform_id: m.platform_id,
      canonical_url: m.canonical_url || (m.sources[0] && normalizeUrl(m.sources[0].post.url).canonical),
      account: m.account,
      client,
      posted_at_utc: postedAtUtc,
      metrics: metricRecon.metrics,
      matched_sources: m.sources.map((s) => s.provider),
      provenance: {
        metrics: metricRecon.provenance,
        providers: m.sources.map((s) => ({
          provider: s.provider,
          id: s.post.id,
          url: s.post.url
        })),
        provider_disagreement: providerDisagreement
      },
      status: "active"
    };

    posts.push(p);
  }

  const disappeared = classifyDisappeared(previousSnapshots, posts);

  const anomalies = buildAnomalies(posts, disappeared);

  return {
    posts,
    disappeared_posts: disappeared,
    anomalies
  };
}

module.exports = {
  reconcile
};

