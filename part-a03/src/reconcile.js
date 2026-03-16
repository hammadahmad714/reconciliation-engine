function reconcilePosts(providerAResult, providerBResult) {
  const rows = [];
  for (const p of providerAResult.posts) {
    rows.push({
      postId: p.id,
      metrics: p.metrics,
      provenance: { provider: "A" }
    });
  }
  for (const p of providerBResult.posts) {
    rows.push({
      postId: p.id,
      metrics: p.metrics,
      provenance: { provider: "B" }
    });
  }
  return rows;
}

module.exports = {
  reconcilePosts
};

