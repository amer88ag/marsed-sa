const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../src/services/hydrology/d8.js");

test("validates rectangular DEM grids and rejects malformed input", () => {
  assert.throws(() => H.validateGrid([[1, 2], [3]]), TypeError);
  assert.throws(() => H.validateGrid([[null, null], [null, null]]), TypeError);
  assert.throws(() => H.conditionDepressions([[1, 2], [3, 4]]), TypeError);
});

test("Priority-Flood raises an enclosed depression and reports conditioning", () => {
  const dem = [
    [10, 10, 10, 10, 10],
    [10, 1, 1, 1, 10],
    [10, 1, 0, 1, 10],
    [10, 1, 1, 1, 10],
    [10, 10, 10, 10, 10]
  ];
  const result = H.conditionDepressions(dem, { epsilon_m: 0.001 });
  assert.ok(result.elevation[2][2] > 10);
  assert.ok(result.raised_cells > 0);
  assert.ok(result.max_fill_m > 10);
  assert.equal(result.valid_cells, 25);
});

test("D8 routing and accumulation process every valid cell without cycles", () => {
  const dem = [
    [9, 9, 9, 9, 9],
    [9, 8, 7, 6, 9],
    [9, 7, 5, 5, 9],
    [9, 6, 4, 3, 9],
    [9, 9, 9, 9, 9]
  ];
  const result = H.analyse(dem, { cell_size_x_m: 90, cell_size_y_m: 90, resolution_m: 90 });
  assert.equal(result.flow.processed_cells, 25);
  const max = Math.max(...result.flow.accumulation.flat());
  assert.ok(max > 1);
  assert.equal(result.metadata.algorithm, "Priority-Flood + D8");
  assert.equal(result.metadata.resolution_m, 90);
});

test("NoData cells are excluded from flow and accumulation", () => {
  const dem = [
    [5, 5, 5, 5, 5],
    [5, 4, null, 4, 5],
    [5, 3, 2, 3, 5],
    [5, 4, 4, 4, 5],
    [5, 5, 5, 5, 5]
  ];
  const result = H.analyse(dem, { cell_size_x_m: 90, cell_size_y_m: 90 });
  assert.equal(result.flow.processed_cells, 24);
  assert.equal(result.routing.valid[1][2], false);
  assert.equal(result.routing.direction[1][2], H.NODATA);
});

test("watershed delineation traces upstream contributors to a valid outlet", () => {
  const dem = [
    [8, 8, 8, 8, 8],
    [8, 7, 6, 5, 8],
    [8, 6, 4, 3, 8],
    [8, 5, 3, 2, 8],
    [8, 8, 8, 8, 8]
  ];
  const result = H.analyse(dem, { cell_size_x_m: 90, cell_size_y_m: 90 });
  const outlet = H.delineateWatershed(result.routing, result.flow, 4, 4);
  assert.ok(outlet.cell_count >= 1);
  assert.equal(outlet.mask[4][4], true);
  assert.equal(outlet.contributing_area_m2, outlet.cell_count * 8100);
});

test("watershed rejects a NoData pour point and an out-of-grid point", () => {
  const dem = [
    [5, 5, 5, 5, 5],
    [5, 4, null, 4, 5],
    [5, 3, 2, 3, 5],
    [5, 4, 4, 4, 5],
    [5, 5, 5, 5, 5]
  ];
  const result = H.analyse(dem, { cell_size_x_m: 90, cell_size_y_m: 90 });
  assert.throws(() => H.delineateWatershed(result.routing, result.flow, 1, 2), TypeError);
  assert.throws(() => H.delineateWatershed(result.routing, result.flow, 8, 8), RangeError);
});

test("zero and positive epsilon settings are explicit and validated", () => {
  const dem = Array.from({ length: 3 }, () => [3, 3, 3]);
  assert.equal(H.conditionDepressions(dem, { epsilon_m: 0 }).epsilon_m, 0);
  assert.throws(() => H.conditionDepressions(dem, { epsilon_m: -1 }), RangeError);
});
