"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Catalogue = require("../src/services/agriculture/plant-catalogue.js");

const source = { id: "ministry-guide", title: "دليل إرشادي تجريبي للاختبار", publisher: "جهة موثوقة", url: "https://example.gov.sa/guide" };
const plant = () => ({
  id: "sample-fruit-tree",
  names: { ar: "شجرة اختبار", scientific: "Arbor testis" },
  category: "fruit_tree",
  regions: ["southwest_highlands"],
  requirements: {
    temperature_c: { min: 5, max: 35, source_ids: ["ministry-guide"] },
    elevation_m: { min: 500, max: 2200, source_ids: ["ministry-guide"] },
    annual_rainfall_mm: { min: 200, max: 800, source_ids: ["ministry-guide"] },
    soil_ph: { min: 5.5, max: 8, source_ids: ["ministry-guide"] }
  },
  operations: [{ type: "pruning", source_ids: ["ministry-guide"] }],
  sources: [{ ...source }]
});

test("plant record requires Arabic and scientific names and a supported category", () => {
  const record = plant();
  assert.equal(Catalogue.validateRecord(record).valid, true);
  record.names.ar = "";
  assert.match(Catalogue.validateRecord(record).errors.join(" "), /Arabic name/);
  record.names.ar = "شجرة اختبار";
  record.category = "unknown";
  assert.match(Catalogue.validateRecord(record).errors.join(" "), /category/);
});

test("factual ranges require matching source references", () => {
  const record = plant();
  record.requirements.elevation_m.source_ids = [];
  assert.match(Catalogue.validateRecord(record).errors.join(" "), /elevation_m facts require/);
  record.requirements.elevation_m.source_ids = ["missing-source"];
  assert.match(Catalogue.validateRecord(record).errors.join(" "), /elevation_m facts require/);
});

test("regional distribution and harvest windows require matching sources", () => {
  const record = plant();
  record.administrative_regions = ["عسير"];
  record.distribution_source_ids = [];
  record.harvest_windows = [{ type: "production", start_month: 7, end_month: 12, source_ids: [] }];
  const errors = Catalogue.validateRecord(record).errors.join(" ");
  assert.match(errors, /distribution_source_ids/);
  assert.match(errors, /harvest window 0 requires matching source_ids/);
});

test("invalid source metadata and operation references are rejected", () => {
  const record = plant();
  record.sources[0].url = "http://example.gov.sa/guide";
  record.operations[0].source_ids = ["unknown"];
  const errors = Catalogue.validateRecord(record).errors.join(" ");
  assert.match(errors, /HTTPS URL/);
  assert.match(errors, /operation 0 requires matching source_ids/);
});

test("unknown values remain unknown and are never coerced to zero", () => {
  assert.equal(Catalogue.assessRange({ min: 0, max: 10 }, null).status, "unknown");
  assert.equal(Catalogue.assessRange({ min: 0, max: 10 }, "").status, "unknown");
  assert.equal(Catalogue.assessRange({ min: 0, max: 10 }, false).status, "unknown");
  assert.equal(Catalogue.assessRange({ min: 0, max: 10 }, 0).status, "within");
});

test("site assessment returns unknown when environmental inputs are incomplete", () => {
  const result = Catalogue.assessSite(plant(), { elevation_m: 1200, temperature_c: 20 });
  assert.equal(result.status, "unknown");
  assert.equal(result.checks.elevation_m.status, "within");
  assert.equal(result.checks.annual_rainfall_mm.status, "unknown");
});

test("site assessment only reports within when all comparison factors are known", () => {
  const result = Catalogue.assessSite(plant(), {
    temperature_c: 20, elevation_m: 1200, annual_rainfall_mm: 400, soil_ph: 7
  });
  assert.equal(result.status, "within");
  assert.equal(result.confidence, "moderate");
  const outside = Catalogue.assessSite(plant(), {
    temperature_c: 40, elevation_m: 1200, annual_rainfall_mm: 400, soil_ph: 7
  });
  assert.equal(outside.status, "outside");
});

test("catalogue filtering excludes invalid records and supports category filters", () => {
  const valid = plant(), invalid = plant();
  invalid.id = "Bad ID";
  assert.deepEqual(Catalogue.filterByCategory([valid, invalid], "fruit_tree"), [valid]);
  assert.deepEqual(Catalogue.filterByCategory([valid], "vegetable"), []);
});
