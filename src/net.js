// A cube net of the 54 stickers (Kociemba order: faces U R F D L B, nine each, row by row), drawn in the solver's frame:
// yellow on top, blue at the front (the cube turned over after the white cross, as every step but the cross is solved).
// Marked stickers show their color, the others are gray; centers always show theirs.
const COLORS = { U: "#ffd500", R: "#c41e3a", F: "#0051ba", D: "#ffffff", L: "#ff5800", B: "#009e60" };
const FACES = "URFDLB";
const ORIGIN = { U: [0, 3], L: [3, 0], F: [3, 3], R: [3, 6], B: [3, 9], D: [6, 3] }; // [row, column] of each face on the net
export const FACE_NAMES = { U: "top (yellow)", R: "right (red)", F: "front (blue)", D: "bottom (white)", L: "left (orange)", B: "back (green)" };

/**
 * The net as an element. With onToggle the stickers are buttons (the step editor); without, a small picture (the step list).
 * Returns { el, set(stickers) }.
 */
export function cubeNet({ stickers = [], onToggle = null, label = "Goal" } = {}) {
  const el = document.createElement("div");
  el.className = "net" + (onToggle ? " net-edit" : "");
  el.setAttribute("role", onToggle ? "group" : "img");
  el.setAttribute("aria-label", label);
  const cells = [];
  for (let i = 0; i < 54; i++) {
    const face = FACES[Math.floor(i / 9)], k = i % 9;
    const center = k === 4;
    const cell = document.createElement(onToggle && !center ? "button" : "span");
    if (onToggle && !center) {
      cell.type = "button";
      cell.title = `${FACE_NAMES[face]}, sticker ${k + 1}`;
      cell.addEventListener("click", () => onToggle(i));
    }
    cell.className = "st" + (center ? " center" : "");
    const [r, c] = ORIGIN[face];
    cell.style.gridRow = String(r + Math.floor(k / 3) + 1);
    cell.style.gridColumn = String(c + (k % 3) + 1);
    cell.style.setProperty("--c", COLORS[face]);
    el.append(cell);
    cells.push(cell);
  }
  const set = (list) => {
    const on = new Set(list);
    cells.forEach((cell, i) => {
      const lit = i % 9 === 4 || on.has(i);
      cell.classList.toggle("on", lit);
      if (cell.tagName === "BUTTON") cell.setAttribute("aria-pressed", String(lit));
    });
  };
  set(stickers);
  return { el, set };
}
