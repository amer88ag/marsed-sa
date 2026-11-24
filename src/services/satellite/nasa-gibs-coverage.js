(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NasaGibsCoverage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ZOOM = 7;
  const POINTS = Object.freeze([
    { id: "tabuk", name: "تبوك", lat: 28.3838, lon: 36.5550 },
    { id: "arar", name: "عرعر", lat: 30.9753, lon: 41.0381 },
    { id: "sakaka", name: "سكاكا", lat: 29.9697, lon: 40.2064 },
    { id: "hail", name: "حائل", lat: 27.5114, lon: 41.7208 },
    { id: "hafr", name: "حفر الباطن", lat: 28.4328, lon: 45.9708 },
    { id: "dammam", name: "الدمام", lat: 26.4207, lon: 50.0888 },
    { id: "riyadh", name: "الرياض", lat: 24.7136, lon: 46.6753 },
    { id: "qassim", name: "بريدة", lat: 26.3592, lon: 43.9818 },
    { id: "madinah", name: "المدينة المنورة", lat: 24.5247, lon: 39.5692 },
    { id: "yanbu", name: "ينبع", lat: 24.0895, lon: 38.0618 },
    { id: "makkah", name: "مكة المكرمة", lat: 21.3891, lon: 39.8579 },
    { id: "jeddah", name: "جدة", lat: 21.4858, lon: 39.1925 },
    { id: "taif", name: "الطائف", lat: 21.2703, lon: 40.4158 },
    { id: "albaha", name: "الباحة", lat: 20.0129, lon: 41.4677 },
    { id: "abha", name: "أبها", lat: 18.2164, lon: 42.5053 },
    { id: "khamis", name: "خميس مشيط", lat: 18.3064, lon: 42.7290 },
    { id: "jazan", name: "جازان", lat: 16.8894, lon: 42.5511 },
    { id: "najran", name: "نجران", lat: 17.4924, lon: 44.1277 },
    { id: "sharurah", name: "شرورة", lat: 17.4667, lon: 47.1167 }
  ]);

  function tileCoordinates(lat, lon, zoom) {
    const z = zoom === undefined ? ZOOM : zoom;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(lon) || lon < -180 || lon > 180 ||
        !Number.isInteger(z) || z < 0 || z > 9) {
      throw new TypeError("Valid latitude, longitude and zoom 0..9 are required");
    }
    const n = Math.pow(2, z);
    const boundedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const radians = boundedLat * Math.PI / 180;
    const x = Math.max(0, Math.min(n - 1, Math.floor((lon + 180) / 360 * n)));
    const y = Math.max(0, Math.min(n - 1,
      Math.floor((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * n)));
    return { z: z, x: x, y: y };
  }

  function buildProbeUrl(layerKey, date, point, satelliteService) {
    if (!point || typeof point !== "object") throw new TypeError("A sample point is required");
    if (!satelliteService || typeof satelliteService.buildTileUrl !== "function") {
      throw new TypeError("NASA GIBS satellite service is required");
    }
    const tile = tileCoordinates(point.lat, point.lon);
    const template = satelliteService.buildTileUrl(layerKey, date);
    return {
      url: template.replace("{z}", String(tile.z)).replace("{y}", String(tile.y)).replace("{x}", String(tile.x)),
      tile: tile
    };
  }

  function probeImage(url, ImageCtor, timeoutMs) {
    const ImageType = ImageCtor || (typeof Image !== "undefined" ? Image : null);
    if (!ImageType) return Promise.resolve({ status: "unsupported", message: "Image loading is unavailable" });
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 12000;
    return new Promise(function (resolve) {
      const image = new ImageType();
      let settled = false;
      const finish = function (status, message) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        resolve({ status: status, message: message || "" });
      };
      const timer = setTimeout(function () { finish("timeout", "انتهت مهلة تحميل البلاطة"); }, timeout);
      image.onload = function () { finish("loaded", "استجاب خادم الصور وحُمّلت البلاطة"); };
      image.onerror = function () { finish("error", "تعذر تحميل البلاطة من الخدمة"); };
      image.src = url;
    });
  }

  async function checkPoint(layerKey, date, point, satelliteService, ImageCtor, timeoutMs) {
    const request = buildProbeUrl(layerKey, date, point, satelliteService);
    const result = await probeImage(request.url, ImageCtor, timeoutMs);
    return Object.assign({ id: point.id, name: point.name, lat: point.lat, lon: point.lon, url: request.url }, request.tile, result);
  }

  return { ZOOM, POINTS, tileCoordinates, buildProbeUrl, probeImage, checkPoint };
});
