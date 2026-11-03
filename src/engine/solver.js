// Philip Marshall's method, implemented on top of two "series":
//   Edge Piece Series   F R' F' R           (3-cycles edges; corners are collateral)
//   Corner Piece Series U R U' L' U R' U' L (3-cycles corners; edges untouched)
// Every move the solver makes is a face turn or a series, optionally wrapped in
// setup turns that are undone afterwards (conjugation) - just like the written method.
import {
  buildMoveTables, parseAlg, invertAlg, emptyState, applyTo, FACES,
} from "./cube.js";
import {
  N, flatFromMove, flatFromState, flatSolved, compose, flatKey, ROTATIONS, mapAlg,
} from "./flat.js";

export const EDGE_SERIES = "F R' F' R";
export const CORNER_SERIES = "U R U' L' U R' U' L";

const CROSS_BASE = [1, 24, 576, 13824]; // radix for the four cross edges UF UR UB UL
const MIDDLE = [8, 9, 10, 11]; // FR FL BR BL
const ALL_EDGES = [...Array(12).keys()];
const ALL_CORNERS = [...Array(8).keys()];

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
    for (const c of conj.values()) {
      const t = this.run(this.solvedFlat, [...c.setup, ...c.series, ...invertAlg(c.setup)]);
      for (const pre of pres) {
        const f = pre.length ? compose(this.flatMoves[pre[0]], t) : t;
        const cost = mergeTurns([...pre, ...c.setup, ...c.series, ...invertAlg(c.setup)]).length;
        const k = flatKey(f);
        const cur = entries.get(k);
        if (!cur || cost < cur.cost) entries.set(k, { flat: f, pre, setup: c.setup, series: c.series, cost });
      }
    }
    // plain face turns are also available moves
    const list = [...entries.values()];
    for (const f of FACES) for (const s of ["", "2", "'"]) {
      const m = f + s;
      list.push({ flat: this.flatMoves[m], pre: [m], setup: [], series: [], cost: 1 });
    }
    // the cross step already fixed edge parity, so only even transformations are useful
    const even = list.filter((e) => this.edgeParity(e.flat) === 0);
    even.sort((a, b) => a.cost - b.cost);
    return even;
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
    const moves = names.map((nm) => this.flatMoves[nm]);
    const quarter = (nm) => (nm.length === 1 || nm[1] === "'" ? 1 : 0);
    const q = names.map(quarter);
    const dist = new Int8Array(24 ** 4 * 2).fill(-1);
    dist[sig(this.solvedFlat)] = 0;
    let layer = [[this.solvedFlat, 0]];
    let d = 0;
    const buf = new Uint8Array(N);
    while (layer.length) {
      const next = [];
      d++;
      for (const [st, par] of layer) for (let m = 0; m < moves.length; m++) {
        compose(st, moves[m], buf);
        const np = par ^ q[m];
        const k = sig(buf) + np;
        if (dist[k] < 0) { dist[k] = d; next.push([buf.slice(), np]); }
      }
      layer = next;
    }
    this.crossDist = { get: (k) => dist[k] };
    this.crossSig = sig;
    this.quarter = quarter;
  }

  edgeParity(f) {
    const seen = new Uint8Array(12);
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
   * that keeps every currently solved piece solved, until `done`.
   * `target` = {edges:[...], corners:[...]} are the pieces being counted.
   */
  climb(flat, table, { target, goal }) {
    const actions = [];
    let s = flat;
    const buf = new Uint8Array(N);
    const solvedE = (f, i) => f[i] === i && f[12 + i] === 0;
    const solvedC = (f, i) => f[24 + i] === i && f[32 + i] === 0;
    const count = (f) =>
      target.edges.reduce((a, i) => a + solvedE(f, i), 0) + target.corners.reduce((a, i) => a + solvedC(f, i), 0);
    let guard = 0;
    while (count(s) < goal) {
      if (++guard > 40) throw new Error("climb did not converge");
      const base = count(s);
      const keptE = ALL_EDGES.filter((i) => solvedE(s, i));
      const keptC = ALL_CORNERS.filter((i) => solvedC(s, i));
      let best = null, bestScore = -1, bestCost = Infinity;
      for (const e of table) {
        if (best && e.cost > bestCost + 6) break;
        compose(s, e.flat, buf);
        let ok = true;
        for (const i of keptE) if (!solvedE(buf, i)) { ok = false; break; }
        if (!ok) continue;
        for (const i of keptC) if (!solvedC(buf, i)) { ok = false; break; }
        if (!ok) continue;
        const gain = count(buf) - base;
        if (gain < 1) continue;
        const score = gain * 100 - e.cost;
        if (score > bestScore) { best = e; bestScore = score; bestCost = e.cost; }
      }
      if (!best) {
        const part = target.edges.length ? "edges" : "corners";
        const fin = target.edges.length === 12 || target.corners.length === 8 ? this.finish(s, table, part) : null;
        if (fin) {
          for (const e of fin) { actions.push(e); s = compose(s, e.flat); }
          continue;
        }
        const two = this.lookahead(s, table, { count, keptE, keptC, base });
        if (!two) throw new Error("stuck");
        for (const e of two) { actions.push(e); s = compose(s, e.flat); }
        continue;
      }
      actions.push(best);
      s = compose(s, best.flat);
    }
    return { actions, state: s };
  }

  /**
   * Meet-in-the-middle finish: find entries a, b with  state*a*b  fully solving
   * `part` ("edges" or "corners"). Used when no single entry makes progress.
   */
  finish(s, table, part) {
    const cfg = part === "edges"
      ? { n: 12, p: 0, o: 12, mod: 2 }
      : { n: 8, p: 24, o: 32, mod: 3 };
    if (!table.partIndex) table.partIndex = {};
    if (!table.partIndex[part]) {
      const idx = new Map();
      for (const e of this.usableFor(table, part)) {
        const k = this.partKey(e.flat, cfg);
        if (!idx.has(k)) idx.set(k, e);
      }
      table.partIndex[part] = idx;
    }
    const idx = table.partIndex[part];
    const n = new Uint8Array(N);
    let best = null, bestCost = Infinity;
    const identity = { flat: this.solvedFlat, pre: [], setup: [], series: [], cost: 0 };
    for (const a of [identity, ...this.usableFor(table, part)]) {
      if (a.cost >= bestCost) break;
      compose(s, a.flat, n);
      const b = idx.get(this.partKey(this.invertPart(n, cfg), cfg));
      if (b && a.cost + b.cost < bestCost) { best = a === identity ? [b] : [a, b]; bestCost = a.cost + b.cost; }
    }
    return best;
  }
  /** Corner finishing must not disturb the (already solved) edges. */
  usableFor(table, part) {
    if (part === "edges") return table;
    if (!table.edgeSafe) {
      table.edgeSafe = table.filter((e) => {
        for (let i = 0; i < 12; i++) if (e.flat[i] !== i || e.flat[12 + i]) return false;
        return true;
      });
    }
    return table.edgeSafe;
  }
  partKey(f, { n, p, o }) {
    return String.fromCharCode.apply(null, f.subarray(p, p + n)) + String.fromCharCode.apply(null, f.subarray(o, o + n));
  }
  /** Returns a flat array whose `part` is the inverse of f's `part`. */
  invertPart(f, { n, p, o, mod }) {
    const out = new Uint8Array(N);
    for (let i = 0; i < n; i++) {
      out[p + f[p + i]] = i;
    }
    for (let i = 0; i < n; i++) {
      const j = out[p + i];
      out[o + i] = (mod - f[o + j]) % mod;
    }
    return out;
  }

  /** Two table entries in a row (the first may temporarily break things). */
  lookahead(s, table, { count, keptE, keptC, base }) {
    const cheap = table.slice(0, 1500);
    const n1 = new Uint8Array(N), n2 = new Uint8Array(N);
    let best = null, bestScore = -Infinity;
    for (const a of cheap) {
      compose(s, a.flat, n1);
      for (const b of cheap) {
        if (best && a.cost + b.cost > best.cost + 4) break;
        compose(n1, b.flat, n2);
        let ok = true;
        for (const i of keptE) if (!(n2[i] === i && n2[12 + i] === 0)) { ok = false; break; }
        if (!ok) continue;
        for (const i of keptC) if (!(n2[24 + i] === i && n2[32 + i] === 0)) { ok = false; break; }
        if (!ok) continue;
        const gain = count(n2) - base;
        if (gain < 1) continue;
        const score = gain * 100 - a.cost - b.cost;
        if (score > bestScore) { bestScore = score; best = [a, b]; best.cost = a.cost + b.cost; }
      }
    }
    return best;
  }

  // ---------- full solve ----------
  /** Solve from a scramble given as move list. Returns the best of six cross orientations. */
  solve(scrambleMoves) {
    let best = null;
    let firstError = null;
    // six choices of which face holds the cross: rotations putting each face on U
    const tops = [];
    for (const rot of ROTATIONS) if (!tops.some((r) => r.U === rot.U)) tops.push(rot);
    for (const rot of tops) {
      try {
        const res = this.solveOriented(mapAlg(rot, scrambleMoves));
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

  solveOriented(scrambleMoves) {
    const start = this.run(this.solvedFlat, scrambleMoves);
    const rawSteps = [];
    this.actionId = 0;
    const log = (name, parts) => rawSteps.push({ name, parts });

    // 1. cross
    const c = this.solveCross(start);
    log("The Cross", c.moves.length ? [{ kind: "turns", moves: c.moves }] : []);
    let s = c.state;

    const r2 = this.climb(s, this.edgeTable, { target: { edges: MIDDLE, corners: [] }, goal: 3 });
    log("Center Section Edge Pieces", this.actionsToParts(r2.actions, "edge"));
    s = r2.state;

    const r3 = this.climb(s, this.edgeTable, { target: { edges: ALL_EDGES, corners: [] }, goal: 12 });
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
    return { steps, total: all.length, solution: all, finalState: s };
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
