"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Geo = require("../src/platform/geo/google-links.js");

test("Google Maps and Earth links use validated coordinates", () => {
  assert.match(Geo.mapsSearchUrl(24.7, 46.6), /google\.com\/maps\/search/);
  assert.match(Geo.earthSearchUrl(24.7, 46.6), /earth\.google\.com\/web\/search/);
  assert.equal(Geo.mapsSearchUrl("", 46.6), null);
  assert.equal(Geo.earthSearchUrl(91, 46.6), null);
  assert.equal(Geo.mapsSearchUrl(24.7, 181), null);
});

test("Google Maps directions require two valid points", () => {
  const url = Geo.directionsUrl({lat: 24.7, lon: 46.6}, {lat: 21.4, lon: 39.8});
  assert.match(url, /origin=24.7%2C46.6/);
  assert.match(url, /destination=21.4%2C39.8/);
  assert.equal(Geo.directionsUrl({lat: 24.7, lon: 46.6}, null), null);
});

test("KML export preserves valid points and escapes XML", () => {
  const kml = Geo.toKml([
    {id:"a", name:"مدينة & موقع", lat:24.7, lon:46.6},
    {id:"bad", name:"خارج النطاق", lat:91, lon:0},
    {id:"b", name:"أبها", lat:18.2, lon:42.5}
  ]);
  assert.match(kml, /مدينة &amp; موقع/);
  assert.match(kml, /46.6,24.7,0/);
  assert.match(kml, /42.5,18.2,0/);
  assert.doesNotMatch(kml, /خارج النطاق/);
});

test("KML polygon export closes the ring and escapes the name", () => {
  const kml = Geo.toPolygonKml([
    {lat:18.2,lon:42.5},{lat:18.2,lon:42.6},{lat:18.3,lon:42.6}
  ], "مزرعة & أرض");
  assert.match(kml, /مزرعة &amp; أرض/);
  assert.ok(kml.includes("42.6,18.3,0 42.5,18.2,0</coordinates>"));
  assert.equal(Geo.toPolygonKml([{lat:1,lon:2},{lat:2,lon:3}], "غير مكتمل"), null);
});
