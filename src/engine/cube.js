// Minimal array-based 3x3x3 model. Piece order matches cubing.js:
// EDGES  UF UR UB UL DF DR DB DL FR FL BR BL
// CORNERS UFR UBR UBL UFL DFR DFL DBL DBR
// Move tables are taken from cubing.js's kpuzzle so both agree.

export const FACES = ["U", "D", "F", "B", "R", "L"];

export function emptyState() {
  return {
    ep: Uint8Array.from({ length: 12 }, (_, i) => i),
    eo: new Uint8Array(12),
    cp: Uint8Array.from({ length: 8 }, (_, i) => i),
    co: new Uint8Array(8),
  };
}

export function cloneState(s) {
  return { ep: s.ep.slice(), eo: s.eo.slice(), cp: s.cp.slice(), co: s.co.slice() };
}

export function applyTo(s, m) {
  const ep = new Uint8Array(12), eo = new Uint8Array(12);
  const cp = new Uint8Array(8), co = new Uint8Array(8);
  for (let i = 0; i < 12; i++) {
    ep[i] = s.ep[m.ep[i]];
    eo[i] = (s.eo[m.ep[i]] + m.eo[i]) % 2;
  }
  for (let i = 0; i < 8; i++) {
    cp[i] = s.cp[m.cp[i]];
    co[i] = (s.co[m.cp[i]] + m.co[i]) % 3;
  }
  return { ep, eo, cp, co };
}

export function isSolved(s) {
  for (let i = 0; i < 12; i++) if (s.ep[i] !== i || s.eo[i]) return false;
  for (let i = 0; i < 8; i++) if (s.cp[i] !== i || s.co[i]) return false;
  return true;
}

export function stateKey(s) {
  return String.fromCharCode(...s.ep, ...s.eo, ...s.cp, ...s.co);
}

/** Build the 18 face-turn tables from a cubing.js KPuzzle. */
export function buildMoveTables(kpuzzle) {
  const tables = {};
  for (const f of FACES) {
    for (const suffix of ["", "2", "'"]) {
      const t = kpuzzle.moveToTransformation(f + suffix).transformationData;
      tables[f + suffix] = {
        ep: Uint8Array.from(t.EDGES.permutation),
        eo: Uint8Array.from(t.EDGES.orientationDelta),
        cp: Uint8Array.from(t.CORNERS.permutation),
        co: Uint8Array.from(t.CORNERS.orientationDelta),
      };
    }
  }
  return tables;
}

export function invertMove(m) {
  if (m.endsWith("2")) return m;
  return m.endsWith("'") ? m[0] : m + "'";
}
export function invertAlg(moves) {
  return moves.slice().reverse().map(invertMove);
}
export function parseAlg(str) {
  return str.trim().split(/\s+/).filter(Boolean);
}
