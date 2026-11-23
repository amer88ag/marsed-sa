(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OsrmAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function buildRouteUrl(origin, destination) {
    [origin, destination].forEach(point => {
      if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) {
        throw new TypeError("Route endpoints require finite longitude and latitude");
      }
    });
    const coordinates = [origin, destination].map(point => point.lon + "," + point.lat).join(";");
    return "https://router.project-osrm.org/route/v1/driving/" + coordinates +
      "?overview=full&geometries=geojson&steps=false&alternatives=false";
  }
  function normalizeRoute(payload) {
    if (!payload || payload.code !== "Ok" || !Array.isArray(payload.routes) || !payload.routes.length) {
      throw new TypeError("Routing provider returned no usable route");
    }
    const route = payload.routes[0];
    const coordinates = route.geometry && route.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2 ||
        !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
      throw new TypeError("Routing provider response is incomplete");
    }
    coordinates.forEach(pair => {
      if (!Array.isArray(pair) || pair.length < 2 ||
          !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) ||
          pair[0] < -180 || pair[0] > 180 || pair[1] < -90 || pair[1] > 90) {
        throw new TypeError("Routing provider returned invalid geometry");
      }
    });
    return {
      provider_id: "osrm-demo",
      distance_m: route.distance,
      duration_s: route.duration,
      geometry: coordinates,
      provenance: {
        source_url: "https://project-osrm.org/",
        attribution: "© OpenStreetMap contributors · Route calculated by OSRM",
        limitations: ["Demo routing service; best-effort availability", "No live traffic, road closures or official safety alerts"]
      }
    };
  }
  function haversineMeters(a, b) {
    const rad = value => value * Math.PI / 180;
    const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
    const lat1 = rad(a[1]), lat2 = rad(b[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function sampleRoute(route, requestedCount) {
    if (!route || !Array.isArray(route.geometry) || route.geometry.length < 2) {
      throw new TypeError("A route with at least two coordinates is required");
    }
    const count = Math.max(2, Math.min(12, Math.floor(requestedCount || 8)));
    const cumulative = [0];
    for (let i = 1; i < route.geometry.length; i++) {
      cumulative.push(cumulative[i - 1] + haversineMeters(route.geometry[i - 1], route.geometry[i]));
    }
    const total = cumulative[cumulative.length - 1];
    if (!Number.isFinite(total) || total <= 0) throw new TypeError("Route geometry has no measurable length");
    const selected = [];
    for (let i = 0; i < count; i++) {
      const target = total * i / (count - 1);
      let best = 0;
      for (let j = 1; j < cumulative.length; j++) {
        if (Math.abs(cumulative[j] - target) < Math.abs(cumulative[best] - target)) best = j;
      }
      if (!selected.length || selected[selected.length - 1].index !== best) {
        selected.push({
          index: best,
          lon: route.geometry[best][0],
          lat: route.geometry[best][1],
          distance_km: cumulative[best] / 1000
        });
      }
    }
    return selected.map((point, index) => ({
      id: "route-point-" + (index + 1),
      name: "نقطة " + (index + 1),
      lat: point.lat,
      lon: point.lon,
      distance_km: Number(point.distance_km.toFixed(1))
    }));
  }
  return { buildRouteUrl, normalizeRoute, sampleRoute, haversineMeters };
});
