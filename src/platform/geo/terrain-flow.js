(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.TerrainFlow=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const MAX_CELLS=625;
  const NEIGHBORS=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

  function normalizeGrid(input){
    if(!input||!Number.isInteger(input.rows)||!Number.isInteger(input.cols)||
      input.rows<3||input.cols<3||input.rows*input.cols>MAX_CELLS)return null;
    const dx=Number(input.cellSizeXM),dy=Number(input.cellSizeYM);
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||dx<=0||dy<=0)return null;
    let values=input.elevations;
    if(Array.isArray(values)&&values.length===input.rows&&values.every(Array.isArray))
      values=values.flat();
    if(!Array.isArray(values)||values.length!==input.rows*input.cols)return null;
    const elevations=values.map(value=>{
      if(value===null||value===undefined||value===""||typeof value==="boolean")return null;
      const number=Number(value);
      return Number.isFinite(number)?number:null;
    });
    return {rows:input.rows,cols:input.cols,cellSizeXM:dx,cellSizeYM:dy,elevations};
  }

  function createGrid(center,rows,cols,spacingM){
    const lat=Number(center&&center.lat),lon=Number(center&&center.lon);
    rows=Number.isInteger(rows)?rows:9;cols=Number.isInteger(cols)?cols:9;
    spacingM=Number(spacingM);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat > 90||lon < -180||lon > 180||
      rows<3||cols<3||rows*cols>100||rows%2===0||cols%2===0||
      !Number.isFinite(spacingM)||spacingM<90||spacingM>1000)return null;
    const metersPerDegreeLat=111320;
    const metersPerDegreeLon=111320*Math.cos(lat*Math.PI/180);
    if(Math.abs(metersPerDegreeLon)<1)return null;
    const points=[];
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      const north=(Math.floor(rows/2)-row)*spacingM;
      const east=(col-Math.floor(cols/2))*spacingM;
      points.push({lat:lat+north/metersPerDegreeLat,lon:lon+east/metersPerDegreeLon});
    }
    if(points.some(p=>p.lat < -90||p.lat > 90||p.lon < -180||p.lon > 180))return null;
    return {rows,cols,cellSizeXM:spacingM,cellSizeYM:spacingM,points};
  }

  function elevationUrl(points){
    if(!Array.isArray(points)||points.length<9||points.length>100)return null;
    if(!points.every(p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&
      p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180))return null;
    const lat=points.map(p=>String(Number(p.lat.toFixed(6)))).join(",");
    const lon=points.map(p=>String(Number(p.lon.toFixed(6)))).join(",");
    return "https://api.open-meteo.com/v1/elevation?latitude="+encodeURIComponent(lat)+
      "&longitude="+encodeURIComponent(lon);
  }

  function analyze(input,options){
    const grid=normalizeGrid(input);
    if(!grid)return null;
    const threshold=options&&Number.isInteger(options.channelThreshold)&&options.channelThreshold>0
      ?options.channelThreshold:8;
    const count=grid.rows*grid.cols;
    const downstream=Array(count).fill(null),slope=Array(count).fill(null);
    const boundary=Array(count).fill(false),valid=grid.elevations.map(v=>v!==null);
    for(let r=0;r<grid.rows;r++)for(let c=0;c<grid.cols;c++){
      const index=r*grid.cols+c;
      if(!valid[index])continue;
      let bestDrop=0,bestIndex=null,bestSlope=0;
      for(const [dr,dc] of NEIGHBORS){
        const nr=r+dr,nc=c+dc;
        if(nr<0||nr>=grid.rows||nc<0||nc>=grid.cols){boundary[index]=true;continue}
        const next=nr*grid.cols+nc,height=grid.elevations[next];
        if(height===null)continue;
        const distance=Math.hypot(dc*grid.cellSizeXM,dr*grid.cellSizeYM);
        const drop=grid.elevations[index]-height;
        const grade=drop/distance;
        if(drop>0&&grade>bestSlope){bestDrop=drop;bestSlope=grade;bestIndex=next}
      }
      if(bestIndex!==null){downstream[index]=bestIndex;slope[index]=bestSlope}
    }
    // Every edge is strictly downhill, so descending elevation is a topological order.
    const order=Array.from({length:count},(_,i)=>i).filter(i=>valid[i])
      .sort((a,b)=>grid.elevations[b]-grid.elevations[a]||a-b);
    const accumulation=Array(count).fill(null);
    for(let i=0;i<count;i++)if(valid[i])accumulation[i]=1;
    for(const index of order){
      const next=downstream[index];
      if(next!==null)accumulation[next]+=accumulation[index];
    }
    const cells=grid.elevations.map((elevation,index)=>({
      index,row:Math.floor(index/grid.cols),col:index%grid.cols,elevationM:elevation,
      downstreamIndex:downstream[index],slopeRatio:slope[index],
      flowAccumulation:accumulation[index],
      isChannel:accumulation[index]!==null&&accumulation[index]>=threshold,
      isBoundary:boundary[index],
      isLocalSink:valid[index]&&downstream[index]===null&&!boundary[index]
    }));
    return {
      rows:grid.rows,cols:grid.cols,cellSizeXM:grid.cellSizeXM,cellSizeYM:grid.cellSizeYM,
      validCellCount:valid.filter(Boolean).length,missingCellCount:valid.length-valid.filter(Boolean).length,
      channelThreshold:threshold,cells,
      channelCellIndices:cells.filter(cell=>cell.isChannel).map(cell=>cell.index),
      localSinkIndices:cells.filter(cell=>cell.isLocalSink).map(cell=>cell.index),
      boundaryOutletIndices:cells.filter(cell=>cell.isBoundary&&cell.downstreamIndex===null).map(cell=>cell.index),
      limitations:["D8 single-direction routing","No depression filling or breaching","No infiltration, rainfall, soil, culvert or channel hydraulics","Boundary exits are truncated by the sampled grid","DEM resolution and vertical errors affect results"]
    };
  }

  function traceDownstream(result,startIndex,maxSteps){
    if(!result||!Array.isArray(result.cells)||!Number.isInteger(startIndex)||
      startIndex<0||startIndex>=result.cells.length||!result.cells[startIndex]||
      result.cells[startIndex].elevationM===null)return null;
    const limit=Number.isInteger(maxSteps)?Math.max(1,Math.min(maxSteps,result.cells.length)):result.cells.length;
    const path=[],seen=new Set();let index=startIndex,termination="step_limit";
    while(path.length<limit){
      if(seen.has(index)){termination="cycle_guard";break}
      seen.add(index);path.push(index);
      const next=result.cells[index].downstreamIndex;
      if(next===null){termination=result.cells[index].isLocalSink?"local_sink":result.cells[index].isBoundary?"grid_boundary":"no_lower_neighbor";break}
      index=next;
    }
    return {indices:path,termination,complete:termination!=="step_limit"&&termination!=="cycle_guard"};
  }

  return {MAX_CELLS,normalizeGrid,createGrid,elevationUrl,analyze,traceDownstream};
});
