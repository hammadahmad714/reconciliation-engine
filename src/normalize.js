function normalizeHost(host) {
  if (!host) return null;
  const h = host.toLowerCase();
  if (h === "vm.tiktok.com") return "tiktok.com";
  if (h.endsWith(".tiktok.com")) return "tiktok.com";
  return h;
}

function normalizeUrl(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { raw, canonical: null, platform: null, platformId: null };
  }

  const host = normalizeHost(url.hostname);
  const pathname = url.pathname.replace(/\/+$/, "");

  const base = `${host}${pathname}`;

  // TikTok canonical video URL
  const videoMatch = pathname.match(/^\/@([^/]+)\/video\/(\d+)/);
  if (host && videoMatch) {
    const account = `@${videoMatch[1]}`;
    const id = videoMatch[2];
    return {
      raw,
      canonical: `https://tiktok.com/@${videoMatch[1]}/video/${id}`,
      platform: "tiktok",
      platformId: id,
      account
    };
  }

  // TikTok vm share URL with short code, no id yet
  const vmMatch = host === "tiktok.com" && pathname.match(/^\/Z[0-9A-Za-z]+/);
  if (host === "tiktok.com" && vmMatch) {
    return {
      raw,
      canonical: `https://tiktok.com${pathname}`,
      platform: "tiktok",
      platformId: null,
      account: null
    };
  }

  return {
    raw,
    canonical: host ? `https://${base}` : null,
    platform: null,
    platformId: null,
    account: null
  };
}

module.exports = {
  normalizeUrl
};

