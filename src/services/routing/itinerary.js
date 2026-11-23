(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RouteItinerary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const FORECAST_WINDOW_MS = 48 * 60 * 60 * 1000;
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
      const expectedTime = Date.UTC(year, month - 1, day, hour, minute) - 3 * 60 * 60 * 1000;
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
    return { departure: new Date(departure.getTime()), arrival: new Date(arrival), forecast_window_hours: 48 };
  }
  return { resolveDepartureTime, FORECAST_WINDOW_MS };
});
