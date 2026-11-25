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

// Data hosts used at runtime or by tooling → provider ids. Library/doc hosts are listed separately.
const DATA_HOSTS = {
  "api.open-meteo.com": "open-meteo", "archive-api.open-meteo.com": "open-meteo",
  "gibs.earthdata.nasa.gov": "nasa-gibs", "router.project-osrm.org": "osrm-demo",
  "tile.openstreetmap.org": "openstreetmap", "data.chc.ucsb.edu": "chirps-v3"
};
const NON_DATA_HOSTS = new Set(["unpkg.com", "open-meteo.com", "www.openstreetmap.org", "www.chc.ucsb.edu", "api-doc.ncm.gov.sa",
  "www.naturalearthdata.com", "gpm.nasa.gov", "github.com", "www.earthdata.nasa.gov", "project-osrm.org", "nasa-gibs.github.io",
  "doi.org", "www.mewa.gov.sa", "saudipedia.com", "geosa.gov.sa", "geoportal.sa", "direct.ksu.edu.sa", "www.almisnid.com",
  "alojeiri.com", "aa.usno.navy.mil"]);

test("every external host in the code is a registered data provider or a documented link", () => {
  const files = walk("src", []).concat(walk("scripts", []), PAGES);
  const hosts = new Set();
  for (const file of files) for (const m of fs.readFileSync(file, "utf8").matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) hosts.add(m[1]);
  const ids = new Set(providers.providers.map(p => p.id));
  for (const host of hosts) {
    if (NON_DATA_HOSTS.has(host)) continue;
    assert.ok(DATA_HOSTS[host], "unregistered external host: " + host);
    assert.ok(ids.has(DATA_HOSTS[host]), host + " → " + DATA_HOSTS[host] + " is in providers.json");
  }
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
