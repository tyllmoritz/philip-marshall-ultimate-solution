// The solution as a smart cube sees it. A smart cube reports turns of its own six faces, measured against its core: whole-cube
// rotations are no moves for it, and wide or slice moves reach it as outer-face turns while the whole cube turns with them.
import { rotationOf } from "./engine/flat.js";

export const isRotation = (m) => /^[xyz]/.test(m);

/**
 * The solution as the cube itself sees it: whole-cube rotations are not moves of a smart cube
 * (its centres never move), they only change which cube face a following turn lands on.
 */
const flipSuffix = (rest) => (rest === "" ? "'" : rest === "'" ? "" : rest);

/** A move of the shown orientation as the cube itself would call it: faces, wide moves (r, u, ...) and slices (M, E, S). */
function cubeMove(frame, m) {
  const c = m[0], rest = m.slice(1);
  if ("UDFBRL".includes(c)) return frame[c] + rest;
  if ("udfbrl".includes(c)) return frame[c.toUpperCase()].toLowerCase() + rest;
  if ("MES".includes(c)) {
    // a slice follows a face (M the L face, E the D face, S the F face): the same slice in the cube's own frame
    const face = frame[{ M: "L", E: "D", S: "F" }[c]];
    const slice = { L: "M", R: "M", D: "E", U: "E", F: "S", B: "S" }[face];
    return slice + (face === { M: "L", E: "D", S: "F" }[slice] ? rest : flipSuffix(rest));
  }
  return m;
}

// A smart cube only knows its six outer faces, measured against its core: a wide turn or a slice turn reaches it as
// turns of the outer faces (r = L, M = R L') while the whole cube turns with it (r = L x, M = R L' x'). Checked against
// cubing.js for every amount, centers included.
const LAYER_MOVES = { r: [["L"], "x"], l: [["R"], "x'"], u: [["D"], "y"], d: [["U"], "y'"], f: [["B"], "z"], b: [["F"], "z'"], M: [["R", "L'"], "x'"], E: [["U", "D'"], "y'"], S: [["F'", "B"], "z"] };
const withAmount = (m, k) => (k === "" ? m : k === "'" ? (m.endsWith("'") ? m[0] : m + "'") : m[0] + "2");
/** A wide or slice move as { outer: the face turns the cube reports, turn: the whole-cube rotation that comes with it } - or null. */
export function splitLayerMove(m) {
  const base = LAYER_MOVES[m[0]];
  if (!base) return null;
  const k = m.slice(1).replace("2'", "2");
  return { outer: base[0].map((x) => withAmount(x, k)), turn: withAmount(base[1], k) };
}
/** The whole-cube rotations in a list of solution moves: the x/y/z tokens, and the turn that comes with each wide or slice move. */
export function rotationsIn(moves) {
  return moves.flatMap((m) => (isRotation(m) ? [m] : splitLayerMove(m) ? [splitLayerMove(m).turn] : []));
}

/**
 * The solution as the cube itself sees it: whole-cube rotations are not moves of a smart cube
 * (its centres never move), they only change which cube face a following turn lands on. Wide and slice moves become the
 * outer turns the cube reports, and their whole-cube turn applies to the moves after them.
 * Returns the moves, with `counts[i]` = how many of them solution move i became.
 */
export function cubeFrameMoves(solution, setupRotation = []) {
  const rotations = [...setupRotation];
  const out = [];
  const counts = [];
  for (const m of solution) {
    if (isRotation(m)) { rotations.push(m); counts.push(0); continue; }
    const frame = rotations.length ? rotationOf(rotations) : null;
    const split = splitLayerMove(m);
    const moves = split ? split.outer : [m];
    for (const x of moves) out.push(frame ? cubeMove(frame, x) : x);
    if (split) rotations.push(split.turn);
    counts.push(moves.length);
  }
  out.counts = counts;
  return out;
}
