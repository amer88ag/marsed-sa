export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const key = process.env.FLYITALYADSB_API_KEY;
  if (!key) return res.status(503).json({ error: "air_data_not_configured", message: "مصدر الطيران غير مهيأ بعد؛ أضف FLYITALYADSB_API_KEY في متغيرات Vercel." });

  const names = ["south", "west", "north", "east"];
  const values = names.map((name) => Number(req.query?.[name]));
  if (values.some((v) => !Number.isFinite(v)) ||
      values[0] < -90 || values[2] > 90 || values[0] >= values[2] ||
      values[1] < -180 || values[3] > 180 || values[1] >= values[3]) {
    return res.status(400).json({ error: "invalid_bounds" });
  }

  const [south, west, north, east] = values;
  const url = `https://api.flyitalyadsb.com/v2/box/${south}/${north}/${west}/${east}`;
  try {
    const upstream = await fetch(url, {
      headers: { "X-Api-Key": key, "Accept": "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : upstream.status === 403 ? 503 : 502;
      return res.status(status).json({
        error: upstream.status === 429 ? "provider_quota" : "provider_unavailable",
        provider_status: upstream.status,
        retry_after: upstream.headers.get("Retry-After")
      });
    }
    const payload = await upstream.json();
    const aircraft = (Array.isArray(payload.ac) ? payload.ac : []).map((a) => ({
      icao24: String(a.hex || "").toLowerCase(),
      callsign: String(a.flight || "").trim(),
      registration: a.r || null,
      aircraft_type: a.t || null,
      latitude: Number.isFinite(a.lat) ? a.lat : null,
      longitude: Number.isFinite(a.lon) ? a.lon : null,
      altitude_feet: typeof a.alt_baro === "number" ? a.alt_baro : null,
      on_ground: a.alt_baro === "ground" || a.gnd === true,
      speed_knots: typeof a.gs === "number" ? a.gs : null,
      true_track: typeof a.track === "number" ? a.track : null,
      vertical_rate_fpm: typeof a.baro_rate === "number" ? a.baro_rate : null,
      seen_seconds: typeof a.seen_pos === "number" ? a.seen_pos : null,
      squawk: a.squawk || null,
      emergency: a.emergency || null
    })).filter((a) => a.icao24);
    return res.status(200).json({
      source: "FlyItalyADSB",
      license: "CC BY-SA 4.0",
      fetched_at: new Date().toISOString(),
      source_time: payload.now || null,
      count: aircraft.length,
      aircraft
    });
  } catch (error) {
    return res.status(502).json({ error: "provider_network_error" });
  }
}
