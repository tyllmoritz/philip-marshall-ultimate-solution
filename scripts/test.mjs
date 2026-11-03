import { cube3x3x3 } from "cubing/puzzles";
import { MarshallSolver } from "../src/engine/solver.js";
import { buildMoveTables, FACES } from "../src/engine/cube.js";
import { compose, flatSolved } from "../src/engine/flat.js";
const kp = await cube3x3x3.kpuzzle();
let t = performance.now();
const solver = new MarshallSolver(kp);
console.log("init ms", (performance.now() - t) | 0, "tables", solver.edgeTable.length, solver.cornerTable.length);
const n = +process.argv[2] || 20;
const f2l = process.argv[3] === "f2l";
let f2lUsed = 0;
const totals = [];
let fail = 0;
for (let i = 0; i < n; i++) {
  const scr = [];
  let last = "";
  for (let j = 0; j < 30; j++) { let f; do f = FACES[(Math.random() * 6) | 0]; while (f === last); last = f; scr.push(f + ["", "2", "'"][(Math.random() * 3) | 0]); }
  t = performance.now();
  const r = solver.solve(scr, { f2l });
  const dt = performance.now() - t;
  if (r.error) { fail++; console.log("FAIL", r.error, scr.join(" ")); continue; }
  // verify with cubing
  const alg = scr.join(" ") + " " + r.solution.join(" ");
  const td = kp.algToTransformation(alg).transformationData; const ok = td.EDGES.permutation.every((p,i)=>p===i) && td.EDGES.orientationDelta.every(o=>!o) && td.CORNERS.permutation.every((p,i)=>p===i) && td.CORNERS.orientationDelta.every(o=>!o);
  if (!ok) { fail++; console.log("WRONG", scr.join(" ")); }
  totals.push(r.total);
  if (r.f2lPairs) f2lUsed++;
  console.log(i, r.total, r.steps.map((s) => s.count).join("/"), dt | 0, "ms", ok ? "" : "BAD");
}
if (f2l) console.log("f2l applied", f2lUsed, "of", totals.length);
console.log("avg", totals.reduce((a, b) => a + b, 0) / totals.length, "fail", fail);
if (fail) process.exit(1);
