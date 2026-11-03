// Flat 40-byte state/move layout for fast composition.
// [0..11] edge perm, [12..23] edge orient, [24..31] corner perm, [32..39] corner orient
import { FACES } from "./cube.js";

export const N = 40;

export function flatFromMove(m) {
  const f = new Uint8Array(N);
  f.set(m.ep, 0); f.set(m.eo, 12); f.set(m.cp, 24); f.set(m.co, 32);
  return f;
}
export function flatFromState(s) {
  return flatFromMove(s);
}
export function flatSolved() {
  const f = new Uint8Array(N);
  for (let i = 0; i < 12; i++) f[i] = i;
  for (let i = 0; i < 8; i++) f[24 + i] = i;
  return f;
}
/** out = state followed by move (same convention as cube.js applyTo). */
export function compose(s, m, out = new Uint8Array(N)) {
  for (let i = 0; i < 12; i++) {
    const j = m[i];
    out[i] = s[j];
    out[12 + i] = (s[12 + j] + m[12 + i]) & 1;
  }
  for (let i = 0; i < 8; i++) {
    const j = m[24 + i];
    out[24 + i] = s[24 + j];
    const c = s[32 + j] + m[32 + i];
    out[32 + i] = c % 3;
  }
  return out;
}
export function flatKey(f) {
  return String.fromCharCode.apply(null, f);
}

/** Whole-cube rotations expressed as face relabelings (24 of them). */
const RX = { U: "F", F: "D", D: "B", B: "U", R: "R", L: "L" };
const RY = { U: "U", D: "D", F: "R", R: "B", B: "L", L: "F" };
export const ROTATIONS = (() => {
  const key = (m) => FACES.map((f) => m[f]).join("");
  const id = Object.fromEntries(FACES.map((f) => [f, f]));
  const seen = new Map([[key(id), id]]);
  const queue = [id];
  while (queue.length) {
    const r = queue.pop();
    for (const g of [RX, RY]) {
      const n = Object.fromEntries(FACES.map((f) => [f, g[r[f]]]));
      if (!seen.has(key(n))) { seen.set(key(n), n); queue.push(n); }
    }
  }
  return [...seen.values()];
})();

export function mapMove(rot, m) {
  return rot[m[0]] + m.slice(1);
}
export function mapAlg(rot, moves) {
  return moves.map((m) => mapMove(rot, m));
}
