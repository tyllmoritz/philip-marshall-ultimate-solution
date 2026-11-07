// Searches for the ZZ and Roux steps: the EOLine (a breadth-first table), building blocks (iterative deepening A* with
// pattern databases for the pieces involved) and the last six edges (breadth-first over M and U, centres included).
import { N, compose, flatFromMove, flatKey } from "./flat.js";

const FACES = ["U", "D", "F", "B", "R", "L"];
export const ALL_MOVES = FACES.flatMap((f) => [f, f + "'", f + "2"]);

/** value of a piece after one move: pos*2+ori (edges) or pos*3+ori (corners), 24 values each */
function transition(solver, kind, move) {
  const t = solver.moves[move] ?? solver.extraMoves[move];
  const out = new Uint8Array(24);
  if (kind === "edge") {
    const inv = new Uint8Array(12);
    for (let i = 0; i < 12; i++) inv[t.ep[i]] = i;
    for (let pos = 0; pos < 12; pos++) for (let o = 0; o < 2; o++) { const np = inv[pos]; out[pos * 2 + o] = np * 2 + ((o + t.eo[np]) & 1); }
  } else {
    const inv = new Uint8Array(8);
    for (let i = 0; i < 8; i++) inv[t.cp[i]] = i;
    for (let pos = 0; pos < 8; pos++) for (let o = 0; o < 3; o++) { const np = inv[pos]; out[pos * 3 + o] = np * 3 + ((o + t.co[np]) % 3); }
  }
  return out;
}

const pdbCache = new Map();
/** Distance (under `moves`) of the given pieces from home: { dist(flat) }. ids = piece numbers; start = their solved values. */
function pdb(solver, kind, ids, moves) {
  const key = kind + ":" + ids.join(",") + ":" + moves.join(",");
  if (pdbCache.has(key)) return pdbCache.get(key);
  const k = ids.length;
  const size = 24 ** k;
  const dist = new Int8Array(size).fill(-1);
  const trans = moves.map((m) => transition(solver, kind, m));
  const home = ids.map((id) => id * (kind === "edge" ? 2 : 3)); // position id, orientation 0
  const enc = (vals) => vals.reduce((n, v, i) => n + v * 24 ** i, 0);
  let layer = [enc(home)];
  dist[layer[0]] = 0;
  for (let d = 1; layer.length; d++) {
    const next = [];
    for (const code of layer) {
      const vals = [];
      let c = code;
      for (let i = 0; i < k; i++) { vals.push(c % 24); c = Math.floor(c / 24); }
      for (const t of trans) {
        const nk = enc(vals.map((v) => t[v]));
        if (dist[nk] < 0) { dist[nk] = d; next.push(nk); }
      }
    }
    layer = next;
  }
  const find = kind === "edge"
    ? (f, id) => { for (let i = 0; i < 12; i++) if (f[i] === id) return i * 2 + f[12 + i]; return 0; }
    : (f, id) => { for (let i = 0; i < 8; i++) if (f[24 + i] === id) return i * 3 + f[32 + i]; return 0; };
  const table = { dist: (f) => { let n = 0, m = 1; for (const id of ids) { n += find(f, id) * m; m *= 24; } return dist[n]; } };
  pdbCache.set(key, table);
  return table;
}

const AXIS = { U: "y", D: "y", u: "y", d: "y", E: "y", R: "x", L: "x", r: "x", l: "x", M: "x", F: "z", B: "z", f: "z", b: "z", S: "z" };
const AXIS_ORDER = "UDuEdRLrMlFBfSb";
// the three layers of an axis that each letter turns (wide = face + slice)
const LAYERS = { U: [1, 0, 0], D: [0, 1, 0], E: [0, 0, 1], u: [1, 0, 1], d: [0, 1, 1], R: [1, 0, 0], L: [0, 1, 0], M: [0, 0, 1], r: [1, 0, 1], l: [0, 1, 1], F: [1, 0, 0], B: [0, 1, 0], S: [0, 0, 1], f: [1, 0, 1], b: [0, 1, 1] };
/** Per axis: how many independent layers the moves can turn (the longest useful run of turns about that axis). */
function axisCaps(moves) {
  const caps = {};
  for (const ax of ["x", "y", "z"]) {
    const rows = [...new Set(moves.filter((m) => AXIS[m[0]] === ax).map((m) => m[0]))].map((c) => [...LAYERS[c]]);
    let rank = 0;
    for (let col = 0; col < 3 && rank < rows.length; col++) {
      const p = rows.findIndex((r, i) => i >= rank && r[col]);
      if (p < 0) continue;
      [rows[rank], rows[p]] = [rows[p], rows[rank]];
      for (let i = 0; i < rows.length; i++) if (i !== rank && rows[i][col]) rows[i] = rows[i].map((v, k) => v - rows[i][col] / rows[rank][col] * rows[rank][k]);
      rank++;
    }
    caps[ax] = rank;
  }
  return caps;
}

const pieceHome =(f, edges, corners) => {
  for (const e of edges) if (f[e] !== e || f[12 + e] !== 0) return false;
  for (const c of corners) if (f[24 + c] !== c || f[32 + c] !== 0) return false;
  return true;
};

/**
 * Shortest ways (up to `limit`) to bring the listed pieces home using only `moves`. Pieces already solved elsewhere
 * (`keep`) must be home at the end too. Iterative deepening with pattern databases of the edges and corners involved.
 */
export function blockSearch(solver, start, { edges, corners, keepEdges = [], keepCorners = [] }, moves, { maxDepth = 12, limit = 4, nodeLimit = 4e6 } = {}) {
  const all = { edges: [...edges, ...keepEdges], corners: [...corners, ...keepCorners] };
  const groups = [];
  const split = (ids, kind) => { for (let i = 0; i < ids.length; i += 3) groups.push(pdb(solver, kind, ids.slice(i, i + 3), moves)); };
  split(all.edges, "edge");
  for (let i = 0; i < all.corners.length; i += 3) groups.push(pdb(solver, "corner", all.corners.slice(i, i + 3), moves));
  const h = (f) => { let m = 0; for (const g of groups) { const d = g.dist(f); if (d > m) m = d; } return m; };
  const flats = moves.map((m) => solver.flatMoves[m] ?? solver.extraFlat[m]);
  const buffers = Array.from({ length: maxDepth + 2 }, () => new Uint8Array(N));
  // turns about one axis commute, and any run of them is a combination of independent layers (R, r, M: R^a M^b),
  // so a run is written in a fixed order of distinct letters and is no longer than the number of independent layers
  const axis = moves.map((m) => AXIS[m[0]]);
  const rank = moves.map((m) => AXIS_ORDER.indexOf(m[0]));
  const cap = axisCaps(moves);
  let nodes = 0;
  const found = [];
  const path = [];
  const dfs = (f, left, last, run) => {
    if (++nodes > nodeLimit) return;
    if (left === 0) { if (pieceHome(f, all.edges, all.corners)) found.push([...path]); return; }
    if (h(f) > left) return;
    for (let i = 0; i < moves.length; i++) {
      const same = last >= 0 && axis[last] === axis[i];
      if (same && (rank[i] <= rank[last] || run >= cap[axis[i]])) continue;
      const buf = buffers[left];
      compose(f, flats[i], buf);
      path.push(moves[i]);
      dfs(buf, left - 1, i, same ? run + 1 : 1);
      path.pop();
      if (found.length >= limit || nodes > nodeLimit) return;
    }
  };
  for (let depth = h(start); depth <= maxDepth; depth++) {
    dfs(start, depth, -1, 0);
    if (found.length || nodes > nodeLimit) break;
  }
  return found;
}

// ---- EOLine: every edge oriented and the two line edges (DF, DB) home ----
let eoTable = null;
function buildEoLine(solver) {
  if (eoTable) return eoTable;
  const pieces = [4, 6]; // DF and DB in the turned-over frame
  const size = 4096 * 144;
  const dist = new Int8Array(size).fill(-1);
  const moves = ALL_MOVES.map((m) => {
    const t = solver.moves[m], inv = new Uint8Array(12);
    for (let i = 0; i < 12; i++) inv[t.ep[i]] = i;
    return { t, inv };
  });
  const enc = (eo, a, b) => (eo * 12 + a) * 12 + b;
  const start = enc(0, pieces[0], pieces[1]);
  dist[start] = 0;
  let layer = [start];
  for (let d = 1; layer.length; d++) {
    const next = [];
    for (const code of layer) {
      const b = code % 12, a = Math.floor(code / 12) % 12, eo = Math.floor(code / 144);
      for (const { t, inv } of moves) {
        let ne = 0;
        for (let i = 0; i < 12; i++) ne |= (((eo >> t.ep[i]) & 1) ^ t.eo[i]) << i; // orientation by position
        const nk = enc(ne, inv[a], inv[b]);
        if (dist[nk] < 0) { dist[nk] = d; next.push(nk); }
      }
    }
    layer = next;
  }
  eoTable = { dist, enc, pieces };
  return eoTable;
}

export function eoLineMoves(solver, start, variant = 0) {
  const { dist, enc, pieces } = buildEoLine(solver);
  const code = (f) => {
    let eo = 0, a = 0, b = 0;
    for (let i = 0; i < 12; i++) { eo |= f[12 + i] << i; if (f[i] === pieces[0]) a = i; if (f[i] === pieces[1]) b = i; }
    return enc(eo, a, b);
  };
  const names = ALL_MOVES.map((_, i) => ALL_MOVES[(i + variant * 5) % ALL_MOVES.length]);
  const out = [];
  let s = start;
  let d = dist[code(s)];
  if (d < 0) throw new Error("EOLine unreachable");
  while (d > 0) {
    let moved = false;
    for (const m of names) {
      const n = compose(s, solver.flatMoves[m]);
      if (dist[code(n)] === d - 1) { out.push(m); s = n; d--; moved = true; break; }
    }
    if (!moved) throw new Error("EOLine stuck");
  }
  return { moves: out, state: s };
}

// ---- LSE: the last six edges with M and U (centres matter: M turns them) ----
const M_FLAT = new Map();
function mMoves(solver) {
  if (M_FLAT.has(solver)) return M_FLAT.get(solver);
  const out = {};
  for (const m of ["M", "M'", "M2"]) {
    const t = solver.kpuzzle.moveToTransformation(m).transformationData;
    out[m] = flatFromMove({ ep: Uint8Array.from(t.EDGES.permutation), eo: Uint8Array.from(t.EDGES.orientationDelta), cp: Uint8Array.from(t.CORNERS.permutation), co: Uint8Array.from(t.CORNERS.orientationDelta) });
  }
  M_FLAT.set(solver, out);
  return out;
}

/** Quarter turns of the middle slice (M direction) in a list of moves, mod 4 - how far the centres have been turned. */
export function centreTurns(moves) {
  let n = 0;
  for (const m of moves) {
    const q = m.length === 1 ? 1 : m[1] === "2" ? 2 : 3;
    if (m[0] === "M") n += q;
    else if (m[0] === "r" || m[0] === "l") n += m[0] === "r" ? (4 - q) : q; // r = R M', l = L' M ... (r' = R' M)
  }
  return ((n % 4) + 4) % 4;
}

const LSE_EDGES = [0, 1, 2, 3, 4, 6]; // UF UR UB UL DF DB
let lseTable = null;
function buildLse(solver) {
  if (lseTable) return lseTable;
  const gens = { ...mMoves(solver), U: solver.flatMoves.U, "U'": solver.flatMoves["U'"], U2: solver.flatMoves.U2 };
  const names = Object.keys(gens);
  const cq = { M: 1, "M'": 3, M2: 2, U: 0, "U'": 0, U2: 0 };
  const key = (f, c) => {
    let k = String(c);
    for (const e of LSE_EDGES) { let pos = 0; for (let i = 0; i < 12; i++) if (f[i] === e) pos = i; k += "," + pos + "." + f[12 + pos]; }
    return k;
  };
  const home = solver.solvedFlat;
  const dist = new Map([[key(home, 0), { d: 0 }]]);
  let layer = [{ f: home, c: 0 }];
  for (let d = 1; layer.length; d++) {
    const next = [];
    for (const { f, c } of layer) {
      for (const m of names) {
        const nf = compose(f, gens[m]);
        const nc = (c + cq[m]) % 4;
        const k = key(nf, nc);
        if (!dist.has(k)) { dist.set(k, { d }); next.push({ f: nf, c: nc }); }
      }
    }
    layer = next;
  }
  lseTable = { dist, key, gens, names, cq };
  return lseTable;
}

/** Shortest M/U sequence that solves the six edges (and brings the centres back); c0 = centre turns so far. */
export function lseMoves(solver, start, c0 = 0, variant = 0) {
  const { dist, key, gens, names, cq } = buildLse(solver);
  const order = names.map((_, i) => names[(i + variant) % names.length]);
  const out = [];
  let s = start, c = c0 % 4;
  let d = dist.get(key(s, c))?.d;
  if (d === undefined) throw new Error("LSE unreachable");
  while (d > 0) {
    let moved = false;
    for (const m of order) {
      const nf = compose(s, gens[m]);
      const nc = (c + cq[m]) % 4;
      if (dist.get(key(nf, nc))?.d === d - 1) { out.push(m); s = nf; c = nc; d--; moved = true; break; }
    }
    if (!moved) throw new Error("LSE stuck");
  }
  return { moves: out, state: s };
}
