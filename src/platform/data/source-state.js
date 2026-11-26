(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const time = node ? require("../time/saudi-time.js") : root && root.SaudiTime;
  const api = factory(time, root);
  if (node) module.exports = api;
  if (root) root.SourceState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (T, root) {
  "use strict";
  // Unified data states shown next to every data block. A failed source is
  // never rendered as zero, and reused data is always labelled as such.
  const STATES = Object.freeze({
    fresh: "حديثة",
    cached: "مخزنة مؤقتاً",
    stale: "قديمة",
    partial: "جزئية",
    unavailable: "غير متاحة",
    source_error: "خطأ في المصدر",
    not_loaded: "لم يتم جلبها بعد"
  });

  // How long the last valid response may be SHOWN (clearly labelled) when the
  // source is down. Operational choices per source type, not a universal TTL;
  // staleness of the data itself is still judged by FreshnessPolicy.
  const REUSE_POLICY = Object.freeze({
    weather_current: { reuse_max_minutes: 6 * 60, basis: "قيم حالية: تُعرض بعد الانقطاع حتى 6 ساعات وموسومة؛ بعدها تُحجب" },
    city_overview: { reuse_max_minutes: 6 * 60, basis: "طبقة المدن: مثل الطقس الحالي" },
    orchard_forecast: { reuse_max_minutes: 24 * 60, basis: "توقع: يبقى مفيداً بوسم واضح حتى 24 ساعة" },
    orchard_reanalysis: { reuse_max_minutes: 72 * 60, basis: "إعادة تحليل لأيام سابقة: تتغير ببطء" },
    celestrak_gp: { reuse_max_minutes: 72 * 60, basis: "عناصر مدارية: تبقى صالحة للحساب أياماً مع تراجع الدقة؛ يُعرض عمرها دائماً" }
  });

  const PREFIX = "marsed:lastgood:v1:";
  const MAX_BYTES = 300000;
  const memory = new Map();

  function storage() {
    try {
      const s = root && root.localStorage;
      if (!s) return null;
      const probe = PREFIX + "probe";
      s.setItem(probe, "1"); s.removeItem(probe);
      return s;
    } catch (error) { return null; } // private mode, quota, sandboxed frame
  }

  function key(source, id) { return PREFIX + source + ":" + id; }

  // Stores the last VALID payload. Returns false when it could not be kept.
  function remember(source, id, payload, now) {
    const entry = { stored_at: (now || new Date()).toISOString(), payload: payload };
    let text;
    try { text = JSON.stringify(entry); } catch (error) { return false; }
    if (text.length > MAX_BYTES) return false;
    memory.set(key(source, id), text);
    const s = storage();
    if (s) { try { s.setItem(key(source, id), text); } catch (error) { /* memory copy still kept */ } }
    return true;
  }

  function recall(source, id) {
    let text = memory.get(key(source, id));
    if (!text) { const s = storage(); if (s) { try { text = s.getItem(key(source, id)); } catch (error) { text = null; } } }
    if (!text) return null;
    try {
      const entry = JSON.parse(text);
      return entry && entry.stored_at && entry.payload !== undefined ? entry : null;
    } catch (error) { return null; }
  }

  function forget(source, id) {
    memory.delete(key(source, id));
    const s = storage();
    if (s) { try { s.removeItem(key(source, id)); } catch (error) { /* ignore */ } }
  }

  function minutesSince(iso, now) {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.round(((now || new Date()).getTime() - t) / 60000) : null;
  }

  // After a successful fetch. `issues` = count of withheld/unverified/missing
  // values; `dataStale` = the data's own valid time is beyond its policy.
  function onSuccess(options) {
    const o = options || {};
    const state = o.dataStale ? "stale" : o.issues > 0 ? "partial" : "fresh";
    return { state: state, label: STATES[state], from_cache: false, fetched_at: (o.now || new Date()).toISOString() };
  }

  // After a failed fetch: reuse the last valid payload within its window,
  // otherwise report unavailable (no response) or source_error (bad response).
  function onFailure(source, id, error, options) {
    const o = options || {};
    const now = o.now || new Date();
    const policy = REUSE_POLICY[source];
    const entry = recall(source, id);
    const age = entry ? minutesSince(entry.stored_at, now) : null;
    if (entry && policy && age !== null && age >= 0 && age <= policy.reuse_max_minutes) {
      const state = typeof o.isStale === "function" && o.isStale(entry.payload, now) ? "stale" : "cached";
      return { state: state, label: STATES[state], from_cache: true, payload: entry.payload, stored_at: entry.stored_at, age_minutes: age, error: error };
    }
    const noResponse = error && (error.kind === "network" || error.kind === "timeout");
    const state = noResponse ? "unavailable" : "source_error";
    return { state: state, label: STATES[state], from_cache: false, payload: null, expired_cache: !!entry, error: error };
  }

  // One Arabic sentence describing the state for the UI.
  function describe(result) {
    if (!result) return STATES.not_loaded;
    if (result.from_cache) {
      return "الحالة: " + result.label + " — آخر بيانات صالحة جُلبت " + (T ? T.saudiClock(new Date(result.stored_at)) + " (" + T.ageText(result.age_minutes) + ")" : result.stored_at) +
        "؛ تعذر تحديثها الآن من المصدر.";
    }
    if (result.state === "unavailable") return "الحالة: " + result.label + " — لا استجابة من المصدر" + (result.expired_cache ? "، وآخر نسخة محفوظة أقدم من أن تُعرض" : "") + ". لم تُعرض قيم بديلة.";
    if (result.state === "source_error") return "الحالة: " + result.label + " — استجاب المصدر باستجابة غير صالحة. لم تُعرض قيم بديلة.";
    return "الحالة: " + result.label;
  }

  return { STATES, REUSE_POLICY, remember, recall, forget, onSuccess, onFailure, describe };
});
