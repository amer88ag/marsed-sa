const test = require("node:test");
const assert = require("node:assert/strict");
const RA = require("../src/services/precipitation/accumulation.js");

function hours(start, count, mm = 1) {
  const base = Date.parse(start + ":00Z");
  return Array.from({ length: count }, (_, i) => ({
    time: new Date(base + i * 3600000).toISOString().slice(0, 16),
    mm
  }));
}

test("24 consecutive hours produce a complete accumulation", () => {
  const rows = hours("2026-11-26T00", 24, 0.5);
  const result = RA.accumulate(rows, "2026-11-26T23:00", [24]);
  assert.equal(result.found, true);
  assert.equal(result.past[0].complete, true);
  assert.equal(result.past[0].mm, 12);
});

test("a missing hour breaks the window instead of shifting row indexes", () => {
  const rows = hours("2026-11-26T00", 24);
  rows.splice(8, 1);
  const result = RA.accumulate(rows, "2026-11-26T23:00", [24]);
  assert.equal(result.past[0].complete, false);
  assert.equal(result.past[0].mm, null);
});

test("duplicate timestamps make lookup ambiguous and windows incomplete", () => {
  const rows = hours("2026-11-26T00", 24);
  rows[9] = { ...rows[8], mm: 4 };
  assert.equal(RA.indexAt(rows, "2026-11-26T23:00"), -1);
  const result = RA.accumulate(rows, "2026-11-26T23:00", [24]);
  assert.equal(result.found, false);
});

test("out-of-order timestamps cannot form a complete window", () => {
  const rows = hours("2026-11-26T00", 24);
  [rows[10], rows[11]] = [rows[11], rows[10]];
  const result = RA.accumulate(rows, "2026-11-26T23:00", [24]);
  assert.equal(result.past[0].complete, false);
  assert.equal(result.past[0].mm, null);
});

test("hourly sequence remains valid across midnight and month boundary", () => {
  const rows = hours("2026-11-30T12", 24, 2);
  const result = RA.accumulate(rows, "2026-12-01T11:00", [24]);
  assert.equal(result.past[0].complete, true);
  assert.equal(result.past[0].mm, 48);
});

test("calendar day totals require all 24 unique valid hours", () => {
  const rows = hours("2026-11-27T00", 24, 0.5);
  assert.deepEqual(RA.calendarTotals(rows, "day")[0], {
    period: "2026-11-27", mm: 12, hours: 24, missing: 0, complete: true
  });
  rows[3].mm = null;
  assert.equal(RA.calendarTotals(rows, "day")[0].complete, false);
  assert.equal(RA.calendarTotals(rows, "day")[0].mm, null);
});

test("calendar totals detect duplicate and missing hours", () => {
  const rows = hours("2026-11-27T00", 24);
  rows[5] = { ...rows[4], mm: 1 };
  const day = RA.calendarTotals(rows, "day")[0];
  assert.equal(day.complete, false);
  assert.equal(day.mm, null);
  assert.ok(day.missing > 0);
});

test("February leap year expects 696 hours", () => {
  const rows = hours("2024-02-01T00", 29 * 24, 0);
  const month = RA.calendarTotals(rows, "month")[0];
  assert.equal(month.complete, true);
  assert.equal(month.hours, 696);
  assert.equal(month.mm, 0);
});

test("a month with missing data is incomplete", () => {
  const rows = hours("2026-11-01T00", 30 * 24, 1);
  rows.splice(100, 1);
  const month = RA.calendarTotals(rows, "month")[0];
  assert.equal(month.complete, false);
  assert.equal(month.mm, null);
});

test("empty data and invalid times do not produce a found window", () => {
  assert.equal(RA.accumulate([], "2026-11-27T00:00").found, false);
  assert.equal(RA.indexAt([{ time: "2026-02-30T10:00", mm: 1 }], "2026-02-30T10:00"), -1);
});

test("zero is valid while null, negative and non-numeric rainfall are not", () => {
  const rows = hours("2026-11-27T00", 3, 0);
  rows[1].mm = null;
  rows[2].mm = -1;
  const result = RA.windowSum(rows, 0, 3, 1);
  assert.equal(result.complete, false);
  assert.equal(result.mm, null);
  assert.equal(result.covered, 1);
  assert.equal(RA.intensity(0).id, "none");
  assert.equal(RA.intensity(-1), null);
});
