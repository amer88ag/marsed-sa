(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GeoMeasure = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const EARTH_RADIUS_M = 6371008.8;
  function validPoint(point) {
    if (!point || typeof point !== "object") return null;
    const lat = Number(point.lat), lon = Number(point.lon);
    if (point.lat == null || point.lon == null ||
        (typeof point.lat === "string" && !point.lat.trim()) ||
        (typeof point.lon === "string" && !point.lon.trim()) ||
        typeof point.lat === "boolean" || typeof point.lon === "boolean" ||
        !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat: lat, lon: lon };
  }
  function normalize(points) {
    if (!Array.isArray(points)) return null;
    const result = [];
    for (const item of points) {
      const p = validPoint(item);
      if (!p) return null;
      if (!result.length || result[result.length - 1].lat !== p.lat ||
          result[result.length - 1].lon !== p.lon) result.push(p);
    }
    if (result.length > 1 && result[0].lat === result[result.length - 1].lat &&
        result[0].lon === result[result.length - 1].lon) result.pop();
    return result;
  }
  function distance(a, b) {
    const p1 = validPoint(a), p2 = validPoint(b);
    if (!p1 || !p2) return null;
    const rad = Math.PI / 180;
    const lat1 = p1.lat * rad, lat2 = p2.lat * rad;
    const dLat = (p2.lat - p1.lat) * rad, dLon = (p2.lon - p1.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function orientation(a, b, c) {
    return (b.lon - a.lon) * (c.lat - a.lat) -
      (b.lat - a.lat) * (c.lon - a.lon);
  }
  function onSegment(a, b, p) {
    const eps = 1e-10;
    return p.lon >= Math.min(a.lon, b.lon) - eps &&
      p.lon <= Math.max(a.lon, b.lon) + eps &&
      p.lat >= Math.min(a.lat, b.lat) - eps &&
      p.lat <= Math.max(a.lat, b.lat) + eps;
  }
  function segmentsIntersect(a, b, c, d) {
    const o1 = orientation(a, b, c), o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a), o4 = orientation(c, d, b);
    const eps = 1e-10;
    if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) &&
        ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true;
    return (Math.abs(o1) <= eps && onSegment(a, b, c)) ||
      (Math.abs(o2) <= eps && onSegment(a, b, d)) ||
      (Math.abs(o3) <= eps && onSegment(c, d, a)) ||
      (Math.abs(o4) <= eps && onSegment(c, d, b));
  }
  function isSimple(points) {
    const ring = normalize(points);
    if (!ring || ring.length < 3) return false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      for (let j = i + 1; j < ring.length; j++) {
        const nextI = (i + 1) % ring.length, nextJ = (j + 1) % ring.length;
        if (i === j || nextI === j || nextJ === i) continue;
        if (segmentsIntersect(a, b, ring[j], ring[nextJ])) return false;
      }
    }
    return true;
  }
  function perimeter(points) {
    const ring = normalize(points);
    if (!ring || ring.length < 3 || !isSimple(ring)) return null;
    let total = 0;
    for (let i = 0; i < ring.length; i++) {
      const d = distance(ring[i], ring[(i + 1) % ring.length]);
      if (d == null) return null;
      total += d;
    }
    return total;
  }
  // Spherical polygon area (Chamberlain-Duquette style); output is the smaller
  // enclosed area on a sphere. Not a cadastral/legal survey.
  function area(points) {
    const ring = normalize(points);
    if (!ring || ring.length < 3 || !isSimple(ring)) return null;
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const lonA = a.lon * Math.PI / 180, lonB = b.lon * Math.PI / 180;
      const latA = a.lat * Math.PI / 180, latB = b.lat * Math.PI / 180;
      sum += (lonB - lonA) * (2 + Math.sin(latA) + Math.sin(latB));
    }
    const raw = Math.abs(sum * EARTH_RADIUS_M * EARTH_RADIUS_M / 2);
    const sphere = 4 * Math.PI * EARTH_RADIUS_M * EARTH_RADIUS_M;
    const result = Math.min(raw, sphere - raw);
    return result > 0.01 ? result : null;
  }
  function formatArea(squareMeters) {
    if (!Number.isFinite(squareMeters) || squareMeters < 0) return null;
    if (squareMeters >= 1000000) return { value: squareMeters / 1000000, unit: "كم²" };
    if (squareMeters >= 10000) return { value: squareMeters / 10000, unit: "هكتار" };
    return { value: squareMeters, unit: "م²" };
  }
  return { validPoint: validPoint, normalize: normalize, distance: distance, isSimple: isSimple,
    perimeter: perimeter, area: area, formatArea: formatArea };
});
