"use strict";
// Shared Open-Meteo-shaped fixture and a dashboard runner with a fixed clock.
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const { runPage, flush } = require("./dom-harness.js");
const Adapter = require(path.join(ROOT, "src/providers/weather/open-meteo/adapter.js"));

function hourlyBlock(startLocal, hours) {
  const time = [], temperature = [];
  const start = Date.parse(startLocal + ":00+03:00");
  for (let i = 0; i < hours; i++) {
    time.push(new Date(start + i * 3600000 + 3 * 3600000).toISOString().slice(0, 16));
    temperature.push(10 + i);
  }
  return { time, temperature_2m: temperature, precipitation_probability: time.map(() => 0), wind_speed_10m: time.map(() => 5), weather_code: time.map(() => 0) };
}

function payload(options) {
  const o = options || {};
  return {
    latitude: 24.71, longitude: 46.68, elevation: 612, timezone: "Asia/Riyadh", utc_offset_seconds: o.offset === undefined ? 10800 : o.offset,
    current_units: Object.assign({ temperature_2m: "°C", precipitation: "mm", wind_speed_10m: "km/h", pressure_msl: "hPa" }, o.currentUnits || {}),
    current: Object.assign({ time: o.validTime || "2026-11-24T23:45", interval: 900, temperature_2m: 18.4, precipitation: 0.2, wind_speed_10m: 12, pressure_msl: 1016.2, surface_pressure: 945.1, weather_code: 1, is_day: 0 }, o.current || {}),
    daily_units: { precipitation_sum: "mm" },
    daily: { time: ["2026-11-24", "2026-11-25", "2026-11-26"], precipitation_sum: [0, null, 3.2], precipitation_probability_max: [5, null, 60], temperature_2m_max: [25, 24, 22], temperature_2m_min: [12, null, 11], weather_code: [1, 2, 61] },
    hourly: hourlyBlock(o.hourlyStart || "2026-11-24T20:00", 12)
  };
}

// Any Leaflet method returns the same chainable object.
function chainable() {
  const target = { options: {}, getZoom: () => 5 };
  const proxy = new Proxy(target, { get: (obj, key) => key in obj ? obj[key] : () => proxy });
  return proxy;
}
function leafletStub() { return { map: chainable, tileLayer: chainable, marker: chainable, circleMarker: chainable, polyline: chainable, geoJSON: chainable }; }

class FixedClock {
  static at(iso) {
    const fixed = Date.parse(iso);
    return class FixedDate extends Date {
      constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
      static now() { return fixed; }
    };
  }
}

async function runDashboard(nowIso, data, extra) {
  const page = runPage(path.join(ROOT, "index.html"), Object.assign({
    Date: FixedClock.at(nowIso),
    L: leafletStub(),
    HttpClient: require(path.join(ROOT, "src/platform/http/client.js")),
    SaudiTime: require(path.join(ROOT, "src/platform/time/saudi-time.js")),
    FreshnessPolicy: require(path.join(ROOT, "src/platform/quality/freshness.js")),
    UnitPolicy: require(path.join(ROOT, "src/platform/quality/units.js")),
    SourceState: require(path.join(ROOT, "src/platform/data/source-state.js")),
    CityRegistry: require(path.join(ROOT, "src/platform/geo/cities.js")),
    RouteItinerary: require(path.join(ROOT, "src/services/routing/itinerary.js")),
    OsrmAdapter: require(path.join(ROOT, "src/providers/routing/osrm/adapter.js")),
    ChirpsAdapter: require(path.join(ROOT, "src/providers/precipitation/chirps/adapter.js")),
    PrecipitationService: (extra && extra.precipitation) || { fetchDataset: async () => { throw new Error("offline"); }, getCitySeries() {} },
    WeatherService: {
      fetchWeather: async () => { if (data instanceof Error) throw data; return Adapter.normalizeCurrent(data, { id: "riyadh", lat: 24.71, lon: 46.68 }, "2026-11-24T20:50:00Z"); },
      fetchOverviewBatch: () => new Promise(() => {}),
      fetchRouteWeatherBatch: async () => []
    },
    RoutingService: { fetchRoute: async () => { throw new Error("unused"); } }
  }, (extra && extra.globals) || {}));
  for (let i = 0; i < 4; i++) await flush();
  return page;
}

module.exports = { payload, hourlyBlock, runDashboard, FixedClock };
