// Research-stage raster hydrology primitives for a contiguous DEM grid.
// Input elevations are metres in a projected/equal-area grid, rows north-to-south.
// No raster downloader or reprojection is included: callers must supply a validated DEM.
// Priority-Flood conditioning + D8 routing + contributing-cell accumulation.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HydrologyD8 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DIRS = [
    [-1, 0], [-1, 1], [0, 1], [1, 1],
    [1, 0], [1, -1], [0, -1], [-1, -1]
  ];
  const NODATA = -1;

  function validateGrid(grid) {
    if (!Array.isArray(grid) || grid.length < 3 || !Array.isArray(grid[0]) || grid[0].length < 3)
      throw new TypeError("DEM must be a rectangular grid of at least 3×3 cells");
    const cols = grid[0].length;
    if (!grid.every(row => Array.isArray(row) && row.length === cols))
      throw new TypeError("DEM rows must have equal lengths");
    if (!grid.some(row => row.some(Number.isFinite)))
      throw new TypeError("DEM has no valid elevation cells");
    return { rows: grid.length, cols: cols };
  }

  function MinHeap() { this.items = []; }
  MinHeap.prototype.push = function (item) {
    const a = this.items; a.push(item); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].z <= item.z) break; a[i] = a[p]; i = p; }
    a[i] = item;
  };
  MinHeap.prototype.pop = function () {
    const a = this.items; if (!a.length) return null;
    const root = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1; if (c >= a.length) break;
        if (c + 1 < a.length && a[c + 1].z < a[c].z) c++;
        if (a[c].z >= last.z) break;
        a[i] = a[c]; i = c;
      }
      a[i] = last;
    }
    return root;
  };

  function inBounds(r, c, rows, cols) { return r >= 0 && c >= 0 && r < rows && c < cols; }
  function isEdge(r, c, rows, cols) { return r === 0 || c === 0 || r === rows - 1 || c === cols - 1; }

  // Epsilon is a tiny documented conditioning gradient used only to resolve flats.
  // It is not a claim about the real terrain and must be reported with derived results.
  function conditionDepressions(dem, options) {
    const shape = validateGrid(dem), rows = shape.rows, cols = shape.cols;
    const epsilon = options && options.epsilon_m !== undefined ? options.epsilon_m : 0.001;
    if (!Number.isFinite(epsilon) || epsilon < 0) throw new RangeError("epsilon_m must be a finite non-negative number");
    const filled = dem.map(row => row.map(v => Number.isFinite(v) ? v : null));
    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
    const heap = new MinHeap(); let validCells = 0, raisedCells = 0, maxFillM = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!Number.isFinite(dem[r][c])) continue;
      validCells++;
      const touchesNoData = DIRS.some(d => {
        const nr = r + d[0], nc = c + d[1];
        return !inBounds(nr, nc, rows, cols) || !Number.isFinite(dem[nr][nc]);
      });
      if (isEdge(r, c, rows, cols) || touchesNoData) {
        visited[r][c] = true;
        heap.push({ r: r, c: c, z: dem[r][c] });
      }
    }
    while (heap.items.length) {
      const current = heap.pop();
      for (const d of DIRS) {
        const nr = current.r + d[0], nc = current.c + d[1];
        if (!inBounds(nr, nc, rows, cols) || visited[nr][nc] || !Number.isFinite(dem[nr][nc])) continue;
        visited[nr][nc] = true;
        const nextZ = Math.max(dem[nr][nc], current.z + epsilon);
        filled[nr][nc] = nextZ;
        const raise = nextZ - dem[nr][nc];
        if (raise > 0) { raisedCells++; maxFillM = Math.max(maxFillM, raise); }
        heap.push({ r: nr, c: nc, z: nextZ });
      }
    }
    return { elevation: filled, rows: rows, cols: cols, valid_cells: validCells,
      raised_cells: raisedCells, max_fill_m: maxFillM, epsilon_m: epsilon };
  }

  function routeD8(conditioned, cellSizeX, cellSizeY) {
    const dem = conditioned.elevation || conditioned;
    const shape = validateGrid(dem), rows = shape.rows, cols = shape.cols;
    const dx = Number.isFinite(cellSizeX) && cellSizeX > 0 ? cellSizeX : 90;
    const dy = Number.isFinite(cellSizeY) && cellSizeY > 0 ? cellSizeY : dx;
    const direction = Array.from({ length: rows }, () => Array(cols).fill(NODATA));
    const valid = dem.map(row => row.map(Number.isFinite));
    const downstream = Array(rows * cols).fill(-1);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!Number.isFinite(dem[r][c])) continue;
      let best = null;
      for (let k = 0; k < DIRS.length; k++) {
        const nr = r + DIRS[k][0], nc = c + DIRS[k][1];
        if (!inBounds(nr, nc, rows, cols) || !Number.isFinite(dem[nr][nc])) continue;
        const drop = dem[r][c] - dem[nr][nc];
        if (drop <= 0) continue;
        const distance = DIRS[k][0] && DIRS[k][1] ? Math.hypot(dx, dy) : (DIRS[k][0] ? dy : dx);
        const slope = drop / distance;
        if (!best || slope > best.slope) best = { k: k, slope: slope, index: nr * cols + nc };
      }
      if (best) { direction[r][c] = best.k; downstream[r * cols + c] = best.index; }
    }
    return { direction: direction, downstream: downstream, valid: valid, rows: rows, cols: cols,
      cell_size_x_m: dx, cell_size_y_m: dy };
  }

  function accumulateFlow(routing, dem) {
    const rows = routing.rows, cols = routing.cols, n = rows * cols;
    const valid = dem || null, indegree = new Int32Array(n), accumulation = new Float64Array(n);
    const upstream = Array.from({ length: n }, () => []);
    let validCount = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      if (valid && !Number.isFinite(valid[r][c])) continue;
      validCount++; accumulation[i] = 1;
      const to = routing.downstream[i];
      if (to >= 0) { indegree[to]++; upstream[to].push(i); }
    }
    const queue = [];
    for (let i = 0; i < n; i++) if (accumulation[i] > 0 && indegree[i] === 0) queue.push(i);
    let head = 0, processed = 0;
    while (head < queue.length) {
      const i = queue[head++]; processed++;
      const to = routing.downstream[i];
      if (to >= 0) {
        accumulation[to] += accumulation[i];
        indegree[to]--;
        if (indegree[to] === 0) queue.push(to);
      }
    }
    if (processed !== validCount) throw new Error("D8 routing contains a cycle or unresolved flow dependency");
    const matrix = [];
    for (let r = 0; r < rows; r++) matrix.push(Array.from(accumulation.slice(r * cols, (r + 1) * cols)));
    return { accumulation: matrix, upstream: upstream, processed_cells: processed };
  }

  function delineateWatershed(routing, accumulationResult, row, col) {
    const rows = routing.rows, cols = routing.cols;
    if (!Number.isInteger(row) || !Number.isInteger(col) || !inBounds(row, col, rows, cols))
      throw new RangeError("pour point is outside the DEM grid");
    const target = row * cols + col;
    if (!routing.valid[row][col]) throw new TypeError("pour point is NoData");
    const seen = new Uint8Array(rows * cols), stack = [target], cells = [];
    seen[target] = 1;
    while (stack.length) {
      const i = stack.pop(); cells.push(i);
      for (const from of accumulationResult.upstream[i]) if (!seen[from]) { seen[from] = 1; stack.push(from); }
    }
    const mask = Array.from({ length: rows }, () => Array(cols).fill(false));
    cells.forEach(i => { mask[Math.floor(i / cols)][i % cols] = true; });
    return { mask: mask, cell_count: cells.length, pour_point: { row: row, col: col },
      contributing_area_m2: cells.length * routing.cell_size_x_m * routing.cell_size_y_m };
  }

  function analyse(dem, options) {
    const conditioned = conditionDepressions(dem, options);
    const routing = routeD8(conditioned, options && options.cell_size_x_m, options && options.cell_size_y_m);
    const flow = accumulateFlow(routing, conditioned.elevation);
    return { conditioned: conditioned, routing: routing, flow: flow,
      metadata: { algorithm: "Priority-Flood + D8", source: options && options.source || "caller-supplied DEM",
        resolution_m: options && options.resolution_m || null,
        epsilon_m: conditioned.epsilon_m,
        valid_cells: conditioned.valid_cells,
        raised_cells: conditioned.raised_cells,
        max_fill_m: conditioned.max_fill_m,
        caveat: "Research-stage terrain analysis; not a validated flood forecast." } };
  }

  return { DIRS, NODATA, validateGrid, conditionDepressions, routeD8, accumulateFlow, delineateWatershed, analyse };
});
