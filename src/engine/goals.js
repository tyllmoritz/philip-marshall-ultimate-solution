// Step goals: the cube state a step has to reach. All goals are in the solver's frame (the cube turned over after the
// cross: white cross on D, yellow on U, so UF..UL = 0..3 are the last layer, DF..DL = 4..7 the cross, FR..BL = 8..11 the middle).
//
// goal = {
//   edges, corners        pieces that must be home and oriented
//   edgesOriented         positions whose edge must be oriented (whichever edge is there)
//   cornersOriented       positions whose corner must be oriented (yellow or white facing up or down)
//   cornersPlaced         positions that must hold their own corner (twisted or not)
//   stickers              facelets (0-53, see FACELET_MAP) that must show the color of their face's center
//   atLeast               only this many of the conditions above (e.g. 3 of the 4 middle edges)
//   rule                  a named goal the solver checks in code (see RULES)
// }

// Facelets in Kociemba order (U R F D L B, nine each, row by row as on a net) -> [orbit (0 edges, 1 corners, 2 centers),
// position, sticker of that position]. The inverse of cubing.js's pattern-to-facelets conversion (cubing.js, MIT License).
export const FACELET_MAP = [
  [1, 2, 0], [0, 2, 0], [1, 1, 0], [0, 3, 0], [2, 0, 0], [0, 1, 0], [1, 3, 0], [0, 0, 0], [1, 0, 0],
  [1, 0, 2], [0, 1, 1], [1, 1, 1], [0, 8, 1], [2, 3, 0], [0, 10, 1], [1, 4, 1], [0, 5, 1], [1, 7, 2],
  [1, 3, 2], [0, 0, 1], [1, 0, 1], [0, 9, 0], [2, 2, 0], [0, 8, 0], [1, 5, 1], [0, 4, 1], [1, 4, 2],
  [1, 5, 0], [0, 4, 0], [1, 4, 0], [0, 7, 0], [2, 5, 0], [0, 5, 0], [1, 6, 0], [0, 6, 0], [1, 7, 0],
  [1, 2, 2], [0, 3, 1], [1, 3, 1], [0, 11, 1], [2, 1, 0], [0, 9, 1], [1, 6, 1], [0, 7, 1], [1, 5, 2],
  [1, 1, 2], [0, 2, 1], [1, 2, 1], [0, 10, 0], [2, 4, 0], [0, 11, 0], [1, 7, 1], [0, 6, 1], [1, 6, 2],
];
export const FACE_ORDER = "URFDLB"; // the faces of the facelets, nine each
export const EDGE_NAMES = "UF UR UB UL DF DR DB DL FR FL BR BL".split(" ");
export const CORNER_NAMES = "UFR URB UBL ULF DRF DFL DLB DBR".split(" ");

/** Does facelet i show the color of its face's center in flat state f? */
function stickerHome(f, i) {
  const [orbit, p, k] = FACELET_MAP[i];
  if (orbit === 2) return true;
  if (orbit === 0) return EDGE_NAMES[f[p]][(k + f[12 + p]) % 2] === EDGE_NAMES[p][k];
  return CORNER_NAMES[f[24 + p]][(k + f[32 + p]) % 3] === CORNER_NAMES[p][k];
}

// goals the solver checks in code: Marshall's step 4 and the key position of his step 3
export const RULES = {
  "corners-on-one-side": "at least five corners home, the others on one side",
  "key-position": "the key position: one middle-layer edge and two last-layer edges wrong, one series solves them",
};

const bit = (e, c) => (e.reduce((m, i) => m | (1 << i), 0) | c.reduce((m, i) => m | (1 << (12 + i)), 0));

/**
 * A goal as quick checks. Stickers that cover a whole piece become that piece; single stickers stay sticker checks.
 * Returns { edges, corners, bits, total, count(f), reached(f), held(f), target }:
 *  bits    the pieces of the goal (as solvedMask bits)
 *  held    bitset of the goal's other conditions (orientation, placement, stickers) that hold in f
 *  target  { edges, corners } when the goal is pieces only (the solver can then count without composing states)
 */
export function compileGoal(goal = {}) {
  const edges = new Set(goal.edges ?? []), corners = new Set(goal.corners ?? []);
  const loose = []; // single stickers that do not cover their piece
  const byPiece = new Map();
  for (const i of goal.stickers ?? []) {
    const [orbit, p] = FACELET_MAP[i];
    if (orbit === 2) continue;
    const key = orbit + ":" + p;
    if (!byPiece.has(key)) byPiece.set(key, []);
    byPiece.get(key).push(i);
  }
  for (const [key, list] of byPiece) {
    const [orbit, p] = key.split(":").map(Number);
    if (list.length === (orbit === 0 ? 2 : 3)) (orbit === 0 ? edges : corners).add(p);
    else loose.push(...list);
  }
  const E = [...edges].sort((a, b) => a - b), C = [...corners].sort((a, b) => a - b);
  // the other conditions, each a function of the state
  const conds = [
    ...(goal.edgesOriented ?? []).map((p) => (f) => f[12 + p] === 0),
    ...(goal.cornersOriented ?? []).map((p) => (f) => f[32 + p] === 0),
    ...(goal.cornersPlaced ?? []).map((p) => (f) => f[24 + p] === p),
    ...loose.map((i) => (f) => stickerHome(f, i)),
  ];
  const total = E.length + C.length + conds.length;
  const count = (f) => {
    let n = 0;
    for (const i of E) if (f[i] === i && f[12 + i] === 0) n++;
    for (const i of C) if (f[24 + i] === i && f[32 + i] === 0) n++;
    for (const c of conds) if (c(f)) n++;
    return n;
  };
  const held = (f) => conds.reduce((m, c, k) => (c(f) ? m | (1 << k) : m), 0);
  const need = goal.atLeast ?? total;
  return {
    edges: E, corners: C, bits: bit(E, C), total, need, rule: goal.rule ?? null, count, held,
    reached: (f) => count(f) >= need,
    target: conds.length ? null : { edges: E, corners: C },
  };
}

/** The facelets a goal covers, for drawing it on a net (placement-only corners are drawn by their side stickers). */
export function goalStickers(goal = {}) {
  const out = new Set(goal.stickers ?? []);
  FACELET_MAP.forEach(([orbit, p, k], i) => {
    // an edge's orientation shows on its first sticker: U or D, and F or B for the middle edges
    if (orbit === 0 && (goal.edges?.includes(p) || (k === 0 && goal.edgesOriented?.includes(p)))) out.add(i);
    if (orbit === 1 && (goal.corners?.includes(p) || (k === 0 && goal.cornersOriented?.includes(p)) || (k > 0 && goal.cornersPlaced?.includes(p)))) out.add(i);
    if (orbit === 2) out.add(i);
  });
  return [...out].sort((a, b) => a - b);
}
