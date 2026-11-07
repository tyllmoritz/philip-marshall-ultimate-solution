// Facelets (Kociemba order URFDLB, as sent by GAN Gen2-4 cubes) -> cubing.js KPattern.
// The facelet table (FACELET_MAP, in engine/goals.js) is the inverse of cubing.js's own pattern-to-facelets conversion
// (cubing.js, MIT License, https://github.com/cubing/cubing.js).
import { KPattern } from "cubing/kpuzzle";
import { FACELET_MAP, EDGE_NAMES, CORNER_NAMES } from "./engine/goals.js";

const REID_EDGES = EDGE_NAMES;
const REID_CORNERS = CORNER_NAMES;
const rotateLeft = (s, i) => s.slice(i) + s.slice(0, i);

/** The 3x3x3 pattern (edges and corners; centres stay home) described by a 54-character facelet string. */
export function faceletsToPattern(kpuzzle, facelets) {
  if (typeof facelets !== "string" || facelets.length !== 54) throw new Error("Unexpected facelets: " + facelets);
  const stickers = [Array.from({ length: 12 }, () => []), Array.from({ length: 8 }, () => [])];
  FACELET_MAP.forEach(([orbit, pos, ori], i) => {
    if (orbit < 2) stickers[orbit][pos][ori] = facelets[i];
  });
  const solve = (names, list) => {
    const pieces = [], orientation = [];
    for (const letters of list) {
      const s = letters.join("");
      let found = false;
      for (let piece = 0; piece < names.length && !found; piece++) {
        for (let o = 0; o < names[piece].length; o++) {
          if (rotateLeft(names[piece], o) === s) { pieces.push(piece); orientation.push(o); found = true; break; }
        }
      }
      if (!found) throw new Error("Impossible cubie: " + s);
    }
    return { pieces, orientation };
  };
  return new KPattern(kpuzzle, {
    EDGES: solve(REID_EDGES, stickers[0]),
    CORNERS: solve(REID_CORNERS, stickers[1]),
    CENTERS: kpuzzle.defaultPattern().patternData.CENTERS,
  });
}
