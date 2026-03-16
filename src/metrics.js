function reconcileMetric(name, history, candidates) {
  const histVal = history != null ? Number(history) : null;
  const nums = candidates
    .map((c) => ({ ...c, value: c.value != null ? Number(c.value) : null }))
    .filter((c) => c.value != null);

  const provenance = {
    metric: name,
    history: histVal,
    candidates: nums.map(({ provider, value }) => ({ provider, value })),
    chosen: null,
    reason: null,
    anomalies: []
  };

  if (!nums.length && histVal == null) {
    provenance.reason = "no_values";
    return { value: null, provenance };
  }

  const maxCurrent = nums.length ? Math.max(...nums.map((n) => n.value)) : null;

  if (histVal != null && maxCurrent != null && maxCurrent < histVal) {
    provenance.anomalies.push("regression_vs_history");
    provenance.reason = "history_preserved_regression_current";
    provenance.chosen = histVal;
    return { value: histVal, provenance };
  }

  if (maxCurrent != null) {
    provenance.reason = "max_current_with_monotonic";
    provenance.chosen = maxCurrent;
    if (histVal != null && maxCurrent < histVal) {
      provenance.anomalies.push("regression_chosen");
    }
    return { value: maxCurrent, provenance };
  }

  provenance.reason = "fallback_history_only";
  provenance.chosen = histVal;
  return { value: histVal, provenance };
}

function reconcileAllMetrics(historySnap, providerValues) {
  const metrics = ["views", "likes", "comments"];
  const result = {};
  const provenance = {};

  for (const m of metrics) {
    const histVal = historySnap ? historySnap[m] : null;
    const candidates = providerValues.map((p) => ({
      provider: p.provider,
      value: p.post[m]
    }));
    const r = reconcileMetric(m, histVal, candidates);
    result[m] = r.value;
    provenance[m] = r.provenance;
  }

  return { metrics: result, provenance };
}

module.exports = {
  reconcileMetric,
  reconcileAllMetrics
};

