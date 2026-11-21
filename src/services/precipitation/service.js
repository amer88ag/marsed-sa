(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PrecipitationService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  async function fetchDataset(url, options) {
    const fetcher = options && options.fetch ? options.fetch : (typeof fetch === "function" ? fetch : null);
    if (!fetcher) throw new Error("Fetch implementation is unavailable");
    const response = await fetcher(url, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload = await response.json();
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
