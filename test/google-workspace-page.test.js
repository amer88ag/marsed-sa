"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const page=fs.readFileSync(path.join(__dirname,"../geo/index.html"),"utf8");

test("Google geospatial workspace exposes Maps and Earth actions",()=>{
  for(const id of ["openMaps","openEarth","openDirections","exportKml","exportKmz","importFile"])assert.match(page,new RegExp('id="'+id+'"'));
  assert.match(page,/Geo\.mapsUrl/);assert.match(page,/Geo\.earthUrl/);assert.match(page,/Geo\.directionsUrl/);
});
test("Google geospatial workspace supports KML and KMZ interchange",()=>{
  assert.match(page,/function parseKml/);assert.match(page,/DOMParser/);assert.match(page,/JSZip\.loadAsync/);assert.match(page,/MultiGeometry/);
  assert.match(page,/application\/vnd\.google-earth\.kml\+xml/);assert.match(page,/application\/vnd\.google-earth\.kmz/);
});
test("Google geospatial workspace has local project persistence and draw modes",()=>{
  for(const id of ["drawPoint","drawLine","drawPolygon","finishDraw","saveProject","loadProject","deleteProject"])assert.match(page,new RegExp('id="'+id+'"'));
  assert.match(page,/localStorage\.setItem/);assert.match(page,/marsed\.google\.geo\.projects\.v1/);
});
test("Google geospatial workspace does not require Google API keys",()=>{
  assert.doesNotMatch(page,/AIza[0-9A-Za-z_-]{30,}/);
});

test("selected feature panel supports rename, metric measurements, coordinate copy and single-feature export",()=>{
  assert.match(page,/id="selectedDetails"/);
  assert.match(page,/function updateSelectedDetails/);
  assert.match(page,/المساحة التقريبية/);
  assert.match(page,/المحيط/);
  assert.match(page,/نسخ الإحداثيات/);
  assert.match(page,/تصدير العنصر المحدد/);
  assert.match(page,/navigator\.clipboard\.writeText/);
});
