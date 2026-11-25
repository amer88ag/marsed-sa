'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/services/precipitation/chirps-chart.js');
const data = require('../data/chirps_daily.json');

const rows = (dates, values) => dates.map((d, i) => ({ date: d, precipitation_mm: values[i] }));
const D = ['2026-09-01', '2026-09-02', '2026-09-03'];
const rects = svg => (svg.match(/<rect /g) || []).length;
const crosses = svg => (svg.match(/>×<\/text>/g) || []).length;

test('all-zero data draws visible baseline marks labelled 0, not an empty chart', () => {
  const r = C.build(rows(D, [0, 0, 0]), rows(D, [0, 0, 0]));
  assert.equal(r.status, 'all_zero');
  assert.equal(rects(r.svg), 6, 'one mark per series per day');
  assert.match(r.svg, /height="2\.0"/);
  assert.equal((r.svg.match(/fill="#1769aa">0<\/text>/g) || []).length, 3, 'SAT zero labels');
  assert.match(C.caption(r), /كل القيم المتاحة صفر/);
});

test('missing values are grey crosses, never zero bars', () => {
  const r = C.build(rows(D, [1.5, null, 0]), rows(D, [null, null, 2]));
  assert.equal(r.status, 'partial');
  assert.equal(crosses(r.svg), 3);
  assert.equal(rects(r.svg), 3);
  assert.equal(r.counts.sat_missing, 1); assert.equal(r.counts.rnl_missing, 2);
  assert.match(C.caption(r), /قيمة مفقودة وليست صفراً/);
});

test('all values missing: explicit message, crosses for every slot, no bars', () => {
  const r = C.build(rows(D, [null, null, null]), rows(D, [null, null, null]));
  assert.equal(r.status, 'all_missing');
  assert.equal(rects(r.svg), 0); assert.equal(crosses(r.svg), 6);
  assert.match(C.caption(r), /كل القيم مفقودة/);
});

test('no records: no chart and an explicit message', () => {
  const r = C.build([], []);
  assert.equal(r.status, 'no_records'); assert.equal(r.svg, '');
  assert.match(C.caption(r), /لا توجد سجلات/);
});

test('RNL is drawn even when SAT is empty, and series align by date not position', () => {
  const r = C.build([], rows(['2026-09-02'], [4]));
  assert.equal(r.status, 'partial'); assert.equal(rects(r.svg), 1);
  const shifted = C.build(rows(['2026-09-01', '2026-09-02'], [1, 2]), rows(['2026-09-02'], [7]));
  assert.deepEqual(shifted.dates, ['2026-09-01', '2026-09-02']);
  assert.match(shifted.svg, /RNL 2026-09-02: 7 ملم/);
  assert.doesNotMatch(shifted.svg, /RNL 2026-09-01: 7/);
  assert.match(shifted.svg, /RNL 2026-09-01: قيمة مفقودة/);
});

test('dates and values in the chart match the source records exactly', () => {
  const r = C.build(rows(D, [0.02, 0.08, 0]), rows(D, [0, 3.25, null]));
  for (const [i, d] of D.entries()) assert.match(r.svg, new RegExp('>' + d.slice(5) + '</text>'));
  assert.match(r.svg, /SAT 2026-09-01: 0\.02 ملم/);
  assert.match(r.svg, /SAT 2026-09-02: 0\.08 ملم/);
  assert.match(r.svg, /RNL 2026-09-02: 3\.25 ملم/);
  assert.match(r.svg, /RNL 2026-09-03: قيمة مفقودة/);
});

test('negative or non-numeric values are treated as missing, not drawn', () => {
  const r = C.build(rows(D, [-1, 'x', 2]), []);
  assert.equal(r.counts.sat_valid, 1); assert.equal(r.counts.sat_missing, 2);
});

test('committed sample: every city produces a visible chart (Jazan has small non-zero values)', () => {
  for (const city of Object.keys(data.series.sat)) {
    const r = C.build(data.series.sat[city], data.series.rnl[city]);
    assert.ok(['ok', 'all_zero', 'partial'].includes(r.status), city + ': ' + r.status);
    assert.ok(rects(r.svg) > 0, city + ' has visible marks');
    assert.equal(r.dates.length, 3);
  }
  const jazan = C.build(data.series.sat.jazan, data.series.rnl.jazan);
  assert.match(jazan.svg, /SAT 2026-09-01: 0\.02 ملم/);
});

test('small non-zero values are labelled with two decimals, never as 0', () => {
  assert.equal(C.label(0.02), '0.02'); assert.equal(C.label(0.08), '0.08'); assert.equal(C.label(0), '0'); assert.equal(C.label(3.25), '3.3');
  const r = C.build(rows(D, [0.02, 0, 1]), []);
  assert.match(r.svg, />0\.02<\/text>/);
});

test('Arabic day counts use the correct plural form', () => {
  assert.deepEqual([1, 2, 3, 10, 11, 30].map(C.arDays), ['يوم واحد', 'يومان', '3 أيام', '10 أيام', '11 يوماً', '30 يوماً']);
  assert.match(C.caption(C.build(rows(D, [0, 0, 0]), [])), /\(3 أيام\)/);
});
