// Philip Marshall's method, implemented on top of two "series":
//   Edge Piece Series   F R' F' R           (3-cycles edges; corners are collateral)
//   Corner Piece Series U R U' L' U R' U' L (3-cycles corners; edges untouched)
// Every move the solver makes is a face turn or a series, optionally wrapped in
// setup turns that are undone afterwards (conjugation) - just like the written method.
import {
  buildMoveTables, parseAlg, invertAlg, emptyState, applyTo, FACES,
} from "./cube.js";
import { F2L_ALGS, F2L_EXTRACTIONS, F2L_PRE } from "./f2l.js";
import {
  N, flatFromMove, flatFromState, flatSolved, compose, flatKey, ROTATIONS, mapAlg,
} from "./flat.js";

export const EDGE_SERIES = "F R' F' R";
export const CORNER_SERIES = "U R U' L' U R' U' L";

const PARITY_SEEN = new Uint8Array(12);
const CROSS_BASE = [1, 24, 576, 13824]; // radix for the four cross edges UF UR UB UL
const MIDDLE = [8, 9, 10, 11]; // FR FL BR BL
// top-layer corner that forms an F2L pair with each center-section edge (FR FL BR BL)
const PAIR_CORNER = { 8: 0, 9: 3, 10: 1, 11: 2 };
const ALL_EDGES = [...Array(12).keys()];
const ALL_CORNERS = [...Array(8).keys()];

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
  steps.forEach((step, si) => step.parts.forEach((part) => part.moves.forEach((m) => {
    const tok = { m, kind: part.kind, act: part.act, step: si };
    for (let j = stack.length - 1; j >= 0; j--) {
      const f = stack[j].m[0];
      if (f === m[0]) {
        const q = (QUARTERS(stack[j].m) + QUARTERS(m)) % 4;
        const kind = KIND_RANK[stack[j].kind] > KIND_RANK[tok.kind] ? stack[j].kind : tok.kind;
        if (q === 0) stack.splice(j, 1);
        else stack[j] = { ...tok, m: m[0] + SUFFIX[q], kind, act: kind === stack[j].kind ? stack[j].act : tok.act };
        return;
      }
      if (OPPOSITE[f] !== m[0]) break;
    }
    stack.push(tok);
  })));
  return steps.map((step, si) => {
    const parts = [];
    for (const t of stack.filter((x) => x.step === si)) {
      const kind = t.kind === "undo" ? "setup" : t.kind;
      const last = parts[parts.length - 1];
      const sameGroup = last && last.kind === kind && (kind === "setup" || kind === "turns" || last.act === t.act);
      if (sameGroup) last.moves.push(t.m);
      else parts.push({ kind, moves: [t.m], act: t.act });
    }
    return { name: step.name, parts, count: parts.reduce((n, p) => n + p.moves.length, 0) };
  });
}

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
    this.crossDist = null;
    this.edgeTable = this.buildTable(EDGE_SERIES);
    this.cornerTable = this.buildTable(CORNER_SERIES);
    this.buildCrossTable();
  }

  run(flat, moves) {
    let s = flat;
    for (const m of moves) s = compose(s, this.flatMoves[m]);
    return s;
  }

  /** All distinct transformations of  P S series S' , with their cheapest spelling. */
  buildTable(base) {
    const baseMoves = parseAlg(base);
    const variants = new Map();
    for (const rot of ROTATIONS) {
      for (const alg of [mapAlg(rot, baseMoves), invertAlg(mapAlg(rot, baseMoves))]) {
        const k = flatKey(this.run(this.solvedFlat, alg));
        if (!variants.has(k)) variants.set(k, alg);
      }
    }
    const setups = setupSequences(2);
    const conj = new Map();
    for (const series of variants.values()) {
      for (const setup of setups) {
        const seq = [...setup, ...series, ...invertAlg(setup)];
        const merged = mergeTurns(seq);
        const k = flatKey(this.run(this.solvedFlat, seq));
        const cost = merged.length;
        const cur = conj.get(k);
        if (!cur || cost < cur.cost) conj.set(k, { setup, series, cost });
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
        const first = c.setup[0] ?? c.series[0];
        const cost = !pre.length ? c.cost
          : pre[0][0] !== first[0] && OPPOSITE[pre[0][0]] !== first[0] ? c.cost + 1
          : mergeTurns([...pre, ...c.setup, ...c.series, ...invertAlg(c.setup)]).length;
        const k = hashFlat(f);
        const cur = entries.get(k);
        if (!cur || cost < cur.cost) entries.set(k, { flat: f === scratch ? scratch.slice() : f, pre, setup: c.setup, series: c.series, cost });
      }
    }
    // plain face turns are also available moves
    const list = [...entries.values()];
    for (const f of FACES) for (const s of ["", "2", "'"]) {
      const m = f + s;
      list.push({ flat: this.flatMoves[m], pre: [m], setup: [], series: [], cost: 1 });
    }
    // the cross step already fixed edge parity, so only even transformations are useful
    for (const e of list) e.mask = solvedMask(e.flat);
    const even = list.filter((e) => this.edgeParity(e.flat) === 0);
    even.sort((a, b) => a.cost - b.cost);
    // odd-parity entries are only needed when F2L algorithms leave an odd edge permutation
    even.withOdd = list.sort((a, b) => a.cost - b.cost);
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

  solveCross(flat) {
    this.buildCrossTable();
    const names = Object.keys(this.flatMoves);
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
  climb(flat, table, { target, goal, count: customCount, first }) {
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
      for (const e of table) {
        if (best && e.cost > bestCost + 6) break;
        if (kept & ~e.mask) continue; // would disturb a finished piece
        let after;
        if (customCount) { compose(s, e.flat, buf); after = customCount(buf); }
        else after = countTargetAfter(s, e.flat, target);
        const gain = after - base;
        if (gain < 1) continue;
        const score = gain * 100 - e.cost;
        if (score > bestScore) { best = e; bestScore = score; bestCost = e.cost; }
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
  /** Solve from a scramble given as move list. Returns the best of six cross orientations. */
  solve(scrambleMoves, options = {}) {
    let best = null;
    let firstError = null;
    // six choices of which face holds the cross: rotations putting each face on U
    const tops = [];
    for (const rot of ROTATIONS) if (!tops.some((r) => r.U === rot.U)) tops.push(rot);
    for (const rot of tops) {
      try {
        const res = this.solveOriented(mapAlg(rot, scrambleMoves), options);
        // map solution back: inverse rotation
        const inv = Object.fromEntries(FACES.map((f) => [rot[f], f]));
        const mapped = {
          ...res,
          steps: res.steps.map((st) => ({
            ...st,
            parts: st.parts.map((p) => ({ ...p, moves: mapAlg(inv, p.moves) })),
          })),
          solution: mapAlg(inv, res.solution),
          crossFace: inv.U,
        };
        if (!best || mapped.total < best.total) best = mapped;
      } catch (e) {
        firstError ??= e.message;
      }
    }
    return best ?? { error: firstError };
  }

  solveOriented(scrambleMoves, { f2l = false } = {}) {
    const start = this.run(this.solvedFlat, scrambleMoves);
    const rawSteps = [];
    this.actionId = 0;
    const log = (name, parts) => rawSteps.push({ name, parts });

    // 1. cross
    const c = this.solveCross(start);
    log("The Cross", c.moves.length ? [{ kind: "turns", moves: c.moves }] : []);
    let s = c.state;

    const r1State = s;
    const r2 = this.climb(s, this.edgeTable, { target: { edges: MIDDLE, corners: [] }, goal: 3 });
    const edgeTarget = { target: { edges: ALL_EDGES, corners: [] }, goal: 12 };
    s = r2.state;
    let step2 = { name: "Center Section Edge Pieces", parts: this.actionsToParts(r2.actions, "edge") };
    let r3 = null;
    let pairs = 0;

    if (f2l) {
      // Partial F2L: three corner-edge pairs next to the cross, then the other five
      // edges with series that leave those corners alone. Two ways to get the pairs
      // (F2L insertion algorithms, or Marshall's own edge + corner series); keep the shorter.
      const plans = [this.f2lByAlgorithms(r1State, edgeTarget), this.f2lBySeries(s, edgeTarget, r2, step2.parts)].filter(Boolean);
      const best = plans.sort((a, b) => a.moves - b.moves)[0];
      if (best) {
        step2 = { name: best.name, parts: best.parts };
        r3 = best.r3;
        pairs = best.pairs;
      }
    }
    if (!r3) r3 = this.climb(s, this.edgeTable, edgeTarget);
    log(step2.name, step2.parts);
    log("Top Edge Pieces", this.actionsToParts(r3.actions, "edge"));
    s = r3.state;

    const r4 = this.climb(s, this.cornerTable, { target: { edges: [], corners: ALL_CORNERS }, goal: 5 });
    log("Five Corner Pieces", this.actionsToParts(r4.actions, "corner"));
    s = r4.state;

    const r5 = this.climb(s, this.cornerTable, { target: { edges: [], corners: ALL_CORNERS }, goal: 8 });
    log("The End Game", this.actionsToParts(r5.actions, "corner"));
    s = r5.state;

    if (flatKey(s) !== flatKey(this.solvedFlat)) throw new Error("internal error: cube not solved");
    const steps = optimizeSteps(rawSteps);
    const all = steps.flatMap((st) => st.parts.flatMap((p) => p.moves));
    return { steps, total: all.length, solution: all, finalState: s, f2lPairs: pairs };
  }

  /** Corner-preserving finish of the five remaining edges after the pairs are in. */
  finishEdges(state, corners, edgeTarget) {
    const need = corners.reduce((m, i) => m | (1 << (12 + i)), 0);
    const source = this.edgeParity(state) ? this.edgeTable.withOdd : this.edgeTable;
    const keep = source.filter((e) => !(need & ~e.mask));
    return this.climb(state, keep, edgeTarget);
  }

  f2lByAlgorithms(state, edgeTarget) {
    try {
      const { table, first } = this.buildF2LTable();
      const pairCount = (f) => {
        let n = 0;
        for (const e of MIDDLE) {
          const c = PAIR_CORNER[e];
          if (f[e] === e && f[12 + e] === 0 && f[24 + c] === c && f[32 + c] === 0) n += 2;
        }
        return n;
      };
      const rp = this.climb(state, table, { target: { edges: [], corners: [] }, goal: 6, count: pairCount, first });
      const corners = MIDDLE.filter((e) => rp.state[e] === e && rp.state[12 + e] === 0).map((e) => PAIR_CORNER[e])
        .filter((c) => rp.state[24 + c] === c && rp.state[32 + c] === 0);
      const r3 = this.finishEdges(rp.state, corners, edgeTarget);
      const parts = this.actionsToParts(rp.actions, "f2l");
      return { name: "F2L pairs (cross + 3 pairs)", parts, r3, pairs: 3, moves: rp.actions.reduce((n, a) => n + a.cost, 0) + r3.actions.reduce((n, a) => n + a.cost, 0) };
    } catch {
      return null;
    }
  }

  f2lBySeries(state, edgeTarget, r2, edgeParts) {
    try {
      const corners = this.solvedEdges(state, MIDDLE).slice(0, 3).map((e) => PAIR_CORNER[e]);
      const rc = this.climb(state, this.cornerTable, { target: { edges: [], corners }, goal: corners.length });
      const r3 = this.finishEdges(rc.state, corners, edgeTarget);
      const cost = (r) => r.actions.reduce((n, a) => n + a.cost, 0);
      return {
        name: "Center Section Edge Pieces + 3 F2L pairs",
        parts: [...edgeParts, ...this.actionsToParts(rc.actions, "corner")],
        r3,
        pairs: corners.length,
        moves: cost(r2) + cost(rc) + cost(r3),
      };
    } catch {
      return null;
    }
  }

  actionsToParts(actions, kind) {
    const parts = [];
    for (const a of actions) {
      const act = this.actionId++;
      if (a.pre.length && !a.series.length) { parts.push({ kind: "turns", moves: a.pre, act }); continue; }
      if (a.pre.length) parts.push({ kind: "turns", moves: a.pre, act });
      if (a.setup.length) parts.push({ kind: "setup", moves: a.setup, act });
      parts.push({ kind, moves: a.series, act });
      if (a.setup.length) parts.push({ kind: "undo", moves: invertAlg(a.setup), act });
    }
    return parts;
  }
}
