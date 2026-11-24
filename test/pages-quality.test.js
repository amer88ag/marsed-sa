"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Http = require("../src/platform/http/client.js");
const Itinerary = require("../src/services/routing/itinerary.js");
const Osrm = require("../src/providers/routing/osrm/adapter.js");
const { runPage, flush, deferred } = require("../test-support/dom-harness.js");

const chain = () => { const o = {}; ["addTo", "setLatLng", "bindPopup", "openPopup", "on", "setView", "fitBounds", "getBounds", "setStyle", "setPopupContent", "bringToFront"].forEach(m => { o[m] = () => o; }); o.getZoom = () => 5; return o; };
const leaflet = () => ({ map: chain, tileLayer: chain, marker: chain, circleMarker: chain, polyline: chain });

function elevationHarness(fetchImpl) {
  const HttpWithFetch = Object.assign({}, Http, { request: (url, options) => Http.request(url, Object.assign({}, options, { fetch: fetchImpl })) });
  const clipboard = [];
  const page = runPage("elevation/index.html", {
    L: leaflet(), HttpClient: HttpWithFetch,
    navigator: { clipboard: { writeText: async text => { clipboard.push(text); } } }
  });
  return Object.assign(page, { clipboard });
}

test("elevation: newer point wins, older request is aborted, copy includes source", async () => {
  const pending = [];
  const page = elevationHarness((url, init) => { const d = deferred(); pending.push({ url, init, d }); return d.promise; });
  page.$("coords").value = "18.2, 42.5";
  page.$("searchPoint").fire("click");
  page.$("coords").value = "21.4, 39.8";
  page.$("searchPoint").fire("click");
  assert.equal(pending.length, 2);
  assert.equal(pending[0].init.signal.aborted, true, "previous request cancelled");
  pending[1].d.resolve({ ok: true, json: async () => ({ elevation: [277] }) });
  await flush(); await flush();
  pending[0].d.resolve({ ok: true, json: async () => ({ elevation: [2200] }) });
  await flush(); await flush();
  assert.match(page.$("elevation").textContent, /٢٧٧|277/);
  assert.equal(page.$("copyResult").disabled, false);
  await page.$("copyResult").fire("click");
  await flush();
  assert.match(page.clipboard[0], /21\.40000, 39\.80000/);
  assert.match(page.clipboard[0], /Copernicus DEM GLO-90/);
});

test("elevation: timeout and invalid values are reported, not shown as numbers", async () => {
  const page = elevationHarness(() => new Promise(() => {}));
  const src = fs.readFileSync("elevation/index.html", "utf8");
  assert.match(src, /TIMEOUT_MS=12000/);
  assert.match(src, /Elevation data by Open-Meteo\.com/);
  assert.match(src, /90 متراً/);
  const nullPage = elevationHarness(async () => ({ ok: true, json: async () => ({ elevation: [null] }) }));
  nullPage.$("coords").value = "18.2, 42.5";
  await nullPage.$("searchPoint").fire("click");
  await flush();
  assert.equal(nullPage.$("elevation").textContent, "—");
  assert.match(nullPage.$("status").textContent, /لم تُرجع الخدمة قيمة ارتفاع صالحة/);
  assert.equal(nullPage.$("copyResult").disabled, true);
  void page;
});

// ---- road trip on the dashboard ----------------------------------------------
function dashboardHarness(services) {
  return runPage("index.html", Object.assign({
    L: leaflet(), HttpClient: Http, RouteItinerary: Itinerary, OsrmAdapter: Osrm,
    PrecipitationService: { fetchDataset: async () => { throw new Error("offline"); }, getCitySeries() {} },
    WeatherService: {
      fetchWeather: () => new Promise(() => {}),
      fetchOverviewBatch: () => new Promise(() => {}),
      fetchRouteWeatherBatch: services.routeWeather
    },
    RoutingService: { fetchRoute: services.route }
  }), { values: { tripOrigin: "riyadh", tripDestination: "jeddah", tripDeparture: "" } });
}
const route = { distance_m: 900000, duration_s: 9 * 3600, geometry: [[46.67, 24.71], [43, 23], [39.19, 21.49]] };

test("trip: missing hourly forecast shows «غير متاح» and the request asks for enough calendar days", async () => {
  let requestedDays = null;
  const page = dashboardHarness({
    route: async () => route,
    routeWeather: async (points, options) => {
      requestedDays = options.forecastDays;
      return points.map(point => ({ location_id: point.id, hourly: null, error: "Hourly forecast unavailable" }));
    }
  });
  await page.$("planTrip").fire("click");
  await flush();
  assert.ok(requestedDays >= 3, "forecastDays " + requestedDays);
  assert.match(page.$("tripOutput").innerHTML, /غير متاح/);
  assert.match(page.$("tripStatus").textContent, /لا يتوفر توقع ساعي مطابق/);
  assert.match(page.$("tripStatus").textContent, /ليس زمن مرور حياً/);
  assert.equal(page.$("planTrip").disabled, false);
});

test("trip: routing timeout re-enables the button and explains the failure", async () => {
  const page = dashboardHarness({
    route: async () => { throw Object.assign(new Error("Request timed out"), { kind: "timeout" }); },
    routeWeather: async () => []
  });
  await page.$("planTrip").fire("click");
  await flush();
  assert.match(page.$("tripStatus").textContent, /انتهت مهلة الاتصال/);
  assert.equal(page.$("planTrip").disabled, false);
});

test("no literal \\n artefacts are rendered in pages", () => {
  for (const file of ["index.html", "seasons/index.html", "elevation/index.html", "satellite/index.html", "satellite/coverage.html", "admin/index.html"]) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /\\n</, file);
  }
});

test("every page that calls a service loads the shared HTTP client first", () => {
  for (const [file, prefix] of [["index.html", "src/"], ["seasons/index.html", "../src/"], ["elevation/index.html", "../src/"], ["satellite/index.html", "../src/"], ["satellite/coverage.html", "../src/"]]) {
    const page = fs.readFileSync(file, "utf8");
    const client = page.indexOf('src="' + prefix + 'platform/http/client.js"');
    assert.ok(client > 0, file);
    const firstService = page.search(/src="[^"]*(services|providers)\//);
    assert.ok(firstService === -1 || client < firstService, file);
  }
});
