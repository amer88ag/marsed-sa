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

test("measures line length and polygon area/perimeter in metric units",()=>{
  const line=Geo.measureFeature({type:"line",coordinates:[{lat:24,lon:46},{lat:24,lon:47}]});
  assert.ok(line.lengthM>100000&&line.lengthM<110000);
  const square=Geo.measureFeature({type:"polygon",coordinates:[{lat:0,lon:0},{lat:0,lon:0.01},{lat:0.01,lon:0.01},{lat:0.01,lon:0}]});
  assert.ok(square.areaM2>1200000&&square.areaM2<1300000);
  assert.ok(square.perimeterM>4400&&square.perimeterM<4500);
  assert.equal(Geo.measureFeature({type:"point",coordinates:[{lat:1,lon:2}]}).areaM2,null);
});

test("polygon interior rings are validated, subtracted from area and added to perimeter",()=>{
  const outer=[{lat:0,lon:0},{lat:0,lon:.02},{lat:.02,lon:.02},{lat:.02,lon:0}];
  const hole=[{lat:.005,lon:.005},{lat:.005,lon:.015},{lat:.015,lon:.015},{lat:.015,lon:.005}];
  const full=Geo.measureFeature({type:"polygon",coordinates:outer});
  const cut=Geo.measureFeature({type:"polygon",coordinates:outer,holes:[hole]});
  assert.ok(cut.areaM2<full.areaM2);
  assert.ok(cut.areaM2>full.areaM2*.7);
  assert.ok(cut.perimeterM>full.perimeterM);
  assert.equal(Geo.normalizeFeature({type:"polygon",coordinates:outer,holes:[[{lat:0,lon:0}]]}),null);
});
test("KML export retains polygon interior boundaries",()=>{
  const kml=Geo.toKml([{type:"polygon",name:"حدود مع ثقب",coordinates:[{lat:0,lon:0},{lat:0,lon:2},{lat:2,lon:2}],holes:[[{lat:.2,lon:.2},{lat:.2,lon:.5},{lat:.5,lon:.5}]]}]);
  assert.match(kml,/<innerBoundaryIs>/);
  assert.match(kml,/<outerBoundaryIs>/);
});


test("GeoJSON round trip preserves points, lines, polygon holes, names and coordinates",()=>{
  const source=[
    {id:"p1",name:"موقع & بوابة",type:"point",coordinates:[{lat:24.7,lon:46.6}]},
    {id:"l1",name:"مسار رئيسي",type:"line",coordinates:[{lat:24,lon:46},{lat:24.5,lon:46.5},{lat:25,lon:47}]},
    {id:"a1",name:"أرض ذات ثقب",type:"polygon",coordinates:[{lat:24,lon:46},{lat:24,lon:46.02},{lat:24.02,lon:46.02},{lat:24.02,lon:46}],holes:[[{lat:24.005,lon:46.005},{lat:24.005,lon:46.01},{lat:24.01,lon:46.01},{lat:24.01,lon:46.005}]]}
  ];
  const encoded=Geo.toGeoJson(source);
  assert.equal(encoded.type,"FeatureCollection");
  const decoded=Geo.fromGeoJson(encoded,(()=>{let n=0;return ()=>"roundtrip-"+(++n)})());
  assert.equal(decoded.length,3);
  for(let i=0;i<source.length;i++){
    assert.equal(decoded[i].name,source[i].name);
    assert.equal(decoded[i].type,source[i].type);
    assert.deepEqual(decoded[i].coordinates,source[i].coordinates);
    assert.deepEqual(decoded[i].holes||[],source[i].holes||[]);
  }
  assert.ok(Math.abs(Geo.measureFeature(decoded[2]).areaM2-Geo.measureFeature(source[2]).areaM2)<0.01);
});

test("GeoJSON importer expands multi-geometries and geometry collections",()=>{
  const data={type:"FeatureCollection",features:[
    {type:"Feature",properties:{name:"نقاط"},geometry:{type:"MultiPoint",coordinates:[[46,24],[47,25]]}},
    {type:"Feature",properties:{name:"خطوط"},geometry:{type:"MultiLineString",coordinates:[[[46,24],[47,25]],[[48,26],[49,27]]]}},
    {type:"Feature",properties:{name:"مجموعة"},geometry:{type:"GeometryCollection",geometries:[{type:"Point",coordinates:[50,28]},{type:"LineString",coordinates:[[50,28],[51,29]]}]}}
  ]};
  const result=Geo.fromGeoJson(data,(()=>{let n=0;return ()=>"multi-"+(++n)})());
  assert.deepEqual(result.map(f=>f.type),["point","point","line","line","point","line"]);
  assert.equal(result[0].name,"نقاط (1)");
  assert.equal(result[3].name,"خطوط (2)");
  assert.equal(result[4].name,"مجموعة (1)");
});

test("GeoJSON importer rejects malformed coordinates without creating invalid features",()=>{
  const data={type:"Feature",properties:{name:"إحداثيات غير صالحة"},geometry:{type:"Point",coordinates:[181,24]}};
  assert.deepEqual(Geo.fromGeoJson(data),[]);
  assert.throws(()=>Geo.fromGeoJson("{not-json"),SyntaxError);
});
