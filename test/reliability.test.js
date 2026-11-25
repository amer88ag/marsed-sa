'use strict';
// Reliability layer: retries, request sharing, unified data states and
// last-valid-data reuse. All network responses here are simulated.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const HttpClient = require('../src/platform/http/client.js');
const SourceState = require('../src/platform/data/source-state.js');

const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const status = code => ({ ok: false, status: code, statusText: 'E' + code, json: async () => ({}), text: async () => '' });

function scripted(steps) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
  return { fetch, calls };
}

test('default behaviour is a single attempt (no hidden retries)', async () => {
  const s = scripted([status(503), ok({ a: 1 })]);
  await assert.rejects(HttpClient.request('https://x.test/a', { fetch: s.fetch }), e => e.kind === 'http' && e.status === 503 && e.attempts === 1);
  assert.equal(s.calls.length, 1);
});

test('transient HTTP 503 is retried and recovers', async () => {
  const s = scripted([status(503), ok({ a: 1 })]);
  const body = await HttpClient.request('https://x.test/a', { fetch: s.fetch, retries: 2, retryDelayMs: 1 });
  assert.deepEqual(body, { a: 1 });
  assert.equal(s.calls.length, 2);
});

test('network failure and 429 are transient; 404 and bad JSON are not retried', async () => {
  const net = scripted([new TypeError('offline'), ok({ b: 2 })]);
  assert.deepEqual(await HttpClient.request('https://x.test/n', { fetch: net.fetch, retries: 1, retryDelayMs: 1 }), { b: 2 });
  const rate = scripted([status(429), ok({ c: 3 })]);
  assert.deepEqual(await HttpClient.request('https://x.test/r', { fetch: rate.fetch, retries: 1, retryDelayMs: 1 }), { c: 3 });
  const missing = scripted([status(404), ok({})]);
  await assert.rejects(HttpClient.request('https://x.test/m', { fetch: missing.fetch, retries: 3, retryDelayMs: 1 }), e => e.status === 404 && e.attempts === 1);
  assert.equal(missing.calls.length, 1);
  const badJson = scripted([{ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); }, text: async () => '{' }]);
  await assert.rejects(HttpClient.request('https://x.test/j', { fetch: badJson.fetch, retries: 3, retryDelayMs: 1 }), e => e.kind === 'json');
  assert.equal(badJson.calls.length, 1);
});

test('retries stop after the limit and report the attempt count', async () => {
  const s = scripted([status(502)]);
  await assert.rejects(HttpClient.request('https://x.test/a', { fetch: s.fetch, retries: 2, retryDelayMs: 1 }), e => e.status === 502 && e.attempts === 3);
  assert.equal(s.calls.length, 3);
});

test('a cancelled request is never retried', async () => {
  const controller = new AbortController();
  controller.abort();
  const s = scripted([ok({})]);
  await assert.rejects(HttpClient.request('https://x.test/a', { fetch: s.fetch, signal: controller.signal, retries: 3 }), e => e.kind === 'aborted');
  assert.equal(s.calls.length, 0);
});

test('concurrent identical requests share one network call', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  let count = 0;
  const fetch = async () => { count++; await gate; return ok({ shared: true }); };
  const a = HttpClient.requestShared('https://x.test/shared', { fetch });
  const b = HttpClient.requestShared('https://x.test/shared', { fetch });
  release();
  assert.deepEqual(await a, { shared: true });
  assert.deepEqual(await b, { shared: true });
  assert.equal(count, 1);
  await HttpClient.requestShared('https://x.test/shared', { fetch });
  assert.equal(count, 2, 'settled calls are not cached; a later call fetches again');
});

test('unified state labels are exactly the seven agreed states', () => {
  assert.deepEqual(Object.values(SourceState.STATES), ['حديثة', 'مخزنة مؤقتاً', 'قديمة', 'جزئية', 'غير متاحة', 'خطأ في المصدر', 'لم يتم جلبها بعد']);
  assert.equal(SourceState.describe(null), 'لم يتم جلبها بعد');
});

test('reuse windows differ per source (no single TTL)', () => {
  const windows = new Set(Object.values(SourceState.REUSE_POLICY).map(p => p.reuse_max_minutes));
  assert.ok(windows.size > 1);
});

test('success states: fresh, partial when values were withheld, stale when data is old', () => {
  assert.equal(SourceState.onSuccess({ issues: 0 }).state, 'fresh');
  assert.equal(SourceState.onSuccess({ issues: 2 }).state, 'partial');
  assert.equal(SourceState.onSuccess({ issues: 0, dataStale: true }).state, 'stale');
});

test('failure without saved data: unavailable for no response, source error for a bad response', () => {
  SourceState.forget('weather_current', 't-none');
  const a = SourceState.onFailure('weather_current', 't-none', { kind: 'network' });
  assert.equal(a.state, 'unavailable'); assert.equal(a.payload, null);
  const b = SourceState.onFailure('weather_current', 't-none', { kind: 'http', status: 500 });
  assert.equal(b.state, 'source_error'); assert.equal(b.payload, null);
  assert.match(SourceState.describe(b), /لم تُعرض قيم بديلة/);
});

test('failure with recent saved data reuses it and labels it cached; old data is labelled stale', () => {
  const t0 = new Date('2026-11-26T09:00:00Z');
  SourceState.remember('weather_current', 't-c', { v: 21 }, t0);
  const later = new Date('2026-11-26T10:00:00Z');
  const cached = SourceState.onFailure('weather_current', 't-c', { kind: 'timeout' }, { now: later });
  assert.equal(cached.state, 'cached'); assert.deepEqual(cached.payload, { v: 21 }); assert.equal(cached.age_minutes, 60);
  assert.match(SourceState.describe(cached), /مخزنة مؤقتاً/);
  const stale = SourceState.onFailure('weather_current', 't-c', { kind: 'timeout' }, { now: later, isStale: () => true });
  assert.equal(stale.state, 'stale');
});

test('saved data beyond its reuse window is not shown', () => {
  SourceState.remember('weather_current', 't-old', { v: 1 }, new Date('2026-11-26T00:00:00Z'));
  const r = SourceState.onFailure('weather_current', 't-old', { kind: 'network' }, { now: new Date('2026-11-26T07:00:00Z') });
  assert.equal(r.state, 'unavailable'); assert.equal(r.payload, null); assert.equal(r.expired_cache, true);
});

test('a broken localStorage does not break saving (memory fallback)', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = { setItem() { throw new Error('QuotaExceeded'); }, getItem() { throw new Error('denied'); }, removeItem() {} };
  try {
    assert.equal(SourceState.remember('city_overview', 't-ls', { ok: 1 }), true);
    assert.deepEqual(SourceState.recall('city_overview', 't-ls').payload, { ok: 1 });
  } finally {
    if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original;
  }
});

// Dashboard journey: valid data → outage (cached shown with label) → recovery.
function dashboard() {
  const html = fs.readFileSync('index.html', 'utf8');
  const elements = new Map(); const listeners = {}; const requests = [];
  const el = id => {
    if (!elements.has(id)) elements.set(id, { id, textContent: '', innerHTML: '', disabled: false, value: 'riyadh', classList: { add() {}, remove() {} },
      setAttribute(n, v) { this['attr_' + n] = String(v); }, addEventListener(t, cb) { listeners[id + ':' + t] = cb; } });
    return elements.get(id);
  };
  const marker = { addTo() { return this; }, setLatLng() { return this; }, setPopupContent() { return this; }, bindPopup() { return this; }, on() { return this; }, openPopup() { return this; } };
  const leaflet = { map() { return { setView() { return this; } }; }, tileLayer() { return { addTo() {} }; }, marker() { return marker; } };
  const context = {
    CityRegistry: require('../src/platform/geo/cities.js'), SaudiTime: require('../src/platform/time/saudi-time.js'), FreshnessPolicy: require('../src/platform/quality/freshness.js'),
    UnitPolicy: require('../src/platform/quality/units.js'), SourceState,
    document: { getElementById: el }, window: { L: leaflet }, L: leaflet, console, Date, Math, Number, isFinite, URL,
    WeatherService: { fetchWeather() { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); requests.push({ resolve: res, reject: rej, promise: p }); return p; } },
    PrecipitationService: { fetchDataset: async () => { throw new Error('offline'); } }
  };
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1].trim()).filter(Boolean)[0];
  vm.runInNewContext(script, context, { filename: 'reliability-dashboard.js' });
  return { elements, listeners, requests };
}
const settle = () => new Promise(r => setImmediate(r));
const sample = t => ({ measurements: [{ name: 'temperature', value: t }, { name: 'relative_humidity', value: 30 }], daily: [{ valid_date: '2026-11-26', precipitation: 0 }] });

test('dashboard: outage after a valid load shows the last valid data labelled as cached, then recovers', async () => {
  SourceState.forget('weather_current', 'riyadh');
  const h = dashboard();
  h.requests[0].resolve(sample(24)); await h.requests[0].promise.catch(() => {}); await settle();
  assert.equal(h.elements.get('temp').textContent, '24.0');
  assert.notEqual(h.elements.get('dataState')['attr_data-state'], 'cached');

  h.listeners['refresh:click']();
  const err = Object.assign(new Error('down'), { kind: 'network' });
  h.requests[1].reject(err); await h.requests[1].promise.catch(() => {}); await settle();
  assert.equal(h.elements.get('temp').textContent, '24.0', 'last valid value kept');
  assert.equal(h.elements.get('dataState')['attr_data-state'], 'cached');
  assert.match(h.elements.get('dataState').textContent, /مخزنة مؤقتاً/);
  assert.match(h.elements.get('connection').textContent, /بيانات محفوظة/);

  h.listeners['refresh:click']();
  h.requests[2].resolve(sample(26)); await h.requests[2].promise; await settle();
  assert.equal(h.elements.get('temp').textContent, '26.0');
  assert.notEqual(h.elements.get('dataState')['attr_data-state'], 'cached');
});

test('dashboard: first-load outage shows no values (never zero) and an unavailable state', async () => {
  SourceState.forget('weather_current', 'riyadh');
  const h = dashboard();
  h.requests[0].reject(Object.assign(new Error('down'), { kind: 'timeout' })); await h.requests[0].promise.catch(() => {}); await settle();
  assert.notEqual(h.elements.get('temp').textContent, '0');
  assert.notEqual(h.elements.get('temp').textContent, '0.0');
  assert.equal(h.elements.get('dataState')['attr_data-state'], 'unavailable');
});

test('dashboard: an HTTP error without saved data is reported as a source error', async () => {
  SourceState.forget('weather_current', 'riyadh');
  const h = dashboard();
  h.requests[0].reject(Object.assign(new Error('bad'), { kind: 'http', status: 500 })); await h.requests[0].promise.catch(() => {}); await settle();
  assert.equal(h.elements.get('dataState')['attr_data-state'], 'source_error');
});
