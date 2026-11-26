"use strict";
const test=require("node:test");const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const adapter=require("../src/providers/aviation/airplanes-live/adapter.js");
test("normalizes ADS-B aircraft and preserves missing values",()=>{
 const rows=adapter.normalize({ac:[{hex:"abc123",flight:" SV 123 ",lat:24.7,lon:46.6,alt_baro:32000,gs:430,track:120,seen:2,t:"A320"},{hex:"bad",lat:null,lon:1}]});
 assert.equal(rows.length,1);assert.equal(rows[0].flight,"SV 123");assert.equal(rows[0].altitudeFt,32000);assert.equal(rows[0].aircraftType,"A320");assert.equal(rows[0].registration,null);
});
test("rejects invalid coordinates before requesting",async()=>{
 await assert.rejects(()=>adapter.fetchNearby(95,0,{fetch:()=>{throw Error("must not call")}}),/إحداثيات/);
});
test("clamps radius to documented safe UI range",async()=>{
 let called="";await adapter.fetchNearby(24,46,{distanceKm:999,fetch:async url=>{called=url;return {ok:true,json:async()=>({ac:[]})}}});
 assert.match(called,/\/250$/);
});
test("air traffic page exposes map, aircraft detail and refresh controls",()=>{
 const page=fs.readFileSync(path.join(__dirname,"../aviation/index.html"),"utf8");
 for(const id of ["map","lat","lon","range","interval","locate","refresh","list","detail"])assert.match(page,new RegExp('id="'+id+'"'));
 assert.match(page,/AirTrafficAdapter.fetchNearby/);assert.match(page,/ADS-B/);assert.match(page,/الرحلات المجدولة/);
});
