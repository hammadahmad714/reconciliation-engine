class InMemoryRepository {
  constructor() {
    this.attempts = [];
    this.resultSets = [];
    this.resultRows = [];
    this.jobResults = [];
    this.accountFailures = new Map(); // accountId -> { consecutive, flagged }
    this.batchState = new Map(); // batchId -> { total, failed, paused }
    this._id = 1;
  }

  nextId() {
    return this._id++;
  }

  async beginTransaction() {
    const snapshot = {
      attempts: [...this.attempts],
      resultSets: [...this.resultSets],
      resultRows: [...this.resultRows],
      jobResults: [...this.jobResults]
    };
    return {
      commit: async () => {},
      rollback: async () => {
        this.attempts = snapshot.attempts;
        this.resultSets = snapshot.resultSets;
        this.resultRows = snapshot.resultRows;
        this.jobResults = snapshot.jobResults;
      }
    };
  }

  async insertAttempt({ jobId, accountId, batchId }) {
    const attempt = {
      id: this.nextId(),
      jobId,
      accountId,
      batchId,
      status: "pending",
      createdAt: new Date(),
      succeededAt: null,
      failedAt: null,
      failureReason: null
    };
    this.attempts.push(attempt);
    return attempt;
  }

  async insertResultSet({ attemptId, providerSummary }) {
    const rs = {
      id: this.nextId(),
      attemptId,
      providerSummary,
      createdAt: new Date()
    };
    this.resultSets.push(rs);
    return rs;
  }

  async insertResultRows({ resultSetId, rows }) {
    const now = new Date();
    for (const r of rows) {
      this.resultRows.push({
        id: this.nextId(),
        resultSetId,
        postId: r.postId,
        metrics: r.metrics,
        provenance: r.provenance,
        createdAt: now
      });
    }
  }

  async insertImmutableJobResult({ attemptId, status, detail }) {
    const jr = {
      id: this.nextId(),
      attemptId,
      status,
      detail,
      createdAt: new Date()
    };
    this.jobResults.push(jr);
    return jr;
  }

  async markAttemptSucceeded(id) {
    const a = this.attempts.find((x) => x.id === id);
    if (a && a.status !== "succeeded") {
      a.status = "succeeded";
      a.succeededAt = new Date();
    }
  }

  async markAttemptFailed(id, reason) {
    const a = this.attempts.find((x) => x.id === id);
    if (a && a.status !== "succeeded") {
      a.status = "failed";
      a.failedAt = new Date();
      a.failureReason = reason;
    }
  }

  async incrementAccountFailure(accountId) {
    const current = this.accountFailures.get(accountId) || {
      consecutive: 0,
      flagged: false
    };
    current.consecutive += 1;
    if (current.consecutive >= 3) current.flagged = true;
    this.accountFailures.set(accountId, current);
  }

  async resetAccountFailure(accountId) {
    this.accountFailures.set(accountId, { consecutive: 0, flagged: false });
  }

  async flagManualReview(accountId) {
    const current = this.accountFailures.get(accountId) || {
      consecutive: 0,
      flagged: false
    };
    current.flagged = true;
    this.accountFailures.set(accountId, current);
  }

  async getAccountFailureState(accountId) {
    return this.accountFailures.get(accountId) || {
      consecutive: 0,
      flagged: false
    };
  }

  async recordBatchJobOutcome(batchId, succeeded) {
    const b = this.batchState.get(batchId) || {
      total: 0,
      failed: 0,
      paused: false
    };
    b.total += 1;
    if (!succeeded) b.failed += 1;
    this.batchState.set(batchId, b);
    return b;
  }

  async pauseBatch(batchId) {
    const b = this.batchState.get(batchId) || {
      total: 0,
      failed: 0,
      paused: false
    };
    b.paused = true;
    this.batchState.set(batchId, b);
  }

  async isBatchPaused(batchId) {
    const b = this.batchState.get(batchId);
    return b ? b.paused : false;
  }
}

module.exports = {
  InMemoryRepository
};

