(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NasaGibsSatellite = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
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
  return { BASE, LAYERS, validDate, shiftDate, saudiDate, buildTileUrl, getLayer };
});
