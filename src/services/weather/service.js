(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WeatherService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  async function fetchWeather(location, options) {
    const config = options || {};
    const adapter = config.adapter || (typeof OpenMeteoAdapter !== "undefined" ? OpenMeteoAdapter : null);
    const fetcher = config.fetch || (typeof fetch === "function" ? fetch : null);
    if (!adapter || !fetcher) throw new Error("Weather service dependencies are unavailable");
    const response = await fetcher(adapter.buildCurrentUrl(location), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload = await response.json();
    return adapter.normalizeCurrent(payload, location, config.retrievedAt);
  }
  async function fetchOverview(location, options) {
    const config = options || {};
    const adapter = config.adapter || (typeof OpenMeteoAdapter !== "undefined" ? OpenMeteoAdapter : null);
    const fetcher = config.fetch || (typeof fetch === "function" ? fetch : null);
    if (!adapter || !fetcher || typeof adapter.buildOverviewUrl !== "function" || typeof adapter.normalizeOverview !== "function") {
      throw new Error("Weather overview dependencies are unavailable");
    }
    const response = await fetcher(adapter.buildOverviewUrl(location), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return adapter.normalizeOverview(await response.json(), location, config.retrievedAt);
  }
  async function fetchOverviewBatch(locations, options) {
    const config = options || {};
    const adapter = config.adapter || (typeof OpenMeteoAdapter !== "undefined" ? OpenMeteoAdapter : null);
    const fetcher = config.fetch || (typeof fetch === "function" ? fetch : null);
    if (!adapter || !fetcher || typeof adapter.buildOverviewBatchUrl !== "function" || typeof adapter.normalizeOverviewBatch !== "function") {
      throw new Error("Weather overview batch dependencies are unavailable");
    }
    const response = await fetcher(adapter.buildOverviewBatchUrl(locations), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return adapter.normalizeOverviewBatch(await response.json(), locations, config.retrievedAt);
  }
  return { fetchWeather, fetchOverview, fetchOverviewBatch };
});
