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
  assert.match(page,/function parseKml/);assert.match(page,/DOMParser/);assert.match(page,/JSZip\.loadAsync/);assert.match(page,/const geometries=\[\]/);assert.match(page,/getElementsByTagNameNS\("\*","Point"\)/);assert.match(page,/getElementsByTagNameNS\("\*","LineString"\)/);assert.match(page,/getElementsByTagNameNS\("\*","Polygon"\)/);
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

test("GeoJSON and GPX import/export controls and parsers are present",()=>{
  for(const id of ["exportGeoJson","exportGpx"])assert.match(page,new RegExp('id="'+id+'"'));
  assert.match(page,/\.geojson/);assert.match(page,/\.gpx/);
  assert.match(page,/function parseGeoJson/);assert.match(page,/FeatureCollection/);
  assert.match(page,/MultiPolygon/);assert.match(page,/function parseGpx/);
  assert.match(page,/getElementsByTagNameNS\("\*","wpt"\)/);
  assert.match(page,/getElementsByTagNameNS\("\*","trk"\)/);assert.match(page,/getElementsByTagNameNS\("\*","trkseg"\)/);
  assert.match(page,/function toGeoJson/);assert.match(page,/function toGpx/);
});

test("CSV export includes coordinate rows and metric measurement columns",()=>{
  assert.match(page,/id="exportCsv"/);
  assert.match(page,/function toCsv/);
  assert.match(page,/اسم العنصر/);
  assert.match(page,/خط العرض/);
  assert.match(page,/خط الطول/);
  assert.match(page,/المساحة م²/);
  assert.match(page,/المحيط م/);
  assert.match(page,/طول المسار م/);
  assert.match(page,/csvCell/);
});
test("KML import retains nested folder path in feature names",()=>{
  assert.match(page,/parent\.localName==="Folder"/);
  assert.match(page,/folders\.unshift/);
  assert.match(page,/folders,nameNode&&nameNode\.textContent/);
});

test("CSV export handles null measurements and neutralizes spreadsheet formulas in text cells",()=>{
  assert.match(page,/m\.areaM2!=null\?m\.areaM2\.toFixed\(2\)/);
  assert.match(page,/m\.perimeterM!=null\?m\.perimeterM\.toFixed\(2\)/);
  assert.match(page,/m\.lengthM!=null\?m\.lengthM\.toFixed\(2\)/);
  assert.match(page,/typeof value==="string"/);
  assert.match(page,/\^\[\\\\t\\\\r \]\*\[=\+@-\]/);
  assert.match(page,/text="\x27"\+text/);
});

test("KML folder path excludes the document root name",()=>{
  assert.match(page,/parent\.localName==="Folder"/);
  assert.doesNotMatch(page,/parent\.localName==="Folder"\|\|parent\.localName==="Document"/);
});
