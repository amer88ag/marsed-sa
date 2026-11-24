(function (root, factory) {
  const http = (typeof module === "object" && module.exports)
    ? require("../../platform/http/client.js")
    : (root && root.HttpClient) || null;
  const api = factory(http);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WeatherService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (http) {
  "use strict";
  // Every call accepts: adapter, fetch, retrievedAt, signal (AbortSignal), timeoutMs.
  // Return contracts are unchanged; failures reject with HttpClient.RequestError
  // whose message keeps the historical "HTTP <status>" wording.
  function resolve(config, required, label) {
    const adapter = config.adapter || (typeof OpenMeteoAdapter !== "undefined" ? OpenMeteoAdapter : null);
    const fetcher = config.fetch || (typeof fetch === "function" ? fetch : null);
    if (!adapter || !fetcher || !http || required.some(name => typeof adapter[name] !== "function")) {
      throw new Error(label + " dependencies are unavailable");
    }
    return { adapter, fetcher };
  }
  function getJson(url, fetcher, config) {
    return http.request(url, {
      fetch: fetcher,
      headers: { Accept: "application/json" },
      signal: config.signal,
      timeoutMs: config.timeoutMs
    });
  }
  async function fetchWeather(location, options) {
    const config = options || {};
    const { adapter, fetcher } = resolve(config, ["buildCurrentUrl", "normalizeCurrent"], "Weather service");
    const payload = await getJson(adapter.buildCurrentUrl(location), fetcher, config);
    return adapter.normalizeCurrent(payload, location, config.retrievedAt);
  }
  async function fetchOverview(location, options) {
    const config = options || {};
    const { adapter, fetcher } = resolve(config, ["buildOverviewUrl", "normalizeOverview"], "Weather overview");
    return adapter.normalizeOverview(await getJson(adapter.buildOverviewUrl(location), fetcher, config), location, config.retrievedAt);
  }
  async function fetchOverviewBatch(locations, options) {
    const config = options || {};
    const { adapter, fetcher } = resolve(config, ["buildOverviewBatchUrl", "normalizeOverviewBatch"], "Weather overview batch");
    return adapter.normalizeOverviewBatch(await getJson(adapter.buildOverviewBatchUrl(locations), fetcher, config), locations, config.retrievedAt);
  }
  async function fetchRouteWeatherBatch(locations, options) {
    const config = options || {};
    const { adapter, fetcher } = resolve(config, ["buildRouteWeatherBatchUrl", "normalizeRouteWeatherBatch"], "Route weather");
    return adapter.normalizeRouteWeatherBatch(await getJson(adapter.buildRouteWeatherBatchUrl(locations, { forecastDays: config.forecastDays }), fetcher, config), locations, config.retrievedAt);
  }
  return { fetchWeather, fetchOverview, fetchOverviewBatch, fetchRouteWeatherBatch };
});
