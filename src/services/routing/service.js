(function (root, factory) {
  const http = (typeof module === "object" && module.exports)
    ? require("../../platform/http/client.js")
    : (root && root.HttpClient) || null;
  const api = factory(http);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RoutingService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (http) {
  "use strict";
  // OSRM travel time is an estimate from the public demo server (no live traffic,
  // incidents or closures). Accepts adapter, fetch, signal and timeoutMs.
  async function fetchRoute(origin, destination, options) {
    const config = options || {};
    const adapter = config.adapter || (typeof OsrmAdapter !== "undefined" ? OsrmAdapter : null);
    const fetcher = config.fetch || (typeof fetch === "function" ? fetch : null);
    if (!adapter || !fetcher || !http) throw new Error("Routing service dependencies are unavailable");
    const payload = await http.request(adapter.buildRouteUrl(origin, destination), {
      fetch: fetcher,
      headers: { Accept: "application/json" },
      signal: config.signal,
      timeoutMs: config.timeoutMs
    });
    return adapter.normalizeRoute(payload);
  }
  return { fetchRoute };
});
