(function (root, factory) {
  const http = (typeof module === "object" && module.exports)
    ? require("../../platform/http/client.js")
    : (root && root.HttpClient) || null;
  const api = factory(http);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NasaGibsSatellite = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (http) {
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
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  }
  function shiftDate(value, offset) {
    if (!validDate(value) || !Number.isInteger(offset)) throw new TypeError("Valid ISO date and integer offset are required");
    const date = new Date(value + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  // GIBS product dates are UTC calendar days. Use this (not the Saudi date) to cap
  // the selectable range: between 00:00 and 03:00 Saudi time the Saudi date is a
  // day ahead, and GIBS domains can list dates that have not started in UTC yet
  // (observed live 2026-11-25: MODIS Aqua domain ended 2026-11-26).
  function productDateCap(now) {
    const date = now instanceof Date ? now : new Date(now === undefined ? Date.now() : now);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
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
    const matches = [...xml.matchAll(/<Domain(?:\s[^>]*)?>([\s\S]*?)<\/Domain>/gi)];
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
  // WMTS time steps (ISO 8601 durations). Day, month and year steps are aligned to
  // the period start. Sub-daily steps (e.g. PT10M) make every calendar day in the
  // range selectable. Unknown steps are treated conservatively: only the period
  // start and end dates are considered available.
  function parseStep(step) {
    if (step === null || step === undefined || step === "") return { unit: "D", n: 1, implicit: true };
    const text = String(step).trim().toUpperCase();
    let match = /^P(\d+)([DMYW])$/.exec(text);
    if (match) {
      const n = Number(match[1]);
      if (!Number.isInteger(n) || n < 1) return null;
      return match[2] === "W" ? { unit: "D", n: n * 7 } : { unit: match[2], n: n };
    }
    match = /^PT(\d+)([HMS])$/.exec(text);
    if (match && Number(match[1]) > 0) return { unit: "SUBDAILY", n: Number(match[1]) };
    return null;
  }
  function dayNumber(value) { return Math.round(Date.parse(value + "T00:00:00Z") / 86400000); }
  function fromDayNumber(days) { return new Date(days * 86400000).toISOString().slice(0, 10); }
  function addMonths(value, months) {
    const parts = value.split("-").map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1 + months, parts[2]));
    // Reject calendar overflow (e.g. Jan 31 + 1 month) instead of silently shifting.
    return date.getUTCDate() === parts[2] ? date.toISOString().slice(0, 10) : null;
  }
  function monthIndex(value) { const p = value.split("-").map(Number); return p[0] * 12 + (p[1] - 1); }
  function isAligned(date, period) {
    const step = parseStep(period.step);
    if (!step) return date === period.start || date === period.end;
    if (step.unit === "SUBDAILY") return true;
    if (step.unit === "D") return (dayNumber(date) - dayNumber(period.start)) % step.n === 0;
    const months = step.unit === "Y" ? step.n * 12 : step.n;
    const diff = monthIndex(date) - monthIndex(period.start);
    return diff >= 0 && diff % months === 0 && addMonths(period.start, diff) === date;
  }
  function isDateAvailable(date, periods) {
    if (!validDate(date) || !Array.isArray(periods)) return false;
    return periods.some(function (period) {
      return period && date >= period.start && date <= period.end && isAligned(date, period);
    });
  }
  // Latest step-aligned date inside one period that is <= cap (cap optional).
  function latestInPeriod(period, cap) {
    const limit = cap && cap < period.end ? cap : period.end;
    if (limit < period.start) return null;
    const step = parseStep(period.step);
    if (!step) return period.end <= limit ? period.end : period.start;
    if (step.unit === "SUBDAILY") return limit;
    if (step.unit === "D") {
      const offset = dayNumber(limit) - dayNumber(period.start);
      return fromDayNumber(dayNumber(period.start) + Math.floor(offset / step.n) * step.n);
    }
    const months = step.unit === "Y" ? step.n * 12 : step.n;
    let k = Math.floor((monthIndex(limit) - monthIndex(period.start)) / months);
    for (; k >= 0; k--) {
      const candidate = addMonths(period.start, k * months);
      if (candidate && candidate <= limit) return candidate;
    }
    return null;
  }
  function latestAvailableOnOrBefore(periods, cap) {
    if (!Array.isArray(periods) || !periods.length) return null;
    if (cap !== undefined && cap !== null && !validDate(cap)) return null;
    return periods.reduce(function (best, period) {
      const candidate = latestInPeriod(period, cap || null);
      return candidate && (!best || candidate > best) ? candidate : best;
    }, null);
  }
  function latestAvailableDate(periods) {
    return latestAvailableOnOrBefore(periods, null);
  }
  function earliestAvailableDate(periods) {
    if (!Array.isArray(periods) || !periods.length) return null;
    return periods.reduce(function (first, period) {
      return !first || period.start < first ? period.start : first;
    }, null);
  }
  // Next/previous available date strictly after/before `date` (direction +1/-1),
  // honouring steps and gaps, optionally bounded by `cap` (inclusive upper bound).
  function adjacentAvailableDate(date, periods, direction, cap) {
    if (!validDate(date) || !Array.isArray(periods) || (direction !== 1 && direction !== -1)) return null;
    let best = null;
    periods.forEach(function (period) {
      const step = parseStep(period.step);
      const upper = cap && cap < period.end ? cap : period.end;
      if (upper < period.start) return;
      let candidate = null;
      if (direction === -1) {
        if (date <= period.start) return;
        candidate = latestInPeriod(period, shiftDate(date, -1) < upper ? shiftDate(date, -1) : upper);
      } else {
        if (date >= upper) return;
        if (date < period.start) candidate = period.start;
        else if (!step) candidate = period.end > date ? period.end : null;
        else if (step.unit === "SUBDAILY") candidate = shiftDate(date, 1);
        else if (step.unit === "D") {
          const offset = dayNumber(date) - dayNumber(period.start);
          candidate = fromDayNumber(dayNumber(period.start) + (Math.floor(offset / step.n) + 1) * step.n);
        } else {
          const months = step.unit === "Y" ? step.n * 12 : step.n;
          for (let k = Math.max(0, Math.floor((monthIndex(date) - monthIndex(period.start)) / months)); k < 100000; k++) {
            const next = addMonths(period.start, k * months);
            if (next && next > date) { candidate = next; break; }
            if (next && next > upper) break;
          }
        }
        if (candidate && candidate > upper) candidate = null;
      }
      if (!candidate) return;
      if (!best || (direction === 1 ? candidate < best : candidate > best)) best = candidate;
    });
    return best;
  }
  async function getAvailableDates(layerKey, fetchImpl, options) {
    const config = options || {};
    const request = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!request || !http) throw new Error("Fetch is unavailable in this environment");
    let text;
    try {
      text = await http.request(describeDomainsUrl(layerKey), {
        fetch: request,
        parse: "text",
        headers: { Accept: "application/xml, text/xml" },
        signal: config.signal,
        timeoutMs: config.timeoutMs
      });
    } catch (error) {
      const wrapped = new Error("NASA GIBS date availability request failed (" + error.message + ")");
      wrapped.kind = error.kind;
      throw wrapped;
    }
    const periods = parseAvailablePeriods(text);
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
  return { BASE, LAYERS, validDate, shiftDate, saudiDate, productDateCap, describeDomainsUrl, parseAvailablePeriods, parseStep, latestAvailableDate, latestAvailableOnOrBefore, earliestAvailableDate, adjacentAvailableDate, isDateAvailable, getAvailableDates, buildTileUrl, getLayer };
});
