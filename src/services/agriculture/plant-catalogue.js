(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PlantCatalogue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CATEGORIES = Object.freeze([
    "fruit_tree", "vegetable", "field_crop", "native_tree",
    "wild_plant", "ornamental", "pasture"
  ]);
  const RANGE_FIELDS = Object.freeze([
    "temperature_c", "elevation_m", "annual_rainfall_mm", "soil_ph"
  ]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function finiteOrNull(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function validRange(range) {
    if (!isObject(range)) return false;
    const min = finiteOrNull(range.min), max = finiteOrNull(range.max);
    if (range.min !== null && range.min !== undefined && min === null) return false;
    if (range.max !== null && range.max !== undefined && max === null) return false;
    return min === null || max === null || min <= max;
  }
  function sourceIdsFor(record, field) {
    const range = record.requirements && record.requirements[field];
    return range && Array.isArray(range.source_ids) ? range.source_ids : [];
  }

  function validateRecord(record) {
    const errors = [];
    if (!isObject(record)) return { valid: false, errors: ["record must be an object"] };
    if (typeof record.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(record.id)) errors.push("id must be a stable lowercase slug");
    if (!isObject(record.names) || typeof record.names.ar !== "string" || !record.names.ar.trim()) errors.push("Arabic name is required");
    if (!isObject(record.names) || typeof record.names.scientific !== "string" || !record.names.scientific.trim()) errors.push("scientific name is required");
    if (!CATEGORIES.includes(record.category)) errors.push("unsupported plant category");
    if (!Array.isArray(record.regions)) errors.push("regions must be an array");
    if (!Array.isArray(record.sources)) errors.push("sources must be an array");
    const sourceIds = new Set((Array.isArray(record.sources) ? record.sources : []).filter(isObject).map(source => source.id));
    (Array.isArray(record.sources) ? record.sources : []).forEach((source, index) => {
      if (!isObject(source) || typeof source.id !== "string" || !source.id.trim()) errors.push("source " + index + " requires an id");
      if (!isObject(source) || typeof source.title !== "string" || !source.title.trim()) errors.push("source " + index + " requires a title");
      if (!isObject(source) || typeof source.publisher !== "string" || !source.publisher.trim()) errors.push("source " + index + " requires a publisher");
      if (!isObject(source) || typeof source.url !== "string" || !/^https:\/\//.test(source.url)) errors.push("source " + index + " requires an HTTPS URL");
    });
    const requirements = isObject(record.requirements) ? record.requirements : {};
    RANGE_FIELDS.forEach(field => {
      const range = requirements[field];
      if (range === undefined || range === null) return;
      if (!validRange(range)) errors.push(field + " must be a valid numeric range");
      const hasValue = finiteOrNull(range.min) !== null || finiteOrNull(range.max) !== null;
      const refs = sourceIdsFor(record, field);
      if (hasValue && (!refs.length || refs.some(id => !sourceIds.has(id)))) {
        errors.push(field + " facts require matching source_ids");
      }
    });
    if (record.administrative_regions !== undefined) {
      if (!Array.isArray(record.administrative_regions)) errors.push("administrative_regions must be an array");
      if (Array.isArray(record.administrative_regions) && record.administrative_regions.length &&
          (!Array.isArray(record.distribution_source_ids) || !record.distribution_source_ids.length ||
           record.distribution_source_ids.some(id => !sourceIds.has(id)))) {
        errors.push("administrative region claims require matching distribution_source_ids");
      }
    }
    if (record.harvest_windows !== undefined && !Array.isArray(record.harvest_windows)) errors.push("harvest_windows must be an array");
    (Array.isArray(record.harvest_windows) ? record.harvest_windows : []).forEach((window, index) => {
      if (!isObject(window) || !Number.isInteger(window.start_month) || window.start_month < 1 || window.start_month > 12 ||
          !Number.isInteger(window.end_month) || window.end_month < 1 || window.end_month > 12) {
        errors.push("harvest window " + index + " requires valid calendar months");
      }
      if (!isObject(window) || !Array.isArray(window.source_ids) || !window.source_ids.length ||
          window.source_ids.some(id => !sourceIds.has(id))) errors.push("harvest window " + index + " requires matching source_ids");
    });
    if (record.operations !== undefined && !Array.isArray(record.operations)) errors.push("operations must be an array");
    (Array.isArray(record.operations) ? record.operations : []).forEach((operation, index) => {
      if (!isObject(operation) || typeof operation.type !== "string" || !operation.type.trim()) errors.push("operation " + index + " requires a type");
      if (!isObject(operation) || !Array.isArray(operation.source_ids) || !operation.source_ids.length ||
          operation.source_ids.some(id => !sourceIds.has(id))) errors.push("operation " + index + " requires matching source_ids");
    });
    return { valid: errors.length === 0, errors: errors };
  }

  function assessRange(range, observed) {
    const value = finiteOrNull(observed);
    if (!isObject(range) || value === null || !validRange(range)) return { status: "unknown", reason: "بيانات غير كافية للمقارنة" };
    const min = finiteOrNull(range.min), max = finiteOrNull(range.max);
    if (min === null && max === null) return { status: "unknown", reason: "لم يُوثق نطاق ملاءمة لهذا العامل" };
    if (min !== null && value < min) return { status: "outside", reason: "القيمة أدنى من النطاق الموثق", value: value };
    if (max !== null && value > max) return { status: "outside", reason: "القيمة أعلى من النطاق الموثق", value: value };
    return { status: "within", reason: "ضمن النطاق الموثق", value: value };
  }

  function assessSite(record, context) {
    const validation = validateRecord(record);
    if (!validation.valid) return { status: "unknown", confidence: "none", checks: {}, errors: validation.errors };
    const site = context || {};
    const checks = {};
    RANGE_FIELDS.forEach(field => {
      checks[field] = assessRange(record.requirements && record.requirements[field], site[field]);
    });
    const assessed = Object.keys(checks).map(key => checks[key].status).filter(status => status !== "unknown");
    const hasOutside = assessed.includes("outside");
    const hasWithin = assessed.includes("within");
    const allKnown = assessed.length === RANGE_FIELDS.length;
    return {
      status: allKnown ? (hasOutside ? "outside" : "within") : "unknown",
      confidence: allKnown ? (hasOutside ? "limited" : "moderate") : "insufficient",
      checks: checks,
      note: "مقارنة أولية للعوامل الموثقة فقط؛ لا تمثل ضمان نجاح الزراعة ولا تغني عن تحليل التربة والمياه والصنف المحلي."
    };
  }

  function filterByCategory(records, category) {
    if (!Array.isArray(records)) return [];
    return records.filter(record => validateRecord(record).valid && (!category || record.category === category));
  }

  return { CATEGORIES, RANGE_FIELDS, validateRecord, assessRange, assessSite, filterByCategory };
});
