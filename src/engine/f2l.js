// Standard F2L insertion algorithms (cross on D, slot FR), from
// https://www.rubiksplace.com/speedcubing/F2L-algorithms/
// Left-slot cases are mirrors of these. Algorithms containing M/r slices are left out.
import { ROTATIONS } from "./flat.js";

const RAW = `
U R U' R'|R' F R F'|y' U' R' U R|F R' F' R
U' R U R' U2 R U' R'|d R' U' R U2' R' U R|y' U R' U' R U2 R' U R
U' R U2' R' U2 R U' R'|d R' U2 R U2' R' U R
y' R' U R U' d' R U R'|y L' U L U2 y R U R'|R U' R' U d R' U' R|R U' R' U2 y' R' U' R|R U' R' U2 F' U' F
y' R' U' R|R U R'
d R' U' R U' R' U' R|U' R U' R' d R' U' R|U' R U' R' U y' R' U' R|U' R U R' U R U R'
U' R U2' R' d R' U' R|R' U2 R2 U R2' U R|R U' R' U R U' R' U2 R U' R'|d R' U2 R d' R U R'
d R' U R U' R' U' R|U' R U' R' U R U R'
R U2' R' U' R U R'|y' R' U2 R U R' U' R|y L' U2 L U L' U' L
U R U2 R' U R U' R'|U R U2 R2 F R F'|y' U' R' U2 R U' R' U R
U2 R U R' U R U' R'|R U' R' U2' R U R'|y' U2 R' U' R U' R' U R|y' R' U R U2 R' U' R
y' U R' U2 R y R U2 R' U R U' R'|U2 R2 U2 R' U' R U' R2|R U R' U2' R U R' U' R U R'|U' R U2' R' y' R' U2 R U' R' U R|R U R' d R' U R U' R' U R|y' U2 R2 U2 R U R' U R2
U R U' R' d' L' U L|U R U' R' U' y L' U L|d' L' U L d R U' R'|y U' L' U L y' U R U' R'
y' R' U' R U R' U' R|R U R' U' R U R'
R U' R' U R U' R'|y' R' U R U' R' U R|R U R' d R' U2 R
U' R U' R' U2 R U' R'|d' L' U' R' U L U' R|d R' U R U2 R' U R|U' R U2' R' U R U R'|U R U R' U2 R U R'
U' R U R' d R' U' R|d R' U' R d' R U R'|y U2 L' U L U y L U L'
R U' R' d R' U R|R U R' U' R U R' U' R U R'|U R U' R' U R U' R' U R U' R'
R U' R' U' R U R' U2 R U' R'|y' R' U' R U2 R' U R U' R' U' R|R U R' U2 R U' R' U R U R'|R U' R' U R U2' R' U R U' R'
R U' R' d R' U' R U' R' U' R|R U R' U' R U' R' U2 y' R' U' R|R U' R' U d R' U' R U' R' U R
R U' R' U y' R' U2 R U2' R' U R|R U' R' d R' U2 R U2' R' U R|R' F R F' R U' R' U R U' R' U2 R U' R'
`;

// Short moves that lift a pair out of its slot so a normal insertion can follow.
const EXTRACTIONS = ["R U R'", "R U' R'", "R U2 R'", "F' U F", "F' U' F", "F' U2 F"];

const RY = { U: "U", D: "D", F: "R", R: "B", B: "L", L: "F" };

function suffixOf(q) {
  return q === 1 ? "" : q === 2 ? "2" : "'";
}

/** Expand y / d rotations into plain face turns; null if the alg uses anything else. */
export function normalizeAlg(str) {
  let map = { U: "U", D: "D", F: "F", B: "B", R: "R", L: "L" };
  const rotateY = (times) => {
    for (let i = 0; i < times; i++) {
      const n = {};
      for (const k of Object.keys(map)) n[k] = map[RY[k]];
      map = n;
    }
  };
  const out = [];
  for (const tok of str.trim().split(/\s+/)) {
    const m = tok.match(/^([UDFBRLdy])(2'|2|')?$/);
    if (!m) return null;
    const q = !m[2] ? 1 : m[2] === "'" ? 3 : 2;
    const x = m[1];
    if (x === "y") rotateY(q);
    else if (x === "d") { rotateY((4 - q) % 4); out.push("U" + suffixOf(q)); }
    else out.push(map[x] + suffixOf(q));
  }
  return out;
}

const MIRROR = { U: "U", D: "D", F: "F", B: "B", R: "L", L: "R" };
function mirror(moves) {
  return moves.map((m) => {
    const q = m.length === 1 ? 1 : m[1] === "2" ? 2 : 3;
    return MIRROR[m[0]] + suffixOf(q === 2 ? 2 : 4 - q);
  });
}

const map = (rot, moves) => moves.map((m) => rot[m[0]] + m.slice(1));
const CROSS_UP_ROTATIONS = ROTATIONS.filter((r) => r.D === "D");

function expand(moves) {
  const out = [];
  for (const base of [moves, mirror(moves)]) {
    for (const rot of CROSS_UP_ROTATIONS) out.push(map(rot, base));
  }
  return out;
}

export const F2L_ALGS = [...new Set(RAW.split(/[\n|]/).map((s) => s.trim()).filter(Boolean))]
  .map(normalizeAlg)
  .filter(Boolean)
  .flatMap(expand);

// every side face, both directions, each followed by a turn of the free layer (U, cross is on D)
const GENERIC_EXTRACTIONS = ["R", "L", "F", "B"].flatMap((f) =>
  [f, f + "'"].flatMap((t) => ["U", "U'", "U2"].map((k) => [t, k, t.endsWith("'") ? f : f + "'"])));

export const F2L_EXTRACTIONS = [...EXTRACTIONS.map(normalizeAlg).flatMap(expand), ...GENERIC_EXTRACTIONS];

/** Pre-alignment turns of the free layer (the U face when the cross is on D). */
export const F2L_PRE = [[], ["U"], ["U2"], ["U'"]];
