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

// Whole-cube rotations as written moves (x y z). A rotation maps each position to the
// face that sits there afterwards, so a series done after it lands on that face.
const RZ = { R: "U", U: "L", L: "D", D: "R", F: "F", B: "B" };
const IDENTITY = Object.fromEntries(FACES.map((f) => [f, f]));
const rotKey = (m) => FACES.map((f) => m[f]).join("");
const inverseMap = (m) => Object.fromEntries(FACES.map((f) => [m[f], f]));
const after = (cur, g) => Object.fromEntries(FACES.map((f) => [f, cur[g[f]]]));
const ROT_TOKENS = (() => {
  const t = {};
  for (const [name, g] of [["x", RX], ["y", RY], ["z", RZ]]) {
    t[name] = g;
    t[name + "2"] = after(g, g);
    t[name + "'"] = inverseMap(g);
  }
  return t;
})();
/** The face relabeling of a rotation written as tokens like ["x", "y'"]. */
export function rotationOf(tokens) {
  return tokens.reduce((cur, t) => after(cur, ROT_TOKENS[t]), IDENTITY);
}
const ROT_WORDS = (() => {
  const words = new Map([[rotKey(IDENTITY), []]]);
  const names = Object.keys(ROT_TOKENS);
  for (let len = 1; len <= 2; len++) {
    for (const w of [...words.values()].filter((x) => x.length === len - 1)) {
      for (const n of names) {
        const word = [...w, n];
        const k = rotKey(rotationOf(word));
        if (!words.has(k)) words.set(k, word);
      }
    }
  }
  return words;
})();
/** Shortest x/y/z spelling of a rotation. */
export function rotationWord(rot) {
  return ROT_WORDS.get(rotKey(rot));
}
export function invertRotationWord(word) {
  return word.slice().reverse().map((t) => (t.length === 1 ? t + "'" : t[1] === "2" ? t : t[0]));
}
