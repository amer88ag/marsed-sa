"use strict";
// Pages ↔ registry ↔ providers ↔ code. A page or data host added without being
// registered (or a registered entry pointing nowhere) fails here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Registry = require("../src/platform/registry/registry.js");
const services = require("../config/services.json");
const providers = require("../config/providers.json");

const PAGES = ["index.html", "seasons/index.html", "elevation/index.html", "satellite/index.html", "satellite/coverage.html", "admin/index.html"];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|html|py)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("registries are valid", () => {
  assert.deepEqual(Registry.validateRegistries(services, providers), { valid: true, errors: [] });
});

test("every user-facing page is registered as a service, and every ui_entry resolves", () => {
  const entries = services.services.filter(s => s.ui_entry).map(s => s.ui_entry);
  for (const page of PAGES.filter(p => p !== "admin/index.html")) {
    assert.ok(entries.some(entry => entry.split("#")[0] === page), page + " has a registry entry");
  }
  for (const entry of entries) {
    const [file, anchor] = entry.split("#");
    assert.ok(fs.existsSync(file), entry + " file exists");
    if (anchor) assert.match(fs.readFileSync(file, "utf8"), new RegExp('id="' + anchor + '"'), entry + " anchor exists");
  }
});

test("new services are research-stage, not silently activated", () => {
  for (const id of ["satellite", "satellite-coverage", "elevation", "seasons-orchard"]) {
    assert.equal(services.services.find(s => s.id === id).status, "research", id);
  }
  assert.deepEqual(services.services.filter(s => s.status === "active").map(s => s.id), ["weather"]);
});

// Scan scope (documented in tools/browser-smoke/README.md):
//   production code : src/**, scripts/**, the six pages
//   test tooling    : tools/**  (test-only hosts allowed here and ONLY here)
//   not scanned     : test/** and test-support/** — they use made-up hosts
//                     (x.test, w.test…) as fetch doubles and never reach the network.
const PRODUCTION_FILES = () => walk("src", []).concat(walk("scripts", []), PAGES);
const TOOL_FILES = () => walk("tools", []);

// Data hosts → provider ids in config/providers.json.
const DATA_HOSTS = {
  "api.open-meteo.com": "open-meteo", "archive-api.open-meteo.com": "open-meteo",
  "gibs.earthdata.nasa.gov": "nasa-gibs", "router.project-osrm.org": "osrm-demo",
  "tile.openstreetmap.org": "openstreetmap", "data.chc.ucsb.edu": "chirps-v3"
};
// Hosts that are not data sources. Every entry needs a reason, must actually occur
// in the scanned files (no stale entries), and may not overlap DATA_HOSTS.
const NON_DATA_HOSTS = {
  "unpkg.com": "Leaflet library CDN (code, not data)",
  "open-meteo.com": "attribution / documentation link",
  "www.openstreetmap.org": "attribution link (copyright page)",
  "www.chc.ucsb.edu": "CHIRPS documentation link",
  "api-doc.ncm.gov.sa": "NCM API documentation link (no integration)",
  "www.naturalearthdata.com": "Natural Earth attribution link",
  "gpm.nasa.gov": "IMERG documentation link (not integrated)",
  "github.com": "documentation links",
  "www.earthdata.nasa.gov": "NASA attribution link",
  "project-osrm.org": "OSRM project link",
  "nasa-gibs.github.io": "GIBS documentation link",
  "doi.org": "CHIRPS citation DOI",
  "www.mewa.gov.sa": "reference link in the seasons page",
  "saudipedia.com": "reference link in the seasons page",
  "geosa.gov.sa": "GEOSA terms link (no data used)",
  "geoportal.sa": "GEOSA portal link (no data used)",
  "direct.ksu.edu.sa": "reference link in the seasons page",
  "www.almisnid.com": "reference link in the seasons page",
  "alojeiri.com": "reference link in the seasons page",
  "aa.usno.navy.mil": "astronomical reference link in the seasons page",
  "www.google.com": "user-initiated Google Maps links; no embedded tiles or copied imagery",
  "earth.google.com": "user-initiated Google Earth links; no embedded imagery or automated scraping",
  "www.opengis.net": "KML 2.2 XML namespace identifier; not a network request"
};
// Test-only hosts: local servers and placeholders used by tools/browser-smoke.
const TOOL_ONLY_HOSTS = {
  "127.0.0.1": "local cross-origin servers for the real-CORS test",
  "local.test": "intercepted pseudo-origin for the browser smoke test",
  "tiles.example.org": "placeholder origin in cors-probe.js (requests intercepted)",
  "marsed.example": "reserved .example origin sent as the Origin header in tools/live-check to test NASA CORS (never requested)"
};

function hostsIn(files) {
  const hosts = new Map();
  for (const file of files) for (const m of fs.readFileSync(file, "utf8").matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
    if (!hosts.has(m[1])) hosts.set(m[1], new Set());
    hosts.get(m[1]).add(file);
  }
  return hosts;
}

test("every external host in production code is a registered data provider or a documented link", () => {
  const ids = new Set(providers.providers.map(p => p.id));
  for (const [host, files] of hostsIn(PRODUCTION_FILES())) {
    assert.ok(!TOOL_ONLY_HOSTS[host], "test-only host in production code: " + host + " in " + [...files].join(", "));
    if (NON_DATA_HOSTS[host]) continue;
    assert.ok(DATA_HOSTS[host], "unregistered external host: " + host + " in " + [...files].join(", "));
    assert.ok(ids.has(DATA_HOSTS[host]), host + " → " + DATA_HOSTS[host] + " is in providers.json");
  }
});

test("test tooling may use local test hosts, but real hosts in tools/ follow the same rules", () => {
  const ids = new Set(providers.providers.map(p => p.id));
  for (const [host, files] of hostsIn(TOOL_FILES())) {
    if (TOOL_ONLY_HOSTS[host] || NON_DATA_HOSTS[host]) continue;
    assert.ok(DATA_HOSTS[host] && ids.has(DATA_HOSTS[host]), "unregistered host in tools/: " + host + " in " + [...files].join(", "));
  }
});

test("host allowlists cannot be used to bypass the check", () => {
  const production = hostsIn(PRODUCTION_FILES()), tools = hostsIn(TOOL_FILES());
  for (const [list, name, scanned] of [[NON_DATA_HOSTS, "NON_DATA_HOSTS", production], [TOOL_ONLY_HOSTS, "TOOL_ONLY_HOSTS", tools]]) {
    for (const [host, reason] of Object.entries(list)) {
      assert.ok(typeof reason === "string" && reason.trim().length >= 8, name + "." + host + " needs a documented reason");
      assert.ok(!DATA_HOSTS[host], name + "." + host + " overlaps a data host");
      assert.ok(scanned.has(host), name + "." + host + " is not used in the scanned files (stale entry)");
    }
  }
  for (const host of Object.keys(TOOL_ONLY_HOSTS)) assert.ok(!NON_DATA_HOSTS[host], host + " listed twice");
});

test("each page shows the attribution its providers require", () => {
  const page = file => fs.readFileSync(file, "utf8");
  for (const file of ["index.html", "elevation/index.html", "satellite/index.html"]) assert.match(page(file), /OpenStreetMap/, file);
  assert.match(page("elevation/index.html"), /Copernicus/);
  assert.match(page("elevation/index.html"), /Open-Meteo/);
  assert.match(page("satellite/index.html") + fs.readFileSync("src/services/satellite/nasa-gibs.js", "utf8"), /NASA/);
  assert.match(fs.readFileSync("src/platform/geo/map-frame.js", "utf8"), /Natural Earth[\s\S]*ليست حدوداً رسمية/);
  assert.match(page("seasons/index.html") + fs.readFileSync("src/services/agriculture/orchard-weather.js", "utf8"), /Open-Meteo\.com/);
});

test("navigation links between pages resolve to existing files", () => {
  for (const file of PAGES) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(/href="([^"#:]+)"/g)) {
      const target = path.normalize(path.join(path.dirname(file), m[1]));
      const resolved = fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, "index.html") : target;
      assert.ok(fs.existsSync(resolved), file + " → " + m[1]);
    }
  }
});

test("admin page renders every registered service and provider", async () => {
  const html = fs.readFileSync("admin/index.html", "utf8");
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, { id, textContent: "", innerHTML: "", value: "", addEventListener() {} }); return elements.get(id); };
  const context = {
    document: { getElementById: el }, console, Promise, JSON, Array, Object, String, Set, Number, URL,
    fetch: async url => ({ ok: true, json: async () => url.includes("services") ? services : providers })
  };
  context.window = context;
  context.window.MarsedRegistry = Registry;
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
  inline.forEach(code => vm.runInNewContext(code, context));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(el("loadStatus").textContent, "تم تحميل السجلات");
  assert.equal(String(el("serviceCount").textContent), String(services.services.length));
  assert.equal(String(el("providerCount").textContent), String(providers.providers.length));
  for (const s of services.services) assert.ok(el("servicesBody").innerHTML.includes(s.title), s.id);
  for (const p of providers.providers) assert.ok(el("providersBody").innerHTML.includes(p.name.replace(/&/g, "&amp;")), p.id);
});

test("satellite page suggests the nearest valid dates when an off-step date is picked", () => {
  const Gibs = require("../src/services/satellite/nasa-gibs.js");
  const { runPage, flush } = require("../test-support/dom-harness.js");
  const chain = () => new Proxy({ options: {} }, { get: (o, k) => k in o ? o[k] : () => chain() });
  const page = runPage("satellite/index.html", {
    L: { map: chain, tileLayer: chain, geoJSON: chain },
    NasaGibsSatellite: Object.assign({}, Gibs, { saudiDate: () => "2026-11-24", productDateCap: () => "2026-11-24",
      getAvailableDates: async () => ({ periods: Gibs.parseAvailablePeriods("<Domain>2026-01-01/2026-11-24/P8D</Domain>") }) }),
    HttpClient: require("../src/platform/http/client.js"), SaudiTime: require("../src/platform/time/saudi-time.js"),
    FreshnessPolicy: require("../src/platform/quality/freshness.js"), CityRegistry: require("../src/platform/geo/cities.js"),
    SaudiMapFrame: { frame: async () => ({ ok: false }) }
  });
  return flush().then(flush).then(() => {
    page.$("imageDate").value = "2026-11-12";
    page.$("imageDate").fire("change");
    assert.match(page.$("imageStatus").textContent, /أقرب تاريخ متاح: 2026-11-09 أو 2026-11-17/);
  });
});
