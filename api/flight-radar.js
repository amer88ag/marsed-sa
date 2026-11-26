const PROVIDERS = Object.freeze({
  adsbfi: "https://opendata.adsb.fi/api/v3/lat/",
  adsblol: "https://api.adsb.lol/v2/point/",
  airplaneslive: "https://api.airplanes.live/v2/point/"
});

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const provider = String(req.query?.provider || "");
  const base = PROVIDERS[provider];
  if (!base) return res.status(400).json({ error: "invalid_provider" });

  const lat = Number(req.query?.lat);
  const lon = Number(req.query?.lon);
  const radius = Number(req.query?.radius);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lon) || lon < -180 || lon > 180 ||
      !Number.isInteger(radius) || radius < 1 || radius > 250) {
    return res.status(400).json({ error: "invalid_parameters" });
  }

  const url = provider === "adsbfi"
    ? base + lat.toFixed(4) + "/lon/" + lon.toFixed(4) + "/dist/" + radius
    : base + lat.toFixed(4) + "/" + lon.toFixed(4) + "/" + radius;
  try {
    const upstream = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok) {
      const retryAfter = upstream.headers.get("Retry-After");
      if (retryAfter) res.setHeader("Retry-After", retryAfter);
      const status = upstream.status === 429 ? 429 :
        upstream.status >= 500 ? 502 : upstream.status;
      return res.status(status).json({
        error: upstream.status === 429 ? "provider_rate_limited" : "provider_error",
        provider,
        provider_status: upstream.status
      });
    }

    const payload = await upstream.json();
    if (!payload || !Array.isArray(payload.ac)) {
      return res.status(502).json({ error: "invalid_provider_payload", provider });
    }
    res.setHeader("X-Flight-Data-Provider", provider);
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(502).json({
      error: error?.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable",
      provider
    });
  }
}
