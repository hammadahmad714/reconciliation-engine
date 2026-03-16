function computeBackoff(baseMs, attempt) {
  const exp = Math.min(attempt, 8);
  const jitter = Math.random() * baseMs;
  return baseMs * exp + jitter;
}

async function retryWithBackoff(fn, { maxAttempts = 5, baseMs = 200, shouldRetry }) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (!shouldRetry || !shouldRetry(err)) break;
      if (attempt === maxAttempts) break;
      const delay = computeBackoff(baseMs, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

module.exports = {
  computeBackoff,
  retryWithBackoff
};

