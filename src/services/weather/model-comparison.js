// Multi-model forecast comparison (research stage).
// Source: Open-Meteo Forecast API with the `models=` parameter. Each model's
// values arrive under "<variable>_<model_id>". Nothing here invents values:
// a model whose series is missing or all-null is reported as unavailable,
// statistics are computed only over models that actually returned a value
// for that hour, and the multi-model mean is a summary, never "the forecast".
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ModelComparison = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Global models published openly through Open-Meteo. Grid sizes are the
  // providers' nominal native resolutions; Open-Meteo interpolates to hourly.
  const MODELS = Object.freeze([
    { id: "ecmwf_ifs025", label: "ECMWF IFS", provider: "ECMWF", grid: "0.25° (~28 كم)" },
    { id: "ecmwf_aifs025_single", label: "ECMWF AIFS", provider: "ECMWF (ذكاء اصطناعي)", grid: "0.25° (~28 كم)" },
    { id: "gfs_seamless", label: "NOAA GFS", provider: "NOAA", grid: "0.11°–0.25° (~13–28 كم)" },
    { id: "icon_seamless", label: "DWD ICON", provider: "DWD", grid: "~13 كم عالمياً" }
  ]);

  const VARIABLES = Object.freeze([
    { key: "precipitation", label: "الهطول", unit: "ملم/ساعة", digits: 1 },
    { key: "temperature_2m", label: "الحرارة", unit: "°م", digits: 1 },
    { key: "pressure_msl", label: "الضغط عند سطح البحر", unit: "hPa", digits: 0 },
    { key: "relative_humidity_2m", label: "الرطوبة النسبية", unit: "٪", digits: 0 },
    { key: "wind_speed_10m", label: "سرعة الرياح", unit: "كم/س", digits: 0 }
  ]);

  const RAIN_HOUR_MM = 0.1; // an hour counts as "rain" from 0.1 mm (WMO trace boundary)

  function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

  function buildUrl(location, options) {
    if (!location || !isNum(location.lat) || !isNum(location.lon)) throw new TypeError("A location with finite lat/lon is required");
    const o = options || {};
    const models = (o.models || MODELS.map(function (m) { return m.id; }));
    const days = Math.min(10, Math.max(1, o.days || 5));
    const q = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      hourly: VARIABLES.map(function (v) { return v.key; }).join(","),
      models: models.join(","),
      forecast_days: String(days),
      timezone: "Asia/Riyadh"
    });
    return "https://api.open-meteo.com/v1/forecast?" + q.toString();
  }

  // payload → { times:[...], models:[{id,label,available,series:{var:[...]}}] }
  function normalize(payload, modelIds) {
    if (!payload || typeof payload !== "object" || !payload.hourly || !Array.isArray(payload.hourly.time)) {
      throw new TypeError("Open-Meteo response has no hourly.time array");
    }
    const h = payload.hourly, n = h.time.length;
    const ids = modelIds || MODELS.map(function (m) { return m.id; });
    const models = ids.map(function (id) {
      const meta = MODELS.find(function (m) { return m.id === id; }) || { id: id, label: id };
      const series = {};
      let any = false;
      VARIABLES.forEach(function (v) {
        // With a single model Open-Meteo omits the suffix; accept both forms.
        const raw = Array.isArray(h[v.key + "_" + id]) ? h[v.key + "_" + id] : (ids.length === 1 && Array.isArray(h[v.key]) ? h[v.key] : null);
        const arr = new Array(n).fill(null);
        if (raw) for (let i = 0; i < n; i++) { const x = raw[i]; if (isNum(x)) { arr[i] = x; any = true; } }
        series[v.key] = arr;
      });
      return { id: id, label: meta.label, provider: meta.provider || "", grid: meta.grid || "", available: any, series: series };
    });
    return { times: h.time.slice(), models: models, units: payload.hourly_units || {} };
  }

  function stats(values) {
    const xs = values.filter(isNum);
    if (!xs.length) return { count: 0, mean: null, min: null, max: null, spread: null, sd: null };
    const mean = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    const min = Math.min.apply(null, xs), max = Math.max.apply(null, xs);
    const sd = xs.length > 1 ? Math.sqrt(xs.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (xs.length - 1)) : 0;
    return { count: xs.length, mean: mean, min: min, max: max, spread: max - min, sd: sd };
  }

  // Per-hour statistics across models for one variable.
  function hourlyStats(data, variable) {
    return data.times.map(function (t, i) {
      const s = stats(data.models.map(function (m) { return m.series[variable][i]; }));
      s.time = t;
      return s;
    });
  }

  // Share of models agreeing with the majority on rain / no rain in an hour.
  function rainAgreement(data, i) {
    const vals = data.models.map(function (m) { return m.series.precipitation[i]; }).filter(isNum);
    if (!vals.length) return null;
    const wet = vals.filter(function (v) { return v >= RAIN_HOUR_MM; }).length;
    return { models: vals.length, wet: wet, agreement: Math.max(wet, vals.length - wet) / vals.length };
  }

  // First and last rain hour plus total, per model, over the full horizon.
  function rainEvent(times, precip) {
    let first = null, last = null, total = 0, have = 0;
    for (let i = 0; i < precip.length; i++) {
      const v = precip[i];
      if (!isNum(v)) continue;
      have++; total += v;
      if (v >= RAIN_HOUR_MM) { if (first === null) first = i; last = i; }
    }
    if (!have) return { available: false, start: null, end: null, total_mm: null, wet_hours: null };
    const wetHours = precip.filter(function (v) { return isNum(v) && v >= RAIN_HOUR_MM; }).length;
    return { available: true, start: first === null ? null : times[first], end: last === null ? null : times[last], total_mm: total, wet_hours: wetHours, hours_covered: have };
  }

  function hoursBetween(a, b) { return (Date.parse(b + ":00Z") - Date.parse(a + ":00Z")) / 3600000; }

  // Agreement summary across models on the rain event in the horizon.
  function compareRain(data) {
    const events = data.models.filter(function (m) { return m.available; }).map(function (m) {
      return Object.assign({ id: m.id, label: m.label }, rainEvent(data.times, m.series.precipitation));
    }).filter(function (e) { return e.available; });
    const wet = events.filter(function (e) { return e.start !== null; });
    const totals = stats(events.map(function (e) { return e.total_mm; }));
    let onsetSpreadHours = null;
    if (wet.length >= 2) {
      const starts = wet.map(function (e) { return e.start; }).sort();
      onsetSpreadHours = hoursBetween(starts[0], starts[starts.length - 1]);
    }
    let verdict;
    if (!events.length) verdict = "no_data";
    else if (!wet.length) verdict = "all_dry";
    else if (wet.length === events.length) verdict = "all_wet";
    else verdict = "split";
    return { events: events, models_with_data: events.length, models_with_rain: wet.length, totals: totals, onset_spread_hours: onsetSpreadHours, verdict: verdict };
  }

  // Agreement level from spread relative to a tolerance per variable.
  const TOLERANCE = Object.freeze({ temperature_2m: 2, pressure_msl: 3, relative_humidity_2m: 15, wind_speed_10m: 10, precipitation: 2 });
  function agreementLevel(variable, spread) {
    if (!isNum(spread)) return null;
    const tol = TOLERANCE[variable];
    if (spread <= tol) return "high";
    if (spread <= tol * 2) return "medium";
    return "low";
  }

  // Overall per-variable summary over a horizon window (indexes [from,to)).
  function summarize(data, from, to) {
    const a = Math.max(0, from || 0), b = Math.min(data.times.length, to === undefined ? data.times.length : to);
    return VARIABLES.map(function (v) {
      const per = hourlyStats(data, v.key).slice(a, b).filter(function (s) { return s.count >= 2; });
      if (!per.length) return { variable: v.key, label: v.label, unit: v.unit, hours: 0, mean_spread: null, max_spread: null, level: null };
      const spreads = per.map(function (s) { return s.spread; });
      const meanSpread = spreads.reduce(function (x, y) { return x + y; }, 0) / spreads.length;
      return { variable: v.key, label: v.label, unit: v.unit, hours: per.length, mean_spread: meanSpread, max_spread: Math.max.apply(null, spreads), level: agreementLevel(v.key, meanSpread) };
    });
  }

  // Historical skill: mean absolute error per model against observations.
  // Returns ranked:null unless every ranked model has at least minSamples
  // paired values — no accuracy claim without real verification records.
  function verify(forecasts, observed, options) {
    const minSamples = (options && options.minSamples) || 30;
    const rows = Object.keys(forecasts).map(function (id) {
      const f = forecasts[id]; let n = 0, sum = 0;
      for (let i = 0; i < Math.min(f.length, observed.length); i++) {
        if (isNum(f[i]) && isNum(observed[i])) { n++; sum += Math.abs(f[i] - observed[i]); }
      }
      return { id: id, samples: n, mae: n ? sum / n : null };
    });
    const enough = rows.length > 0 && rows.every(function (r) { return r.samples >= minSamples; });
    return { rows: rows, min_samples: minSamples, ranked: enough ? rows.slice().sort(function (x, y) { return x.mae - y.mae; }) : null };
  }

  return { MODELS, VARIABLES, RAIN_HOUR_MM, TOLERANCE, buildUrl, normalize, stats, hourlyStats, rainAgreement, rainEvent, compareRain, agreementLevel, summarize, verify };
});
