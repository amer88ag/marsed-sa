// Terrain engine (research stage): slope, aspect, D8 flow direction and
// topographic position from a small elevation grid around one point.
// Source grid: Open-Meteo Elevation API (Copernicus DEM GLO-90, ~90 m).
// Results describe the DEM surface at ~90 m spacing, not field survey.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TerrainEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const M_PER_DEG_LAT = 111320;
  const DIRS = ["شمال", "شمال شرقي", "شرق", "جنوب شرقي", "جنوب", "جنوب غربي", "غرب", "شمال غربي"];
  // Operational thresholds for labelling (not a published standard).
  const FLAT_DEG = 1;          // below this the surface is treated as flat
  const TPI_METRES = 15;       // centre vs. neighbourhood mean for peak / valley labels

  function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

  // size×size points, row 0 = north, column 0 = west, centre at the middle.
  function gridPoints(lat, lon, spacingM, size) {
    if (!isNum(lat) || !isNum(lon)) throw new TypeError("finite lat/lon required");
    const n = size || 5, s = spacingM || 90, half = (n - 1) / 2;
    const dLat = s / M_PER_DEG_LAT, dLon = s / (M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180));
    const pts = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) pts.push({ lat: lat + (half - r) * dLat, lon: lon + (c - half) * dLon });
    return { size: n, spacing_m: s, points: pts };
  }

  function buildUrl(grid) {
    if (grid.points.length > 100) throw new RangeError("Open-Meteo Elevation accepts at most 100 points per request");
    return "https://api.open-meteo.com/v1/elevation?latitude=" + grid.points.map(p => p.lat.toFixed(6)).join(",") +
      "&longitude=" + grid.points.map(p => p.lon.toFixed(6)).join(",");
  }

  // Validates the response and returns a size×size matrix of metres.
  function toMatrix(payload, grid) {
    const e = payload && payload.elevation;
    if (!Array.isArray(e) || e.length !== grid.points.length) throw new TypeError("elevation response length does not match the grid");
    if (!e.every(isNum)) throw new TypeError("elevation response contains invalid values");
    const m = [];
    for (let r = 0; r < grid.size; r++) m.push(e.slice(r * grid.size, (r + 1) * grid.size));
    return m;
  }

  function compass(deg) { return DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }

  // Horn (1981) 3×3 gradient around matrix cell (r,c); cell size in metres.
  function slopeAspect(m, r, c, cell) {
    const z = (dr, dc) => m[r + dr][c + dc];
    const a = z(-1, -1), b = z(-1, 0), cc = z(-1, 1), d = z(0, -1), f = z(0, 1), g = z(1, -1), h = z(1, 0), i = z(1, 1);
    const dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * cell);    // + towards east
    const dzdy = ((a + 2 * b + cc) - (g + 2 * h + i)) / (8 * cell);    // + towards north
    const grad = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
    const slopeDeg = Math.atan(grad) * 180 / Math.PI;
    if (slopeDeg < FLAT_DEG) return { slope_deg: slopeDeg, slope_pct: grad * 100, aspect_deg: null, aspect: "مستوٍ تقريباً" };
    // Aspect = compass direction the slope faces (downhill), clockwise from north.
    const aspect = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360;
    return { slope_deg: slopeDeg, slope_pct: grad * 100, aspect_deg: aspect, aspect: compass(aspect) };
  }

  // D8: steepest downhill neighbour of the centre cell.
  function flowD8(m, r, c, cell) {
    const z0 = m[r][c]; let best = null;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const dist = cell * (dr && dc ? Math.SQRT2 : 1), drop = (z0 - m[r + dr][c + dc]) / dist;
      if (drop > 0 && (!best || drop > best.drop)) best = { drop: drop, deg: (Math.atan2(dc, -dr) * 180 / Math.PI + 360) % 360 };
    }
    if (!best) return { direction: null, label: "لا يوجد اتجاه أدنى: نقطة منخفضة محلية أو سطح مستوٍ (قد تتجمع المياه)", drop_m_per_m: 0 };
    return { direction: best.deg, label: "نحو ال" + compass(best.deg), drop_m_per_m: best.drop };
  }

  // Topographic position: centre minus mean of the whole grid (excluding centre).
  function position(m) {
    const n = m.length, rc = (n - 1) / 2, z0 = m[rc][rc]; let sum = 0, k = 0, lo = Infinity, hi = -Infinity;
    m.forEach((row, r) => row.forEach((v, c) => { lo = Math.min(lo, v); hi = Math.max(hi, v); if (r !== rc || c !== rc) { sum += v; k++; } }));
    const tpi = z0 - sum / k;
    let cls;
    if (tpi > TPI_METRES) cls = { id: "ridge", label: "قمة أو حافة مرتفعة" };
    else if (tpi < -TPI_METRES) cls = { id: "valley", label: "بطن وادٍ أو منخفض" };
    else cls = { id: "slope", label: "سفح أو أرض متوسطة الموقع" };
    return { tpi_m: tpi, relief_m: hi - lo, min_m: lo, max_m: hi, class: cls };
  }

  function analyse(payload, grid) {
    const m = toMatrix(payload, grid), rc = (grid.size - 1) / 2;
    return {
      centre_m: m[rc][rc],
      slope: slopeAspect(m, rc, rc, grid.spacing_m),
      flow: flowD8(m, rc, rc, grid.spacing_m),
      position: position(m),
      window_m: grid.spacing_m * (grid.size - 1)
    };
  }

  return { FLAT_DEG, TPI_METRES, gridPoints, buildUrl, toMatrix, compass, slopeAspect, flowD8, position, analyse };
});
