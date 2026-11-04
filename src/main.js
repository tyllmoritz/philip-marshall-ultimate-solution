import { Alg } from "cubing/alg";
import { randomScrambleForEvent } from "cubing/scramble";
import { TwistyPlayer } from "cubing/twisty";

const $ = (id) => document.getElementById(id);
const MOVE = /^[UDFBRL][2']?$/;

const player = new TwistyPlayer({
  puzzle: "3x3x3",
  visualization: "3D",
  background: "none",
  controlPanel: "bottom-row",
  hintFacelets: "none",
});
$("player").appendChild(player);

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let nextId = 0;
let current = null; // { scramble, result }

worker.onmessage = (e) => {
  if (e.data.type === "ready") {
    $("solve").disabled = false;
    setStatus("Ready.");
  } else if (e.data.type === "result" && e.data.id === nextId) {
    finish(e.data.result);
  }
};

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

/** Scramble text -> face turns, via cubing's alg parser (comments, groupings, commutators, repeats all work). */
function parseScramble(text) {
  let alg;
  try {
    alg = new Alg(text.replace(/[’‘`]/g, "'"));
  } catch (err) {
    throw new Error("Could not read the scramble: " + err.message);
  }
  const moves = [...alg.expand().experimentalLeafMoves()].map((m) => m.toString());
  const bad = moves.find((m) => !MOVE.test(m));
  if (bad) throw new Error(`Unsupported move "${bad}". Use U D F B R L with ' or 2.`);
  return moves;
}

/** A fresh scramble from cubing's WCA-style scrambler; plain random turns if it is unavailable. */
async function newScramble() {
  try {
    return (await randomScrambleForEvent("333")).toString();
  } catch {
    return randomScramble().join(" ");
  }
}

function randomScramble(length = 25) {
  const faces = ["U", "D", "F", "B", "R", "L"];
  const opposite = { U: "D", D: "U", F: "B", B: "F", R: "L", L: "R" };
  const out = [];
  while (out.length < length) {
    const f = faces[Math.floor(Math.random() * 6)];
    const a = out[out.length - 1]?.[0];
    const b = out[out.length - 2]?.[0];
    if (f === a || (b === f && opposite[f] === a)) continue;
    out.push(f + ["", "2", "'"][Math.floor(Math.random() * 3)]);
  }
  return out;
}

// what the player is showing: global index of its first move and its moves (null before a solve)
let view = null;
let lit = null; // move index highlighted to follow the animation

function clearHighlight() {
  lit = null;
  document.querySelectorAll(".mv.now").forEach((e) => e.classList.remove("now"));
}

function highlight(ts) {
  clearHighlight();
  if (!view || !view.moves.length || ts <= 0) return;
  let t = 0, i = 0;
  for (; i < view.moves.length; i++) {
    t += moveMs(view.moves[i]);
    if (ts <= t + 1) break;
  }
  lit = view.from + Math.min(i, view.moves.length - 1);
  document.querySelector(`.mv[data-i="${lit}"]`)?.classList.add("now");
}
// the highlighted move follows the animation (and the scrubber)
player.experimentalModel.detailedTimelineInfo.addFreshListener((info) => highlight(info.timestamp));

/** Show setup + alg in the player; with `from`, the alg carries // comments explaining every part. */
function show(setupMoves, algMoves, from = null) {
  view = from === null ? null : { from, moves: algMoves };
  player.experimentalSetupAlg = setupMoves.join(" ");
  player.alg = from === null ? algMoves.join(" ") : annotate(current.result.steps, from, from + algMoves.length);
  player.timestamp = "start";
  clearHighlight();
}

$("random").addEventListener("click", async () => {
  $("random").disabled = true;
  setStatus("Scrambling…");
  $("scramble").value = await newScramble();
  $("random").disabled = false;
  solve();
});
$("solve").addEventListener("click", solve);

function solve() {
  let scramble;
  try {
    scramble = parseScramble($("scramble").value);
  } catch (err) {
    setStatus(err.message, true);
    return;
  }
  if (!scramble.length) { setStatus("Enter a scramble first.", true); return; }
  $("solve").disabled = true;
  setStatus("Solving…");
  show(scramble, []);
  nextId++;
  worker.postMessage({ id: nextId, scramble, f2l: $("f2l").checked });
  current = { scramble, result: null };
}

function finish(result) {
  $("solve").disabled = false;
  if (result.error) {
    setStatus("Could not solve: " + result.error, true);
    return;
  }
  current.result = result;
  const pairs = result.f2lPairs ? ` (cross + ${result.f2lPairs} F2L pairs)` : "";
  setStatus(`Solved in ${result.total} moves, MCC ${result.mcc.toFixed(1)}${pairs}.`);
  render(current);
  show(current.scramble, result.solution, 0);
  player.play();
}

const KIND_LABEL = { edge: "edge series", corner: "corner series", setup: "setup", undo: "undo", turns: "turns", rotate: "cube rotation", f2l: "F2L pair" };

/** What a part of the solution does, for the // comments in the player and its Twizzle link. */
function describe(p, parts, k) {
  const next = parts[k + 1]?.kind;
  const series = (kind) => kind === "edge" || kind === "corner";
  if (p.note) return p.note;
  if (p.kind === "edge") return "Edge series: cycles three edge pieces (corners get disturbed)";
  if (p.kind === "corner") return "Corner series: cycles three corners and twists them (edges stay put)";
  if (p.kind === "f2l") return "F2L algorithm: insert a corner-edge pair next to the cross";
  if (p.kind === "rotate") return series(next) ? "Rotate the cube so the series is done at the front/top" : "Rotate back to the original orientation";
  if (p.kind === "setup") return series(next) || next === "rotate" ? "Setup: bring the pieces into position" : "Undo the setup";
  return k ? "Turn the layer to line up the next pieces" : "Turn the layer to line up the pieces";
}

/** The solution moves [from, to) as alg text with a `// comment` after every group of moves. */
function annotate(steps, from, to) {
  const lines = [];
  let at = 0;
  steps.forEach((step, i) => {
    const out = [];
    step.parts.forEach((p, k) => {
      const s = at, e = at + p.moves.length;
      at = e;
      const lo = Math.max(s, from), hi = Math.min(e, to);
      if (lo < hi) out.push(`${p.moves.slice(lo - s, hi - s).join(" ")} // ${describe(p, step.parts, k)}`);
    });
    if (out.length) lines.push(`// Step ${i + 1}: ${step.name}`, ...out, "");
  });
  return lines.join("\n").trim();
}

// whole-turn animation lengths used by cubing.js, to turn a move index into a timestamp
const moveMs = (m) => (m.endsWith("2") ? 1500 : 1000);

/** Show the full solution, paused right after move `k`. */
function jumpTo(k) {
  const { scramble, result } = current;
  show(scramble, result.solution, 0);
  player.pause();
  player.timestamp = result.solution.slice(0, k + 1).reduce((t, m) => t + moveMs(m), 0);
}

function render({ scramble, result }) {
  $("result").hidden = false;
  $("total").textContent = `— ${result.total} moves`;
  $("total2").textContent = `— ${result.total} moves`;
  const solution = $("solution");
  solution.dataset.s = 0;
  solution.dataset.e = result.solution.length;
  const ol = $("steps");
  ol.replaceChildren();
  let at = 0;
  result.steps.forEach((step, i) => {
    const li = document.createElement("li");
    li.className = "step";
    li.dataset.s = at;
    const head = document.createElement("div");
    head.className = "step-head";
    head.innerHTML = `<span class="step-name">${i + 1}. ${step.name}</span><span class="step-count" title="Movecount coefficient: estimated execution cost, lower is better">${step.count} moves · MCC ${step.mcc.toFixed(1)}</span>`;
    const body = document.createElement("div");
    if (!step.parts.length) body.textContent = "Already solved.";
    let prevRotate = null;
    for (const part of step.parts) {
      const chip = document.createElement("span");
      chip.className = "chip " + part.kind;
      chip.title = KIND_LABEL[part.kind] + " - click to play";
      chip.dataset.s = prevRotate && part.kind !== "rotate" ? prevRotate : at; // a series starts at its rotation
      for (const m of part.moves) {
        const mv = document.createElement("span");
        mv.className = "mv";
        mv.dataset.i = at++;
        mv.textContent = m;
        chip.append(mv, " ");
      }
      chip.dataset.e = at;
      prevRotate = part.kind === "rotate" ? chip.dataset.s : null;
      body.append(chip, " ");
    }
    li.dataset.e = at;
    li.append(head, body);
    ol.append(li);
  });
}

// innermost clickable thing under the pointer: move > block > step > whole solution
const target = (e) => e.target.closest?.(".mv, .chip, .step, .solution");
$("solution").addEventListener("click", async (e) => {
  if (!current?.result) return;
  const t = target(e);
  if (!t) return;
  const sol = current.result.solution;
  if (t.classList.contains("mv")) {
    const k = +t.dataset.i;
    // a second click on the highlighted move plays on from it
    if (lit === k && !(await player.experimentalModel.playingInfo.get()).playing) player.play();
    else jumpTo(k);
    return;
  }
  const s = +t.dataset.s, end = +t.dataset.e;
  show([...current.scramble, ...sol.slice(0, s)], sol.slice(s, end), s);
  player.play();
});
let hot = null;
$("solution").addEventListener("pointerover", (e) => {
  let t = target(e);
  if (t?.classList.contains("mv")) t = null; // moves have their own highlight
  if (t === hot) return;
  hot?.classList.remove("hot");
  hot = t;
  hot?.classList.add("hot");
});
$("solution").addEventListener("pointerleave", () => { hot?.classList.remove("hot"); hot = null; });

try {
  $("f2l").checked = localStorage.getItem("marshall-f2l") === "1";
} catch {}
$("f2l").addEventListener("change", () => {
  try { localStorage.setItem("marshall-f2l", $("f2l").checked ? "1" : "0"); } catch {}
});

$("scramble").value = randomScramble().join(" ");
show(parseScramble($("scramble").value), []);
newScramble().then((text) => { if (!current) { $("scramble").value = text; show(parseScramble(text), []); } });

// a click anywhere that is not a move drops the selection
document.addEventListener("click", (e) => { if (!e.target.closest?.(".mv")) clearHighlight(); });
