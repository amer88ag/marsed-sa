(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.GoogleGeoWorkspace=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  function point(value){
    if(!value||value.lat==null||value.lon==null||typeof value.lat==="boolean"||typeof value.lon==="boolean")return null;
    if(typeof value.lat==="string"&&!value.lat.trim()||typeof value.lon==="string"&&!value.lon.trim())return null;
    const lat=Number(value.lat),lon=Number(value.lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180?{lat,lon}:null;
  }
  function normalizeFeature(feature){
    if(!feature||!["point","line","polygon"].includes(feature.type))return null;
    const coords=Array.isArray(feature.coordinates)?feature.coordinates:[];
    const points=coords.map(point);
    if(points.some(p=>!p))return null;
    if(feature.type==="point"&&points.length!==1)return null;
    if(feature.type==="line"&&points.length<2)return null;
    if(feature.type==="polygon"){
      if(points.length>1&&points[0].lat===points[points.length-1].lat&&points[0].lon===points[points.length-1].lon)points.pop();
      if(points.length<3)return null;
    }
    return {id:String(feature.id||("feature-"+Math.random().toString(36).slice(2,9)),).slice(0,80),
      name:String(feature.name||"عنصر جغرافي").slice(0,160),type:feature.type,coordinates:points};
  }
  function centroid(feature){
    const f=normalizeFeature(feature);if(!f)return null;
    const pts=f.coordinates;
    return {lat:pts.reduce((s,p)=>s+p.lat,0)/pts.length,lon:pts.reduce((s,p)=>s+p.lon,0)/pts.length};
  }
  function mapsUrl(feature){
    const p=centroid(feature);return p?"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(p.lat+","+p.lon):null;
  }
  function earthUrl(feature){
    const p=centroid(feature);return p?"https://earth.google.com/web/search/"+encodeURIComponent(p.lat+","+p.lon):null;
  }
  function directionsUrl(feature){
    const f=normalizeFeature(feature);if(!f||f.type!=="line")return null;
    const a=f.coordinates[0],b=f.coordinates[f.coordinates.length-1];
    return "https://www.google.com/maps/dir/?api=1&origin="+encodeURIComponent(a.lat+","+a.lon)+"&destination="+encodeURIComponent(b.lat+","+b.lon);
  }
  function xml(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
  function toKml(features){
    const valid=(Array.isArray(features)?features:[]).map(normalizeFeature).filter(Boolean);
    const placemarks=valid.map(f=>{
      const coords=f.coordinates.map(p=>p.lon+","+p.lat+",0").join(" ");
      let geometry="";
      if(f.type==="point")geometry="<Point><coordinates>"+coords+"</coordinates></Point>";
      if(f.type==="line")geometry="<LineString><tessellate>1</tessellate><coordinates>"+coords+"</coordinates></LineString>";
      if(f.type==="polygon"){const ring=f.coordinates.concat([f.coordinates[0]]).map(p=>p.lon+","+p.lat+",0").join(" ");geometry="<Polygon><outerBoundaryIs><LinearRing><coordinates>"+ring+"</coordinates></LinearRing></outerBoundaryIs></Polygon>";}
      return "<Placemark><name>"+xml(f.name)+"</name><description>"+xml(f.type)+"</description>"+geometry+"</Placemark>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>مساحة العمل الجغرافية</name>'+placemarks+"</Document></kml>";
  }
  function parseCoordinateText(value){
    const tokens=String(value||"").trim().split(/\s+/).filter(Boolean);
    const points=[];
    for(const token of tokens){
      const parts=token.split(",");
      if(parts.length<2)return null;
      const p=point({lon:parts[0],lat:parts[1]});if(!p)return null;points.push(p);
    }
    return points;
  }
  return {point,normalizeFeature,centroid,mapsUrl,earthUrl,directionsUrl,toKml,parseCoordinateText};
});
