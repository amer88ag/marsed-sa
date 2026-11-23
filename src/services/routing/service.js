(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RoutingService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  async function fetchRoute(origin, destination, options) {
    const config = options || {};
    const adapter = config.adapter || (typeof OsrmAdapter !== "undefined" ? OsrmAdapter : null);
    const fetcher = config.fetch || (typeof fetch === "function" ? fetch : null);
    if (!adapter || !fetcher) throw new Error("Routing service dependencies are unavailable");
    const response = await fetcher(adapter.buildRouteUrl(origin, destination), {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return adapter.normalizeRoute(await response.json());
  }
  return { fetchRoute };
});
