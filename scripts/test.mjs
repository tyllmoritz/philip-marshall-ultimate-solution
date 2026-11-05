import { cube3x3x3 } from "cubing/puzzles";
import { MarshallSolver } from "../src/engine/solver.js";
import { buildMoveTables, FACES } from "../src/engine/cube.js";
import { compose, flatSolved, flatFromMove } from "../src/engine/flat.js";
import { solvedMask, unsolvedOnOneSide } from "../src/engine/solver.js";
const kp = await cube3x3x3.kpuzzle();
let t = performance.now();
const solver = new MarshallSolver(kp);
console.log("init ms", (performance.now() - t) | 0, "tables", solver.edgeTable.length, solver.cornerTable.length);
const EDGE_BITS = (list) => list.reduce((m, i) => m | (1 << i), 0);
const CORNER_BITS = (list) => list.reduce((m, i) => m | (1 << (12 + i)), 0);
const PAIR = { 8: 0, 9: 3, 10: 1, 11: 2 }; // middle edge -> its corner next to the cross
function checkSteps(solver, scr, r, f2l, yellowTop) {
  // replay through cubing itself so x/y/z rotations are interpreted independently of the solver
  const flatOf = (alg) => {
    const t = kp.algToTransformation(alg).transformationData;
    return flatFromMove({ ep: Uint8Array.from(t.EDGES.permutation), eo: Uint8Array.from(t.EDGES.orientationDelta), cp: Uint8Array.from(t.CORNERS.permutation), co: Uint8Array.from(t.CORNERS.orientationDelta) });
  };
  const masks = [];
  const played = [...scr];
  for (const step of r.steps) {
    played.push(...step.parts.flatMap((p) => p.moves));
    // from step 2 on the cube is turned over (x2); turn it back to judge piece positions
    const f = flatOf(played.join(" ") + (masks.length >= (yellowTop ? 0 : 1) && masks.length < 4 ? " x2" : ""));
    masks.push(solvedMask(f));
    if (masks.length === 4 && !unsolvedOnOneSide(f)) return "step 4: remaining corners are not on one side";
  }
  const inv = (m) => (m.endsWith("2") ? m : m.endsWith("'") ? m[0] : m + "'");
  // an edge series is a commutator X Y X' Y' of two adjacent faces (any orientation, mirrored or not)
  const commutator = (m, trimmedOk) => (m.length === 3 && trimmedOk && m[2] === inv(m[0]) && m[0][0] !== m[1][0] && !m[0].endsWith("2") && !m[1].endsWith("2")) || m.length === 4 && m[2] === inv(m[0]) && m[3] === inv(m[1]) && m[0][0] !== m[1][0] && !m[0].endsWith("2") && !m[1].endsWith("2");
  const niklas = ["U R U' L' U R' U' L", "L' U R U' L U R' U'"];
  for (const p of r.steps.flatMap((st, si) => st.parts.map((x) => ({ ...x, step: si })))) {
    if (p.kind === "edge" && !commutator(p.moves, p.step === (yellowTop ? 1 : 1))) return "edge series is not a commutator: " + p.moves.join(" ");
    if (p.kind === "corner" && !niklas.includes(p.moves.join(" "))) return "series not in front/top form: " + p.moves.join(" ");
  }
  const has = (m, bits) => (m & bits) === bits;
  const bitsSet = (m, list) => list.filter((i) => m & (1 << i)).length;
  const cross = EDGE_BITS([0, 1, 2, 3]);
  if (!has(masks[0], cross)) return "step 1: cross incomplete";
  const mid = bitsSet(masks[1], [8, 9, 10, 11]);
  if (!has(masks[1], cross) || mid < 3) return "step 2: need cross + 3 middle-layer edges, got " + mid;
  if (f2l) {
    const pairs = [8, 9, 10, 11].filter((e) => has(masks[1], EDGE_BITS([e]) | CORNER_BITS([PAIR[e]]))).length;
    if (pairs < 3) return "step 2: need 3 F2L pairs, got " + pairs;
  }
  if (!has(masks[2], EDGE_BITS([...Array(12).keys()]))) return "step 3: not all edges solved";
  const corners = bitsSet(masks[3] >> 12, [...Array(8).keys()]);
  if (!has(masks[3], EDGE_BITS([...Array(12).keys()])) || corners < 5) return "step 4: need all edges + 5 corners, got " + corners;
  if (masks[4] !== (1 << 20) - 1) return "step 5: not solved";
  return null;
}
const n = +process.argv[2] || 20;
const mode = process.argv[3] ?? "";
const f2l = mode.includes("f2l");
const yellowTop = mode.includes("yellow") || mode.includes("beginner");
const beginner = mode.includes("beginner");
let f2lUsed = 0;
const totals = [];
let fail = 0;
for (let i = 0; i < n; i++) {
  const scr = [];
  let last = "";
  for (let j = 0; j < 30; j++) { let f; do f = FACES[(Math.random() * 6) | 0]; while (f === last); last = f; scr.push(f + ["", "2", "'"][(Math.random() * 3) | 0]); }
  t = performance.now();
  const r = solver.solve(scr, { f2l, yellowTop, beginner });
  const dt = performance.now() - t;
  if (r.error) { fail++; console.log("FAIL", r.error, scr.join(" ")); continue; }
  // verify with cubing
  const alg = scr.join(" ") + " " + r.solution.join(" ");
  const td = kp.algToTransformation(alg).transformationData; const ok = td.EDGES.permutation.every((p,i)=>p===i) && td.EDGES.orientationDelta.every(o=>!o) && td.CORNERS.permutation.every((p,i)=>p===i) && td.CORNERS.orientationDelta.every(o=>!o);
  if (!ok) { fail++; console.log("WRONG", scr.join(" ")); }
  // every step must leave the cube in its target state
  const problems = checkSteps(solver, scr, r, f2l, yellowTop);
  if (problems) { fail++; console.log("STEP TARGET", problems, scr.join(" ")); continue; }
  totals.push(r.total);
  if (r.f2lPairs) f2lUsed++;
  console.log(i, r.total, r.steps.map((s) => s.count).join("/"), dt | 0, "ms", ok ? "" : "BAD");
}
if (f2l) console.log("f2l applied", f2lUsed, "of", totals.length);
console.log("avg", totals.reduce((a, b) => a + b, 0) / totals.length, "fail", fail);
if (fail) process.exit(1);
