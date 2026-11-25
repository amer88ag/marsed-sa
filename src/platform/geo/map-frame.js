(function (root, factory) {
  const deps = (typeof module === "object" && module.exports)
    ? { http: require("../http/client.js"), cities: require("./cities.js") }
    : { http: root && root.HttpClient, cities: root && root.CityRegistry };
  const api = factory(deps);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SaudiMapFrame = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";
  // Frames a Leaflet map on Saudi Arabia: soft maxBounds plus an illustrative
  // national outline from Natural Earth (public domain, Saudi point of view).
  // The outline is NOT an official GEOSA boundary and is labelled as such.
  const BOUNDARY_ATTRIBUTION = 'الحدود للتوضيح: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (ملك عام) — ليست حدوداً رسمية معتمدة';
  const DEFAULT_BOUNDS = { south: 12.5, west: 31.5, north: 35.5, east: 59.5 };

  function bounds() {
    return (deps.cities && deps.cities.BOUNDS) || DEFAULT_BOUNDS;
  }
  function leafletBounds() {
    const b = bounds();
    return [[b.south, b.west], [b.north, b.east]];
  }
  // True when a point lies inside the padded observatory frame.
  function contains(lat, lon) {
    const b = bounds();
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
  }
  function restrict(map) {
    if (!map) return;
    if (typeof map.setMaxBounds === "function") map.setMaxBounds(leafletBounds());
    if (typeof map.setMinZoom === "function") map.setMinZoom(4);
    if (map.options) map.options.maxBoundsViscosity = 0.8;
  }
  // Adds the outline; resolves to { ok, layer, error }. A failure never breaks the map.
  async function addBoundary(map, L, options) {
    const config = options || {};
    if (!map || !L || typeof L.geoJSON !== "function" || !deps.http) {
      return { ok: false, layer: null, error: new Error("Map or GeoJSON support unavailable") };
    }
    try {
      const data = await deps.http.request(config.url || "data/geo/saudi_boundary.geojson", {
        fetch: config.fetch, timeoutMs: config.timeoutMs || 10000, signal: config.signal
      });
      if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features) || !data.features.length) {
        throw new TypeError("Boundary file is not a valid FeatureCollection");
      }
      const layer = L.geoJSON(data, {
        interactive: false,
        attribution: BOUNDARY_ATTRIBUTION,
        style: { color: "#0b5d3b", weight: 1.6, opacity: 0.85, fill: false, dashArray: "5 4" }
      }).addTo(map);
      return { ok: true, layer: layer, error: null };
    } catch (error) {
      return { ok: false, layer: null, error: error };
    }
  }
  function frame(map, L, options) {
    restrict(map);
    return addBoundary(map, L, options);
  }
  return { BOUNDARY_ATTRIBUTION, bounds, leafletBounds, contains, restrict, addBoundary, frame };
});
