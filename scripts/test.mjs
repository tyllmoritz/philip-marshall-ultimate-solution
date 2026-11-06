import { cube3x3x3 } from "cubing/puzzles";
import { MarshallSolver } from "../src/engine/solver.js";
import { buildMoveTables, FACES } from "../src/engine/cube.js";
import { compose, flatSolved, flatFromMove, rotationOf, rotationWord, invertRotationWord } from "../src/engine/flat.js";
import { solvedMask, unsolvedOnOneSide } from "../src/engine/solver.js";
import { BUILT_IN_PRESETS } from "../src/engine/presets.js";
const kp = await cube3x3x3.kpuzzle();
let t = performance.now();
const solver = new MarshallSolver(kp);
console.log("init ms", (performance.now() - t) | 0, "tables", solver.edgeTable.length, solver.cornerTable.length);
const EDGE_BITS = (list) => list.reduce((m, i) => m | (1 << i), 0);
const CORNER_BITS = (list) => list.reduce((m, i) => m | (1 << (12 + i)), 0);
const PAIR = { 8: 0, 9: 3, 10: 1, 11: 2 }; // middle edge -> its corner next to the cross
function checkSteps(solver, scr, r, f2l, yellowTop, opts = {}) {
  // replay through cubing itself so x/y/z rotations are interpreted independently of the solver
  const flatOf = (alg) => {
    const t = kp.algToTransformation(alg).transformationData;
    return flatFromMove({ ep: Uint8Array.from(t.EDGES.permutation), eo: Uint8Array.from(t.EDGES.orientationDelta), cp: Uint8Array.from(t.CORNERS.permutation), co: Uint8Array.from(t.CORNERS.orientationDelta) });
  };
  const masks = [];
  const played = [...scr, ...r.setupRotation];
  let stepNo = 0;
  for (const step of r.steps) {
    played.push(...step.parts.flatMap((p) => p.moves));
    const lastStep = ++stepNo === r.steps.length;
    // from step 2 on the cube is turned over (x2); turn it back to judge piece positions
    // judge piece positions in the cube's original orientation: undo whatever the rotations so far have turned it by
    const turned = played.filter((m) => /^[xyz]/.test(m));
    const f = flatOf(played.join(" ") + " " + invertRotationWord(rotationWord(rotationOf(turned))).join(" "));
    masks.push(solvedMask(f));
    if (masks.length === 5 && !unsolvedOnOneSide(f)) return "step 4: remaining corners are not on one side";
    // with the option the last corners are in the last layer: D corners 4-7 once the cube is back in its original orientation
    if (masks.length === 5 && opts.lastLayer) { for (let i = 0; i < 8; i++) if (i < 4 && !(f[24 + i] === i && f[32 + i] === 0)) return "step 4: an unsolved corner is outside the last layer"; }
  }
  if (opts.openSlot) for (const si of [2, 3]) for (const p of r.steps[si].parts) if ((p.kind === "setup" || p.kind === "turns") && p.moves.some((m) => m[0] !== "U")) return "open slot: a setup turns more than U in step " + (si + 1) + ": " + p.moves.join(" ");
  const inv = (m) => (m.endsWith("2") ? m : m.endsWith("'") ? m[0] : m + "'");
  // an edge series is a commutator X Y X' Y' of two adjacent faces (any orientation, mirrored or not)
  const commutator = (m, trimmedOk) => (m.length === 3 && trimmedOk && m[2] === inv(m[0]) && m[0][0] !== m[1][0] && !m[0].endsWith("2") && !m[1].endsWith("2")) || m.length === 4 && m[2] === inv(m[0]) && m[3] === inv(m[1]) && m[0][0] !== m[1][0] && !m[0].endsWith("2") && !m[1].endsWith("2");
  const niklas = ["U R U' L' U R' U' L", "L' U R U' L U R' U'"];
  for (const p of r.steps.flatMap((st, si) => st.parts.map((x) => ({ ...x, step: si })))) {
    if (p.kind === "edge" && !commutator(p.moves, true)) return "edge series is not a commutator: " + p.moves.join(" ");
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
  // step 3 ends in the key position: nothing left, or one middle-layer edge and two top-layer edges wrong
  // (seen with the cross on U: middle edges 8-11, top layer = the D edges 4-7)
  const wrong = [...Array(12).keys()].filter((i) => !(masks[2] & (1 << i)));
  if (wrong.length) {
    const mid = wrong.filter((i) => i >= 8).length, top = wrong.filter((i) => i >= 4 && i < 8).length;
    if (wrong.length !== 3 || mid !== 1 || top !== 2) return "step 3: wrong edges " + wrong.join(",") + " are not 1 middle + 2 top";
  }
  if (!has(masks[3], EDGE_BITS([...Array(12).keys()]))) return "step 4: not all edges solved";
  const corners = bitsSet(masks[4] >> 12, [...Array(8).keys()]);
  if (!has(masks[4], EDGE_BITS([...Array(12).keys()])) || corners < 5) return "step 5: need all edges + 5 corners, got " + corners;
  if (masks[5] !== (1 << 20) - 1) return "step 6: not solved";
  return null;
}
/** Any method: what a step finishes stays finished (cross, first layer, second layer), and the last step leaves the cube solved. */
function genericCheck(scr, r) {
  const flatOf = (alg) => {
    const t = kp.algToTransformation(alg).transformationData;
    return flatFromMove({ ep: Uint8Array.from(t.EDGES.permutation), eo: Uint8Array.from(t.EDGES.orientationDelta), cp: Uint8Array.from(t.CORNERS.permutation), co: Uint8Array.from(t.CORNERS.orientationDelta) });
  };
  const bits = (edges, corners) => edges.reduce((m, i) => m | (1 << i), 0) | corners.reduce((m, i) => m | (1 << (12 + i)), 0);
  const played = [...scr, ...r.setupRotation];
  let required = 0; // in the original orientation: cross = edges 0-3, first layer corners 0-3, middle edges 8-11
  for (const [i, step] of r.steps.entries()) {
    played.push(...step.parts.flatMap((p) => p.moves));
    const turned = played.filter((m) => /^[xyz]/.test(m));
    const mask = solvedMask(flatOf(played.join(" ") + " " + invertRotationWord(rotationWord(rotationOf(turned))).join(" ")));
    if (required & ~mask) return `step ${i + 1} (${step.name}) undid something the steps before had finished`;
    const goal = i === 0 ? bits([0, 1, 2, 3], []) : /First Layer/.test(step.name) ? bits([], [0, 1, 2, 3]) : /Second Layer/.test(step.name) ? bits([8, 9, 10, 11], []) : 0;
    if (goal & ~mask) return `step ${i + 1} (${step.name}) did not finish what it is for`;
    required |= goal;
  }
  const f = flatOf(played.join(" ") + " " + invertRotationWord(rotationWord(rotationOf(played.filter((m) => /^[xyz]/.test(m))))).join(" "));
  return solvedMask(f) === (1 << 20) - 1 ? null : "the last step does not leave the cube solved";
}
const n = +process.argv[2] || 20;
const mode = process.argv[3] ?? "";
const presetId = /^preset=(.+)$/.exec(mode)?.[1] ?? null;
const preset = presetId ? BUILT_IN_PRESETS.find((p) => p.id === presetId) : null;
if (presetId && !preset) { console.log("unknown preset", presetId); process.exit(1); }
const f2l = preset ? preset.f2l : mode.includes("f2l");
const yellowTop = preset ? preset.yellowTop : mode.includes("yellow") || mode.includes("beginner");
const beginner = !preset && mode.includes("beginner");
const openSlot = mode.includes("open");
const lastLayer = mode.includes("layer");
let f2lUsed = 0;
const totals = [];
let fail = 0;
for (let i = 0; i < n; i++) {
  const scr = [];
  let last = "";
  for (let j = 0; j < 30; j++) { let f; do f = FACES[(Math.random() * 6) | 0]; while (f === last); last = f; scr.push(f + ["", "2", "'"][(Math.random() * 3) | 0]); }
  t = performance.now();
  const r = solver.solve(scr, { f2l, yellowTop, beginner, openSlot, lastLayer, ...(preset ? { steps: preset.steps } : {}) });
  const dt = performance.now() - t;
  if (r.error) { fail++; console.log("FAIL", r.error, scr.join(" ")); continue; }
  // verify with cubing
  const alg = scr.join(" ") + " " + r.setupRotation.join(" ") + " " + r.solution.join(" ") + " " + r.restoreRotation.join(" ");
  const td = kp.algToTransformation(alg).transformationData; const ok = td.EDGES.permutation.every((p,i)=>p===i) && td.EDGES.orientationDelta.every(o=>!o) && td.CORNERS.permutation.every((p,i)=>p===i) && td.CORNERS.orientationDelta.every(o=>!o);
  if (!ok) { fail++; console.log("WRONG", scr.join(" ")); }
  // every step must leave the cube in its target state
  const problems = preset && !/^marshall(-f2l)?$/.test(preset.id) ? genericCheck(scr, r) : checkSteps(solver, scr, r, f2l, yellowTop, { openSlot, lastLayer });
  if (problems) { fail++; console.log("STEP TARGET", problems, scr.join(" ")); continue; }
  totals.push(r.total);
  if (r.f2lPairs) f2lUsed++;
  console.log(i, r.total, r.steps.map((s) => s.count).join("/"), dt | 0, "ms", ok ? "" : "BAD");
}
if (f2l) console.log("f2l applied", f2lUsed, "of", totals.length);
console.log("avg", totals.reduce((a, b) => a + b, 0) / totals.length, "fail", fail);
if (fail) process.exit(1);
