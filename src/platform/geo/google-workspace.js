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
    const closeRing=ring=>{
      const result=ring.map(point);
      if(result.some(p=>!p))return null;
      if(result.length>1&&result[0].lat===result[result.length-1].lat&&result[0].lon===result[result.length-1].lon)result.pop();
      return result.length>=3?result:null;
    };
    let holes=[];
    if(feature.type==="polygon"){
      if(points.length>1&&points[0].lat===points[points.length-1].lat&&points[0].lon===points[points.length-1].lon)points.pop();
      if(points.length<3)return null;
      const rawHoles=Array.isArray(feature.holes)?feature.holes:[];
      holes=rawHoles.map(closeRing);
      if(holes.some(ring=>!ring))return null;
    }
    return {id:String(feature.id||"feature").slice(0,80),
      name:String(feature.name||"عنصر جغرافي").slice(0,160),type:feature.type,coordinates:points,...(feature.type==="polygon"?{holes}:{})};
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
  function distanceM(a,b){
    const rad=Math.PI/180,lat1=a.lat*rad,lat2=b.lat*rad,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
    const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function measureFeature(feature){
    const f=normalizeFeature(feature);if(!f)return null;
    const pts=f.coordinates;let perimeterM=0;
    for(let i=1;i<pts.length;i++)perimeterM+=distanceM(pts[i-1],pts[i]);
    if(f.type==="point")return {lengthM:0,perimeterM:null,areaM2:null};
    if(f.type==="polygon"){
      const ringMetrics=ring=>{
        let perimeter=0,sum=0;
        for(let i=0;i<ring.length;i++){
          const a=ring[i],b=ring[(i+1)%ring.length];
          perimeter+=distanceM(a,b);
          sum+=(b.lon-a.lon)*Math.PI/180*(2+Math.sin(a.lat*Math.PI/180)+Math.sin(b.lat*Math.PI/180));
        }
        return {perimeter,area:Math.abs(sum)*6371008.8*6371008.8/2};
      };
      const outer=ringMetrics(pts),inner=(f.holes||[]).map(ringMetrics);
      perimeterM=outer.perimeter+inner.reduce((sum,r)=>sum+r.perimeter,0);
      const areaM2=Math.max(0,outer.area-inner.reduce((sum,r)=>sum+r.area,0));
      return {lengthM:null,perimeterM,areaM2};
    }
    return {lengthM:perimeterM,perimeterM:null,areaM2:null};
  }
  function xml(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
  function toKml(features){
    const valid=(Array.isArray(features)?features:[]).map(normalizeFeature).filter(Boolean);
    const placemarks=valid.map(f=>{
      const coords=f.coordinates.map(p=>p.lon+","+p.lat+",0").join(" ");
      let geometry="";
      if(f.type==="point")geometry="<Point><coordinates>"+coords+"</coordinates></Point>";
      if(f.type==="line")geometry="<LineString><tessellate>1</tessellate><coordinates>"+coords+"</coordinates></LineString>";
      if(f.type==="polygon"){
        const toRing=points=>points.concat([points[0]]).map(p=>p.lon+","+p.lat+",0").join(" ");
        const outer="<outerBoundaryIs><LinearRing><coordinates>"+toRing(f.coordinates)+"</coordinates></LinearRing></outerBoundaryIs>";
        const inner=(f.holes||[]).map(ring=>"<innerBoundaryIs><LinearRing><coordinates>"+toRing(ring)+"</coordinates></LinearRing></innerBoundaryIs>").join("");
        geometry="<Polygon>"+outer+inner+"</Polygon>";
      }
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
  function toGeoJson(features){
    const valid=(Array.isArray(features)?features:[]).map(normalizeFeature).filter(Boolean);
    return {type:"FeatureCollection",features:valid.map(f=>({
      type:"Feature",properties:{name:f.name,source:"Marsed Saudi"},
      geometry:{type:f.type==="point"?"Point":f.type==="line"?"LineString":"Polygon",
        coordinates:f.type==="point"?[f.coordinates[0].lon,f.coordinates[0].lat]:
          f.type==="line"?f.coordinates.map(p=>[p.lon,p.lat]):
          [f.coordinates,...(f.holes||[])].map(ring=>ring.concat([ring[0]]).map(p=>[p.lon,p.lat]))}
    }))};
  }
  function fromGeoJson(input,makeId){
    const data=typeof input==="string"?JSON.parse(input):input,out=[];
    const nextId=typeof makeId==="function"?makeId:()=> "geojson-"+(out.length+1);
    function addGeometry(geometry,name){
      if(!geometry||!geometry.type)return;
      const coords=geometry.coordinates;
      const convert=arr=>Array.isArray(arr)?arr.map(pair=>Array.isArray(pair)&&pair.length>=2?{lat:pair[1],lon:pair[0]}:null):[];
      if(geometry.type==="GeometryCollection"){
        (geometry.geometries||[]).forEach((g,i)=>addGeometry(g,name+" ("+(i+1)+")"));return;
      }
      let type,points,holes=[];
      if(geometry.type==="Point"){type="point";points=convert([coords]);}
      else if(geometry.type==="MultiPoint"){(coords||[]).forEach((p,i)=>addGeometry({type:"Point",coordinates:p},name+" ("+(i+1)+")"));return;}
      else if(geometry.type==="LineString"){type="line";points=convert(coords);}
      else if(geometry.type==="MultiLineString"){(coords||[]).forEach((p,i)=>addGeometry({type:"LineString",coordinates:p},name+" ("+(i+1)+")"));return;}
      else if(geometry.type==="Polygon"){type="polygon";points=convert(coords&&coords[0]);holes=(coords||[]).slice(1).map(convert);}
      else if(geometry.type==="MultiPolygon"){(coords||[]).forEach((p,i)=>addGeometry({type:"Polygon",coordinates:p},name+" ("+(i+1)+")"));return;}
      else return;
      const feature=normalizeFeature({id:nextId(),name,type,coordinates:points,...(type==="polygon"?{holes}:{})});
      if(feature){out.push(feature);if(out.length>5000)throw new Error("ملف GeoJSON يحتوي على أكثر من 5000 عنصر؛ قسّمه إلى ملفات أصغر.");}
    }
    function visit(item){
      if(!item)return;
      if(item.type==="FeatureCollection"){(item.features||[]).forEach(visit);return;}
      if(item.type==="Feature"){const props=item.properties||{};addGeometry(item.geometry,String(props.name||props.title||"عنصر GeoJSON"));return;}
      addGeometry(item,String(item.name||"عنصر GeoJSON"));
    }
    visit(data);return out;
  }
  return {point,normalizeFeature,centroid,mapsUrl,earthUrl,directionsUrl,toKml,parseCoordinateText,measureFeature,toGeoJson,fromGeoJson};
});
