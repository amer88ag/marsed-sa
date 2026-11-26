(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const sat = node ? require("../../../vendor/satellite.js/6.0.1/satellite.min.js") : root && root.satellite;
  const http = node ? require("../../platform/http/client.js") : root && root.HttpClient;
  const state = node ? require("../../platform/data/source-state.js") : root && root.SourceState;
  const api = factory(sat, http, state);
  if (node) module.exports = api;
  if (root) root.SatRadar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (S, http, SourceState) {
  "use strict";
  // Satellite radar, phase 1. Positions are COMPUTED with SGP4 from CelesTrak GP
  // (OMM/JSON) orbital elements — not observed. Accuracy falls as the elements age,
  // so every result carries the element epoch and its age.
  // CelesTrak policy: new GP data is checked once every 2 hours; re-download only
  // when the stored copy is older than that. Large groups (Starlink, Active) are
  // not used here.
  const GROUPS = Object.freeze({
    stations: { label: "المحطات الفضائية (ومنها محطة الفضاء الدولية)", type: "محطة فضائية أو مركبة مأهولة/مرتبطة بها" },
    visual: { label: "الأقمار الأكثر لمعاناً", type: "قمر أو جسم لامع يُرى بالعين غالباً" },
    gnss: { label: "أقمار الملاحة (GPS وGalileo وGLONASS وBeiDou)", type: "قمر ملاحة عالمي (GNSS)" }
  });
  const BASE = "https://celestrak.org/NORAD/elements/gp.php";
  const REFRESH_MINUTES = 120;      // CelesTrak: once per 2-hour update cycle
  const EPOCH_STALE_DAYS = 7;       // label elements older than this as stale (operational choice)
  const DEG = 180 / Math.PI;

  function groupUrl(group) {
    if (!GROUPS[group]) throw new TypeError("Unknown satellite group");
    return BASE + "?GROUP=" + group + "&FORMAT=json";
  }

  const REQUIRED = ["OBJECT_NAME", "NORAD_CAT_ID", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY"];

  // OMM records → [{ id, name, object_id, launch_year, epoch, group, satrec }]; invalid ones are counted, not guessed.
  function parseGroup(records, group) {
    if (!Array.isArray(records)) throw new TypeError("CelesTrak response is not a JSON array");
    const out = [], seen = new Set();
    let rejected = 0;
    records.forEach(function (r) {
      const okFields = r && REQUIRED.every(function (k) { return r[k] !== undefined && r[k] !== null && r[k] !== ""; });
      if (!okFields || seen.has(r.NORAD_CAT_ID) || !Number.isFinite(Date.parse(r.EPOCH + (/Z$/.test(r.EPOCH) ? "" : "Z")))) { rejected++; return; }
      let satrec;
      try { satrec = S.json2satrec(r); } catch (e) { rejected++; return; }
      if (!satrec || satrec.error) { rejected++; return; }
      seen.add(r.NORAD_CAT_ID);
      const oid = typeof r.OBJECT_ID === "string" ? r.OBJECT_ID : null;
      out.push({
        id: Number(r.NORAD_CAT_ID), name: String(r.OBJECT_NAME).trim(), object_id: oid,
        launch_year: oid && /^\d{4}-/.test(oid) ? Number(oid.slice(0, 4)) : null,
        epoch: new Date(Date.parse(r.EPOCH + (/Z$/.test(r.EPOCH) ? "" : "Z"))).toISOString(),
        group: group, satrec: satrec, omm: r
      });
    });
    return { satellites: out, rejected: rejected };
  }

  function epochAgeDays(satItem, now) { return (now.getTime() - Date.parse(satItem.epoch)) / 86400000; }

  // Geodetic position, speed and look angles at `date`. Returns null if SGP4 fails (e.g. decayed).
  function positionAt(item, date, observer) {
    const pv = S.propagate(item.satrec, date);
    if (!pv || !pv.position || typeof pv.position !== "object" || !Number.isFinite(pv.position.x)) return null;
    const gmst = S.gstime(date);
    const gd = S.eciToGeodetic(pv.position, gmst);
    const v = pv.velocity;
    const out = {
      lat: S.degreesLat(gd.latitude), lon: S.degreesLong(gd.longitude), height_km: gd.height,
      speed_kms: v && Number.isFinite(v.x) ? Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) : null
    };
    if (!Number.isFinite(out.lat) || !Number.isFinite(out.lon) || !Number.isFinite(out.height_km)) return null;
    if (observer) {
      const la = S.ecfToLookAngles({ latitude: observer.lat / DEG, longitude: observer.lon / DEG, height: (observer.height_m || 0) / 1000 }, S.eciToEcf(pv.position, gmst));
      out.elevation_deg = la.elevation * DEG; out.azimuth_deg = ((la.azimuth * DEG) % 360 + 360) % 360; out.range_km = la.rangeSat;
    }
    return out;
  }

  // Direction of motion over the ground (degrees from north), from two positions 10 s apart.
  function headingAt(item, date) {
    const a = positionAt(item, date), b = positionAt(item, new Date(date.getTime() + 10000));
    if (!a || !b) return null;
    const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return ((Math.atan2(y, x) / r) + 360) % 360;
  }

  // Ground track sampled every `stepSec` between -pastMin and +futureMin, split where it crosses ±180°.
  function groundTrack(item, date, pastMin, futureMin, stepSec) {
    const step = (stepSec || 60) * 1000, segs = { past: [], future: [] };
    ["past", "future"].forEach(function (part) {
      const from = part === "past" ? date.getTime() - pastMin * 60000 : date.getTime();
      const to = part === "past" ? date.getTime() : date.getTime() + futureMin * 60000;
      let seg = [], prev = null;
      for (let t = from; t <= to; t += step) {
        const p = positionAt(item, new Date(t));
        if (!p) { if (seg.length > 1) segs[part].push(seg); seg = []; prev = null; continue; }
        if (prev && Math.abs(p.lon - prev.lon) > 180) { if (seg.length > 1) segs[part].push(seg); seg = []; }
        seg.push([p.lat, p.lon]); prev = p;
      }
      if (seg.length > 1) segs[part].push(seg);
    });
    return segs;
  }

  // Next pass above `minElevation` within `hours`: rise, culmination, set (to ~1 s).
  function nextPass(item, observer, from, hours, minElevation) {
    const minEl = Number.isFinite(minElevation) ? minElevation : 0;
    const end = from.getTime() + (hours || 24) * 3600000, step = 30000;
    const el = function (t) { const p = positionAt(item, new Date(t), observer); return p ? p.elevation_deg - minEl : null; };
    const refine = function (a, b, rising) { // bisection on the sign change
      for (let i = 0; i < 20 && b - a > 1000; i++) { const m = (a + b) / 2, v = el(m); if (v === null) return null; if ((v > 0) === rising) b = m; else a = m; }
      return b;
    };
    let t = from.getTime(), prev = el(t);
    if (prev === null) return null;
    let rise = prev > 0 ? from.getTime() : null, inProgress = prev > 0;
    for (t += step; t <= end; t += step) {
      const v = el(t);
      if (v === null) return null;
      if (rise === null && prev <= 0 && v > 0) rise = refine(t - step, t, true);
      if (rise !== null && prev > 0 && v <= 0) {
        const set = refine(t - step, t, false);
        let best = rise, bestEl = -90;
        for (let s = rise; s <= set; s += 10000) { const p = positionAt(item, new Date(s), observer); if (p && p.elevation_deg > bestEl) { bestEl = p.elevation_deg; best = s; } }
        return { rise: new Date(rise).toISOString(), culmination: new Date(best).toISOString(), set: new Date(set).toISOString(), max_elevation_deg: bestEl, in_progress_at_start: inProgress };
      }
      prev = v;
    }
    return rise !== null ? { rise: new Date(rise).toISOString(), culmination: null, set: null, max_elevation_deg: null, in_progress_at_start: inProgress, open_ended: true } : null;
  }

  // Fetch a group with CelesTrak's 2-hour policy: reuse a stored copy younger than
  // 2 h without any request; on failure fall back to the last valid copy (labelled).
  async function loadGroup(group, options) {
    const o = options || {}, now = o.now || new Date();
    const cached = SourceState && SourceState.recall("celestrak_gp", group);
    const ageMin = cached ? (now.getTime() - Date.parse(cached.stored_at)) / 60000 : null;
    if (cached && ageMin >= 0 && ageMin < REFRESH_MINUTES && !o.force) {
      const parsed = parseGroup(cached.payload, group);
      return Object.assign(parsed, { state: "cached", from_cache: true, fetched_at: cached.stored_at, reason: "policy_2h" });
    }
    try {
      const body = await http.request(groupUrl(group), { fetch: o.fetch, signal: o.signal, timeoutMs: o.timeoutMs || 20000 });
      const parsed = parseGroup(body, group);
      if (!parsed.satellites.length) { const e = new Error("No valid orbital elements"); e.kind = "json"; throw e; }
      if (SourceState) SourceState.remember("celestrak_gp", group, body, now);
      return Object.assign(parsed, { state: parsed.rejected ? "partial" : "fresh", from_cache: false, fetched_at: now.toISOString() });
    } catch (error) {
      if (error && error.kind === "aborted") throw error;
      const fb = SourceState ? SourceState.onFailure("celestrak_gp", group, error, { now: now }) : { payload: null, state: "unavailable" };
      if (fb.payload) return Object.assign(parseGroup(fb.payload, group), { state: "stale", from_cache: true, fetched_at: fb.stored_at, error: error });
      const e = new Error("Orbital elements unavailable"); e.kind = fb.state; e.cause = error; throw e;
    }
  }

  return { GROUPS, BASE, REFRESH_MINUTES, EPOCH_STALE_DAYS, groupUrl, parseGroup, epochAgeDays, positionAt, headingAt, groundTrack, nextPass, loadGroup };
});
