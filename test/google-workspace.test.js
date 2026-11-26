"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Geo=require("../src/platform/geo/google-workspace.js");

test("validates geographic feature types and coordinate ranges",()=>{
  assert.equal(Geo.normalizeFeature({type:"point",coordinates:[{lat:91,lon:1}]}),null);
  assert.equal(Geo.normalizeFeature({type:"line",coordinates:[{lat:1,lon:2}]}),null);
  assert.equal(Geo.normalizeFeature({type:"polygon",coordinates:[{lat:1,lon:2},{lat:2,lon:3}]}),null);
  assert.equal(Geo.normalizeFeature({type:"point",coordinates:[{lat:24.7,lon:46.6}]}).type,"point");
});
test("computes map and Earth links from feature centre",()=>{
  const f={type:"polygon",name:"مزرعة",coordinates:[{lat:24,lon:46},{lat:24,lon:47},{lat:25,lon:47},{lat:25,lon:46}]};
  assert.match(Geo.mapsUrl(f),/google.com\/maps\/search/);
  assert.match(Geo.earthUrl(f),/earth.google.com\/web\/search/);
  assert.deepEqual(Geo.centroid(f),{lat:24.5,lon:46.5});
});
test("directions link uses line endpoints only",()=>{
  const f={type:"line",coordinates:[{lat:24,lon:46},{lat:25,lon:47},{lat:26,lon:48}]};
  assert.match(Geo.directionsUrl(f),/origin=24%2C46/);
  assert.match(Geo.directionsUrl(f),/destination=26%2C48/);
  assert.equal(Geo.directionsUrl({type:"point",coordinates:[{lat:1,lon:2}]}),null);
});
test("KML export writes point, line and closed polygon geometries safely",()=>{
  const kml=Geo.toKml([
    {type:"point",name:"موقع & علامة",coordinates:[{lat:24,lon:46}]},
    {type:"line",name:"مسار",coordinates:[{lat:24,lon:46},{lat:25,lon:47}]},
    {type:"polygon",name:"أرض",coordinates:[{lat:24,lon:46},{lat:24,lon:47},{lat:25,lon:47}]}
  ]);
  assert.match(kml,/موقع &amp; علامة/);
  assert.match(kml,/<Point>/);assert.match(kml,/<LineString>/);assert.match(kml,/<Polygon>/);
  assert.match(kml,/46,24,0 47,24,0 47,25,0 46,24,0/);
});
test("parses KML coordinate tuples and rejects malformed input",()=>{
  assert.deepEqual(Geo.parseCoordinateText("46,24,0 47,25,0"),[{lat:24,lon:46},{lat:25,lon:47}]);
  assert.equal(Geo.parseCoordinateText("181,24,0"),null);
  assert.equal(Geo.parseCoordinateText("bad"),null);
});
