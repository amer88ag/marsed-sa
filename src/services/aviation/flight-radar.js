(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const http = node ? require("../../platform/http/client.js") : root && root.HttpClient;
  const adapter = node ? require("../../providers/aviation/adsb-v2/adapter.js") : root && root.AdsbV2Adapter;
  const api = factory(http, adapter);
  if (node) module.exports = api;
  if (root) root.FlightRadar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (http, A) {
  "use strict";
  // Live aircraft around a point, from community ADS-B networks.
  // - Tries independent public ADS-B providers in order. A provider-specific
  //   403/429/5xx does not block trying another provider; never retries the same
  //   provider in this poll. If all providers fail, respect Retry-After.
  // - Polling every 30 s keeps one open tab well under adsb.lol's 500 requests/day
  //   per IP for a few hours; the page pauses polling while hidden.
  // - Between polls positions are ESTIMATED by dead reckoning and labelled so.
  const ORDER = ["adsbfi", "adsblol", "airplaneslive"];
  const POLL_SECONDS = 30;
  const MAX_ESTIMATE_SECONDS = 60;   // never extrapolate further than this
  const TRAIL_MAX_POINTS = 60, TRAIL_MAX_MINUTES = 30;
  const R_KM = 6371;

  function isFallbackWorthy(error) {
    if (!error) return false;
    if (error.kind === "network" || error.kind === "timeout" || error.kind === "json") return true;
    return error.kind === "http" && (error.status === 403 || error.status === 429 || error.status >= 500);
  }

  async function fetchAround(lat, lon, radiusNm, options) {
    const o = options || {};
    const errors = [];
    for (const id of o.providers || ORDER) {
      try {
        const proxyUrl = "/api/flight-radar?provider=" + encodeURIComponent(id) + "&lat=" + encodeURIComponent(lat) + "&lon=" + encodeURIComponent(lon) + "&radius=" + encodeURIComponent(radiusNm);
        const body = await http.request(proxyUrl, { fetch: o.fetch, signal: o.signal, timeoutMs: o.timeoutMs || 15000 });
        const result = A.normalize(body, id);
        result.fallback_used = errors.length > 0;
        result.errors = errors;
        return result;
      } catch (error) {
        if (error && error.kind === "aborted") throw error;
        if (error instanceof TypeError && !error.kind) error.kind = "json"; // malformed body
        errors.push({ provider: id, kind: error.kind || "error", status: error.status, retryAfterSeconds: error.retryAfterSeconds });
        if (!isFallbackWorthy(error)) { const e = new Error("ADS-B source error"); e.kind = error.kind || "source_error"; e.status = error.status; e.errors = errors; throw e; }
      }
    }
    // Every source answered, but with an unusable body → source error; otherwise no response.
    const limited = errors.find(function (x) { return x.kind === "http" && x.status === 429; });
    if (limited) {
      const e = new Error("ADS-B providers rate limited or unavailable");
      e.kind = "rate_limited"; e.provider = limited.provider;
      // Retry-After may be hidden by a proxy/browser; use a conservative fallback.
      e.retryAfterSeconds = Number.isFinite(limited.retryAfterSeconds) ? limited.retryAfterSeconds : 300;
      e.errors = errors; throw e;
    }
    const allBad = errors.length > 0 && errors.every(function (x) { return x.kind === "json"; });
    const e = new Error(allBad ? "ADS-B sources returned invalid data" : "All ADS-B sources unavailable");
    e.kind = allBad ? "source_error" : "unavailable"; e.errors = errors; throw e;
  }

  // Great-circle destination after `distanceKm` along `bearingDeg`.
  function destination(lat, lon, bearingDeg, distanceKm) {
    const r = Math.PI / 180, d = distanceKm / R_KM, b = bearingDeg * r, p1 = lat * r, l1 = lon * r;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 / r, lon: ((l2 / r + 540) % 360) - 180 };
  }

  // Estimated position `elapsedSeconds` after the reported fix. Returns the
  // reported fix unchanged (estimated:false) when an estimate is not justified.
  function estimatePosition(ac, elapsedSeconds) {
    const base = { lat: ac.lat, lon: ac.lon, estimated: false };
    if (ac.on_ground || ac.speed_kmh === null || ac.track_deg === null || !(elapsedSeconds > 0)) return base;
    const t = Math.min(elapsedSeconds, MAX_ESTIMATE_SECONDS);
    const p = destination(ac.lat, ac.lon, ac.track_deg, ac.speed_kmh * t / 3600);
    return { lat: p.lat, lon: p.lon, estimated: true, seconds: t };
  }

  // Session trail per aircraft (only REPORTED fixes; estimates are never stored).
  function createTrailStore() {
    const trails = new Map();
    function add(result, nowMs) {
      const now = Number.isFinite(nowMs) ? nowMs : Date.now();
      result.aircraft.forEach(function (ac) {
        const t = ac.position_time ? Date.parse(ac.position_time) : now;
        const list = trails.get(ac.hex) || [];
        const last = list[list.length - 1];
        if (!last || last.lat !== ac.lat || last.lon !== ac.lon) list.push({ lat: ac.lat, lon: ac.lon, t: t });
        trails.set(ac.hex, list);
      });
      trails.forEach(function (list, hex) {
        const kept = list.filter(function (p) { return now - p.t <= TRAIL_MAX_MINUTES * 60000; }).slice(-TRAIL_MAX_POINTS);
        if (kept.length) trails.set(hex, kept); else trails.delete(hex);
      });
    }
    return { add: add, get: function (hex) { return (trails.get(hex) || []).slice(); }, size: function () { return trails.size; } };
  }

  // Rough count of requests a visible tab makes per hour at the poll interval.
  function requestsPerHour(pollSeconds) { return Math.ceil(3600 / (pollSeconds || POLL_SECONDS)); }

  return { ORDER, POLL_SECONDS, MAX_ESTIMATE_SECONDS, TRAIL_MAX_MINUTES, fetchAround, estimatePosition, destination, createTrailStore, requestsPerHour, isFallbackWorthy };
});
