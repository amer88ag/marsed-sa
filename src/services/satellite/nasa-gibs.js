(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NasaGibsSatellite = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  const KVP = BASE + "wmts.cgi";
  const LAYERS = Object.freeze({
    viirsTrue: { id: "VIIRS_SNPP_CorrectedReflectance_TrueColor", title: "VIIRS Suomi NPP — ألوان طبيعية", resolution: "GoogleMapsCompatible_Level9", format: "jpg", period: "يومي", note: "صورة مرئية نهارية مركبة؛ قد تظهر فجوات عند عدم توفر مرور فضائي صالح." },
    modisTerraTrue: { id: "MODIS_Terra_CorrectedReflectance_TrueColor", title: "MODIS Terra — ألوان طبيعية", resolution: "GoogleMapsCompatible_Level9", format: "jpg", period: "يومي", note: "صورة مرئية نهارية من القمر Terra." },
    modisAquaTrue: { id: "MODIS_Aqua_CorrectedReflectance_TrueColor", title: "MODIS Aqua — ألوان طبيعية", resolution: "GoogleMapsCompatible_Level9", format: "jpg", period: "يومي", note: "صورة مرئية نهارية من القمر Aqua." },
    modisFalse: { id: "MODIS_Terra_CorrectedReflectance_Bands721", title: "MODIS Terra — ألوان زائفة 7-2-1", resolution: "GoogleMapsCompatible_Level9", format: "jpg", period: "يومي", note: "تركيب نطاقات طيفية لإبراز خصائص السطح؛ لا يُفسر كصورة ألوان طبيعية." }
  });
  function validDate(value) {
    return typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  }
  function shiftDate(value, offset) {
    if (!validDate(value) || !Number.isInteger(offset)) throw new TypeError("Valid ISO date and integer offset are required");
    const date = new Date(value + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  function saudiDate(now) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(now || new Date()).reduce(function (out, part) {
      if (part.type !== "literal") out[part.type] = part.value;
      return out;
    }, {});
    return parts.year + "-" + parts.month + "-" + parts.day;
  }
  function describeDomainsUrl(layerKey) {
    const layer = LAYERS[layerKey];
    if (!layer) throw new TypeError("Unsupported NASA GIBS layer");
    const params = new URLSearchParams({
      SERVICE: "WMTS", REQUEST: "DescribeDomains", VERSION: "1.0.0",
      LAYER: layer.id, TILEMATRIXSET: layer.resolution
    });
    return KVP + "?" + params.toString();
  }
  function parseAvailablePeriods(xml) {
    if (typeof xml !== "string") throw new TypeError("NASA GIBS domain response must be text");
    const matches = [...xml.matchAll(/<Domain(?:\\s[^>]*)?>([\\s\\S]*?)<\\/Domain>/gi)];
    const values = matches.flatMap(function (match) {
      return match[1].trim().split(",").map(function (value) { return value.trim(); }).filter(Boolean);
    });
    const periods = values.map(function (value) {
      const parts = value.split("/");
      if (!validDate(parts[0])) return null;
      const end = parts.length > 1 ? parts[1] : parts[0];
      if (!validDate(end) || end < parts[0]) return null;
      return { start: parts[0], end: end, step: parts[2] || null };
    }).filter(Boolean);
    if (!periods.length) throw new Error("NASA GIBS did not return a readable time domain");
    return periods;
  }
  function latestAvailableDate(periods) {
    if (!Array.isArray(periods) || !periods.length) return null;
    return periods.reduce(function (latest, period) {
      return !latest || period.end > latest ? period.end : latest;
    }, null);
  }
  function isDateAvailable(date, periods) {
    if (!validDate(date) || !Array.isArray(periods)) return false;
    return periods.some(function (period) {
      return date >= period.start && date <= period.end;
    });
  }
  async function getAvailableDates(layerKey, fetchImpl) {
    const request = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!request) throw new Error("Fetch is unavailable in this environment");
    const response = await request(describeDomainsUrl(layerKey), { headers: { Accept: "application/xml, text/xml" } });
    if (!response || !response.ok) throw new Error("NASA GIBS date availability request failed");
    const periods = parseAvailablePeriods(await response.text());
    return { periods: periods, latestDate: latestAvailableDate(periods) };
  }
  function buildTileUrl(layerKey, date) {
    const layer = LAYERS[layerKey];
    if (!layer) throw new TypeError("Unsupported NASA GIBS layer");
    if (!validDate(date)) throw new TypeError("A valid YYYY-MM-DD image date is required");
    return BASE + layer.id + "/default/" + date + "/" + layer.resolution + "/{z}/{y}/{x}." + layer.format;
  }
  function getLayer(layerKey) {
    if (!LAYERS[layerKey]) throw new TypeError("Unsupported NASA GIBS layer");
    return Object.assign({}, LAYERS[layerKey]);
  }
  return { BASE, LAYERS, validDate, shiftDate, saudiDate, describeDomainsUrl, parseAvailablePeriods, latestAvailableDate, isDateAvailable, getAvailableDates, buildTileUrl, getLayer };
});
