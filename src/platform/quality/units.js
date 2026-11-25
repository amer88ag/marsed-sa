(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.UnitPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Single source of truth for provider units, shared by the weather adapter and
  // the orchard service. Values feed advice or indicators ONLY when "verified".
  // Expected unit for EVERY field this adapter requests (current, hourly, daily).
  // A test asserts that no requested field is missing from this dictionary.
  // Three outcomes per field:
  //   verified   — provider declared the expected unit
  //   mismatch   — provider declared another unit: the value is withheld (null)
  //   undeclared — provider declared no unit: the value is kept but reported as
  //                "unit not verified", never silently treated as checked
  const FIELD_UNITS = Object.freeze({
    temperature_2m: "°C", apparent_temperature: "°C", dew_point_2m: "°C", wet_bulb_temperature_2m: "°C",
    temperature_2m_max: "°C", temperature_2m_min: "°C",
    soil_temperature_0_to_7cm: "°C", soil_temperature_7_to_28cm: "°C", soil_temperature_28_to_100cm: "°C", soil_temperature_100_to_255cm: "°C",
    relative_humidity_2m: "%", cloud_cover: "%", precipitation_probability: "%", precipitation_probability_max: "%",
    precipitation: "mm", rain: "mm", showers: "mm", precipitation_sum: "mm", evapotranspiration: "mm", et0_fao_evapotranspiration: "mm",
    wind_speed_10m: "km/h", wind_gusts_10m: "km/h", wind_speed_80m: "km/h", wind_speed_100m: "km/h",
    wind_direction_10m: "°", wind_direction_80m: "°", wind_direction_100m: "°",
    pressure_msl: "hPa", surface_pressure: "hPa",
    shortwave_radiation: "W/m²", direct_radiation: "W/m²", diffuse_radiation: "W/m²",
    soil_moisture_0_to_7cm: "m³/m³", soil_moisture_7_to_28cm: "m³/m³", soil_moisture_28_to_100cm: "m³/m³", soil_moisture_100_to_255cm: "m³/m³",
    cape: "J/kg", freezing_level_height: "m", boundary_layer_height: "m", visibility: "m",
    weather_code: "wmo code", is_day: "", uv_index: "", uv_index_max: "",
    sunrise: "iso8601", sunset: "iso8601"
  });
  const METADATA_FIELDS = ["time", "interval"];
  const UNIT_CANON = { "°c": "°C", "km/h": "km/h", "mm": "mm", "%": "%", "hpa": "hPa", "°": "°", "w/m²": "W/m²", "w/m2": "W/m²",
    "m³/m³": "m³/m³", "m3/m3": "m³/m³", "j/kg": "J/kg", "m": "m", "": "", "wmo code": "wmo code", "iso8601": "iso8601" };
  function canonUnit(unit) {
    const key = String(unit).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(UNIT_CANON, key) ? UNIT_CANON[key] : String(unit).trim();
  }
  function unitStatus(units, key) {
    if (!Object.prototype.hasOwnProperty.call(FIELD_UNITS, key)) return "no_expectation";
    if (!units || units[key] === undefined || units[key] === null) return "undeclared";
    return canonUnit(units[key]) === canonUnit(FIELD_UNITS[key]) ? "verified" : "mismatch";
  }
  function newQuality() { return { unit_mismatches: [], unverified_units: [] }; }
  // Records the outcome; returns false when the value must be withheld.
  function checkUnit(units, key, quality, scope) {
    const status = unitStatus(units, key);
    if (status === "mismatch") {
      quality.unit_mismatches.push({ scope: scope, field: key, expected: FIELD_UNITS[key], declared: units[key] });
      return false;
    }
    if (status === "undeclared" || status === "no_expectation") {
      quality.unverified_units.push({ scope: scope, field: key, reason: status });
    }
    return true;
  }
  // Copy of a block (column arrays or scalar values) with mismatched fields nulled.
  function guardBlock(block, units, quality, scope) {
    if (!block || typeof block !== "object") return block;
    const copy = Object.assign({}, block);
    Object.keys(copy).forEach(function (key) {
      if (METADATA_FIELDS.indexOf(key) !== -1) return;
      if (!checkUnit(units, key, quality, scope)) {
        copy[key] = Array.isArray(copy[key]) ? copy[key].map(function () { return null; }) : null;
      }
    });
    return copy;
  }

  function isVerified(status) { return status === "verified"; }
  // True when a field in a given scope was neither mismatched nor unverified.
  function fieldVerified(quality, scope, field) {
    if (!quality) return false;
    const listed = function (list) { return (list || []).some(function (item) { return item.scope === scope && item.field === field; }); };
    return !listed(quality.unit_mismatches) && !listed(quality.unverified_units);
  }
  return { FIELD_UNITS, METADATA_FIELDS, canonUnit, unitStatus, checkUnit, guardBlock, newQuality, isVerified, fieldVerified };
});
