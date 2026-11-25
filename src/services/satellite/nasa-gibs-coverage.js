(function (root, factory) {
  const cities = (typeof module === "object" && module.exports)
    ? require("../../platform/geo/cities.js")
    : root && root.CityRegistry;
  const api = factory(cities);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NasaGibsCoverage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (cities) {
  "use strict";

  const ZOOM = 7;
  // Sampling points come from the unified city registry (config/cities.json, group
  // "coverage"): one source of truth shared with weather, CHIRPS and routing.
  const POINTS = Object.freeze(cities.pointsFor("coverage").map(function (point) { return Object.freeze(point); }));

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

  // Pixel classification thresholds. GIBS fills areas without a valid overpass
  // with black (JPEG) or transparent (PNG) pixels.
  const EMPTY_CHANNEL_MAX = 8;
  const BLANK_FRACTION = 0.98;
  const PARTIAL_FRACTION = 0.25;
  const UNIFORM_STDDEV = 1.5;

  // Classifies RGBA pixel data. Returns { content, emptyFraction, stddev } where
  // content is "valid" | "partial" | "blank".
  function analyzePixels(data) {
    if (!data || typeof data.length !== "number" || data.length < 4 || data.length % 4 !== 0) {
      throw new TypeError("RGBA pixel data is required");
    }
    const pixels = data.length / 4;
    let empty = 0, sum = 0, sumSq = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 10 || (r <= EMPTY_CHANNEL_MAX && g <= EMPTY_CHANNEL_MAX && b <= EMPTY_CHANNEL_MAX)) empty++;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luminance; sumSq += luminance * luminance;
    }
    const mean = sum / pixels;
    const stddev = Math.sqrt(Math.max(0, sumSq / pixels - mean * mean));
    const emptyFraction = empty / pixels;
    let content = "valid";
    if (emptyFraction >= BLANK_FRACTION || stddev < UNIFORM_STDDEV) content = "blank";
    else if (emptyFraction >= PARTIAL_FRACTION) content = "partial";
    return { content: content, emptyFraction: Number(emptyFraction.toFixed(4)), stddev: Number(stddev.toFixed(2)) };
  }

  function defaultCanvasFactory() {
    return typeof document !== "undefined" && document && typeof document.createElement === "function"
      ? function () { return document.createElement("canvas"); }
      : null;
  }

  // Reads pixels from a loaded image. Returns null when the canvas is unavailable
  // or tainted by CORS (content cannot be verified).
  function readPixels(image, createCanvas) {
    if (!createCanvas) return null;
    try {
      const canvas = createCanvas();
      const width = image.naturalWidth || image.width || 256;
      const height = image.naturalHeight || image.height || 256;
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext && canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(image, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    } catch (error) {
      return null; // SecurityError: tainted canvas
    }
  }

  function loadImage(ImageType, url, timeout, crossOrigin) {
    return new Promise(function (resolve) {
      const image = new ImageType();
      let settled = false;
      const finish = function (status, message) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        resolve({ status: status, message: message || "", image: image });
      };
      const timer = setTimeout(function () { finish("timeout", "انتهت مهلة تحميل البلاطة"); }, timeout);
      image.onload = function () { finish("loaded", "استجاب خادم الصور وحُمّلت البلاطة"); };
      image.onerror = function () { finish("error", "تعذر تحميل البلاطة من الخدمة"); };
      if (crossOrigin) image.crossOrigin = "anonymous";
      image.src = url;
    });
  }

  // status: "valid" | "partial" | "blank" (content verified), "loaded" (delivered,
  // content NOT verified), "error", "timeout", "unsupported".
  // A delivered tile alone is never reported as valid satellite data.
  async function probeImage(url, ImageCtor, timeoutMs, options) {
    const config = options || {};
    const ImageType = ImageCtor || (typeof Image !== "undefined" ? Image : null);
    if (!ImageType) return { status: "unsupported", message: "Image loading is unavailable", contentChecked: false };
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 12000;
    const createCanvas = config.createCanvas !== undefined ? config.createCanvas : defaultCanvasFactory();
    const wantContent = config.analyzeContent !== false && !!createCanvas;
    let attempt = await loadImage(ImageType, url, timeout, wantContent);
    let corsFallback = false;
    if (attempt.status === "error" && wantContent) {
      // A CORS-mode failure may only mean the server refused CORS; retry plainly
      // so delivery can still be reported (as unverified).
      corsFallback = true;
      attempt = await loadImage(ImageType, url, timeout, false);
    }
    if (attempt.status !== "loaded") {
      return { status: attempt.status, message: attempt.message, contentChecked: false };
    }
    const pixels = !corsFallback && wantContent ? readPixels(attempt.image, createCanvas) : null;
    if (!pixels) {
      return {
        status: "loaded",
        message: "حُمّلت البلاطة لكن تعذر فحص محتواها المرئي (CORS أو عدم توفر Canvas)؛ لا يثبت ذلك وجود بيانات فضائية صالحة",
        contentChecked: false
      };
    }
    const analysis = analyzePixels(pixels);
    const messages = {
      valid: "حُمّلت البلاطة ويحتوي معظمها على قيم مرئية",
      partial: "حُمّلت البلاطة لكن جزءاً كبيراً منها فارغ (فجوة مرور أو حافة مسار)",
      blank: "حُمّلت البلاطة لكنها فارغة أو موحدة اللون؛ لا توجد بيانات مرئية صالحة"
    };
    return { status: analysis.content, message: messages[analysis.content], contentChecked: true, emptyFraction: analysis.emptyFraction, stddev: analysis.stddev };
  }

  async function checkPoint(layerKey, date, point, satelliteService, ImageCtor, timeoutMs, options) {
    const request = buildProbeUrl(layerKey, date, point, satelliteService);
    const result = await probeImage(request.url, ImageCtor, timeoutMs, options);
    return Object.assign({ id: point.id, name: point.name, lat: point.lat, lon: point.lon, region_id: point.region_id || null, url: request.url }, request.tile, result);
  }

  // Aggregates a list of probe results without merging distinct meanings.
  function summarize(results) {
    const counts = { total: 0, valid: 0, partial: 0, blank: 0, unverified: 0, failed: 0 };
    (Array.isArray(results) ? results : []).forEach(function (result) {
      counts.total++;
      if (result.status === "valid") counts.valid++;
      else if (result.status === "partial") counts.partial++;
      else if (result.status === "blank") counts.blank++;
      else if (result.status === "loaded") counts.unverified++;
      else counts.failed++;
    });
    counts.delivered = counts.valid + counts.partial + counts.blank + counts.unverified;
    return counts;
  }

  // Third, independent indicator: how many of the 13 administrative regions have
  // at least one point with verified visible content. A point sample per region,
  // not an areal coverage measurement.
  function summarizeRegions(results) {
    const regions = (cities && cities.REGISTRY && cities.REGISTRY.regions) || [];
    const byRegion = {};
    regions.forEach(function (region) { byRegion[region.id] = { id: region.id, name: region.name_ar, points: 0, valid: 0 }; });
    (Array.isArray(results) ? results : []).forEach(function (result) {
      const entry = byRegion[result.region_id];
      if (!entry) return;
      entry.points++;
      if (result.status === "valid") entry.valid++;
    });
    const list = Object.keys(byRegion).map(function (key) { return byRegion[key]; });
    return {
      total: list.length,
      sampled: list.filter(function (item) { return item.points > 0; }).length,
      withValidContent: list.filter(function (item) { return item.valid > 0; }).length,
      regions: list
    };
  }

  return { ZOOM, POINTS, summarizeRegions, tileCoordinates, buildProbeUrl, analyzePixels, probeImage, checkPoint, summarize };
});
