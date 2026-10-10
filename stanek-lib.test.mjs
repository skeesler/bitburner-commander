/**
 * stanek-lib.test.mjs — Node spec for the Stanek's Gift placer.
 *
 * Not a Bitburner script (.mjs, so the game's file-sync ignores it). Runs under Node:
 *   node stanek-lib.test.mjs
 *
 * The fragment table below is the LIVE fragmentDefinitions() output from BN13.1 (2026-10-03,
 * stanek-api.js), so the geometry is tested against the real pieces, not a guess at them.
 */
import { fullAt, shapeCells, chargeK, scoreLayout, bestLayout, drawLayout, PLANS, BOOSTER_TYPE } from "./stanek-lib.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? "  — " + extra : ""}`); }
};
const S = (...rows) => rows.map((r) => [...r].map((c) => c === "#"));
const DEFS = [
  { id: 0, type: 6, power: 1, limit: 1, shape: S(".##", "##.") },
  { id: 1, type: 6, power: 1, limit: 1, shape: S("##.", ".##") },
  { id: 5, type: 3, power: 1.3, limit: 1, shape: S("###", ".#.") },
  { id: 6, type: 4, power: 2, limit: 1, shape: S("####") },
  { id: 7, type: 5, power: 0.5, limit: 1, shape: S("#..", "###") },
  { id: 10, type: 7, power: 2, limit: 1, shape: S("###", ".#.") },
  { id: 12, type: 8, power: 2, limit: 1, shape: S("..#", "###") },
  { id: 14, type: 9, power: 2, limit: 1, shape: S("..#", "###") },
  { id: 16, type: 10, power: 2, limit: 1, shape: S(".##", "##.") },
  { id: 18, type: 11, power: 3, limit: 1, shape: S(".##", "##.") },
  { id: 20, type: 12, power: 1, limit: 1, shape: S("####") },
  { id: 21, type: 13, power: 2, limit: 1, shape: S("##", "##") },
  { id: 25, type: 14, power: 0.5, limit: 1, shape: S("#..", "###") },
  { id: 27, type: 15, power: 10, limit: 1, shape: S("#..", "###") },
  { id: 28, type: 16, power: 2, limit: 1, shape: S("..#", "###") },
  { id: 30, type: 17, power: 0.4, limit: 1, shape: S(".##", "##.") },
  { id: 100, type: 18, power: 1.1, limit: 99, shape: S(".##", "##.", ".#.") },
  { id: 101, type: 18, power: 1.1, limit: 99, shape: S("####", "#...") },
  { id: 102, type: 18, power: 1.1, limit: 99, shape: S(".###", "##..") },
  { id: 103, type: 18, power: 1.1, limit: 99, shape: S("###.", "..##") },
  { id: 104, type: 18, power: 1.1, limit: 99, shape: S(".##", ".#.", "##.") },
  { id: 105, type: 18, power: 1.1, limit: 99, shape: S("..#", ".##", "##.") },
  { id: 106, type: 18, power: 1.1, limit: 99, shape: S("#..", "###", "#..") },
  { id: 107, type: 18, power: 1.1, limit: 99, shape: S(".#.", "###", ".#.") },
];
const byId = Object.fromEntries(DEFS.map((d) => [d.id, d]));

console.log("\ngeometry (ports of Fragment.fullAt / width / height):");
{
  const L = S("#.", "#.", "##");
  const pics = [0, 1, 2, 3].map((r) => {
    const { cells, w, h } = shapeCells(L, r);
    const g = [...Array(h)].map(() => Array(w).fill("."));
    for (const [x, y] of cells) g[y][x] = "#";
    return g.map((row) => row.join("")).join("/");
  });
  ok("rotation 0 is the shape as drawn", pics[0] === "#./#./##", pics[0]);
  ok("rotation 1 swaps width and height", pics[1] === "###/#..", pics[1]);
  ok("rotation 2 is a half turn", pics[2] === "##/.#/.#", pics[2]);
  ok("rotation 3", pics[3] === "..#/###", pics[3]);
  ok("every rotation keeps the cell count",
    [0, 1, 2, 3].every((r) => shapeCells(L, r).cells.length === 4));
  ok("fullAt outside the box is false", !fullAt(L, 0, 5, 0) && !fullAt(L, 0, -1, 0));
}

console.log("\nscoring (StaneksGift.effect + formulas/effect.ts):");
{
  const K = chargeK({ threads: 14, numCharge: 100, nodeMult: 2 });
  ok("K at 14 threads, 100 charges, BN13 x2 matches the live §4 curve's order (~0.11)", K > 0.10 && K < 0.12, String(K));
  // A strength piece with a booster beside it vs alone.
  const str = { id: 10, x: 0, y: 0, rotation: 0, cells: shapeCells(byId[10].shape, 0).cells };
  const alone = scoreLayout([str], byId, { 10: 1 }, K);
  // "+" rooted at (2,0) covers (3,0),(2,1),(3,1),(4,1),(3,2): (2,1) sits beside the T's (1,1) and
  // under its (2,0), with no overlap.
  const plusCells = shapeCells(byId[107].shape, 0).cells.map(([x, y]) => [x + 2, y]);
  const touching = scoreLayout([str, { id: 107, x: 2, y: 0, rotation: 0, cells: plusCells }], byId, { 10: 1 }, K);
  ok("an adjacent booster multiplies the fragment's power by 1.1", Math.abs(touching.detail[0].boost - 1.1) < 1e-12, JSON.stringify(touching.detail));
  ok("...and raises the score", touching.total > alone.total);
  const farCells = shapeCells(byId[107].shape, 0).cells.map(([x, y]) => [x + 3, y + 2]);
  const far = scoreLayout([str, { id: 107, x: 3, y: 2, rotation: 0, cells: farCells }], byId, { 10: 1 }, K);
  ok("a booster that only touches diagonally does nothing", far.detail[0].boost === 1, JSON.stringify(far.detail));
}

console.log("\nbestLayout on the live 6x5 grid:");
for (const [name, weights] of Object.entries(PLANS)) {
  const K = chargeK({ threads: 14 });
  const t0 = Date.now();
  const r = bestLayout({ width: 6, height: 5, defs: DEFS, weights, K });
  const ms = Date.now() - t0;
  const ids = r.placed.map((p) => p.id);
  const cells = r.placed.flatMap((p) => p.cells.map(([x, y]) => `${x},${y}`));
  ok(`${name}: search finishes (${r.nodes} nodes, ${ms} ms)`, r.complete && ms < 20000);
  ok(`${name}: no two pieces share a cell`, new Set(cells).size === cells.length);
  ok(`${name}: everything inside the grid`, r.placed.every((p) => p.cells.every(([x, y]) => x >= 0 && y >= 0 && x < 6 && y < 5)));
  ok(`${name}: each wanted fragment at most once`, ids.filter((id) => byId[id].type !== BOOSTER_TYPE).length ===
    new Set(ids.filter((id) => byId[id].type !== BOOSTER_TYPE)).size);
  ok(`${name}: only the plan's fragments (and boosters) are placed`,
    r.placed.every((p) => byId[p.id].type === BOOSTER_TYPE || (weights[p.id] || 0) > 0));
  // Roots must satisfy canPlace: root + rotated size inside the grid, and the cells must match.
  ok(`${name}: every root reproduces its cells via fullAt (what placeFragment will check)`, r.placed.every((p) => {
    const { cells, w, h } = shapeCells(byId[p.id].shape, p.rotation);
    if (p.x < 0 || p.y < 0 || p.x + w > 6 || p.y + h > 5) return false;
    const want = new Set(p.cells.map(([x, y]) => `${x},${y}`));
    return cells.length === want.size && cells.every(([x, y]) => want.has(`${x + p.x},${y + p.y}`));
  }));
  console.log(`    ${name}: score ${r.score.toFixed(4)} · ${r.placed.length} pieces · boosts ` +
    r.detail.map((d) => `#${d.id} x${d.boost.toFixed(3)}`).join(" "));
  for (const row of drawLayout(r.placed, DEFS, 6, 5)) console.log(`      ${row}`);
}
{
  const r = bestLayout({ width: 6, height: 5, defs: DEFS, weights: PLANS.bb, K: chargeK({ threads: 14 }) });
  const placedIds = new Set(r.placed.map((p) => p.id));
  ok("bb: all five Bladeburner-plan fragments fit on 6x5", [10, 12, 14, 16, 30].every((id) => placedIds.has(id)),
    [...placedIds].join(","));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
