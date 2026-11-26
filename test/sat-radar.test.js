'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const S = require('../vendor/satellite.js/6.0.1/satellite.min.js');
const R = require('../src/services/space/sat-radar.js');
const SourceState = require('../src/platform/data/source-state.js');

// Synthetic ISS-like elements (TEST DATA, not live CelesTrak data).
const OMM = { OBJECT_NAME: 'TEST STATION', OBJECT_ID: '1998-067A', EPOCH: '2026-11-25T12:00:00.000000', MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005, INCLINATION: 51.64, RA_OF_ASC_NODE: 120, ARG_OF_PERICENTER: 90, MEAN_ANOMALY: 270, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 50000, BSTAR: 0.0002, MEAN_MOTION_DOT: 0.0001, MEAN_MOTION_DDOT: 0 };
const T = new Date('2026-11-26T12:00:00Z');
const RIYADH = { lat: 24.71, lon: 46.68 };
const item = () => R.parseGroup([OMM], 'stations').satellites[0];

test('vendored satellite.js is the documented file (SHA-256) and reproduces the Vallado SGP4 reference (sat 00005, t=0)', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync('vendor/satellite.js/6.0.1/satellite.min.js')).digest('hex');
  assert.match(fs.readFileSync('vendor/satellite.js/6.0.1/README.md', 'utf8'), new RegExp(sha));
  const rec = S.twoline2satrec('1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753', '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667');
  const pv = S.sgp4(rec, 0);
  assert.ok(Math.abs(pv.position.x - 7022.46529266) < 1e-3, 'x ' + pv.position.x);
  assert.ok(Math.abs(pv.position.y - -1400.08296755) < 1e-3, 'y ' + pv.position.y);
  assert.ok(Math.abs(pv.position.z - 0.03995155) < 1e-3, 'z ' + pv.position.z);
});

test('group URLs use CelesTrak GP JSON for small groups only', () => {
  assert.equal(R.groupUrl('stations'), 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json');
  assert.deepEqual(Object.keys(R.GROUPS), ['stations', 'visual', 'gnss']);
  assert.throws(() => R.groupUrl('starlink'), TypeError);
  assert.throws(() => R.groupUrl('active'), TypeError);
});

test('invalid, incomplete and duplicate records are rejected and counted, never guessed', () => {
  const bad = { ...OMM, NORAD_CAT_ID: 1, MEAN_MOTION: undefined };
  const dup = { ...OMM };
  const badEpoch = { ...OMM, NORAD_CAT_ID: 2, EPOCH: 'yesterday' };
  const r = R.parseGroup([OMM, bad, dup, badEpoch, null], 'stations');
  assert.equal(r.satellites.length, 1); assert.equal(r.rejected, 4);
  assert.equal(r.satellites[0].launch_year, 1998);
  assert.equal(r.satellites[0].epoch, '2026-11-25T12:00:00.000Z');
  assert.throws(() => R.parseGroup({ error: 'x' }, 'stations'), TypeError);
});

test('computed position is physically plausible for an ISS-like orbit', () => {
  const s = item();
  for (let h = 0; h < 24; h += 0.5) {
    const p = R.positionAt(s, new Date(T.getTime() + h * 3600000));
    assert.ok(p.height_km > 380 && p.height_km < 460, 'height ' + p.height_km);
    assert.ok(p.speed_kms > 7.5 && p.speed_kms < 7.8, 'speed ' + p.speed_kms);
    assert.ok(Math.abs(p.lat) <= 51.7, 'latitude within inclination');
    assert.ok(p.lon >= -180 && p.lon <= 180);
  }
});

test('an observer directly under the satellite sees it near the zenith', () => {
  const s = item(); const sub = R.positionAt(s, T);
  const p = R.positionAt(s, T, { lat: sub.lat, lon: sub.lon });
  assert.ok(p.elevation_deg > 85, 'elevation ' + p.elevation_deg);
  assert.ok(Math.abs(p.range_km - sub.height_km) < 20, 'range ≈ height');
  const far = R.positionAt(s, T, { lat: -sub.lat, lon: ((sub.lon + 360) % 360) - 180 });
  assert.ok(far.elevation_deg < 0, 'antipode sees it below the horizon');
});

test('heading follows the ground motion; epoch age is reported', () => {
  const s = item(), h = R.headingAt(s, T);
  assert.ok(h >= 0 && h < 360);
  assert.equal(R.epochAgeDays(s, T), 1);
});

test('ground track covers past and future and is split at the antimeridian', () => {
  const tr = R.groundTrack(item(), T, 90, 90, 60);
  const pts = tr.past.flat().length + tr.future.flat().length;
  assert.ok(pts >= 180, 'about one point per minute over 3 h');
  for (const seg of tr.past.concat(tr.future)) for (let i = 1; i < seg.length; i++) assert.ok(Math.abs(seg[i][1] - seg[i - 1][1]) < 180, 'no line across the map');
});

test('next pass: rise < culmination < set, elevation positive inside the pass and ~0 at its edges', () => {
  const s = item(), pass = R.nextPass(s, RIYADH, T, 24, 0);
  assert.ok(pass, 'an ISS-like orbit passes over Riyadh within 24 h');
  const rise = Date.parse(pass.rise), cul = Date.parse(pass.culmination), set = Date.parse(pass.set);
  assert.ok(rise < cul && cul < set);
  assert.ok(set - rise < 15 * 60000, 'LEO pass shorter than 15 min');
  assert.ok(pass.max_elevation_deg > 0);
  assert.ok(Math.abs(R.positionAt(s, new Date(rise), RIYADH).elevation_deg) < 0.5);
  assert.ok(Math.abs(R.positionAt(s, new Date(set), RIYADH).elevation_deg) < 0.5);
  assert.ok(R.positionAt(s, new Date(cul), RIYADH).elevation_deg > 0);
});

test('next pass with a high minimum elevation is later or absent, never earlier', () => {
  const s = item(), any = R.nextPass(s, RIYADH, T, 24, 0), high = R.nextPass(s, RIYADH, T, 24, 40);
  if (high) assert.ok(Date.parse(high.rise) >= Date.parse(any.rise));
});

// ---------- loading policy ----------
const okResp = b => ({ ok: true, status: 200, json: async () => b, headers: { get: () => null } });

test('loading: CelesTrak 2-hour policy — no request while the stored copy is younger than 2 h', async () => {
  SourceState.forget('celestrak_gp', 'stations');
  let calls = 0; const fetch = async () => { calls++; return okResp([OMM]); };
  const first = await R.loadGroup('stations', { fetch, now: T });
  assert.equal(first.state, 'fresh'); assert.equal(calls, 1);
  const second = await R.loadGroup('stations', { fetch, now: new Date(T.getTime() + 119 * 60000) });
  assert.equal(second.state, 'cached'); assert.equal(second.reason, 'policy_2h'); assert.equal(calls, 1);
  const third = await R.loadGroup('stations', { fetch, now: new Date(T.getTime() + 121 * 60000) });
  assert.equal(third.state, 'fresh'); assert.equal(calls, 2);
});

test('loading: outage falls back to the last valid copy (stale, ≤3 days); beyond that it is unavailable', async () => {
  SourceState.forget('celestrak_gp', 'gnss');
  await R.loadGroup('gnss', { fetch: async () => okResp([OMM]), now: T });
  const down = async () => { throw new TypeError('offline'); };
  const r = await R.loadGroup('gnss', { fetch: down, now: new Date(T.getTime() + 5 * 3600000), timeoutMs: 1000 });
  assert.equal(r.state, 'stale'); assert.equal(r.satellites.length, 1);
  await assert.rejects(R.loadGroup('gnss', { fetch: down, now: new Date(T.getTime() + 4 * 86400000) }), e => e.kind === 'unavailable');
});

test('loading: a response with no valid records is a source error; partial data is labelled partial', async () => {
  SourceState.forget('celestrak_gp', 'visual');
  await assert.rejects(R.loadGroup('visual', { fetch: async () => okResp([{ OBJECT_NAME: 'X' }]), now: T }), e => e.kind === 'source_error');
  const r = await R.loadGroup('visual', { fetch: async () => okResp([OMM, { OBJECT_NAME: 'X' }]), now: T });
  assert.equal(r.state, 'partial'); assert.equal(r.rejected, 1);
});

test('sat radar page: computed-not-observed wording, visibility caveat, attribution, vendored library', () => {
  const html = fs.readFileSync('sat-radar/index.html', 'utf8');
  for (const s of ['../vendor/satellite.js/6.0.1/satellite.min.js', 'sat-radar.js', 'وليست رصداً', 'لا يعني أن القمر مرئي بالعين', 'CelesTrak', 'MIT', 'الجهة المالكة غير متاحة', 'مرة كل ساعتين']) assert.ok(html.includes(s), s);
});
