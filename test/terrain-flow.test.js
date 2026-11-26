"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Flow=require("../src/platform/geo/terrain-flow.js");

const grid={rows:3,cols:3,cellSizeXM:90,cellSizeYM:90,elevations:[10,10,10,10,0,10,10,10,10]};

test("normalizes a rectangular elevation grid and preserves missing values",()=>{
 const normalized=Flow.normalizeGrid({...grid,elevations:[[10,9,8],[7,null,5],[4,3,2]]});
 assert.equal(normalized.elevations.length,9);
 assert.equal(normalized.elevations[4],null);
 assert.equal(Flow.normalizeGrid({...grid,elevations:[1,2]}),null);
 assert.equal(Flow.normalizeGrid({...grid,cellSizeXM:0}),null);
 assert.equal(Flow.normalizeGrid({...grid,rows:30,cols:30,elevations:Array(900).fill(1)}),null);
});

test("D8 routes each valid cell only to a strictly lower neighbor",()=>{
 const result=Flow.analyze({...grid,elevations:[9,8,7,8,7,6,7,6,5]});
 assert.ok(result);
 for(const cell of result.cells){
  if(cell.downstreamIndex===null)continue;
  assert.ok(result.cells[cell.downstreamIndex].elevationM<cell.elevationM);
  assert.ok(cell.slopeRatio>0);
 }
});

test("a closed local depression is flagged rather than silently filled",()=>{
 const result=Flow.analyze(grid);
 assert.deepEqual(result.localSinkIndices,[4]);
 assert.equal(result.cells[4].elevationM,0);
 assert.equal(result.cells[4].downstreamIndex,null);
});

test("flow accumulation conserves upstream cell counts at a central pit",()=>{
 const result=Flow.analyze(grid);
 assert.equal(result.cells[4].flowAccumulation,9);
 assert.equal(result.cells[4].isChannel,true);
 assert.equal(result.cells[4].isBoundary,false);
});

test("channel threshold is configurable and defaults to eight cells",()=>{
 const result=Flow.analyze(grid);
 assert.equal(result.channelThreshold,8);
 assert.equal(result.cells[4].isChannel,true);
 const stricter=Flow.analyze(grid,{channelThreshold:10});
 assert.equal(stricter.cells[4].isChannel,false);
});

test("missing DEM cells remain unavailable and receive no flow accumulation",()=>{
 const result=Flow.analyze({...grid,elevations:[10,10,10,10,null,10,10,10,10]});
 assert.equal(result.missingCellCount,1);
 assert.equal(result.cells[4].elevationM,null);
 assert.equal(result.cells[4].flowAccumulation,null);
 assert.equal(result.cells[4].downstreamIndex,null);
});

test("downstream tracing ends at a labelled local sink",()=>{
 const result=Flow.analyze(grid);
 const trace=Flow.traceDownstream(result,0);
 assert.ok(trace.indices.includes(4));
 assert.equal(trace.termination,"local_sink");
 assert.equal(trace.complete,true);
});

test("downstream tracing rejects invalid starts and bounds step counts",()=>{
 const result=Flow.analyze(grid);
 assert.equal(Flow.traceDownstream(result,99),null);
 assert.equal(Flow.traceDownstream(result,4).termination,"local_sink");
 const limited=Flow.traceDownstream(result,0,1);
 assert.equal(limited.termination,"step_limit");
 assert.equal(limited.complete,false);
});

test("analysis reports methodological limits explicitly",()=>{
 const result=Flow.analyze(grid);
 assert.ok(result.limitations.some(item=>item.includes("depression")));
 assert.ok(result.limitations.some(item=>item.includes("infiltration")));
 assert.ok(result.limitations.some(item=>item.includes("Boundary")));
});

test("invalid grids and all-missing grids fail safely",()=>{
 assert.equal(Flow.analyze(null),null);
 const result=Flow.analyze({...grid,elevations:Array(9).fill(null)});
 assert.equal(result.validCellCount,0);
 assert.equal(result.channelCellIndices.length,0);
 assert.equal(result.localSinkIndices.length,0);
});
