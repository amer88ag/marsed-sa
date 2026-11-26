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

test("large imports are rejected rather than silently truncated",()=>{
  assert.match(page,/MAX_IMPORT_FEATURES=5000/);
  assert.match(page,/MAX_EXPANDED_TEXT=30\*1024\*1024/);
  assert.match(page,/features\.length\+imported\.length>MAX_IMPORT_FEATURES/);
  assert.match(page,/out\.length>MAX_IMPORT_FEATURES/);
  assert.doesNotMatch(page,/out\.length>=5000\)break/);
  assert.doesNotMatch(page,/features=features\.concat\(imported\)\.slice\(0,5000\)/);
});

test("polygon holes are imported, rendered and exported in GeoJSON and KML",()=>{
  assert.match(page,/coords\|\|\[\]\)\.slice\(1\)/);
  assert.match(page,/innerBoundaryIs/);
  assert.match(page,/f\.holes\|\|\[\]/);
  assert.match(page,/coordinates:f\.type==="point"/);
  assert.match(page,/ringIndex===0\?"الخارجية":"الثقب "/);
});

test("selected polygon details and copied coordinates include interior rings",()=>{
  assert.match(page,/الثقوب الداخلية/);
  assert.match(page,/const rings=f\.type==="polygon"/);
  assert.match(page,/الحلقة الخارجية/);
});

test("large geometry vertex counts and compressed KMZ expansion are bounded",()=>{
  assert.match(page,/MAX_IMPORT_VERTICES=100000/);
  assert.match(page,/vertexCount\(features\)\+vertexCount\(imported\)>MAX_IMPORT_VERTICES/);
  assert.match(page,/entry\._data&&Number\(entry\._data\.uncompressedSize\)>MAX_EXPANDED_TEXT/);
  assert.match(page,/textContent\.length>MAX_EXPANDED_TEXT/);
});


test("manual drawing obeys the same workspace feature and vertex limits as imports",()=>{
  assert.match(page,/function workspaceVertexCount\(\)/);
  assert.match(page,/features\.length>=MAX_IMPORT_FEATURES/);
  assert.match(page,/workspaceVertexCount\(\)\+coordinates\.length>MAX_IMPORT_VERTICES/);
  assert.match(page,/workspaceVertexCount\(\)\+draft\.length\+1>MAX_IMPORT_VERTICES/);
  assert.match(page,/100 ألف نقطة إحداثية/);
});


test("selecting a feature updates existing map layers without rebuilding the full map",()=>{
  assert.match(page,/layer\.featureId=f\.id/);
  assert.match(page,/row\.dataset\.featureId=f\.id/);
  const match=page.match(/function select\(featureId\)\{([\s\S]*?)\n\}/);
  assert.ok(match,"select handler exists");
  assert.match(match[1],/layer\.setStyle\(/);
  assert.match(match[1],/querySelectorAll\("\.feature"\)/);
  assert.doesNotMatch(match[1],/render\(\)/);
});
