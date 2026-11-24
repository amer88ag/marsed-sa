(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RouteItinerary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const FORECAST_WINDOW_HOURS = 48;
  const FORECAST_WINDOW_MS = FORECAST_WINDOW_HOURS * 60 * 60 * 1000;
  const SAUDI_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh has no DST.
  // Hourly values are labelled at the top of the hour. An ETA is matched to the
  // nearest hourly row only if it is within 30 minutes; otherwise "unavailable".
  const ETA_MATCH_TOLERANCE_MS = 30 * 60 * 1000;

  function resolveDepartureTime(value, nowValue, routeDurationSeconds) {
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue === undefined ? Date.now() : nowValue);
    const duration = Number(routeDurationSeconds);
    if (!Number.isFinite(now.getTime()) || !Number.isFinite(duration) || duration < 0) {
      throw new TypeError("A valid current time and non-negative route duration are required");
    }
    let departure = now;
    if (value) {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
        throw new TypeError("Departure time must use YYYY-MM-DDTHH:mm");
      }
      departure = new Date(value + ":00+03:00");
      if (!Number.isFinite(departure.getTime())) throw new TypeError("Departure time is invalid");
      const [year, month, day, hour, minute] = value.match(/\d+/g).map(Number);
      const calendarCheck = new Date(Date.UTC(year, month - 1, day, hour, minute));
      const expectedTime = Date.UTC(year, month - 1, day, hour, minute) - SAUDI_OFFSET_MS;
      if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 ||
          calendarCheck.getUTCDate() !== day || calendarCheck.getUTCHours() !== hour ||
          calendarCheck.getUTCMinutes() !== minute || departure.getTime() !== expectedTime) {
        throw new TypeError("Departure time is not a valid Saudi local date and time");
      }
    }
    if (departure.getTime() < now.getTime() - 60 * 1000) {
      throw new RangeError("Departure time cannot be in the past");
    }
    const arrival = departure.getTime() + duration * 1000;
    if (arrival > now.getTime() + FORECAST_WINDOW_MS) {
      throw new RangeError("The selected trip falls outside the available 48-hour weather forecast");
    }
    return { departure: new Date(departure.getTime()), arrival: new Date(arrival), forecast_window_hours: FORECAST_WINDOW_HOURS };
  }

  // Open-Meteo `forecast_days` counts Saudi calendar days starting at today 00:00
  // local, so forecast_days=2 at 22:00 only reaches tomorrow 23:00 (~25 h).
  // Returns the number of calendar days whose hourly rows reach now + window
  // (+ the ETA matching tolerance).
  function requiredForecastDays(nowValue, windowHours) {
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue === undefined ? Date.now() : nowValue);
    const hours = windowHours === undefined ? FORECAST_WINDOW_HOURS : Number(windowHours);
    if (!Number.isFinite(now.getTime()) || !Number.isFinite(hours) || hours < 0) {
      throw new TypeError("A valid time and non-negative window are required");
    }
    const localNow = now.getTime() + SAUDI_OFFSET_MS;
    const localMidnight = Math.floor(localNow / 86400000) * 86400000;
    // The last hourly row of day N-1 is at (N*24 - 1) h after local midnight.
    const neededEnd = localNow + hours * 3600000 - ETA_MATCH_TOLERANCE_MS;
    const lastRowOffsetHours = Math.ceil((neededEnd - localMidnight) / 3600000);
    return Math.max(1, Math.ceil((lastRowOffsetHours + 1) / 24));
  }

  function parseSaudiHour(text) {
    if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return NaN;
    return new Date(text + ":00+03:00").getTime();
  }

  // Returns the hourly row nearest to `eta` if it lies within the tolerance, or
  // null. Never extrapolates beyond the last available hour.
  function weatherAtEta(rows, eta) {
    if (!Array.isArray(rows) || !rows.length || !(eta instanceof Date) || !Number.isFinite(eta.getTime())) return null;
    const target = eta.getTime();
    let best = null, bestDelta = Infinity;
    rows.forEach(function (row) {
      const time = parseSaudiHour(row && row.valid_time);
      if (!Number.isFinite(time)) return;
      const delta = Math.abs(time - target);
      if (delta < bestDelta) { best = row; bestDelta = delta; }
    });
    return best && bestDelta <= ETA_MATCH_TOLERANCE_MS ? best : null;
  }

  // Last instant (ms) the hourly rows can describe, including tolerance.
  function forecastCoverageEnd(rows) {
    if (!Array.isArray(rows)) return null;
    let last = null;
    rows.forEach(function (row) {
      const time = parseSaudiHour(row && row.valid_time);
      if (Number.isFinite(time) && (last === null || time > last)) last = time;
    });
    return last === null ? null : last + ETA_MATCH_TOLERANCE_MS;
  }

  // ETA at a point sampled at `distanceKm` along the route, assuming the OSRM
  // estimated duration is spread proportionally to distance (no traffic model).
  function etaAtDistance(departure, durationSeconds, distanceKm, totalKm) {
    const start = departure instanceof Date ? departure.getTime() : Number(departure);
    const duration = Number(durationSeconds), distance = Number(distanceKm), total = Number(totalKm);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration < 0 ||
        !Number.isFinite(distance) || !Number.isFinite(total) || total <= 0) {
      throw new TypeError("Valid departure, duration and distances are required");
    }
    const fraction = Math.min(1, Math.max(0, distance / total));
    return new Date(start + duration * fraction * 1000);
  }

  return {
    resolveDepartureTime, requiredForecastDays, weatherAtEta, forecastCoverageEnd, etaAtDistance,
    FORECAST_WINDOW_MS, FORECAST_WINDOW_HOURS, ETA_MATCH_TOLERANCE_MS
  };
});
