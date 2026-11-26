(function(root){
"use strict";
const BASE="https://api.airplanes.live/v2";
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function normalize(raw){
 const rows=Array.isArray(raw&&raw.ac)?raw.ac:[];
 return rows.filter(a=>finite(a.lat)!==null&&finite(a.lon)!==null).map(a=>({
  hex:String(a.hex||"").toLowerCase(),flight:String(a.flight||"").trim()||"غير معروف",
  registration:String(a.r||"").trim()||null,latitude:finite(a.lat),longitude:finite(a.lon),
  altitudeFt:finite(a.alt_baro),groundSpeedKt:finite(a.gs),trackDeg:finite(a.track),
  verticalRateFpm:finite(a.baro_rate),squawk:String(a.squawk||"")||null,
  category:String(a.category||"")||null,aircraftType:String(a.t||"")||null,
  seenSeconds:finite(a.seen),onGround:a.alt_baro==="ground"||a.alt_baro===-1
 }));
}
async function fetchNearby(lat,lon,options){
 const o=options||{},distance=Math.max(10,Math.min(250,Number(o.distanceKm)||100));
 if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon))||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error("إحداثيات الموقع غير صحيحة");
 const url=BASE+"/point/"+encodeURIComponent(lat)+"/"+encodeURIComponent(lon)+"/"+distance;
 const response=await (o.fetch||fetch)(url,{headers:{Accept:"application/json"},signal:o.signal});
 if(!response.ok){const e=new Error("HTTP "+response.status);e.status=response.status;throw e}
 const data=await response.json();
 return {aircraft:normalize(data),source:"Airplanes.live ADS-B",retrievedAt:new Date().toISOString(),total:finite(data.total)||0,center:{lat:Number(lat),lon:Number(lon)},distanceKm:distance};
}
return {normalize,fetchNearby};
})(typeof globalThis!=="undefined"?globalThis:this);
