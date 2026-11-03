// Usage: node scripts/profile.mjs [count] [f2l]
import { cube3x3x3 } from "cubing/puzzles";
import { MarshallSolver } from "../src/engine/solver.js";
import { FACES } from "../src/engine/cube.js";

const kp = await cube3x3x3.kpuzzle();
const stats = new Map();
const rec = (label, ms) => { const s = stats.get(label) ?? { ms: 0, n: 0 }; s.ms += ms; s.n++; stats.set(label, s); };
const wrap = (obj, name, label = name) => {
  const orig = obj[name];
  obj[name] = function (...a) { const t = performance.now(); try { return orig.apply(this, a); } finally { rec(typeof label === "function" ? label(...a) : label, performance.now() - t); } };
};

const proto = MarshallSolver.prototype;
for (const n of ["buildTable", "buildCrossTable", "buildF2LTable", "solveCross", "finish", "lookahead", "f2lByAlgorithms", "f2lBySeries", "finishEdges", "solveOriented"]) wrap(proto, n);
wrap(proto, "climb", function (f, table, o) {
  const kind = o.count ? "f2l pairs" : o.target.edges.length === 4 ? "step2 middle edges" : o.target.edges.length === 12 ? "step3 edges" : o.goal === 5 ? "step4 5 corners" : o.goal === 8 ? "step5 end game" : "other corners";
  return "climb: " + kind;
});

const t0 = performance.now();
const solver = new MarshallSolver(kp);
rec("constructor (total)", performance.now() - t0);

const n = +process.argv[2] || 20, f2l = process.argv[3] === "f2l";
const solveTimes = [];
for (let i = 0; i < n; i++) {
  const scr = []; let last = "";
  for (let j = 0; j < 30; j++) { let f; do f = FACES[(Math.random() * 6) | 0]; while (f === last); last = f; scr.push(f + ["", "2", "'"][(Math.random() * 3) | 0]); }
  const t = performance.now();
  solver.solve(scr, { f2l });
  solveTimes.push(performance.now() - t);
}
console.log(`${n} solves, f2l=${f2l}: avg ${(solveTimes.reduce((a, b) => a + b) / n).toFixed(0)} ms, max ${Math.max(...solveTimes).toFixed(0)} ms\n`);
console.log("phase".padEnd(28), "total ms".padStart(9), "calls".padStart(7), "ms/call".padStart(9));
for (const [k, v] of [...stats].sort((a, b) => b[1].ms - a[1].ms)) console.log(k.padEnd(28), v.ms.toFixed(0).padStart(9), String(v.n).padStart(7), (v.ms / v.n).toFixed(1).padStart(9));
