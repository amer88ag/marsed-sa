(function (root, factory) {
  const api = factory();
  if (root) root.AirQualityService = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  async function fetchAirQuality(location, options) {
    const config = options || {};
    const adapter = config.adapter || (typeof OpenMeteoAirQualityAdapter !== "undefined" ? OpenMeteoAirQualityAdapter : null);
    const fetcher = config.fetch || (typeof fetch === "function" ? fetch : null);
    if (!adapter || !fetcher) throw new Error("Air quality service dependencies are unavailable");
    const response = await fetcher(adapter.buildUrl(location), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return adapter.normalize(await response.json(), location, config.retrievedAt);
  }
  return { fetchAirQuality };
});
