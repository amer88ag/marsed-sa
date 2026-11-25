(function (root, factory) {
  const http = (typeof module === "object" && module.exports)
    ? require("../../platform/http/client.js")
    : (root && root.HttpClient) || null;
  const api = factory(http);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PrecipitationService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (http) {
  "use strict";
  // Loads the committed CHIRPS artifact (data/chirps_daily.json). Success here does
  // NOT prove the live CHIRPS source is reachable; that is checked separately by the
  // research workflow. Accepts fetch, signal and timeoutMs.
  async function fetchDataset(url, options) {
    const config = options || {};
    const fetcher = config.fetch || (typeof fetch === "function" ? fetch : null);
    if (!fetcher || !http) throw new Error("Fetch implementation is unavailable");
    const payload = await http.request(url, {
      fetch: fetcher,
      init: { cache: "no-store" },
      signal: config.signal,
      timeoutMs: config.timeoutMs,
      retries: config.retries === undefined ? 1 : config.retries,
      retryDelayMs: config.retryDelayMs
    });
    if (!payload || payload.schema_version !== 1 || !payload.series) {
      throw new TypeError("Unsupported CHIRPS dataset schema");
    }
    return payload;
  }
  function getCitySeries(dataset, cityId, productId, adapter) {
    const normalizer = adapter || (typeof ChirpsAdapter !== "undefined" ? ChirpsAdapter : null);
    if (!normalizer) throw new Error("CHIRPS adapter is unavailable");
    return normalizer.normalizeCitySeries(dataset, cityId, productId);
  }
  return { fetchDataset, getCitySeries };
});
