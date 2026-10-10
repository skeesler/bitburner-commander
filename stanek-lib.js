/** stanek-lib.js — Stanek's Gift geometry, scoring and layout search. PURE: no `ns` anywhere, so
 *  stanek-lib.test.mjs can pin it down under Node, and importing it costs a script no RAM.
 *
 *  Every rule here is a port of the v3.0.1 source (src/CotMG/), confirmed against a live gift on
 *  2026-10-03 (6x5 grid, 24 fragment definitions — see bn13-design.md):
 *    - a fragment covers cell (x, y) of its rotated box per Fragment.fullAt (Fragment.ts:24-41);
 *    - it fits if root + rotated size stays inside the grid and nothing collides (StaneksGift.canPlace);
 *    - its neighbours are the 4-adjacent cells of its own cells, minus itself (Fragment.neighbors);
 *    - its effect is 1 + ln(highest+1)/60 x ((numCharge+1)/5)^0.07 x power x boost x nodeMult, where
 *      boost multiplies the power of every DISTINCT adjacent Booster (StaneksGift.effect,
 *      CotMG/formulas/effect.ts). Boosters themselves have no effect.
 */

export const BOOSTER_TYPE = 18;   // FragmentType.Booster, as fragmentDefinitions() reports it (live)

// Weighted wish lists by fragment ID. Weights say how much one unit of ln(effect) is worth to the
// plan; a fragment absent from a plan is never placed. IDs from the live table (bn13-design.md).
export const PLANS = {
  // Bladeburner: success chance runs on combat stats (dex/agi weigh most in contracts and ops),
  // and the Bladeburner fragment multiplies success chance directly — power 0.4, so it needs boosting.
  bb:     { 10: 1.0, 12: 0.6, 14: 1.0, 16: 1.0, 30: 2.0 },
  combat: { 10: 1, 12: 1, 14: 1, 16: 1 },
  hack:   { 0: 1.0, 5: 1.0, 6: 1.0, 7: 0.3 },
  money:  { 27: 1.0, 25: 0.6, 18: 0.3 },
};

/** Is cell (x, y), relative to the root, covered by `shape` at `rotation`? Port of Fragment.fullAt. */
export function fullAt(shape, rotation, x, y) {
  const w0 = shape[0].length, h0 = shape.length;
  const width = rotation % 2 === 0 ? w0 : h0, height = rotation % 2 === 0 ? h0 : w0;
  if (y < 0 || y >= height || x < 0 || x >= width) return false;
  let [sx, sy, mx, my] = [0, 0, 1, 1];
  if (rotation === 1) [sx, sy, mx, my] = [width - 1, 0, -1, 1];
  else if (rotation === 2) [sx, sy, mx, my] = [width - 1, height - 1, -1, -1];
  else if (rotation === 3) [sx, sy, mx, my] = [0, height - 1, 1, -1];
  let [qx, qy] = [sx + mx * x, sy + my * y];
  if (rotation % 2 === 1) [qx, qy] = [qy, qx];
  return !!shape[qy][qx];
}

/** The cells a shape covers at a rotation, relative to its root, plus its rotated size. */
export function shapeCells(shape, rotation) {
  const w = rotation % 2 === 0 ? shape[0].length : shape.length;
  const h = rotation % 2 === 0 ? shape.length : shape[0].length;
  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fullAt(shape, rotation, x, y)) cells.push([x, y]);
  return { cells, w, h };
}

/** Charge strength K, so that effect = 1 + K x power x boost. */
export function chargeK({ threads, numCharge = 100, nodeMult = 2 }) {
  return (Math.log(threads + 1) / 60) * Math.pow((numCharge + 1) / 5, 0.07) * nodeMult;
}

/** Score a layout: sum over placed non-boosters of weight x ln(1 + K x power x boost).
 *  `placed` = [{id, x, y, rotation, cells: [[x,y],...]}]; `defs` maps id -> definition. */
export function scoreLayout(placed, defs, weights, K) {
  const owner = new Map();   // "x,y" -> index into placed
  placed.forEach((p, i) => { for (const [cx, cy] of p.cells) owner.set(`${cx},${cy}`, i); });
  let total = 0;
  const detail = [];
  placed.forEach((p, i) => {
    const def = defs[p.id];
    if (def.type === BOOSTER_TYPE) return;
    const boosters = new Set();
    for (const [cx, cy] of p.cells) {
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        const j = owner.get(`${nx},${ny}`);
        if (j !== undefined && j !== i && defs[placed[j].id].type === BOOSTER_TYPE) boosters.add(j);
      }
    }
    let boost = 1;
    for (const j of boosters) boost *= defs[placed[j].id].power;
    const effect = 1 + K * def.power * boost;
    total += (weights[p.id] || 0) * Math.log(effect);
    detail.push({ id: p.id, boost, effect, boosters: boosters.size });
  });
  return { total, detail };
}

/** Find the best layout of a plan on a W x H grid.
 *
 *  Cell-ordered backtracking: take the first undecided cell in reading order and either leave it
 *  empty or put a piece there whose FIRST cell (reading order) lands on it — which enumerates every
 *  packing exactly once. Pieces: each wanted fragment at most once (they all have limit 1), boosters
 *  any number. A booster that touches no wanted fragment can't change the score, so the search
 *  refuses to place one with no wanted fragment possible beside it — that prune is what keeps 30
 *  cells and 8 booster shapes fast. `maxNodes` caps the work; the result says if it was hit.
 *
 *  `prune: false` turns the bound off — exhaustive, slow, and the cross-check the bound is
 *  verified against (stanek-lib.test.mjs --exhaustive).
 *
 *  defs: [{id, shape, type, power, limit}] (fragmentDefinitions()). Returns
 *  {placed, score, detail, nodes, complete}. */
export function bestLayout({ width, height, defs, weights, K, maxNodes = 5e6, maxBoosters = 4, prune = true }) {
  const byId = {};
  for (const d of defs) byId[d.id] = d;
  // Heaviest first: the search finds a strong layout early, so the bound below prunes harder.
  const wanted = defs.filter((d) => d.type !== BOOSTER_TYPE && (weights[d.id] || 0) > 0)
    .sort((a, b) => (weights[b.id] || 0) - (weights[a.id] || 0));
  const boosters = defs.filter((d) => d.type === BOOSTER_TYPE);

  // Every distinct orientation of a piece, as cells relative to its first (reading-order) cell.
  const orient = (d) => {
    const out = [], seen = new Set();
    for (let r = 0; r < 4; r++) {
      const { cells } = shapeCells(d.shape, r);
      cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const [fx, fy] = cells[0];
      const rel = cells.map(([x, y]) => [x - fx, y - fy]);
      const key = JSON.stringify(rel);
      if (seen.has(key)) continue;
      seen.add(key);
      // Root (top-left of the rotated box) relative to the first cell, for placeFragment.
      out.push({ rotation: r, rel, rootDx: -fx, rootDy: -fy });
    }
    return out;
  };
  const orients = {};
  for (const d of [...wanted, ...boosters]) orients[d.id] = orient(d);

  const grid = Array(width * height).fill(-1);
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? -2 : grid[y * width + x]);
  const placed = [];
  const used = new Set();
  let best = { score: -1, placed: [] }, nodes = 0, complete = true;

  const fits = (rel, x, y) => rel.every(([dx, dy]) => at(x + dx, y + dy) === -1);
  const put = (rel, x, y, v) => { for (const [dx, dy] of rel) grid[(y + dy) * width + (x + dx)] = v; };

  // Could a wanted fragment still end up next to these cells? True if any neighbour is a placed
  // wanted fragment or is still empty-and-undecided (index >= current cursor).
  const touchesWantedOrOpen = (cells, cursor) => cells.some(([cx, cy]) =>
    [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]].some(([nx, ny]) => {
      const v = at(nx, ny);
      if (v >= 0) return byId[placed[v].id].type !== BOOSTER_TYPE;
      return v === -1 && ny * width + nx > cursor;
    }));

  // BRANCH AND BOUND. The best any completion of this branch can score. Boosters cost 5 cells, so
  // the only boosters still to come are the ones that fit in the area left over once the unplaced
  // fragments are in. A placed fragment keeps its CURRENT boost and can gain at most those future
  // boosters; an unplaced one could touch every booster there is or will be. Any branch that has
  // given up room for a fragment, or for a booster, the best layout has gets cut.
  const area = {};
  for (const d of wanted) area[d.id] = shapeCells(d.shape, 0).cells.length;
  const boosterPower = boosters.length ? Math.max(...boosters.map((b) => b.power)) : 1;
  const boosterArea = boosters.length ? Math.min(...boosters.map((b) => shapeCells(b.shape, 0).cells.length)) : Infinity;
  const currentBoost = (p) => {
    const seen = new Set();
    for (const [cx, cy] of p.cells) for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
      const v = at(nx, ny);
      if (v >= 0 && byId[placed[v].id].type === BOOSTER_TYPE) seen.add(v);
    }
    let b = 1;
    for (const v of seen) b *= byId[placed[v].id].power;
    return b;
  };
  const upper = (cursor, boostersUsed) => {
    let open = 0;
    for (let i = cursor; i < grid.length; i++) if (grid[i] === -1) open++;
    const rest = wanted.filter((d) => !used.has(d.id))
      .map((d) => ({ a: area[d.id], w: weights[d.id] || 0, p: d.power }));
    const placedCore = placed.filter((p) => byId[p.id].type !== BOOSTER_TYPE)
      .map((p) => ({ w: weights[p.id] || 0, p: byId[p.id].power, b: currentBoost(p) }));
    // Try every count of future boosters: each one takes boosterArea cells away from the
    // fragments still to come. A completion that drops a light fragment to fit more boosters
    // around a heavy one (the money plan does exactly this) must still be under the bound.
    let bestBound = 0;
    const maxFuture = Math.max(0, Math.min(maxBoosters - boostersUsed, Math.floor(open / boosterArea)));
    for (let f = 0; f <= maxFuture; f++) {
      const futureBoost = Math.pow(boosterPower, f);
      const allBoost = Math.pow(boosterPower, boostersUsed + f);
      let bound = 0;
      for (const c of placedCore) bound += c.w * Math.log(1 + K * c.p * c.b * futureBoost);
      // Best fragments for the area left — a knapsack, tiny here (<= ~6 items, <= 30 cells).
      const cap = open - f * boosterArea;
      const value = rest.map((r) => r.w * Math.log(1 + K * r.p * allBoost));
      let dp = new Array(cap + 1).fill(0);
      rest.forEach((r, k) => {
        const next = dp.slice();
        for (let c = r.a; c <= cap; c++) next[c] = Math.max(next[c], dp[c - r.a] + value[k]);
        dp = next;
      });
      bound += dp[cap];
      if (bound > bestBound) bestBound = bound;
    }
    return bestBound;
  };

  const rec = (cursor, boostersUsed) => {
    if (++nodes > maxNodes) { complete = false; return; }
    while (cursor < grid.length && grid[cursor] !== -1) cursor++;
    if (prune && best.score >= 0 && upper(cursor, boostersUsed) <= best.score + 1e-12) return;
    if (cursor >= grid.length) {
      const s = scoreLayout(placed, byId, weights, K).total;
      if (s > best.score) best = { score: s, placed: placed.map((p) => ({ ...p })) };
      return;
    }
    const x = cursor % width, y = Math.floor(cursor / width);
    for (const d of wanted) {
      if (used.has(d.id)) continue;
      for (const o of orients[d.id]) {
        if (!fits(o.rel, x, y)) continue;
        const cells = o.rel.map(([dx, dy]) => [x + dx, y + dy]);
        put(o.rel, x, y, placed.length);
        placed.push({ id: d.id, x: x + o.rootDx, y: y + o.rootDy, rotation: o.rotation, cells });
        used.add(d.id);
        rec(cursor + 1, boostersUsed);
        used.delete(d.id);
        placed.pop();
        put(o.rel, x, y, -1);
        if (!complete) return;
      }
    }
    if (boostersUsed < maxBoosters) {
      for (const d of boosters) {
        for (const o of orients[d.id]) {
          if (!fits(o.rel, x, y)) continue;
          const cells = o.rel.map(([dx, dy]) => [x + dx, y + dy]);
          if (!touchesWantedOrOpen(cells, cursor)) continue;
          put(o.rel, x, y, placed.length);
          placed.push({ id: d.id, x: x + o.rootDx, y: y + o.rootDy, rotation: o.rotation, cells });
          rec(cursor + 1, boostersUsed + 1);
          placed.pop();
          put(o.rel, x, y, -1);
          if (!complete) return;
        }
      }
    }
    rec(cursor + 1, boostersUsed);   // leave this cell empty
  };
  rec(0, 0);

  const scored = scoreLayout(best.placed, byId, weights, K);
  return { placed: best.placed, score: scored.total, detail: scored.detail, nodes, complete };
}

/** ASCII picture of a layout: one character per cell (fragment id, base 36; boosters as '+'). */
export function drawLayout(placed, defs, width, height) {
  const byId = {};
  for (const d of defs) byId[d.id] = d;
  const rows = [...Array(height)].map(() => Array(width).fill("."));
  for (const p of placed) {
    const ch = byId[p.id].type === BOOSTER_TYPE ? "+" : (p.id % 36).toString(36).toUpperCase();
    for (const [x, y] of p.cells) rows[y][x] = ch;
  }
  return rows.map((r) => r.join(" "));
}
