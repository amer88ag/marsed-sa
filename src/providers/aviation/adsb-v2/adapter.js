(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AdsbV2Adapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // ADS-B "v2" JSON (ADSBExchange-compatible) as served by adsb.lol and airplanes.live.
  // Field meanings and units follow the adsb.lol OpenAPI spec (checked 2026-11-26):
  //   alt_baro: feet or "ground" · gs: knots · track: degrees true · seen_pos: seconds
  //   now: Unix ms · dst: nautical miles · radius param: 0–250 nm.
  // Positions come from community receivers; coverage is not complete.
  const FT_TO_M = 0.3048, KN_TO_KMH = 1.852, NM_TO_KM = 1.852;
  const PROVIDERS = Object.freeze({
    adsblol: { id: "adsblol", name: "ADSB.lol", base: "https://api.adsb.lol/v2/", license: "ODbL 1.0", terms: "مجاني؛ دون مفتاح حتى 500 طلب يومياً لكل عنوان IP؛ الرد 429 عند تجاوز الحد", url: "https://adsb.lol" },
    airplaneslive: { id: "airplaneslive", name: "airplanes.live", base: "https://api.airplanes.live/v2/", license: "استخدام غير تجاري", terms: "طلب واحد في الثانية كحد أقصى؛ بلا ضمان توفر", url: "https://airplanes.live" }
  });

  function finite(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

  function buildPointUrl(providerId, lat, lon, radiusNm) {
    const p = PROVIDERS[providerId];
    if (!p) throw new TypeError("Unknown ADS-B provider");
    if (!(finite(lat) !== null && lat >= -90 && lat <= 90 && finite(lon) !== null && lon >= -180 && lon <= 180)) throw new RangeError("Invalid coordinates");
    if (!Number.isInteger(radiusNm) || radiusNm < 1 || radiusNm > 250) throw new RangeError("Radius must be an integer 1–250 nm");
    return p.base + "point/" + lat.toFixed(4) + "/" + lon.toFixed(4) + "/" + radiusNm;
  }

  function buildCallsignUrl(providerId, callsign) {
    const p = PROVIDERS[providerId];
    if (!p) throw new TypeError("Unknown ADS-B provider");
    const cs = String(callsign || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(cs)) throw new RangeError("Callsign must be 2–8 letters or digits");
    return p.base + "callsign/" + cs;
  }

  // One aircraft → normalized record, or null when it has no usable position.
  function normalizeAircraft(ac, nowMs) {
    if (!ac || typeof ac.hex !== "string") return null;
    let lat = finite(ac.lat), lon = finite(ac.lon), posAge = finite(ac.seen_pos);
    let fromLast = false;
    if ((lat === null || lon === null) && ac.lastPosition && finite(ac.lastPosition.lat) !== null && finite(ac.lastPosition.lon) !== null) {
      lat = ac.lastPosition.lat; lon = ac.lastPosition.lon; posAge = finite(ac.lastPosition.seen_pos); fromLast = true;
    }
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    const onGround = ac.alt_baro === "ground";
    const altFt = onGround ? null : finite(ac.alt_baro);
    const gsKn = finite(ac.gs);
    const callsign = typeof ac.flight === "string" && ac.flight.trim() ? ac.flight.trim() : null;
    return {
      hex: ac.hex.toLowerCase(),
      non_icao: ac.hex.charAt(0) === "~",
      callsign: callsign,
      airline_icao: callsign && /^[A-Z]{3}\d/.test(callsign) ? callsign.slice(0, 3) : null,
      registration: typeof ac.r === "string" && ac.r.trim() ? ac.r.trim() : null,
      type: typeof ac.t === "string" && ac.t.trim() ? ac.t.trim() : null,
      lat: lat, lon: lon,
      on_ground: onGround,
      altitude_ft: altFt,
      altitude_m: altFt === null ? null : Math.round(altFt * FT_TO_M),
      speed_kn: gsKn,
      speed_kmh: gsKn === null ? null : Math.round(gsKn * KN_TO_KMH),
      track_deg: finite(ac.track),
      squawk: typeof ac.squawk === "string" ? ac.squawk : null,
      distance_km: finite(ac.dst) === null ? null : Math.round(ac.dst * NM_TO_KM * 10) / 10,
      position_age_s: posAge,
      position_from_last_known: fromLast,
      position_time: Number.isFinite(nowMs) && posAge !== null ? new Date(nowMs - posAge * 1000).toISOString() : null
    };
  }

  // Whole response → { aircraft, generated_at, total, skipped }. Throws on a malformed body.
  function normalize(body, providerId) {
    if (!body || typeof body !== "object" || !Array.isArray(body.ac)) throw new TypeError("ADS-B response has no aircraft list");
    const nowMs = finite(body.now);
    const aircraft = [], seen = new Set();
    let skipped = 0;
    body.ac.forEach(function (ac) {
      const n = normalizeAircraft(ac, nowMs);
      if (!n || seen.has(n.hex)) { skipped++; return; }
      seen.add(n.hex); aircraft.push(n);
    });
    aircraft.sort(function (a, b) { return (a.distance_km === null) - (b.distance_km === null) || (a.distance_km || 0) - (b.distance_km || 0); });
    return {
      provider: providerId, aircraft: aircraft, skipped_without_position: skipped,
      total_reported: finite(body.total), generated_at: nowMs === null ? null : new Date(nowMs).toISOString()
    };
  }

  return { PROVIDERS, buildPointUrl, buildCallsignUrl, normalizeAircraft, normalize, FT_TO_M, KN_TO_KMH, NM_TO_KM };
});
