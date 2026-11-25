'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/services/precipitation/aggregate.js');

function days(start, values) {
  const t0 = Date.parse(start + 'T00:00:00Z');
  return values.map((v, i) => ({ valid_date: new Date(t0 + i * 86400000).toISOString().slice(0, 10), value: v }));
}

test('a complete month gets a total; valid zeros count as zeros', () => {
  const rows = days('2026-02-01', Array.from({ length: 28 }, (_, i) => (i === 3 ? 5.5 : 0)));
  const [feb] = R.byMonth(rows);
  assert.equal(feb.complete, true);
  assert.equal(feb.total_mm, 5.5);
  assert.equal(feb.wet_days, 1);
});

test('a month with one missing value has no total (missing is not zero)', () => {
  const vals = Array.from({ length: 30 }, () => 1); vals[10] = null;
  const [m] = R.byMonth(days('2026-11-01', vals));
  assert.equal(m.complete, false);
  assert.equal(m.total_mm, null);
  assert.equal(m.valid_days, 29);
  assert.equal(m.partial_sum_mm, 29);
  assert.match(R.describePeriod(m), /جزئي — 29 من 30/);
});

test('a month with absent days (calendar gap) is partial', () => {
  const [m] = R.byMonth(days('2026-09-01', [0, 0, 0]));
  assert.equal(m.expected_days, 30); assert.equal(m.complete, false); assert.equal(m.total_mm, null);
});

test('leap years expect 366 days', () => {
  assert.equal(R.byYear(days('2028-01-01', [1]))[0].expected_days, 366);
  assert.equal(R.byYear(days('2026-01-01', [1]))[0].expected_days, 365);
});

test('duplicate dates (overlapping periods) are rejected', () => {
  assert.throws(() => R.byMonth([{ valid_date: '2026-01-01', value: 1 }, { valid_date: '2026-01-01', value: 2 }]), /Duplicate/);
});

test('invalid dates, negative and non-numeric values are rejected', () => {
  assert.throws(() => R.byMonth([{ valid_date: '2026-02-30', value: 1 }]), /Invalid date/);
  assert.throws(() => R.byMonth([{ valid_date: '26-1-1', value: 1 }]), /Invalid date/);
  assert.throws(() => R.byMonth([{ valid_date: '2026-01-01', value: -1 }]), /Invalid rainfall/);
  assert.throws(() => R.byMonth([{ valid_date: '2026-01-01', value: 'x' }]), /Invalid rainfall/);
});

test('months are separate and ordered regardless of input order', () => {
  const rows = days('2026-01-30', [1, 2, 3, 4]).reverse();
  const months = R.byMonth(rows);
  assert.deepEqual(months.map(m => m.period), ['2026-01', '2026-02']);
  assert.equal(months[0].partial_sum_mm + months[1].partial_sum_mm, 10, 'no day counted twice');
});

test('span reports the window and the last date that has a value', () => {
  const w = R.span(days('2026-09-01', [0, 2, null]));
  assert.equal(w.expected_days, 3); assert.equal(w.complete, false); assert.equal(w.last_valid_date, '2026-09-02');
  assert.equal(R.span([]), null);
});

test('spells: dry and wet runs; a missing day breaks the run and is not counted as dry', () => {
  const sp = R.spells(days('2026-01-01', [0, 0, 0, null, 0, 5, 3, 0]), 1);
  assert.equal(sp.longest_dry.days, 3);
  assert.equal(sp.longest_dry.start, '2026-01-01');
  assert.equal(sp.longest_wet.days, 2);
  assert.equal(sp.current.kind, 'dry');
  assert.ok(sp.broken_by_missing >= 1);
});

test('spells: a calendar gap breaks the run', () => {
  const rows = [{ valid_date: '2026-01-01', value: 0 }, { valid_date: '2026-01-02', value: 0 }, { valid_date: '2026-01-05', value: 0 }];
  assert.equal(R.spells(rows).longest_dry.days, 2);
});

test('committed CHIRPS sample: 3 days only, so monthly and yearly totals are withheld', () => {
  const data = require('../data/chirps_daily.json');
  const rows = data.series.sat.riyadh.map(r => ({ valid_date: r.date, value: r.precipitation_mm }));
  const [m] = R.byMonth(rows); const [y] = R.byYear(rows);
  assert.equal(m.total_mm, null); assert.equal(y.total_mm, null);
  assert.equal(R.span(rows).complete, true, 'the 3-day window itself is complete');
});
