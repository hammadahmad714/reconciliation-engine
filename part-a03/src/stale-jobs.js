const TEN_MINUTES_MS = 10 * 60 * 1000;

function isJobStale(job) {
  const now = Date.now();
  const started = job.processedOn || job.timestamp || now;
  return now - started > TEN_MINUTES_MS;
}

module.exports = {
  TEN_MINUTES_MS,
  isJobStale
};

