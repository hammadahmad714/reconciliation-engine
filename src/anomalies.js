function buildAnomalies(posts, disappeared, options = {}) {
  const items = [];

  for (const p of posts) {
    const prov = p.provenance || {};
    const mProv = prov.metrics || {};
    for (const [name, meta] of Object.entries(mProv)) {
      if (meta.anomalies && meta.anomalies.includes("regression_vs_history")) {
        items.push({
          type: "metric_regression",
          metric: name,
          platform_id: p.platform_id,
          details: meta
        });
      }
    }
    if (!p.platform_id) {
      items.push({
        type: "unresolved_identity",
        canonical_url: p.canonical_url,
        account: p.account
      });
    }
    if (p.provenance && p.provenance.match_notes === "ambiguous_caption") {
      items.push({
        type: "ambiguous_caption_match",
        platform_id: p.platform_id || null
      });
    }
    if (p.provenance && p.provenance.provider_disagreement) {
      items.push({
        type: "provider_disagreement",
        platform_id: p.platform_id,
        delta: p.provenance.provider_disagreement
      });
    }
    if (p.provenance && p.provenance.assignment_boundary_risk) {
      items.push({
        type: "assignment_boundary_risk",
        platform_id: p.platform_id
      });
    }
  }

  for (const d of disappeared) {
    if (d.reason === "missing_from_providers") {
      items.push({
        type: "missing_from_all_providers",
        platform_id: d.platform_id
      });
    }
  }

  return items;
}

module.exports = {
  buildAnomalies
};

