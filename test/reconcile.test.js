const { normalizeUrl } = require("../src/normalize");
const { toUtc, captionsTruncationMatch } = require("../src/match");
const { reconcileMetric } = require("../src/metrics");
const { pickClient } = require("../src/attribution");
const { reconcile } = require("../src/reconcile");

const providerA = [
  {
    id: null,
    url: "https://vm.tiktok.com/ZMrABC123/",
    views: 45200,
    likes: 1800,
    comments: 94,
    caption:
      "This brand changed my entire morning routine and I can't believe how much better I feel since switching to their products #ad #sponsored #wellness",
    posted_at: "2025-03-14T15:30:00Z",
    account: "@creator1"
  },
  {
    id: "7322789456",
    url: "https://www.tiktok.com/@creator1/video/7322789456",
    views: 12000,
    likes: 450,
    comments: 28,
    caption:
      "This brand changed my entire morning routine and I can't believe how much better I feel since switching to their amazing new line of supplements",
    posted_at: "2025-03-14T09:15:00Z",
    account: "@creator1"
  }
];

const providerB = [
  {
    id: "7321456789",
    url: "https://tiktok.com/@creator1/video/7321456789",
    views: 44800,
    likes: 1850,
    comments: 91,
    caption:
      "This brand changed my entire morning routine and I can't believe how much better I feel since switching to their prod...",
    posted_at: "2025-03-14T10:30:00-05:00",
    account: "@creator1"
  },
  {
    id: "7322789456",
    url: "https://tiktok.com/@creator1/video/7322789456",
    views: 11800,
    likes: 445,
    comments: 27,
    caption:
      "This brand changed my entire morning routine and I can't believe how much better I feel since switching to their amaz...",
    posted_at: "2025-03-14T09:15:00Z",
    account: "@creator1"
  }
];

const previousSnapshot = [
  {
    platform_id: "7321456789",
    views: 46000,
    likes: 1780,
    scraped_at: "2025-03-13T12:00:00Z",
    source: "provider_a"
  },
  {
    platform_id: "7320111222",
    views: 22400,
    likes: 900,
    scraped_at: "2025-03-13T12:00:00Z",
    source: "provider_b"
  }
];

const assignments = [
  {
    account: "@creator1",
    client: "client_a",
    from: "2025-01-01T00:00:00Z",
    to: "2025-03-14T15:00:00Z"
  },
  {
    account: "@creator1",
    client: "client_b",
    from: "2025-03-14T15:00:00Z",
    to: null
  }
];

test("canonical URL normalization for TikTok video", () => {
  const n = normalizeUrl("https://www.tiktok.com/@creator1/video/7322789456?foo=bar");
  expect(n.canonical).toBe("https://tiktok.com/@creator1/video/7322789456");
  expect(n.platformId).toBe("7322789456");
});

test("share URL normalization keeps unresolved shape", () => {
  const n = normalizeUrl("https://vm.tiktok.com/ZMrABC123/");
  expect(n.platformId).toBe(null);
  expect(n.canonical).toBe("https://tiktok.com/ZMrABC123");
});

test("query param stripping and host normalization", () => {
  const n = normalizeUrl("https://www.tiktok.com/@creator1/video/7322789456/?utm_source=x");
  expect(n.canonical).toBe("https://tiktok.com/@creator1/video/7322789456");
});

test("timestamp normalization with timezone offset to UTC", () => {
  const utc = toUtc("2025-03-14T10:30:00-05:00");
  expect(utc).toBe("2025-03-14T15:30:00.000Z");
});

test("truncation-aware caption match detects prefix truncation", () => {
  const long =
    "This brand changed my entire morning routine and I can't believe how much better I feel since switching to their products #ad #sponsored #wellness";
  const short =
    "This brand changed my entire morning routine and I can't believe how much better I feel since switching to their prod...";
  expect(captionsTruncationMatch(long, short)).toBeTruthy();
});

test("truncation-aware caption match avoids false merge when same first 150 chars", () => {
  const a =
    "x".repeat(150) + "A";
  const b =
    "x".repeat(150) + "B";
  const truncated = "x".repeat(150) + "...";
  expect(captionsTruncationMatch(a, b)).toBeFalsy();
  expect(captionsTruncationMatch(a, truncated)).toBeFalsy();
});

test("metric regression detection keeps historical higher value", () => {
  const hist = 46000;
  const r = reconcileMetric("views", hist, [
    { provider: "A", value: 45200 },
    { provider: "B", value: 44800 }
  ]);
  expect(r.value).toBe(46000);
  expect(r.provenance.anomalies.includes("regression_vs_history")).toBeTruthy();
});

test("pickClient before reassignment", () => {
  const posted = "2025-03-14T14:59:59Z";
  const client = pickClient(assignments, "@creator1", posted);
  expect(client).toBe("client_a");
});

test("pickClient after reassignment", () => {
  const posted = "2025-03-14T15:00:01Z";
  const client = pickClient(assignments, "@creator1", posted);
  expect(client).toBe("client_b");
});

test("reconcile end-to-end returns deterministic posts", () => {
  const r1 = reconcile(providerA, providerB, previousSnapshot, assignments);
  const r2 = reconcile(providerA, providerB, previousSnapshot, assignments);
  expect(r1).toEqual(r2);
});

test("reconcile attaches metrics and provenance for 7321456789", () => {
  const r = reconcile(providerA, providerB, previousSnapshot, assignments);
  const p = r.posts.find((x) => x.platform_id === "7321456789");
  expect(p).toBeTruthy();
  expect(p.metrics.views).toBe(46000);
  expect(p.provenance.metrics.views.history).toBe(46000);
});

test("disappeared post 7320111222 classified as historical_only", () => {
  const r = reconcile(providerA, providerB, previousSnapshot, assignments);
  const d = r.disappeared_posts.find((x) => x.platform_id === "7320111222");
  expect(d.status).toBe("historical_only");
});

test("anomaly generation includes missing_from_all_providers for 7320111222", () => {
  const r = reconcile(providerA, providerB, previousSnapshot, assignments);
  const a = r.anomalies.find(
    (x) => x.type === "missing_from_all_providers" && x.platform_id === "7320111222"
  );
  expect(a).toBeTruthy();
});

test("provider disagreement is null when only one provider for a post", () => {
  const r = reconcile(providerA, providerB, previousSnapshot, assignments);
  const p = r.posts.find((x) => x.platform_id === "7321456789");
  expect(p.provenance.provider_disagreement).toBe(null);
});

test("posts contain matched_sources list", () => {
  const r = reconcile(providerA, providerB, previousSnapshot, assignments);
  for (const p of r.posts) {
    expect(Array.isArray(p.matched_sources)).toBeTruthy();
  }
});

