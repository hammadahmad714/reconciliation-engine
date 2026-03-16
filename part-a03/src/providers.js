const { retryWithBackoff } = require("./retry-policy");

async function fetchProviderPosts(provider, accountId, { expectedCount, timeoutMs, fetchFn }) {
  const started = Date.now();

  const res = await retryWithBackoff(
    async () => {
      const remained = timeoutMs ? timeoutMs - (Date.now() - started) : null;
      if (remained != null && remained <= 0) {
        const err = new Error("provider_timeout");
        err.code = "PROVIDER_TIMEOUT";
        throw err;
      }
      const data = await fetchFn(provider, accountId);
      return data;
    },
    {
      maxAttempts: 5,
      baseMs: 200,
      shouldRetry: (err) => err && (err.code === 429 || err.code === "429")
    }
  );

  const complete =
    expectedCount == null || !Number.isFinite(expectedCount)
      ? true
      : res.posts.length >= expectedCount;

  return {
    posts: res.posts,
    complete
  };
}

module.exports = {
  fetchProviderPosts
};

