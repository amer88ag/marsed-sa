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
  return { fetchWeather };
});
