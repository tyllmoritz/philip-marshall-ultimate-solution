// Philip Marshall's method, implemented on top of two "series":
//   Edge Piece Series   F R' F' R           (3-cycles edges; corners are collateral)
//   Corner Piece Series U R U' L' U R' U' L (3-cycles corners; edges untouched)
// Every move the solver makes is a face turn or a series, optionally wrapped in
// setup turns that are undone afterwards (conjugation) - just like the written method.
import {
  buildMoveTables, parseAlg, invertAlg, emptyState, applyTo, FACES,
} from "./cube.js";
import { movecount } from "./mcc.js";
import { F2L_ALGS, F2L_EXTRACTIONS, F2L_PRE } from "./f2l.js";
import {
  N, flatFromMove, flatFromState, flatSolved, compose, flatKey, ROTATIONS, mapAlg,
  rotationOf, rotationWord, invertRotationWord,
} from "./flat.js";

export const EDGE_SERIES = "F R' F' R";
export const CORNER_SERIES = "U R U' L' U R' U' L";

const PARITY_SEEN = new Uint8Array(12);
const CROSS_BASE = [1, 24, 576, 13824]; // radix for the four cross edges UF UR UB UL
const MIDDLE = [8, 9, 10, 11]; // FR FL BR BL
// cross-layer corner (DFR DFL DBR DBL) that forms an F2L pair with each center-section edge (FR FL BR BL);
// steps 2-5 are solved with the cube turned over, so the cross is on the D face
const PAIR_CORNER = { 8: 4, 9: 5, 10: 7, 11: 6 };
const ALL_EDGES = [...Array(12).keys()];
const ALL_CORNERS = [...Array(8).keys()];
const CORNER_FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 3, 4, 5], [1, 2, 6, 7], [0, 1, 4, 7], [2, 3, 5, 6]]; // U D F B R L
/** Corners that are not home yet all lie on one face (so one corner series can finish them). */
export function unsolvedOnOneSide(f, lastLayerOnly = false) {
  const open = ALL_CORNERS.filter((i) => !(f[24 + i] === i && f[32 + i] === 0));
  return (lastLayerOnly ? CORNER_FACES.slice(0, 1) : CORNER_FACES).some((face) => open.every((i) => face.includes(i)));
}

/** Bit i (edges 0-11) / 12+i (corners): that piece sits at home, correctly oriented. */
export function solvedMask(f) {
  let m = 0;
  for (let i = 0; i < 12; i++) if (f[i] === i && f[12 + i] === 0) m |= 1 << i;
  for (let i = 0; i < 8; i++) if (f[24 + i] === i && f[32 + i] === 0) m |= 1 << (12 + i);
  return m;
}
function countTarget(f, { edges, corners }) {
  let n = 0;
  for (const i of edges) if (f[i] === i && f[12 + i] === 0) n++;
  for (const i of corners) if (f[24 + i] === i && f[32 + i] === 0) n++;
  return n;
}
/** countTarget(s * m) without building the composed state. */
function countTargetAfter(s, m, { edges, corners }) {
  let n = 0;
  for (const i of edges) {
    const j = m[i];
    if (s[j] === i && !((s[12 + j] + m[12 + i]) & 1)) n++;
  }
  for (const i of corners) {
    const j = m[24 + i];
    if (s[24 + j] === i && !((s[32 + j] + m[32 + i]) % 3)) n++;
  }
  return n;
}
/** 52-bit hash of a whole flat state; collisions are astronomically unlikely at this table size. */
function hashFlat(f) {
  let h1 = 2166136261, h2 = 5381;
  for (let i = 0; i < N; i++) {
    h1 = Math.imul(h1 ^ f[i], 16777619);
    h2 = Math.imul(h2 + f[i] + 1, 33) ^ (h2 >>> 15);
  }
  return (h1 >>> 0) * 1048576 + (h2 >>> 12);
}
function composePart(s, m, out, { n, p, o, mod }) {
  for (let i = 0; i < n; i++) {
    const j = m[p + i];
    out[p + i] = s[p + j];
    out[o + i] = (s[o + j] + m[o + i]) % mod;
  }
}
/** Flat array whose `part` is the inverse of f's `part`. */
function invertPart(f, { n, p, o, mod }) {
  const out = new Uint8Array(N);
  for (let i = 0; i < n; i++) out[p + f[p + i]] = i;
  for (let i = 0; i < n; i++) out[o + i] = (mod - f[o + out[p + i]]) % mod;
  return out;
}
function hashPart(f, { n, p, o }) {
  let h = 2166136261;
  for (let i = 0; i < n; i++) h = Math.imul(h ^ f[p + i], 16777619) ^ Math.imul(f[o + i] + 7, 2246822519);
  return h >>> 0;
}
function samePart(a, b, { n, p, o }) {
  for (let i = 0; i < n; i++) if (a[p + i] !== b[p + i] || a[o + i] !== b[o + i]) return false;
  return true;
}

export function mergeTurns(moves) {
  const out = [];
  for (const m of moves) {
    const last = out[out.length - 1];
    if (last && last[0] === m[0]) {
      const amt = (q) => (q.length === 1 ? 1 : q[1] === "2" ? 2 : 3);
      const t = (amt(last) + amt(m)) % 4;
      out.pop();
      if (t) out.push(m[0] + ["", "", "2", "'"][t]);
    } else out.push(m);
  }
  return out;
}

const QUARTERS = (m) => (m.length === 1 ? 1 : m[1] === "2" ? 2 : 3);
const SUFFIX = ["", "", "2", "'"];
const KIND_RANK = { edge: 3, corner: 3, turns: 2, setup: 1, undo: 1 };

/**
 * Cancel turns across all boundaries (series/setup/undo/steps), also reaching
 * past turns of the opposite face (R L R' = L), then regroup into steps/parts.
 */
export function optimizeSteps(steps) {
  const stack = [];
  steps.forEach((step, si) => step.parts.forEach((part) => part.moves.forEach((m, mi, arr) => {
    const tok = { m, kind: part.kind, act: part.act, step: si, pair: part.pair, frees: part.frees };
    // a top-layer turn at either end of an edge series is optional (it only turns the layer the series is not about):
    // it may cancel against a neighbouring turn of that layer instead of being done twice
    const optional = part.kind === "edge" && arr.length === 4 && m[0] === "U" && (mi === 0 || mi === 3);
    tok.optional = optional;
    // series stay exactly as written (front/top) and rotations are barriers, so nothing cancels into them
    const solid = (part.kind === "edge" || part.kind === "corner" || part.kind === "rotate") && !optional;
    tok.solid = solid;
    if (solid) { stack.push(tok); return; }
    for (let j = stack.length - 1; j >= 0; j--) {
      if (stack[j].step !== si || stack[j].solid) break; // never move turns between steps: each step must end in its target state
      const f = stack[j].m[0];
      if (f === m[0]) {
        const prev = stack[j];
        const q = (QUARTERS(prev.m) + QUARTERS(m)) % 4;
        let kind, act;
        if (prev.optional && tok.optional) { // two optional turns of neighbouring series meet: a plain turn between them
          kind = "turns";
          act = tok.act;
        } else if (prev.optional !== tok.optional) { // what is left of an optional series turn is a plain turn
          const other = prev.optional ? tok : prev;
          kind = other.kind;
          act = other.act;
        } else {
          kind = KIND_RANK[prev.kind] > KIND_RANK[tok.kind] ? prev.kind : tok.kind;
          act = kind === prev.kind ? prev.act : tok.act;
        }
        if (q === 0) stack.splice(j, 1);
        else stack[j] = { ...tok, m: m[0] + SUFFIX[q], kind, act, optional: false };
        return;
      }
      if (OPPOSITE[f] !== m[0]) break;
    }
    stack.push(tok);
  })));
  mergeRotations(stack);
  return steps.map((step, si) => {
    const parts = [];
    for (const t of stack.filter((x) => x.step === si)) {
      const kind = t.kind === "undo" ? "setup" : t.kind;
      const last = parts[parts.length - 1];
      const sameGroup = last && last.kind === kind && (kind === "setup" || kind === "turns" || last.act === t.act);
      if (sameGroup) last.moves.push(t.m);
      else parts.push({ kind, moves: [t.m], act: t.act, ...(t.pair !== undefined ? { pair: t.pair, ...(t.frees ? { frees: true } : {}) } : {}) });
    }
    return { name: step.name, parts, count: parts.reduce((n, p) => n + (p.kind === "rotate" ? 0 : p.moves.length), 0) };
  });
}

/** Back-to-back rotations (end of one series, start of the next) collapse into one. */
/**
 * Rotations before the first move belong to the setup (how the cube is held to begin with), rotations after the last
 * move are dropped (a solved cube can be put down any way up). Returns the steps without them, the setup rotation and
 * the rotation that would put the cube back in its first orientation (for checking, not shown).
 */
function stripEnds(steps) {
  const setup = [];
  for (const step of steps) {
    while (step.parts.length && step.parts[0].kind === "rotate") setup.push(...step.parts.shift().moves);
    if (step.parts.length) break;
  }
  for (let i = steps.length - 1; i >= 0; i--) {
    const parts = steps[i].parts;
    while (parts.length && parts[parts.length - 1].kind === "rotate") parts.pop();
    if (parts.length) break;
  }
  const rotations = steps.flatMap((st) => st.parts.filter((p) => p.kind === "rotate").flatMap((p) => p.moves));
  const net = rotationOf([...setup, ...rotations]);
  return {
    steps: steps.map((st) => ({ ...st, count: st.parts.reduce((n, p) => n + (p.kind === "rotate" ? 0 : p.moves.length), 0) })),
    setupRotation: rotationWord(rotationOf(setup)),
    restoreRotation: invertRotationWord(rotationWord(net)),
  };
}

function mergeRotations(stack) {
  // a y rotation commutes with U and D turns, so y2 U y2 is just U
  const isY = (t) => t.kind === "rotate" && t.m[0] === "y";
  const free = (t) => t.kind !== "rotate" && !t.solid && (t.m[0] === "U" || t.m[0] === "D");
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < stack.length && !again; i++) {
      if (!isY(stack[i])) continue;
      let j = i + 1;
      while (j < stack.length && stack[j].step === stack[i].step && free(stack[j])) j++;
      if (j > i + 1 && j < stack.length && stack[j].step === stack[i].step && isY(stack[j])) {
        const word = rotationWord(rotationOf([stack[i].m, stack[j].m]));
        stack.splice(j, 1, ...word.map((m) => ({ ...stack[j], m })));
        stack.splice(i, 1);
        again = true;
      }
    }
  }
  for (let i = 0; i < stack.length; i++) {
    if (stack[i].kind !== "rotate") continue;
    let j = i;
    while (j + 1 < stack.length && stack[j + 1].kind === "rotate" && stack[j + 1].step === stack[i].step) j++;
    const word = rotationWord(rotationOf(stack.slice(i, j + 1).map((t) => t.m)));
    stack.splice(i, j - i + 1, ...word.map((m) => ({ ...stack[i], m })));
    i += word.length - 1;
  }
}

/**
 * After the white cross the cube is turned over (x2) so that yellow is on top for the rest of the solve
 * (steps 2-5 were solved in that orientation).
 */
function flipAfterCross(steps, yellowTop = false) {
  const addRotation = (parts, at, note) => {
    const near = parts[at === 0 ? 0 : parts.length - 1];
    if (near?.kind === "rotate") {
      const word = at === 0 ? ["x2", ...near.moves] : [...near.moves, "x2"];
      const moves = rotationWord(rotationOf(word));
      const rest = at === 0 ? parts.slice(1) : parts.slice(0, -1);
      if (!moves.length) return rest;
      return at === 0 ? [{ ...near, moves, note }, ...rest] : [...rest, { ...near, moves, note }];
    }
    const part = { kind: "rotate", moves: ["x2"], act: -1, note };
    return at === 0 ? [part, ...parts] : [...parts, part];
  };
  return steps.map((step, i) => {
    let parts = step.parts;
    if (i === (yellowTop ? 0 : 1)) parts = addRotation(parts, 0, "Turn the cube over: yellow on top");
    return { ...step, parts };
  });
}

// how awkward a turn is (the movecount coefficient punishes F and B, and rotations, the most)
const TURN_WEIGHT = { U: 1, R: 1, L: 1, D: 1.1, F: 1.3, B: 1.3 };
const ROTATE_WEIGHT = 3;
const FLIP_FACE = { U: "D", D: "U", F: "B", B: "F", R: "R", L: "L" }; // x2
const flipMove = (m) => FLIP_FACE[m[0]] + m.slice(1);
const weight = (moves) => moves.reduce((n, m) => n + TURN_WEIGHT[m[0]], 0);
const MIRROR_FACE = { R: "L", L: "R", U: "U", D: "D", F: "F", B: "B" };
/** Mirror image (left <-> right) of an algorithm. */
function mirrorAlg(moves) {
  return moves.map((m) => {
    const f = MIRROR_FACE[m[0]];
    return f + (m.length === 1 ? "'" : m[1] === "2" ? "2" : "");
  });
}

/** Table entry whose setup (and first turn) are turns of the top layer only. */
const setupIsU = (e) => e.setup.every((m) => m[0] === "U") && e.pre.every((m) => m[0] === "U");

const OPPOSITE = { U: "D", D: "U", F: "B", B: "F", R: "L", L: "R" };
function setupSequences(maxLen) {
  const turns = [];
  for (const f of FACES) for (const s of ["", "2", "'"]) turns.push(f + s);
  let seqs = [[]];
  let layer = [[]];
  for (let l = 0; l < maxLen; l++) {
    const next = [];
    for (const seq of layer) for (const t of turns) {
      const last = seq[seq.length - 1];
      if (last && last[0] === t[0]) continue;
      // canonical order for commuting opposite faces
      if (last && OPPOSITE[last[0]] === t[0] && FACES.indexOf(t[0]) < FACES.indexOf(last[0])) continue;
      next.push([...seq, t]);
    }
    seqs = seqs.concat(next);
    layer = next;
  }
  return seqs;
}

export class MarshallSolver {
  constructor(kpuzzle) {
    this.moves = buildMoveTables(kpuzzle);
    this.flatMoves = Object.fromEntries(Object.entries(this.moves).map(([k, v]) => [k, flatFromMove(v)]));
    this.solvedFlat = flatSolved();
    const x2 = kpuzzle.moveToTransformation("x2").transformationData;
    this.flipFlat = flatFromMove({
      ep: Uint8Array.from(x2.EDGES.permutation), eo: Uint8Array.from(x2.EDGES.orientationDelta),
      cp: Uint8Array.from(x2.CORNERS.permutation), co: Uint8Array.from(x2.CORNERS.orientationDelta),
    });
    this.crossDist = null;
    this.edgeTable = this.buildTable(EDGE_SERIES, { mirror: true, plain: true });
    this.cornerTable = this.buildTable(CORNER_SERIES, { anyFace: true });
    this.buildCrossTable();
  }

  run(flat, moves) {
    let s = flat;
    for (const m of moves) s = compose(s, this.flatMoves[m]);
    return s;
  }

  /**
   * All distinct transformations of  P S series S' , with their cheapest spellings.
   * A series can be written in any orientation (rotated or mirrored, e.g. F R' F' R ~ R U R' U' ~ U' L' U L)
   * without turning the cube, or in its canonical form between cube rotations; natural turns
   * (R U L D) are preferred to F and B, and rotations are expensive, like in the movecount coefficient.
   */
  buildTable(base, { anyFace = false, mirror = false, plain = false } = {}) {
    const baseMoves = parseAlg(base);
    const forms = new Map();
    for (const rot of ROTATIONS) {
      const word = rotationWord(rot);
      for (const canon of [baseMoves, invertAlg(baseMoves)]) {
        const alg = mapAlg(rot, canon);
        const add = (form) => forms.set(form.canon.join(" ") + "|" + form.word.join(" ") + "|" + form.alg.join(" "), form);
        if (plain || !word.length) add({ alg, canon: alg, word: [] });
        // the canonical text between rotations; the edge series keep white on top (y rotations only)
        if (word.length && (anyFace || rot.U === "U")) add({ alg, canon, word });
        if (mirror) {
          const m = mirrorAlg(alg);
          add({ alg: m, canon: m, word: [] });
        }
      }
    }
    const setups = setupSequences(2);
    const conj = new Map();
    for (const v of forms.values()) {
      for (const setup of setups) {
        const seq = [...setup, ...v.alg, ...invertAlg(setup)];
        const k = flatKey(this.run(this.solvedFlat, seq));
        const cost = 2 * weight(setup) + weight(v.canon) + 2 * ROTATE_WEIGHT * v.word.length;
        const alt = { setup, series: v.alg, canon: v.canon, word: v.word, cost };
        const cur = conj.get(k);
        if (!cur || cost < cur.cost - 1e-9) conj.set(k, { ...alt, alts: [alt] });
        else if (Math.abs(cost - cur.cost) < 1e-9 && cur.alts.length < 6) cur.alts.push(alt);
      }
    }
    const entries = new Map();
    const pres = [[]];
    for (const f of FACES) for (const s of ["", "2", "'"]) pres.push([f + s]);
    const scratch = new Uint8Array(N);
    for (const c of conj.values()) {
      const t = this.run(this.solvedFlat, [...c.setup, ...c.series, ...invertAlg(c.setup)]);
      for (const pre of pres) {
        const f = pre.length ? compose(this.flatMoves[pre[0]], t, scratch) : t;
        const cost = c.cost - weight(c.setup) + weight(mergeTurns([...pre, ...c.setup]));
        const k = hashFlat(f);
        const cur = entries.get(k);
        if (!cur || cost < cur.cost) entries.set(k, { flat: f === scratch ? scratch.slice() : f, pre, setup: c.setup, series: c.series, canon: c.canon, word: c.word, alts: c.alts, cost });
      }
    }
    // plain face turns are also available moves
    const list = [...entries.values()];
    for (const f of FACES) for (const s of ["", "2", "'"]) {
      const m = f + s;
      list.push({ flat: this.flatMoves[m], pre: [m], setup: [], series: [], cost: weight([m]) });
    }
    // the cross step already fixed edge parity, so only even transformations are useful
    for (const e of list) e.mask = solvedMask(e.flat);
    const even = list.filter((e) => this.edgeParity(e.flat) === 0);
    even.sort((a, b) => a.cost - b.cost);
    // odd-parity entries are only needed when F2L algorithms leave an odd edge permutation
    even.withOdd = list.sort((a, b) => a.cost - b.cost);
    // Step 2 does not care what happens to the top layer, so a series that ends with a turn of the top layer
    // (the sexy move R U R' U') can leave that last turn out. It changes the edge parity; the aligning
    // U turn at the end of step 3 puts that right again.
    if (plain) {
      const trimmed = new Map();
      for (const c of conj.values()) {
        const last = c.series[c.series.length - 1];
        if (c.word.length || c.series.join() !== c.canon.join() || !last || last[0] !== "U" || last.endsWith("2")) continue;
        const tser = c.series.slice(0, -1);
        const flat = this.run(this.solvedFlat, [...c.setup, ...tser, ...invertAlg(c.setup)]);
        const cost = c.cost - weight([last]);
        const k = hashFlat(flat);
        const cur = trimmed.get(k);
        if (!cur || cost < cur.cost) trimmed.set(k, { flat, pre: [], setup: c.setup, series: tser, canon: tser, word: [], cost, mask: solvedMask(flat), trim: true });
      }
      even.step2 = [...even, ...trimmed.values()].sort((a, b) => a.cost - b.cost);
    }
    return even;
  }

  /** F2L insertion macros (pre-alignment + algorithm) and the extraction moves that precede them. */
  buildF2LTable() {
    if (this.f2lTable) return this.f2lTable;
    const entries = new Map();
    const add = (map, pre, alg) => {
      const flat = this.run(this.solvedFlat, [...pre, ...alg]);
      const cost = mergeTurns([...pre, ...alg]).length;
      const k = flatKey(flat);
      const cur = map.get(k);
      if (!cur || cost < cur.cost) map.set(k, { flat, pre, setup: [], series: alg, cost });
    };
    for (const alg of F2L_ALGS) for (const pre of F2L_PRE) add(entries, pre, alg);
    const first = new Map();
    for (const alg of F2L_EXTRACTIONS) add(first, [], alg);
    const finish = (map) => [...map.values()].map((e) => ({ ...e, mask: solvedMask(e.flat) })).sort((a, b) => a.cost - b.cost);
    this.f2lTable = { table: finish(entries), first: finish(first) };
    return this.f2lTable;
  }

  // ---------- Step 1: cross ----------
  // The edge series are 3-cycles (even permutations). If the scramble has an odd
  // edge permutation, the cross has to be solved with an odd number of quarter
  // turns, otherwise the last two edges could never be finished. So the cross
  // search also tracks the parity of quarter turns used.
  buildCrossTable() {
    if (this.crossDist) return;
    const sig = (f) => {
      let k = 0;
      for (let i = 0; i < 12; i++) {
        const piece = f[i];
        if (piece < 4) k += (i * 2 + f[12 + i]) * CROSS_BASE[piece];
      }
      return k * 2;
    };
    const names = Object.keys(this.flatMoves);
    const quarter = (nm) => (nm.length === 1 || nm[1] === "'" ? 1 : 0);
    // piece at old position p goes to dest[p] and flips by flip[p]
    const dest = [], flip = [];
    for (const nm of names) {
      const m = this.flatMoves[nm];
      const d = new Uint8Array(12), fl = new Uint8Array(12);
      for (let i = 0; i < 12; i++) { d[m[i]] = i; fl[m[i]] = m[12 + i]; }
      dest.push(d); flip.push(fl);
    }
    const q = names.map(quarter);
    const size = 24 ** 4 * 2;
    const dist = new Int8Array(size).fill(-1);
    // state: radix-24 digits (position*2 + orientation) of the four cross edges, times 2, plus quarter-turn parity
    const solvedKey = sig(this.solvedFlat);
    dist[solvedKey] = 0;
    // flattened tables: nextDigit[m][pos*2+ori] = new digit
    const nextDigit = dest.map((d, m) => {
      const t = new Uint8Array(24);
      for (let pos = 0; pos < 12; pos++) for (let ori = 0; ori < 2; ori++) t[pos * 2 + ori] = d[pos] * 2 + (ori ^ flip[m][pos]);
      return t;
    });
    let layer = new Int32Array([solvedKey]);
    let d = 0;
    while (layer.length) {
      const next = new Int32Array(layer.length * 18);
      let nn = 0;
      d++;
      for (let li = 0; li < layer.length; li++) {
        const key = layer[li];
        const par = key & 1;
        const rest = key >> 1;
        const d0 = rest % 24, d1 = ((rest / 24) | 0) % 24, d2 = ((rest / 576) | 0) % 24, d3 = (rest / 13824) | 0;
        for (let m = 0; m < 18; m++) {
          const t = nextDigit[m];
          const k = (t[d0] + t[d1] * 24 + t[d2] * 576 + t[d3] * 13824) * 2 + (par ^ q[m]);
          if (dist[k] < 0) { dist[k] = d; next[nn++] = k; }
        }
      }
      layer = next.subarray(0, nn);
    }
    this.crossDist = { get: (k) => dist[k] };
    this.crossSig = sig;
    this.quarter = quarter;
  }

  edgeParity(f) {
    const seen = PARITY_SEEN.fill(0);
    let p = 0;
    for (let i = 0; i < 12; i++) {
      if (seen[i]) continue;
      let len = 0, j = i;
      while (!seen[j]) { seen[j] = 1; j = f[j]; len++; }
      p ^= (len - 1) & 1;
    }
    return p;
  }

  /** variant picks a different (equally short) cross by rotating the move order. */
  solveCross(flat, variant = 0) {
    this.buildCrossTable();
    const all = Object.keys(this.flatMoves);
    const names = all.map((_, i) => all[(i + variant * 5) % all.length]);
    const out = [];
    let s = flat;
    let need = this.edgeParity(flat);
    let d = this.crossDist.get(this.crossSig(s) + need);
    while (d > 0) {
      let moved = false;
      for (const nm of names) {
        const n = compose(s, this.flatMoves[nm]);
        const np = need ^ this.quarter(nm);
        if (this.crossDist.get(this.crossSig(n) + np) === d - 1) { out.push(nm); s = n; need = np; d--; moved = true; break; }
      }
      if (!moved) throw new Error("cross search failed");
    }
    return { moves: out, state: s };
  }

  // ---------- table driven steps ----------
  solvedEdges(f, set) { return set.filter((i) => f[i] === i && f[12 + i] === 0); }
  solvedCorners(f, set) { return set.filter((i) => f[24 + i] === i && f[32 + i] === 0); }

  /**
   * Repeatedly apply the best table entry (most pieces gained, then cheapest)
   * that keeps every currently solved piece solved, until the goal is reached.
   * `target` = {edges:[...], corners:[...]} are the pieces being counted; `count`
   * overrides that with a custom score on a full state; `first` lists entries that
   * may start a two-step lookahead (default: the cheapest table entries).
   */
  climb(flat, table, { target, goal, count: customCount, first, pick = 0 }) {
    const actions = [];
    let s = flat;
    const buf = new Uint8Array(N);
    const count = customCount ?? ((f) => countTarget(f, target));
    let guard = 0;
    while (count(s) < goal) {
      if (++guard > 40) throw new Error("climb did not converge");
      const base = count(s);
      const kept = solvedMask(s);
      let best = null, bestScore = -1, bestCost = Infinity;
      const options = pick && guard === 1 ? [] : null; // alternative first moves, to compare by movecount coefficient
      for (const e of table) {
        if (best && e.cost > bestCost + 6) break;
        if (kept & ~e.mask) continue; // would disturb a finished piece
        let after;
        if (customCount) { compose(s, e.flat, buf); after = customCount(buf); }
        else after = countTargetAfter(s, e.flat, target);
        const gain = after - base;
        if (gain < 1) continue;
        const score = gain * 100 - e.cost;
        options?.push({ e, score });
        if (score > bestScore) { best = e; bestScore = score; bestCost = e.cost; }
      }
      if (options?.length > 1) {
        options.sort((a, b) => b.score - a.score || a.e.cost - b.e.cost);
        best = options[Math.min(pick, options.length - 1)].e;
      }
      if (!best) {
        const part = target.edges.length ? "edges" : "corners";
        const full = target.edges.length === 12 || target.corners.length === 8;
        const fin = full ? this.finish(s, table, part) : null;
        if (fin) {
          for (const e of fin) { actions.push(e); s = compose(s, e.flat); }
          continue;
        }
        const two = this.lookahead(s, table, { count, customCount, target, kept, base, first });
        if (!two) throw new Error("stuck");
        for (const e of two) { actions.push(e); s = compose(s, e.flat); }
        continue;
      }
      actions.push(best);
      s = compose(s, best.flat);
    }
    return { actions, state: s };
  }

  /** Two table entries in a row (the first may temporarily break things). */
  lookahead(s, table, { count, customCount, target, kept, base, first }) {
    for (const width of first ? [6000] : [250, 1500]) {
      const found = this.lookaheadWindow(s, table, width, { count, customCount, target, kept, base, first });
      if (found) return found;
    }
    return null;
  }

  lookaheadWindow(s, table, width, { count, customCount, target, kept, base, first }) {
    const cheap = table.slice(0, width);
    const starts = first ?? cheap;
    const keptE = [], keptC = [];
    for (let i = 0; i < 12; i++) if (kept & (1 << i)) keptE.push(i);
    for (let i = 0; i < 8; i++) if (kept & (1 << (12 + i))) keptC.push(i);
    const full = new Uint8Array(N), mid = new Uint8Array(N);
    let best = null, bestScore = -Infinity;
    for (const a of starts) {
      const af = a.flat;
      for (const b of cheap) {
        if (best && a.cost + b.cost > best.cost + 4) break;
        const bf = b.flat;
        // finished pieces must survive both entries (checked without composing)
        let ok = true;
        for (const i of keptE) {
          const p = bf[i], q = af[p];
          if (s[q] !== i || ((s[12 + q] + af[12 + p] + bf[12 + i]) & 1)) { ok = false; break; }
        }
        if (!ok) continue;
        for (const i of keptC) {
          const p = bf[24 + i], q = af[24 + p];
          if (s[24 + q] !== i || (s[32 + q] + af[32 + p] + bf[32 + i]) % 3) { ok = false; break; }
        }
        if (!ok) continue;
        let after;
        if (customCount) { compose(s, af, mid); compose(mid, bf, full); after = customCount(full); }
        else {
          after = 0;
          for (const i of target.edges) {
            const p = bf[i], q = af[p];
            if (s[q] === i && !((s[12 + q] + af[12 + p] + bf[12 + i]) & 1)) after++;
          }
          for (const i of target.corners) {
            const p = bf[24 + i], q = af[24 + p];
            if (s[24 + q] === i && !((s[32 + q] + af[32 + p] + bf[32 + i]) % 3)) after++;
          }
        }
        const gain = after - base;
        if (gain < 1) continue;
        const score = gain * 100 - a.cost - b.cost;
        if (score > bestScore) { bestScore = score; best = [a, b]; best.cost = a.cost + b.cost; }
      }
    }
    return best;
  }

  /**
   * Meet-in-the-middle finish: find entries a, b with  state*a*b  fully solving
   * `part` ("edges" or "corners"). Used when no single entry makes progress.
   */
  finish(s, table, part) {
    const cfg = part === "edges" ? { n: 12, p: 0, o: 12, mod: 2 } : { n: 8, p: 24, o: 32, mod: 3 };
    const usable = this.usableFor(table, part);
    if (!usable.partIndex) usable.partIndex = {};
    if (!usable.partIndex[part]) {
      const idx = new Map();
      for (const e of usable) {
        const h = hashPart(e.flat, cfg);
        const bucket = idx.get(h);
        if (!bucket) idx.set(h, [e]);
        else if (!bucket.some((x) => samePart(x.flat, e.flat, cfg))) bucket.push(e);
      }
      usable.partIndex[part] = idx;
    }
    const idx = usable.partIndex[part];
    const n = new Uint8Array(N);
    let best = null, bestCost = Infinity;
    const identity = { flat: this.solvedFlat, pre: [], setup: [], series: [], cost: 0 };
    for (const a of [identity, ...usable]) {
      if (a.cost >= bestCost) break;
      composePart(s, a.flat, n, cfg);
      const inv = invertPart(n, cfg);
      const bucket = idx.get(hashPart(inv, cfg));
      if (!bucket) continue;
      for (const b of bucket) {
        if (samePart(b.flat, inv, cfg) && a.cost + b.cost < bestCost) {
          best = a === identity ? [b] : [a, b];
          bestCost = a.cost + b.cost;
        }
      }
    }
    return best;
  }

  /** Corner finishing must not disturb the (already solved) edges. */
  usableFor(table, part) {
    if (part === "edges") return table;
    if (!table.edgeSafe) {
      table.edgeSafe = table.filter((e) => (e.mask & 0xfff) === 0xfff);
    }
    return table.edgeSafe;
  }

  // ---------- full solve ----------
  /** Movecount coefficient of a step's parts, as they will be written (turns cancelled within the step). */
  mcc(parts) {
    const [step] = optimizeSteps([{ name: "", parts }]);
    return movecount(step.parts.flatMap((p) => p.moves));
  }

  /** Distinct candidates from make(0..picks-1), best (lowest movecount coefficient) first. */
  rank(make, picks = 6, penalty = null) {
    const seen = new Map();
    for (let pick = 0; pick < picks; pick++) {
      let c;
      try { c = make(pick); } catch { continue; }
      const key = c.parts.map((p) => p.kind + ":" + p.moves.join(" ")).join("|");
      if (seen.has(key)) continue;
      c.score = this.mcc(c.parts) + (penalty ? penalty(c) : 0);
      seen.set(key, c);
    }
    return [...seen.values()].sort((a, b) => a.score - b.score);
  }

  /**
   * The cross is always built on the top (white) face. Several equally short
   * crosses lead to different later steps; every step offers a few candidates and
   * the one with the lowest movecount coefficient wins (falling back to the next
   * candidate if a later step cannot be finished from it).
   */
  solve(scrambleMoves, options = {}) {
    const { yellowTop = false, beginner = false } = options;
    const start = this.run(this.solvedFlat, scrambleMoves);
    if (beginner) {
      this.actionId = 0;
      try {
        return { ...this.solveFrom(this.beginnerCross(start), { ...options, yellowTop: true }), crossFace: "D" };
      } catch (e) {
        return { error: e.message };
      }
    }
    const crosses = new Map();
    for (let variant = 0; variant < 12; variant++) {
      const c = this.solveCross(start, variant);
      const moves = yellowTop ? c.moves.map(flipMove) : c.moves; // as seen with yellow on top
      const key = moves.join(" ");
      if (!crosses.has(key)) crosses.set(key, { ...c, moves, score: movecount(moves) });
    }
    let firstError = null;
    for (const cross of [...crosses.values()].sort((a, b) => a.score - b.score)) {
      try {
        return { ...this.solveFrom(cross, options), crossFace: yellowTop ? "D" : "U" };
      } catch (e) {
        firstError ??= e.message;
      }
    }
    return { error: firstError };
  }

  /**
   * Beginner cross: with yellow on top, first the "daisy" (the four white edges around the yellow
   * centre, white facing up), then each petal is turned above its centre and a half turn (180 degrees)
   * drops it into the white cross. Works in the turned-over frame (white edges are DF DR DB DL = 4..7).
   */
  beginnerCross(start) {
    const flipped = compose(compose(this.flipFlat, start), this.flipFlat);
    const names = Object.keys(this.moves);
    // a white edge is one of 24 values (position * 2 + orientation); trans[move][value] = value after the move
    const trans = names.map((m) => {
      const t = this.moves[m], inv = new Uint8Array(12), out = new Uint8Array(24);
      for (let i = 0; i < 12; i++) inv[t.ep[i]] = i;
      for (let pos = 0; pos < 12; pos++) for (let o = 0; o < 2; o++) {
        const np = inv[pos];
        out[pos * 2 + o] = np * 2 + ((o + t.eo[np]) & 1);
      }
      return out;
    });
    const apply = (st, mi) => st.map((v) => trans[mi][v]);
    const keyOf = (st) => st[0] + 24 * st[1] + 576 * st[2] + 13824 * st[3];
    const unkey = (k) => [k % 24, Math.floor(k / 24) % 24, Math.floor(k / 576) % 24, Math.floor(k / 13824)];
    const startSt = [];
    for (let piece = 4; piece < 8; piece++) {
      const pos = flipped.slice(0, 12).indexOf(piece);
      startSt.push(pos * 2 + flipped[12 + pos]);
    }
    const quarters = (m) => (m.length === 1 || m[1] === "'" ? 1 : 0);
    const need = this.edgeParity(flipped);
    const done = (st) => st.every((v) => v < 8 && !(v & 1)); // top layer, white facing up
    const solved = (st) => st.every((v, k) => v === (4 + k) * 2);
    if (solved(startSt)) return { moves: [], parts: [], state: flipped, flipped: true, name: "The Cross" };

    // BFS over the four white edges; every daisy found is finished by the best order of half turns
    const SIZE = 24 ** 4;
    const from = new Int32Array(SIZE).fill(-2), via = new Int8Array(SIZE);
    const startKey = keyOf(startSt);
    from[startKey] = -1;
    let layer = [startKey];
    const goals = [];
    let evaluated = 0;
    const pathOf = (key) => {
      const out = [];
      for (let k = key; from[k] >= 0; k = from[k]) out.push(names[via[k]]);
      return out.reverse();
    };
    const perms = [];
    const permute = (a, rest) => { if (!rest.length) perms.push(a); rest.forEach((x, i) => permute([...a, x], rest.filter((_, j) => j !== i))); };
    permute([], [0, 1, 2, 3]);
    const U = names.indexOf("U");
    const halves = ["F", "R", "B", "L"].map((f) => names.indexOf(f + "2"));
    const finish = (daisy, base) => { // best order of inserting the petals after a daisy path
      let best = null;
      for (const order of perms) {
        let st = base;
        const inserts = [];
        let ok = true;
        for (const k of order) {
          let c = 0;
          while (st[k] >> 1 !== k && c < 4) { st = apply(st, U); c++; }
          const turns = c === 1 ? ["U"] : c === 2 ? ["U2"] : c === 3 ? ["U'"] : [];
          st = apply(st, halves[k]);
          if (st[k] !== (4 + k) * 2) { ok = false; break; }
          inserts.push([...turns, ["F", "R", "B", "L"][k] + "2"]);
        }
        if (!ok) continue;
        const all = [...daisy, ...inserts.flat()];
        if (all.reduce((n, m) => n + quarters(m), 0) % 2 !== need) continue;
        const len = mergeTurns(all).length;
        if (!best || len < best.len) best = { len, inserts };
      }
      return best && { daisy, ...best };
    };
    for (let depth = 0; depth < 12 && !(goals.length && depth > goals[0].depth + 1); depth++) {
      const next = [];
      for (const key of layer) {
        const st = unkey(key);
        if (done(st) && evaluated < 400) {
          evaluated++;
          const r = finish(pathOf(key), st);
          if (r) goals.push({ ...r, depth });
        }
        for (let mi = 0; mi < names.length; mi++) {
          const t = trans[mi];
          const nk = t[st[0]] + 24 * t[st[1]] + 576 * t[st[2]] + 13824 * t[st[3]];
          if (from[nk] !== -2) continue;
          from[nk] = key;
          via[nk] = mi;
          next.push(nk);
        }
      }
      layer = next;
    }
    if (!goals.length) throw new Error("beginner cross not found");
    goals.sort((a, b) => a.len - b.len || movecount([...a.daisy, ...a.inserts.flat()]) - movecount([...b.daisy, ...b.inserts.flat()]));
    const g = goals[0];
    const parts = [];
    if (g.daisy.length) parts.push({ kind: "daisy", moves: g.daisy, act: this.actionId++, note: "Daisy: bring the four white edges up around the yellow centre, white facing up" });
    for (const ins of g.inserts) parts.push({ kind: "insert", moves: ins, act: this.actionId++, note: "Turn the top layer so the white edge is above its centre, then a half turn (180°) drops it into the white cross" });
    const moves = parts.flatMap((p) => p.moves);
    return { moves, parts, state: this.run(flipped, moves), flipped: true, name: "The Cross (beginner: daisy, then half turns)" };
  }

  step2Candidates(state, f2l) {
    const mid = { target: { edges: MIDDLE, corners: [] }, goal: 3 };
    const plain = (pick) => {
      const r = this.climb(state, this.edgeTable.step2, { ...mid, pick });
      return { name: "3 Center Section Edge Pieces", parts: this.actionsToParts(r.actions, "edge"), state: r.state, corners: [], pairs: 0 };
    };
    if (!f2l) return this.rank(plain);
    // Partial F2L: three corner-edge pairs next to the cross, then the other five edges with
    // series that leave those corners alone. Two ways to get the pairs (F2L insertion algorithms,
    // or Marshall's own edge + corner series); the better one by movecount coefficient wins.
    const bySeries = (pick) => {
      const r = plain(pick);
      const corners = this.solvedEdges(r.state, MIDDLE).slice(0, 3).map((e) => PAIR_CORNER[e]);
      const rc = this.climb(r.state, this.cornerTable, { target: { edges: [], corners }, goal: corners.length });
      return { name: "3 F2L Pairs", parts: [...r.parts, ...this.actionsToParts(rc.actions, "corner")], state: rc.state, corners, pairs: corners.length };
    };
    const all = [...this.rank((pick) => this.f2lByAlgorithms(state, pick)), ...this.rank(bySeries)].sort((a, b) => a.score - b.score);
    return all.length ? all : this.rank(plain);
  }

  solveFrom(cross, { f2l = false, yellowTop = false, openSlot = false, lastLayer = false } = {}) {
    this.uOnly = openSlot; // edge series are set up with U turns only (they work at the open slot)
    if (!cross.parts) this.actionId = 0;
    const edgeTarget = { target: { edges: ALL_EDGES, corners: [] }, goal: 12 };
    // step 4 ends with at least 5 corners home and the rest (2 or 3) on one side, ready for the end game
    const fiveOnASide = (f) => {
      const n = this.solvedCorners(f, ALL_CORNERS).length;
      return n >= 5 && unsolvedOnOneSide(f, lastLayer) ? n : Math.min(n, 4);
    };
    const cornerStage = (name, goal, count, picks = 6, penalty = null) => (s) => this.rank((pick) => {
      const r = this.climb(s, this.cornerTable, { target: { edges: [], corners: ALL_CORNERS }, goal, count, pick });
      return { parts: this.actionsToParts(r.actions, "corner"), state: r.state };
    }, picks, penalty).map((c) => ({ ...c, name }));
    // the end game is usually: rotate, 1-3 setup turns, one Niklas, repair - look for that first
    const endGame = (s) => {
      const hit = this.endgameSingle(s);
      const single = hit ? [{ parts: this.actionsToParts([hit], "corner"), state: compose(s, hit.flat), name: "The End Game" }] : [];
      for (const c of single) c.score = this.mcc(c.parts);
      return [...single, ...cornerStage("The End Game", 8)(s)].sort((a, b) => a.score - b.score);
    };
    // step 4 is judged by what it leaves: a position the end game solves with a single Niklas counts for a lot
    const leavesSingle = (c) => (this.endgameSingle(c.state) ? 0 : 25);
    const stages = [
      (s) => this.step2Candidates(s, f2l),
      // step 3: down to the key position - one middle-layer edge and two top-layer edges are wrong and one
      // hedgeslammer / sledgehammer / sexy move (no setup) finishes them. Step 4 is that one series.
      (s, ctx) => this.rank((pick) => {
        const need = ctx.corners.reduce((m, i) => m | (1 << (12 + i)), 0);
        let r;
        try {
          r = this.reachKey(s, ctx.corners, edgeTarget, pick);
        } catch {
          r = this.finishEdges(s, ctx.corners, edgeTarget, pick); // no key position within reach: solve the edges outright
        }
        return { parts: this.actionsToParts(r.actions, "edge"), state: r.state };
      }, 8).map((c) => ({ ...c, name: "Top Edge Pieces" })),
      (s, ctx) => this.lastEdges(s, ctx.corners).map((c) => ({ ...c, name: "Last Three Edge Pieces" })),
      cornerStage("Five Corner Pieces", 5, fiveOnASide, 10, leavesSingle),
      endGame,
    ];
    const go = (i, s, ctx) => {
      if (i === stages.length) {
        if (flatKey(s) !== flatKey(this.solvedFlat)) throw new Error("internal error: cube not solved");
        return [];
      }
      for (const c of stages[i](s, ctx)) {
        try {
          return [c, ...go(i + 1, c.state, { corners: c.corners ?? ctx.corners, pairs: c.pairs ?? ctx.pairs })];
        } catch { /* try the next candidate */ }
      }
      throw new Error("stuck");
    };
    // turn the cube over (x2): the rest is solved with yellow on top, the cross layer below
    const flipped = cross.flipped ? cross.state : compose(compose(this.flipFlat, cross.state), this.flipFlat);
    const chosen = go(0, flipped, { corners: [], pairs: 0 });
    const rawSteps = [
      { name: cross.name ?? "The Cross", parts: cross.parts ?? (cross.moves.length ? [{ kind: "turns", moves: cross.moves }] : []) },
      ...chosen.map((c) => ({ name: c.name, parts: c.parts })),
    ];
    const stripped = stripEnds(flipAfterCross(optimizeSteps(rawSteps), yellowTop));
    const steps = stripped.steps.map((st) => ({ ...st, mcc: movecount(st.parts.flatMap((p) => p.moves)) }));
    const all = steps.flatMap((st) => st.parts.flatMap((p) => p.moves));
    return {
      steps, total: steps.reduce((n, st) => n + st.count, 0), solution: all, mcc: movecount(all), f2lPairs: chosen[0].pairs,
      setupRotation: stripped.setupRotation, restoreRotation: stripped.restoreRotation,
    };
  }

  /** Corner-preserving finish of the five remaining edges after the pairs are in. */
  finishEdges(state, corners, edgeTarget, pick = 0, count = null) {
    const need = corners.reduce((m, i) => m | (1 << (12 + i)), 0);
    const source = this.edgeParity(state) ? this.edgeTable.withOdd : this.edgeTable;
    let keep = need ? source.filter((e) => !(need & ~e.mask)) : source;
    if (this.uOnly) keep = keep.filter(setupIsU);
    return this.climb(state, keep, { ...edgeTarget, pick, ...(count ? { count } : {}) });
  }

  /**
   * Table entries (a series with its setup) that finish all edges from f, cheapest first. `need` = corners that must stay put.
   * A bare Hedgeslammer / Sledgehammer / sexy move is the cheapest kind of entry, so those come first when they fit.
   */
  singleFinishers(f, need) {
    const odd = this.edgeParity(f);
    const key = odd + ":" + need + ":" + !!this.uOnly;
    this._finisherIndex ??= new Map();
    let index = this._finisherIndex.get(key);
    const cfg = { n: 12, p: 0, o: 12, mod: 2 };
    if (!index) {
      const source = odd ? this.edgeTable.withOdd : this.edgeTable;
      index = new Map();
      for (const e of source) {
        if (!e.series.length || (need & ~e.mask) || (this.uOnly && !setupIsU(e))) continue;
        const h = hashPart(e.flat, cfg);
        if (!index.has(h)) index.set(h, []);
        index.get(h).push(e);
      }
      this._finisherIndex.set(key, index);
    }
    const want = invertPart(f, cfg);
    return (index.get(hashPart(want, cfg)) ?? []).filter((e) => samePart(e.flat, want, cfg));
  }

  /** The key position of step 3: one middle-layer edge and two last-layer edges are wrong, and one series finishes them. */
  keyCount(need) {
    return (f) => {
      let n = 0, mid = 0, last = 0;
      for (let i = 0; i < 12; i++) {
        if (f[i] === i && f[12 + i] === 0) n++;
        else if (i >= 8) mid++;
        else if (i < 4) last++;
      }
      return n === 9 && mid === 1 && last === 2 && this.singleFinishers(f, need).length ? 12 : n;
    };
  }

  /**
   * Series (with setup) until the key position is reached: the first depth at which one table entry lands in it
   * wins, so the fewest series are used; `pick` takes alternatives. The optional aligning top-layer turn of the
   * final series closes the step.
   */
  reachKey(state, corners, edgeTarget, pick = 0) {
    const need = corners.reduce((m, i) => m | (1 << (12 + i)), 0);
    const source = this.edgeParity(state) ? this.edgeTable.withOdd : this.edgeTable;
    let table = need ? source.filter((e) => !(need & ~e.mask)) : source;
    if (this.uOnly) table = table.filter(setupIsU);
    const cfg = { n: 12, p: 0, o: 12, mod: 2 };
    const solved = (f) => { for (let i = 0; i < 12; i++) if (f[i] !== i || f[12 + i] !== 0) return false; return true; };
    const count = this.keyCount(need);
    const buf = new Uint8Array(N);
    const turnAction = (m) => ({ flat: this.flatMoves[m], pre: [m], setup: [], series: [], cost: weight([m]), mask: solvedMask(this.flatMoves[m]) });
    // an aligning U turn that the finishing series starts with belongs to this step
    const align = (s) => {
      const best = this.singleFinishers(s, need).slice().sort((a, b) => a.pre.length - b.pre.length)[0];
      return best && best.pre.length === 1 && best.pre[0][0] === "U" && !best.setup.length ? best.pre[0] : null;
    };
    const actions = [];
    let s = state;
    for (let depth = 0; depth < 8; depth++) {
      if (solved(s)) return { actions, state: s };
      if (count(s) === 12) {
        const m = align(s);
        return m ? { actions: [...actions, turnAction(m)], state: compose(s, this.flatMoves[m]) } : { actions, state: s };
      }
      const kept = solvedMask(s);
      const hits = [];
      const choice = Math.floor(pick / 4 ** depth) % 4; // which alternative to take at this depth
      for (const e of table) {
        if (hits.length > choice + 3) break;
        if (kept & ~e.mask) continue;
        composePart(s, e.flat, buf, cfg);
        if (count(buf) === 12) hits.push(e);
      }
      if (hits.length) {
        const e = hits[Math.min(choice, hits.length - 1)];
        let after = compose(s, e.flat);
        const list = [...actions, e];
        const m = align(after);
        if (m) { list.push(turnAction(m)); after = compose(after, this.flatMoves[m]); }
        return { actions: list, state: after };
      }
      // the key position counts for more than all edges home, so that the last three edges stay a step of their own
      const rate = (f) => { const c = count(f); return c === 12 ? (solved(f) ? 10 : 11) : Math.min(c, 9); };
      const step = this.climb(s, table, { ...edgeTarget, count: rate, goal: rate(s) + 1, pick: choice });
      actions.push(...step.actions);
      s = step.state;
    }
    throw new Error("no key position");
  }

  /** Step 4: the one series that finishes the edges from the key position (nothing to do when they are home). */
  lastEdges(s, corners) {
    const need = corners.reduce((m, i) => m | (1 << (12 + i)), 0);
    const solved = (f) => { for (let i = 0; i < 12; i++) if (f[i] !== i || f[12 + i] !== 0) return false; return true; };
    if (solved(s)) return [{ parts: [], state: s, score: 0 }];
    return this.singleFinishers(s, need).slice(0, 12).map((e) => {
      const parts = this.actionsToParts([e], "edge");
      return { parts, state: compose(s, e.flat), score: this.mcc(parts) };
    }).filter((c) => solved(c.state)).sort((a, b) => a.score - b.score).slice(0, 6);
  }

  /** Three F2L pairs by insertion algorithms (null-safe: throws if the table cannot do it). */
  f2lByAlgorithms(state, pick = 0) {
    const { table, first } = this.buildF2LTable();
    const pairCount = (f) => {
      let n = 0;
      for (const e of MIDDLE) {
        const c = PAIR_CORNER[e];
        if (f[e] === e && f[12 + e] === 0 && f[24 + c] === c && f[32 + c] === 0) n += 2;
      }
      return n;
    };
    const rp = this.climb(state, table, { target: { edges: [], corners: [] }, goal: 6, count: pairCount, first, pick });
    const corners = MIDDLE.filter((e) => rp.state[e] === e && rp.state[12 + e] === 0).map((e) => PAIR_CORNER[e])
      .filter((c) => rp.state[24 + c] === c && rp.state[32 + c] === 0);
    // which pair does each algorithm insert (or, for the turns before it, free)? - for the text above the cubes
    const solvedPairs = (f) => MIDDLE.filter((e) => f[e] === e && f[12 + e] === 0 && f[24 + PAIR_CORNER[e]] === PAIR_CORNER[e] && f[32 + PAIR_CORNER[e]] === 0);
    let st = state;
    const tagged = rp.actions.map((a) => {
      const before = solvedPairs(st);
      st = compose(st, a.flat);
      const added = solvedPairs(st).find((e) => !before.includes(e));
      return { ...a, pairEdge: added };
    });
    for (let i = tagged.length - 2; i >= 0; i--) if (tagged[i].pairEdge === undefined && tagged[i + 1].pairEdge !== undefined) tagged[i].pairFor = tagged[i + 1].pairEdge;
    return { name: "3 F2L Pairs", parts: this.actionsToParts(tagged, "f2l"), state: rp.state, corners, pairs: 3 };
  }

  /** Of the equally cheap spellings of an action, the one with the lowest movecount coefficient. */
  nicest(a) {
    if (!a.alts || a.alts.length < 2) return a;
    let best = null, bestScore = Infinity;
    // an action that was chosen for its U-only setup keeps to such spellings
    const alts = this.uOnly && a.series.length && setupIsU(a) ? a.alts.filter((alt) => alt.setup.every((m) => m[0] === "U")) : a.alts;
    for (const alt of alts) {
      const score = movecount([...a.pre, ...this.inFrame(alt)]);
      if (score < bestScore) { best = alt; bestScore = score; }
    }
    return { ...a, setup: best.setup, series: best.series, canon: best.canon, word: best.word };
  }

  /** rotate, setup turns (as seen after the rotation), the series, the repair (undo), rotate back. */
  inFrame(a) {
    const word = a.word ?? [];
    if (!word.length) return [...a.setup, ...(a.canon ?? a.series), ...invertAlg(a.setup)];
    const frame = rotationOf(word); // position -> cube face after the rotation
    const position = {};
    for (const p of FACES) position[frame[p]] = p;
    const setup = a.setup.map((m) => position[m[0]] + m.slice(1));
    return [...word, ...setup, ...a.canon, ...invertAlg(setup), ...invertRotationWord(word)];
  }

  actionsToParts(actions, kind) {
    const parts = [];
    for (const orig of actions) {
      const act = this.actionId++;
      const a = this.nicest(orig);
      if (a.pre.length && !a.series.length) { parts.push({ kind: "turns", moves: a.pre, act }); continue; }
      if (a.pre.length) parts.push({ kind: "turns", moves: a.pre, act });
      const word = a.word ?? [];
      let setup = a.setup;
      if (word.length) {
        const frame = rotationOf(word);
        const position = {};
        for (const p of FACES) position[frame[p]] = p;
        setup = a.setup.map((m) => position[m[0]] + m.slice(1));
        parts.push({ kind: "rotate", moves: word, act });
      }
      if (setup.length) parts.push({ kind: "setup", moves: setup, act });
      parts.push({ kind, moves: a.canon ?? a.series, act, ...(a.pairEdge !== undefined ? { pair: a.pairEdge } : a.pairFor !== undefined ? { pair: a.pairFor, frees: true } : {}) });
      if (setup.length) parts.push({ kind: "undo", moves: invertAlg(setup), act });
      if (word.length) parts.push({ kind: "rotate", moves: invertRotationWord(word), act });
    }
    return parts;
  }

  /**
   * Everything one Niklas can do after a rotation and 0-3 setup turns (and the repair afterwards):
   * a lookup from the corner change it makes to the cheapest spellings. Built once, on first use.
   */
  endgameTable() {
    if (this._endgame) return this._endgame;
    const cfg = { n: 8, p: 24, o: 32, mod: 3 };
    const base = parseAlg(CORNER_SERIES);
    const setups = setupSequences(3);
    const map = new Map();
    for (const rot of ROTATIONS) {
      const word = rotationWord(rot);
      for (const canon of [base, invertAlg(base)]) {
        const series = mapAlg(rot, canon);
        const sflat = this.run(this.solvedFlat, series);
        for (const inner of setups) { // turns as seen after the rotation
          const setup = mapAlg(rot, inner);
          // setup . series . repair
          let f = this.run(this.solvedFlat, setup);
          f = compose(f, sflat);
          f = this.run(f, invertAlg(setup));
          const cost = 2 * weight(inner) + weight(canon) + 2 * ROTATE_WEIGHT * word.length;
          const h = hashPart(f, cfg);
          const alt = { setup, series, canon, word, cost };
          let bucket = map.get(h);
          if (!bucket) map.set(h, (bucket = []));
          let entry = bucket.find((x) => samePart(x.flat, f, cfg));
          if (!entry) { entry = { flat: f, pre: [], setup, series, canon, word, cost, alts: [alt] }; bucket.push(entry); }
          if (cost < entry.cost - 1e-9) Object.assign(entry, { setup, series, canon, word, cost, alts: [alt] });
          else if (cost < entry.cost + 1 && entry.alts.length < 8) entry.alts.push(alt);
        }
      }
    }
    this._endgame = { map, cfg };
    return this._endgame;
  }

  /** The cheapest pairs of such macros that finish the cube from s (two Niklas always suffice). */
  endgameDouble(s, limit = 6) {
    const { map, cfg } = this.endgameTable();
    this._endgameList ??= [...map.values()].flat();
    const n = new Uint8Array(N);
    const found = [];
    for (const a of this._endgameList) {
      composePart(s, a.flat, n, cfg);
      const inv = invertPart(n, cfg);
      const bucket = map.get(hashPart(inv, cfg));
      const b = bucket?.find((x) => samePart(x.flat, inv, cfg));
      if (b) found.push({ a, b, cost: a.cost + b.cost });
    }
    return found.sort((x, y) => x.cost - y.cost).slice(0, limit);
  }

  /** One rotation, a few setup turns, one Niklas and the repair that finish the cube from s - or null. */
  endgameSingle(s) {
    const { map, cfg } = this.endgameTable();
    const want = invertPart(s, cfg);
    const bucket = map.get(hashPart(want, cfg));
    const hit = bucket?.find((x) => samePart(x.flat, want, cfg));
    return hit ?? null;
  }
}
