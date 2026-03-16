async function handleBatchOutcome(repo, alerts, batchId, succeeded) {
  if (!batchId) return;
  const state = await repo.recordBatchJobOutcome(batchId, succeeded);
  if (state.total >= 5 && state.failed / state.total > 0.2 && !state.paused) {
    await repo.pauseBatch(batchId);
    await alerts.emit({
      type: "batch_paused",
      batchId,
      failed: state.failed,
      total: state.total
    });
  }
}

module.exports = {
  handleBatchOutcome
};

