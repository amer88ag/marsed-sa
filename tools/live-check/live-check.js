#!/usr/bin/env node
"use strict";
// Live verification of the external sources, run MANUALLY from a machine with
// internet access. Never run in CI. It re-uses the project's own URL builders,
// unit policy and date logic, so it checks the exact assumptions the code makes.
//
// Outcome per check:
//   verified            — responded and every assumption held
//   failed_verification — responded, but an assumption did not hold (a finding)
//   service_error       — responded with an HTTP error or an invalid body
//   unreachable         — no response (network, DNS, proxy, timeout): says
//                         nothing about the service itself
//
// Exit code: 0 all verified · 1 any failed_verification or service_error ·
//            2 only unreachable checks besides verified ones (inconclusive).
const path = require("node:path");
const ROOT = path.join(__dirname, "..", "..");
const req = rel => require(path.join(ROOT, rel));
const Http = req("src/platform/http/client.js");
const Units = req("src/platform/quality/units.js");
const Fresh = req("src/platform/quality/freshness.js");
const Adapter = req("src/providers/weather/open-meteo/adapter.js");
const Orchard = req("src/services/agriculture/orchard-weather.js");
const Itinerary = req("src/services/routing/itinerary.js");
const Gibs = req("src/services/satellite/nasa-gibs.js");
const Osrm = req("src/providers/routing/osrm/adapter.js");
const Cities = req("src/platform/geo/cities.js");

const TIMEOUT_MS = 25000;
const CHIRPS_BASE = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/final/";
const chirpsUrl = (product, date) => CHIRPS_BASE + product + "/" + date.slice(0, 4) + "/chirps-v3.0." + product + "." + date.replace(/-/g, ".") + ".tif";

function classify(error) {
  if (error && (error.kind === "network" || error.kind === "timeout" || error.kind === "aborted")) return "unreachable";
  return "service_error";
}

// Unit outcome for every field of a *_units block against the shared policy.
function unitReport(payload, blocks) {
  const issues = [];
  for (const block of blocks) {
    const data = payload[block], units = payload[block + "_units"];
    if (!data) continue;
    if (!units) { issues.push(block + "_units missing"); continue; }
    for (const key of Object.keys(data)) {
      if (Units.METADATA_FIELDS.includes(key)) continue;
      const status = Units.unitStatus(units, key);
      if (status !== "verified") issues.push(block + "." + key + ": " + status + " (declared " + JSON.stringify(units[key]) + ", expected " + JSON.stringify(Units.FIELD_UNITS[key]) + ")");
    }
  }
  return issues;
}

async function runChecks(options) {
  const o = options || {};
  const fetchImpl = o.fetch || fetch;
  const now = o.now || new Date();
  const get = (url, extra) => Http.request(url, Object.assign({ fetch: fetchImpl, timeoutMs: o.timeoutMs || TIMEOUT_MS }, extra || {}));
  const results = [];
  async function check(id, title, fn) {
    try {
      const outcome = await fn();
      results.push(Object.assign({ id, title }, outcome));
    } catch (error) {
      results.push({ id, title, status: classify(error), evidence: (error && error.kind ? error.kind + ": " : "") + (error && error.message) });
    }
  }
  const verdict = (problems, evidence) => ({ status: problems.length ? "failed_verification" : "verified", evidence, problems });
  const riyadh = Cities.get("riyadh"), jeddah = Cities.get("jeddah");

  await check("OM1", "Open-Meteo forecast: units, interval, offset, freshness", async () => {
    const p = await get(Adapter.buildCurrentUrl(riyadh));
    const problems = unitReport(p, ["current", "hourly", "daily"]);
    if (p.utc_offset_seconds !== 10800) problems.push("utc_offset_seconds = " + p.utc_offset_seconds + " (expected 10800)");
    if (p.timezone !== "Asia/Riyadh") problems.push("timezone = " + p.timezone);
    if (!p.current || p.current.interval !== 900) problems.push("current.interval = " + (p.current && p.current.interval) + " (expected 900)");
    const fresh = Fresh.currentWeather(p.current && p.current.time, now);
    if (fresh.status !== "fresh") problems.push("current.time " + (p.current && p.current.time) + " is " + fresh.status + " (age " + fresh.age_minutes + " min)");
    Adapter.normalizeCurrent(p, riyadh, now.toISOString());
    return verdict(problems, "current.time " + (p.current && p.current.time) + ", age " + fresh.age_minutes + " min, elevation " + p.elevation + " m, " + Object.keys(p.current_units || {}).length + " current units declared");
  });

  await check("OM2", "Open-Meteo archive (reanalysis): units and latency", async () => {
    const today = Orchard.saudiToday(now);
    const p = await get(Orchard.buildArchiveUrl({ lat: riyadh.lat, lon: riyadh.lon }, today));
    const problems = unitReport(p, ["daily"]);
    const { rows } = Orchard.normalizeDailyWithQuality(p);
    const missing = rows.filter(r => r.min === null || r.max === null).map(r => r.date);
    return verdict(problems, rows.length + " days " + (rows[0] && rows[0].date) + ".." + (rows.length && rows[rows.length - 1].date) + "; days without temperature (latency, informational): " + (missing.join(", ") || "none"));
  });

  await check("OM3", "Open-Meteo elevation (Copernicus DEM) plausibility for Riyadh", async () => {
    const url = "https://api.open-meteo.com/v1/elevation?latitude=" + riyadh.lat + "&longitude=" + riyadh.lon;
    const p = await get(url);
    const value = p && Array.isArray(p.elevation) ? p.elevation[0] : null;
    const problems = Number.isFinite(value) && value > 400 && value < 900 ? [] : ["elevation " + value + " m outside the plausible 400-900 m for Riyadh"];
    return verdict(problems, "elevation " + value + " m");
  });

  await check("OM4", "Open-Meteo route batch covers the 48 h window", async () => {
    const points = [{ id: "a", lat: riyadh.lat, lon: riyadh.lon }, { id: "b", lat: jeddah.lat, lon: jeddah.lon }];
    const p = await get(Adapter.buildRouteWeatherBatchUrl(points, { forecastDays: Itinerary.requiredForecastDays(now) }));
    const list = Array.isArray(p) ? p : [p];
    const problems = [];
    if (list.length !== 2) problems.push("expected 2 locations, got " + list.length);
    list.forEach((item, i) => unitReport(item, ["hourly"]).forEach(x => problems.push("point " + i + ": " + x)));
    const rows = Adapter.normalizeRouteWeatherBatch(list, points, now.toISOString());
    const end = Itinerary.forecastCoverageEnd(rows[0].hourly || []);
    if (!end || end < now.getTime() + Itinerary.FORECAST_WINDOW_MS) problems.push("hourly coverage ends before now + 48 h");
    return verdict(problems, "coverage until " + (end ? new Date(end).toISOString() : "none"));
  });

  for (const product of ["sat", "rnl"]) {
    await check("CH-" + product, "CHIRPS v3 daily final " + product.toUpperCase() + ": release-cycle assumption", async () => {
      const expected = Fresh.chirpsExpectedLatest(now);
      const response = await get(chirpsUrl(product, expected), { parse: "none", init: { method: "HEAD" } }).catch(error => {
        if (error.kind === "http" && error.status === 404) return null;
        throw error;
      });
      if (!response) {
        return { status: "failed_verification", evidence: chirpsUrl(product, expected) + " → 404",
          problems: ["file for the expected latest day " + expected + " is not published: the release cycle (third week + 7-day margin) is optimistic for today"] };
      }
      return verdict([], chirpsUrl(product, expected) + " → " + response.status + " (expected latest " + expected + " is published)");
    });
  }

  for (const key of ["viirsTrue", "modisTerraTrue", "modisAquaTrue", "modisFalse"]) {
    await check("GB-" + key, "NASA GIBS " + key + ": date domain and tile CORS", async () => {
      const availability = await Gibs.getAvailableDates(key, fetchImpl, { timeoutMs: o.timeoutMs || TIMEOUT_MS });
      const cap = Gibs.productDateCap(now);
      const date = Gibs.latestAvailableOnOrBefore(availability.periods, cap);
      const problems = [];
      if (!date) problems.push("no available date on or before " + cap);
      const url = date ? Gibs.buildTileUrl(key, date).replace("{z}", "5").replace("{y}", "13").replace("{x}", "20") : null;
      let tileEvidence = "tile not requested";
      if (url) {
        const tile = await get(url, { parse: "none", headers: { Origin: "https://marsed.example" } });
        const type = tile.headers && tile.headers.get ? tile.headers.get("content-type") : null;
        const cors = tile.headers && tile.headers.get ? tile.headers.get("access-control-allow-origin") : null;
        if (!type || !/^image\//.test(type)) problems.push("tile content-type " + type);
        if (cors !== "*" && cors !== "https://marsed.example") problems.push("tile has no usable Access-Control-Allow-Origin (" + cors + "): in-browser content checks will report «unverified»");
        tileEvidence = "tile " + type + ", ACAO " + cors + " (pixels not analysed here; use the browser tools)";
      }
      return verdict(problems, availability.periods.length + " periods, latest listed " + availability.latestDate + ", selected " + date + " (UTC cap " + cap + "); " + tileEvidence);
    });
  }

  await check("OS1", "OSRM demo route Riyadh → Jeddah plausibility", async () => {
    const p = await get(Osrm.buildRouteUrl({ lat: riyadh.lat, lon: riyadh.lon }, { lat: jeddah.lat, lon: jeddah.lon }));
    const route = Osrm.normalizeRoute(p);
    const km = route.distance_m / 1000, hours = route.duration_s / 3600;
    const problems = km > 800 && km < 1150 && hours > 7 && hours < 14 ? [] : ["implausible route: " + km.toFixed(0) + " km, " + hours.toFixed(1) + " h"];
    return verdict(problems, km.toFixed(0) + " km, " + hours.toFixed(1) + " h (estimate, no live traffic)");
  });

  const count = s => results.filter(r => r.status === s).length;
  const summary = { verified: count("verified"), failed_verification: count("failed_verification"), service_error: count("service_error"), unreachable: count("unreachable"), total: results.length };
  const exitCode = summary.failed_verification || summary.service_error ? 1 : summary.unreachable ? 2 : 0;
  return { ran_at: now.toISOString(), summary, exitCode, results };
}

function render(report) {
  const lines = ["Live source check — " + report.ran_at, ""];
  for (const r of report.results) {
    lines.push(r.status.toUpperCase().padEnd(20) + r.id + "  " + r.title);
    lines.push("    " + r.evidence);
    (r.problems || []).forEach(p => lines.push("    ! " + p));
  }
  const s = report.summary;
  lines.push("", "verified " + s.verified + " · failed_verification " + s.failed_verification + " · service_error " + s.service_error + " · unreachable " + s.unreachable + " (of " + s.total + ")");
  lines.push("unreachable = no response from this machine; it says nothing about the service itself.");
  lines.push("RESULT: " + (report.exitCode === 0 ? "ALL VERIFIED" : report.exitCode === 1 ? "FINDINGS — review the lines marked !" : "INCONCLUSIVE — some sources unreachable from this machine"));
  return lines.join("\n");
}

module.exports = { runChecks, render, chirpsUrl };

if (require.main === module) {
  runChecks().then(report => {
    console.log(render(report));
    if (process.argv.includes("--json")) require("node:fs").writeFileSync("live-check.json", JSON.stringify(report, null, 2));
    process.exit(report.exitCode);
  }).catch(error => { console.error(error); process.exit(1); });
}
