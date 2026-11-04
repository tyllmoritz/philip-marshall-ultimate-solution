// Facelets (Kociemba order URFDLB, as sent by GAN Gen2-4 cubes) -> cubing.js KPattern.
// The table below is the inverse of cubing.js's own pattern-to-facelets conversion
// (cubing.js, MIT License, https://github.com/cubing/cubing.js).
import { KPattern } from "cubing/kpuzzle";

const REID_EDGES = "UF UR UB UL DF DR DB DL FR FL BR BL".split(" ");
const REID_CORNERS = "UFR URB UBL ULF DRF DFL DLB DBR".split(" ");
const CENTER_ORDER = "U L F R B D".split(" ");
const FACELET_MAP = [
  [1, 2, 0],
  [0, 2, 0],
  [1, 1, 0],
  [0, 3, 0],
  [2, 0, 0],
  [0, 1, 0],
  [1, 3, 0],
  [0, 0, 0],
  [1, 0, 0],
  [1, 0, 2],
  [0, 1, 1],
  [1, 1, 1],
  [0, 8, 1],
  [2, 3, 0],
  [0, 10, 1],
  [1, 4, 1],
  [0, 5, 1],
  [1, 7, 2],
  [1, 3, 2],
  [0, 0, 1],
  [1, 0, 1],
  [0, 9, 0],
  [2, 2, 0],
  [0, 8, 0],
  [1, 5, 1],
  [0, 4, 1],
  [1, 4, 2],
  [1, 5, 0],
  [0, 4, 0],
  [1, 4, 0],
  [0, 7, 0],
  [2, 5, 0],
  [0, 5, 0],
  [1, 6, 0],
  [0, 6, 0],
  [1, 7, 0],
  [1, 2, 2],
  [0, 3, 1],
  [1, 3, 1],
  [0, 11, 1],
  [2, 1, 0],
  [0, 9, 1],
  [1, 6, 1],
  [0, 7, 1],
  [1, 5, 2],
  [1, 1, 2],
  [0, 2, 1],
  [1, 2, 1],
  [0, 10, 0],
  [2, 4, 0],
  [0, 11, 0],
  [1, 7, 1],
  [0, 6, 1],
  [1, 6, 2]
];
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
