'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const G = require('../src/services/satellite/nasa-gibs.js');
const E = require('../src/services/satellite/earth-memory.js');
const A = require('../src/providers/aviation/adsb-v2/adapter.js');
const F = require('../src/services/aviation/flight-radar.js');
const snapshot = require('./fixtures/gibs-live-domains-2026-11-25.json');

// ---------- Earth memory ----------
const terra = G.parseAvailablePeriods('<Domain>' + snapshot.layers.MODIS_Terra_CorrectedReflectance_TrueColor.domain + '</Domain>');
const CAP = '2026-11-23';

test('earth memory: same day across years covers every archive year and uses only listed dates', () => {
  const list = E.sameDayAcrossYears('2026-11-20', terra, CAP, 7);
  assert.equal(list[0].year, 2000); assert.equal(list[list.length - 1].year, 2026);
  for (const e of list) if (e.date) assert.ok(G.isDateAvailable(e.date, terra), e.year + ' ' + e.date);
});

test('earth memory: a missing day snaps to the nearest listed day within 7 days and reports the gap', () => {
  const p = G.parseAvailablePeriods('<Domain>2010-01-01/2010-03-10/P1D,2010-03-14/2026-01-01/P1D</Domain>');
  const hit = E.nearestAvailable('2010-03-12', p, '2026-01-01', 7);
  assert.equal(hit.date, '2010-03-10'); assert.equal(hit.gap_days, -2);
  assert.match(E.describeGap(hit), /قبل التاريخ المطلوب بـ 2 يوم/);
  const far = G.parseAvailablePeriods('<Domain>2010-01-01/2010-03-01/P1D,2010-04-01/2026-01-01/P1D</Domain>');
  assert.equal(E.nearestAvailable('2010-03-15', far, '2026-01-01', 7), null, 'no image within 7 days → null, never a far date');
});

test('earth memory: years before the archive are reported, not invented', () => {
  const p = G.parseAvailablePeriods('<Domain>2015-11-24/2026-11-02/P1D</Domain>');
  const list = E.sameDayAcrossYears('2026-06-01', p, '2026-11-02', 7);
  assert.equal(list[0].year, 2015); assert.equal(list[0].date, null); assert.equal(list[0].reason, 'before_archive');
  assert.equal(list[1].date, '2016-06-01');
});

test('earth memory: 29 February falls back to 28 February in common years and says so', () => {
  assert.deepEqual(E.dayOfYearDate(2025, 2, 29), { date: '2025-02-28', adjusted: true });
  assert.deepEqual(E.dayOfYearDate(2024, 2, 29), { date: '2024-02-29', adjusted: false });
});

test('earth memory: «N years before» snaps to an available date; invalid input rejected', () => {
  const hit = E.yearsBefore('2026-11-20', 10, terra, CAP, 7);
  assert.ok(hit.date >= '2016-11-13' && hit.date <= '2016-11-27');
  assert.throws(() => E.yearsBefore('2026-13-01', 10, terra, CAP), TypeError);
  assert.throws(() => E.yearsBefore('2026-11-20', 0, terra, CAP), TypeError);
});

test('earth memory page: synced before/after maps, GIBS attribution, honest limits', () => {
  const html = fs.readFileSync('earth-memory/index.html', 'utf8');
  for (const s of ['earth-memory.js', 'nasa-gibs.js', 'id="mapA"', 'id="mapB"', 'id="years"', 'NASA Earthdata', 'ولا تثبت وحدها سبب أي تغير', 'أقرب يوم متاح خلال 7 أيام']) assert.ok(html.includes(s), s);
});

// ---------- Flight radar: adapter ----------
const NOW = Date.parse('2026-11-26T12:00:00Z');
const body = {
  now: NOW, total: 5, ctime: NOW, ptime: 3, msg: 'No error',
  ac: [
    { hex: '710101', flight: 'SVA1020 ', r: 'HZ-AK11', t: 'B77W', alt_baro: 35000, gs: 480, track: 270, lat: 24.9, lon: 46.5, seen_pos: 2.5, dst: 12.3, seen: 1, messages: 1, mlat: [], tisb: [], rssi: -20, type: 'adsb_icao' },
    { hex: '710102', flight: '', alt_baro: 'ground', gs: 12, track: 90, lat: 24.95, lon: 46.7, seen_pos: 1, dst: 15, seen: 1, messages: 1, mlat: [], tisb: [], rssi: -20, type: 'adsb_icao' },
    { hex: '710103', flight: 'XYZ99', alt_baro: 20000, seen: 30, messages: 1, mlat: [], tisb: [], rssi: -30, type: 'adsb_icao' },
    { hex: '~abc123', flight: 'TEST1', alt_baro: 1000, gs: null, track: null, lat: 25, lon: 46, seen_pos: 40, dst: 50, seen: 1, messages: 1, mlat: [], tisb: [], rssi: -20, type: 'tisb_other' },
    { hex: '710101', flight: 'DUP', lat: 1, lon: 1, seen: 1, messages: 1, mlat: [], tisb: [], rssi: 0, type: 'x' }
  ]
};

test('flights: units converted from feet/knots/nm with source values kept', () => {
  const r = A.normalize(body, 'adsblol');
  const sva = r.aircraft.find(a => a.hex === '710101');
  assert.equal(sva.callsign, 'SVA1020'); assert.equal(sva.airline_icao, 'SVA');
  assert.equal(sva.altitude_ft, 35000); assert.equal(sva.altitude_m, 10668);
  assert.equal(sva.speed_kn, 480); assert.equal(sva.speed_kmh, 889);
  assert.equal(sva.distance_km, 22.8);
  assert.equal(sva.position_time, '2026-11-26T11:59:57.500Z');
  assert.equal(r.generated_at, '2026-11-26T12:00:00.000Z');
});

test('flights: ground, missing values, no-position and duplicate aircraft handled without inventing data', () => {
  const r = A.normalize(body, 'adsblol');
  const g = r.aircraft.find(a => a.hex === '710102');
  assert.equal(g.on_ground, true); assert.equal(g.altitude_m, null); assert.equal(g.callsign, null);
  const t = r.aircraft.find(a => a.hex === '~abc123');
  assert.equal(t.non_icao, true); assert.equal(t.speed_kmh, null); assert.equal(t.track_deg, null);
  assert.equal(r.aircraft.length, 3, 'no-position aircraft and the duplicate hex are skipped');
  assert.equal(r.skipped_without_position, 2);
  assert.deepEqual(r.aircraft.map(a => a.hex), ['710101', '710102', '~abc123'], 'sorted by distance');
});

test('flights: URL builders validate coordinates, radius (1–250 nm) and callsign', () => {
  assert.equal(A.buildPointUrl('adsblol', 24.7136, 46.6753, 54), 'https://api.adsb.lol/v2/point/24.7136/46.6753/54');
  assert.equal(A.buildPointUrl('airplaneslive', 21.5, 39.2, 27), 'https://api.airplanes.live/v2/point/21.5000/39.2000/27');
  assert.throws(() => A.buildPointUrl('adsblol', 91, 0, 10), RangeError);
  assert.throws(() => A.buildPointUrl('adsblol', 24, 46, 251), RangeError);
  assert.throws(() => A.buildPointUrl('adsblol', 24, 46, 0), RangeError);
  assert.throws(() => A.buildPointUrl('nope', 24, 46, 10), TypeError);
  assert.equal(A.buildCallsignUrl('adsblol', ' sva1020 '), 'https://api.adsb.lol/v2/callsign/SVA1020');
  assert.throws(() => A.buildCallsignUrl('adsblol', 'SV A/1'), RangeError);
  assert.throws(() => A.normalize({ msg: 'x' }, 'adsblol'), TypeError);
});

// ---------- Flight radar: service ----------
const ok = b => ({ ok: true, status: 200, json: async () => b, headers: { get: () => null } });
const status = (code, headers) => ({ ok: false, status: code, json: async () => ({}), headers: { get: k => (headers || {})[k] || null } });

test('flights: primary source used when it answers', async () => {
  const calls = [];
  const r = await F.fetchAround(24.7, 46.7, 54, { fetch: async u => { calls.push(u); return ok(body); } });
  assert.equal(r.provider, 'adsblol'); assert.equal(r.fallback_used, false); assert.equal(calls.length, 1);
});

test('flights: falls back to airplanes.live on network failure or 5xx, and says so', async () => {
  const seq = [new TypeError('offline'), ok(body)]; let i = 0;
  const r = await F.fetchAround(24.7, 46.7, 54, { fetch: async () => { const s = seq[i++]; if (s instanceof Error) throw s; return s; } });
  assert.equal(r.provider, 'airplaneslive'); assert.equal(r.fallback_used, true); assert.equal(r.errors[0].provider, 'adsblol');
  const seq2 = [status(503), ok(body)]; let j = 0;
  assert.equal((await F.fetchAround(24.7, 46.7, 54, { fetch: async () => seq2[j++] })).provider, 'airplaneslive');
});

test('flights: 429 stops immediately (no hammering the fallback) and carries Retry-After', async () => {
  let calls = 0;
  await assert.rejects(F.fetchAround(24.7, 46.7, 54, { fetch: async () => { calls++; return status(429, { 'Retry-After': '120' }); } }),
    e => e.kind === 'rate_limited' && e.retryAfterSeconds === 120 && e.provider === 'adsblol');
  assert.equal(calls, 1);
});

test('flights: both sources down → unavailable; a 4xx is a source error, not a fallback', async () => {
  await assert.rejects(F.fetchAround(24.7, 46.7, 54, { fetch: async () => { throw new TypeError('offline'); } }), e => e.kind === 'unavailable' && e.errors.length === 2);
  let calls = 0;
  await assert.rejects(F.fetchAround(24.7, 46.7, 54, { fetch: async () => { calls++; return status(404); } }), e => e.kind === 'http' && e.status === 404);
  assert.equal(calls, 1);
});

test('flights: both sources returning malformed data is a source error, not "unreachable"', async () => {
  await assert.rejects(F.fetchAround(24.7, 46.7, 54, { fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); }, headers: { get: () => null } }) }), e => e.kind === 'source_error');
  await assert.rejects(F.fetchAround(24.7, 46.7, 54, { fetch: async () => ok({ msg: 'no list' }) }), e => e.kind === 'source_error');
});

test('flights: dead reckoning moves along the track, capped at 60 s; ground/unknown speed are not extrapolated', () => {
  const a = A.normalize(body, 'adsblol').aircraft[0]; // 889 km/h due west
  const p = F.estimatePosition(a, 30);
  assert.equal(p.estimated, true);
  assert.ok(Math.abs(p.lat - a.lat) < 0.001 && p.lon < a.lon);
  const km = F.destination(0, 0, 90, 111.195).lon; assert.ok(Math.abs(km - 1) < 0.001, 'destination() sanity: 111.195 km east at the equator ≈ 1°');
  assert.equal(F.estimatePosition(a, 600).seconds, 60);
  const g = A.normalize(body, 'adsblol').aircraft[1];
  assert.equal(F.estimatePosition(g, 30).estimated, false);
});

test('flights: trail keeps only reported fixes, de-duplicates and expires after 30 min', () => {
  const store = F.createTrailStore();
  const r1 = A.normalize(body, 'adsblol');
  store.add(r1, NOW); store.add(r1, NOW + 1000);
  assert.equal(store.get('710101').length, 1, 'same fix not duplicated');
  const moved = JSON.parse(JSON.stringify(body)); moved.ac[0].lon = 46.4; moved.now = NOW + 30000;
  store.add(A.normalize(moved, 'adsblol'), NOW + 30000);
  assert.equal(store.get('710101').length, 2);
  store.add({ aircraft: [] }, NOW + 31 * 60000);
  assert.equal(store.get('710101').length, 0);
});

test('flights: 30 s polling stays within 500 requests/day for about 4 hours of one visible tab', () => {
  assert.equal(F.requestsPerHour(F.POLL_SECONDS), 120);
  assert.ok(500 / F.requestsPerHour(F.POLL_SECONDS) >= 4);
});

test('flights page: honest scope, attribution, pause when hidden, location rounding', () => {
  const html = fs.readFileSync('flights/index.html', 'utf8');
  for (const s of ['flight-radar.js', 'adsb-v2/adapter.js', 'ODbL', 'airplanes.live', 'visibilitychange', 'غير متاحة</b> في هذه المرحلة', 'وليس رادار مراقبة جوية', 'لا تستخدم هذه الصفحة للملاحة', 'مقرّب لمنزلتين عشريتين', 'غياب طائرة لا يعني أنها غير موجودة']) assert.ok(html.includes(s), s);
  assert.doesNotMatch(html, /api[_-]?key|apikey|Authorization/i);
});

test('earth memory page: default "after" avoids today\'s incomplete mosaic and explains black areas', () => {
  const html = fs.readFileSync('earth-memory/index.html', 'utf8');
  assert.match(html, /cap===today\?\(G\.adjacentAvailableDate\(cap,periods,-1,cap\)\|\|cap\):cap/);
  assert.match(html, /المناطق السوداء تعني لا بيانات/);
});

test('flights page: links to free live maps centred on the chosen place, opened externally', () => {
  const html = fs.readFileSync('flights/index.html', 'utf8');
  for (const host of ['globe.adsb.lol', 'globe.airplanes.live', 'globe.adsb.fi', 'globe.adsbexchange.com']) assert.ok(html.includes('https://' + host + '/'), host);
  assert.match(html, /\?lat="\+lat\.toFixed\(3\)\+"&lon="\+lon\.toFixed\(3\)\+"&zoom=8"/);
  assert.match(html, /a\.target="_blank";a\.rel="noopener noreferrer"/);
});
