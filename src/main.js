import { Alg } from "cubing/alg";
import { randomScrambleForEvent } from "cubing/scramble";
import { TwistyPlayer } from "cubing/twisty";
import { initSmartCube } from "./smartcube.js";
import { initMethods } from "./methods-ui.js";
import { initAlgsets } from "./algsets.js";
import { errorText } from "./engine/presets.js";
import { rotationOf, rotationWord, invertRotationWord } from "./engine/flat.js";
import { cubeFrameMoves, rotationsIn, isRotation } from "./cubeframe.js";

window.marshallStarted = true; // the scripts loaded: the repair in index.html is not needed
const startedAt = Date.now();
const $ = (id) => document.getElementById(id);
const MOVE = /^[UDFBRLudfbrlMESxyz][2']?$/;

const player = new TwistyPlayer({
  puzzle: "3x3x3",
  visualization: "3D",
  background: "none",
  controlPanel: "none",
  hintFacelets: "none",
});
$("player").appendChild(player);

// a small cube in the usual view: shown while the big one has been turned by hand (drag), a click turns that back
const mini = new TwistyPlayer({ puzzle: "3x3x3", visualization: "3D", background: "none", controlPanel: "none", hintFacelets: "none" });
$("mini").prepend(mini);
let loaded = { setup: "", alg: "" }; // what the player shows (it cannot be read back from cubing.js)
let home = null; // the camera the player starts with
let miniOn = false;
/** Show setup + alg on the player (and the small cube). */
function load(setup, alg) {
  loaded = { setup, alg };
  player.experimentalSetupAlg = setup;
  player.alg = alg;
  if (miniOn) syncMini();
}
function syncMini() {
  mini.experimentalSetupAlg = loaded.setup;
  mini.alg = loaded.alg;
  mini.timestamp = lastTs;
}
player.experimentalModel.twistySceneModel.orbitCoordinates.addFreshListener((c) => {
  if (!c) return;
  home ??= { latitude: c.latitude, longitude: c.longitude };
  const dLon = Math.abs(((c.longitude - home.longitude) % 360 + 540) % 360 - 180);
  const off = Math.abs(c.latitude - home.latitude) > 20 || dLon > 20;
  if (off === miniOn) return;
  miniOn = off;
  $("mini").hidden = !off;
  if (off) syncMini();
});
$("mini").addEventListener("click", () => {
  if (!home) return;
  player.cameraLatitude = home.latitude;
  player.cameraLongitude = home.longitude;
});

// Two solver workers: a solve in progress is aborted by terminating its worker, while the spare
// (already initialised) takes the new request; a fresh spare is started in the background.
const workers = [];
let nextId = 0;
let current = null; // { scramble, result }
let pending = null; // latest request waiting for a worker to be ready

function spawn() {
  const w = { worker: new Worker(new URL("./worker.js", import.meta.url), { type: "module" }), state: "init", id: 0 };
  w.worker.onmessage = (e) => {
    if (e.data.type === "ready") {
      w.state = "idle";
      if (pending) dispatch(pending);
      else if (!current) setStatus("Ready.");
    } else if (e.data.type === "result") {
      w.state = "idle";
      if (e.data.id === nextId) finish(e.data.result);
    }
  };
  workers.push(w);
}
spawn();
spawn();

function dispatch(req) {
  const idle = workers.find((w) => w.state === "idle");
  if (!idle) { pending = req; return; }
  pending = null;
  // abort whatever is still being calculated
  for (const w of workers.filter((x) => x.state === "busy")) {
    w.worker.terminate();
    workers.splice(workers.indexOf(w), 1);
    spawn();
  }
  idle.state = "busy";
  idle.worker.postMessage(req);
}

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

/**
 * Scramble text -> face turns, via cubing's alg parser (comments, groupings, commutators, repeats all work). Wide and slice
 * moves and rotations are allowed: the solver gets the face turns that give the same state seen from the centers (the cube
 * held as usual), `.typed` keeps the moves as written for the player.
 */
function parseScramble(text) {
  let alg;
  try {
    alg = new Alg(text.replace(/[’‘`]/g, "'"));
  } catch (err) {
    throw new Error("Could not read the scramble: " + err.message);
  }
  const typed = [...alg.expand().experimentalLeafMoves()].map((m) => m.toString().replace("2'", "2").replace(/^([UDFBRL])w/, (_, f) => f.toLowerCase()));
  const bad = typed.find((m) => !MOVE.test(m));
  if (bad) throw new Error(`Unsupported move "${bad}". Use U D F B R L with ' or 2 (also wide moves like r or Rw, slices M E S, rotations x y z).`);
  const moves = cubeFrameMoves(typed);
  moves.typed = typed;
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

// ---- the player always holds the full solution ----
// view = { from: 0, to, moves, cum } (global move indices; cum[k] = start time of move k in ms)
let view = null;
let layout = null; // { steps: [{s, e}], units: [{s, e, step}] } for the current solution
let lit = null; // move index highlighted to follow the animation
let lastTs = 0;
let isPlaying = false;
let wantPlay = false; // playback was asked for and has not been stopped yet
let holding = false; // waiting one rotation before (re)starting
let holdTimer = null;
let scope = null; // {s, e}: a series that was clicked and plays on its own (loop off)
let win = null; // {a, b, s, e}: what the current playback loops over or stops at, in ms (a, b) and moves [s, e)
let dragging = false;
let pin = null; // {ms, g}: a jump target; at exactly this time the move g is the current one (not the one that just ended)
let cur = 0; // the move highlighted now (the one playing, or when paused, the one the cube has just done or is about to do)
const HOLD = 1000; // one rotation of pause before and after jumps (at normal speed)
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 10];
let speed = 1;
const LOOPS = ["off", "1", "2", "3", "algo", "step", "all"]; // the slider stops, left to right

// whole-turn animation lengths used by cubing.js, to turn a move index into a timestamp
const moveMs = (m) => (m.endsWith("2") ? 1500 : 1000);
const msOf = (g) => view.cum[Math.min(Math.max(g - view.from, 0), view.moves.length)];
const loopMode = () => $("loop").dataset.mode;

function setLoop(mode) {
  const b = $("loop");
  b.dataset.mode = mode;
  b.value = String(LOOPS.indexOf(mode));
}
setLoop("off"); // the default: play the solution once (a smart cube switches to looping, see onConnected)

function clearHighlight() {
  lit = null;
  document.querySelectorAll(".mv.now").forEach((e) => e.classList.remove("now"));
}

/** Global index of the move being played at time ts (the first move at the very start). */
function indexAt(ts) {
  if (ts <= 0) return view.from;
  let k = 0;
  while (k < view.moves.length - 1 && ts > view.cum[k + 1] + 1) k++;
  return view.from + k;
}

/** Global index of the move that plays from ts on: at the end of a move, the next one (indexAt says the one just done). */
function startAt(ts) {
  let k = 0;
  while (k < view.moves.length - 1 && ts >= view.cum[k + 1] - 1) k++;
  return view.from + k;
}

/** The move boundary nearest to ts (in ms): a pause or a jump never leaves the cube halfway through a turn. */
function snapMs(ts) {
  if (ts < view.cum[0]) return ts < view.cum[0] / 2 ? 0 : view.cum[0]; // the turn before the first move
  const k = startAt(ts) - view.from;
  const a = view.cum[k], b = view.cum[k + 1] ?? a;
  return ts - a < b - ts ? a : b;
}

/** Active borders: the step and series being played, and the solution when the whole of it is. */
function markActive(g) {
  document.querySelectorAll(".active").forEach((e) => e.classList.remove("active"));
  if (!view || view.custom) return;
  const wholeSolution = !scope && (loopMode() === "off" || loopMode() === "all");
  if (wholeSolution) $("solution").classList.add("active");
  const step = layout.steps.findIndex((x) => g >= x.s && g < x.e);
  const unit = layout.units.findIndex((x) => g >= x.s && g < x.e);
  document.querySelector(`.step[data-step="${step}"]`)?.classList.add("active");
  document.querySelector(`.unit[data-unit="${unit}"]`)?.classList.add("active");
  showInfo(g);
}

/** Short name and purpose of the series in a unit, for the line below the step name. */
function shortInfo(part) {
  if (!part) return "";
  const m = part.moves.join(" ");
  switch (part.kind) {
    case "edge": {
      const name = m === "F R' F' R" ? "Hedgeslammer" : m === "R' F R F'" ? "Sledgehammer"
        : part.moves.every((x) => "RLUD".includes(x[0])) ? "Sexy move" : "Hedgeslammer, turned";
      return `${name} · cycles three edges`;
    }
    case "alg": return part.label ?? "Algorithm";
    case "corner": return `Niklas${part.moves[0] === "U" ? "" : " (inverse)"} · cycles three corners`;
    case "f2l": {
      // the pair's edge, as the solver sees it (cube turned over): which physical edge that is, and so its two colours
      const PAIR_COLOURS = { 8: "blue-red", 9: "blue-orange", 10: "green-red", 11: "green-orange" };
      const colours = PAIR_COLOURS[part.pair];
      if (!colours) return "F2L algorithm · inserts a corner-edge pair";
      return part.frees ? `F2L algorithm · frees the ${colours} pair` : `F2L algorithm · inserts the ${colours} pair`;
    }
    case "daisy": return "Daisy · white edges up around the yellow center";
    case "insert": return "Half turn · drops a white edge into the cross";
    default: return "Turns · line up the pieces";
  }
}

/** The step, what its algorithm does, and the algorithm itself (what is left of it) as the panel's background. */
/**
 * The algorithm line above the cubes, grouped and coloured like the solution list: one chip per part
 * (setup, rotation, series, repair), kinds as in `chip.<kind>`. groups = [{ kind, moves }].
 */
function renderLine(groups) {
  const line = $("algo-moves");
  line.replaceChildren();
  let n = 0;
  for (const g of groups) {
    if (!g.moves.length) continue;
    const chip = document.createElement("span");
    chip.className = "chip " + g.kind;
    for (const m of g.moves) {
      const tok = document.createElement("span");
      tok.className = "tok";
      tok.textContent = m;
      chip.append(tok, " ");
      n++;
    }
    line.append(chip, " ");
  }
  return n;
}
const lineTokens = () => [...$("algo-moves").querySelectorAll(".tok")];

/** The parts of solution unit k from global move `from` on (the part of an algorithm that is left). */
function unitGroups(k, from = 0) {
  const u = layout.units[k];
  const out = [];
  let at = u.s;
  for (const p of u.parts) {
    const skip = Math.max(0, from - at);
    const moves = p.moves.slice(skip);
    if (moves.length) out.push({ kind: p.kind, moves });
    at += p.moves.length;
  }
  return out;
}

let infoLocked = false; // a smart cube writes the panel text itself
function showInfo(g) {
  if (infoLocked) return;
  const box = $("algo-bg");
  if (!view || !layout || !current?.result) { box.hidden = true; return; }
  const u = layout.units.find((x) => g >= x.s && g < x.e) ?? layout.units[layout.units.length - 1];
  if (!u) { box.hidden = true; return; }
  box.hidden = false;
  $("algo-title").textContent = `${u.step + 1}. ${current.result.steps[u.step].name}`;
  $("algo-sub").textContent = shortInfo(u.part);
  const box2 = $("algo-moves");
  box2.classList.remove("done");
  const from = Math.max(u.s, view.from);
  const n = renderLine(unitGroups(layout.units.indexOf(u), from));
  if (!n) box2.textContent = "Done";
  lineTokens().forEach((t, i) => t.classList.toggle("now", from + i === lit)); // the move being played, like in the solution list
  $("algo-did").hidden = true;
}

function updatePlayButton() {
  const on = isPlaying || holding;
  $("playpause").querySelector(".ico").innerHTML = on
    ? '<rect x="6.5" y="5" width="4" height="14" rx="1" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" stroke="none"/>'
    : '<path d="M8 5v14l11-7z" stroke="none"/>';
  $("playpause").title = on ? "Pause" : "Play";
}

function cancelHold() {
  clearTimeout(holdTimer);
  holding = false;
}

/** Run fn after one rotation of pause (the play button shows "pause" meanwhile). */
function afterHold(fn) {
  cancelHold();
  holding = true;
  updatePlayButton();
  holdTimer = setTimeout(() => {
    holding = false;
    fn();
    updatePlayButton();
  }, HOLD / speed);
}

function onTime(ts) {
  if (!view) { lastTs = ts; return; }
  // at the end of the playback window: hold exactly there, the window's last move still highlighted (playback overshoots
  // by a frame, which would light up the first move after it), then loop back to its start (or stop)
  if (wantPlay && !holding && win && ts >= win.b - 5) {
    player.pause();
    pin = { ms: win.b, g: Math.max(win.s, win.e - 1) };
    if (loopMode() !== "off") {
      afterHold(() => {
        pin = { ms: win.a, g: win.s }; // during the hold before playing again, the first move of the loop is the current one
        player.timestamp = win.a;
        afterHold(() => player.play());
      });
    } else wantPlay = false;
    ts = win.b;
    player.timestamp = ts;
  }
  lastTs = ts;
  if (!dragging) $("progress").value = ts;
  clearHighlight();
  const g = pin && Math.abs(ts - pin.ms) < 1 ? pin.g : indexAt(ts);
  cur = g;
  if (ts > 0 && (view.custom || infoLocked)) {
    // the line above the cubes: the move being played (algorithm shown by a smart cube, step 0, ...)
    const k = g - view.from;
    lineTokens().forEach((x, i) => x.classList.toggle("now", i === k));
  }
  turnHint(ts, g);
  if (ts > 0 && ts >= view.cum[0] - 1 && !view.custom) {
    // the solution list lights up only while the solution itself is playing (not during step 0 or the turn before move 1)
    lit = g;
    document.querySelector(`.mv[data-i="${g}"]`)?.classList.add("now");
  }
  markActive(g);
  if (miniOn) mini.timestamp = ts;
}

// ---- whole-cube turns: a line over the cube says which way, and how the cube is held after it ----
const COLOUR = { U: "white", F: "green", R: "red", D: "yellow", L: "orange", B: "blue" };
const ROTATE_LIKE = { x: "R", y: "U", z: "F" };
/** The colours on top and in front after solution move g (-1: before the first move); wide and slice moves turn the centers too. */
function heldAs(g) {
  const rot = rotationsIn([...(current.result.setupRotation ?? []), ...current.result.solution.slice(0, g + 1)]);
  const frame = rot.length ? rotationOf(rot) : { U: "U", F: "F" };
  return `${COLOUR[frame.U]} on top, ${COLOUR[frame.F]} in front`;
}
function turnHint(ts, g) {
  let text = "";
  if (view && !view.custom && current?.result) {
    const m = view.moves[g - view.from];
    if (ts < view.cum[0] - 1) text = `${view.lead.join(" ")}: turn the whole cube first (${heldAs(-1)})`;
    else if (m && isRotation(m)) text = `${m}: turn the whole cube like ${ROTATE_LIKE[m[0]]}${m.slice(1)} (${heldAs(g)})`;
  }
  $("turn-hint").textContent = text;
  $("turn-hint").hidden = !text;
}
// the highlight, borders and progress bar follow the animation (and the scrubber)
player.experimentalModel.detailedTimelineInfo.addFreshListener((info) => onTime(info.timestamp));
player.experimentalModel.playingInfo.addFreshListener((info) => {
  isPlaying = info.playing;
  updatePlayButton();
});

/** Plain player state without a solution (e.g. while solving). */
function show(setupMoves, algMoves) {
  view = null;
  layout = null;
  scope = null;
  win = null;
  wantPlay = false;
  cancelHold();
  load(setupMoves.join(" "), algMoves.join(" "));
  player.timestamp = "start";
  $("turn-hint").hidden = true;
  clearHighlight();
  document.querySelectorAll(".active").forEach((e) => e.classList.remove("active"));
  setControls(false);
}

/**
 * Load the full solution (with // comments explaining every part) into the player. The scramble is shown as typed; the
 * whole-cube turn before the first move (undoing the scramble's own rotations, then holding the cube as the solution
 * wants it, e.g. x2 for the cross on the bottom) is played as well, ahead of move 1.
 */
function useSolution() {
  const { scramble, result } = current;
  const typed = scramble.typed ?? scramble;
  const lead = rotationWord(rotationOf([...invertRotationWord(rotationWord(rotationOf(rotationsIn(typed)))), ...(result.setupRotation ?? [])]));
  const cum = [lead.reduce((ms, m) => ms + moveMs(m), 0)];
  for (const m of result.solution) cum.push(cum[cum.length - 1] + moveMs(m));
  view = { from: 0, to: result.solution.length, moves: result.solution, cum, lead };
  const alg = (lead.length ? `${lead.join(" ")} // Before the first move: turn the whole cube, ${heldAs(-1)}\n\n` : "") + annotate(result.steps, 0, result.solution.length);
  load(typed.join(" "), alg);
  player.timestamp = "start";
  clearHighlight();
  $("progress").max = cum[cum.length - 1];
  $("progress").value = 0;
  $("twizzle").href = "https://alpha.twizzle.net/edit/?" + new URLSearchParams({ alg, "setup-alg": typed.join(" ") });
  $("twizzle").classList.remove("disabled");
}

/**
 * Show only solution moves [from, to) (with everything before them as the setup): the part of an
 * algorithm that is left to do on a smart cube. Loops, since that is what the cube is for.
 */
function useRange(from, to) {
  const { scramble, result } = current;
  const moves = result.solution.slice(from, to);
  const cum = [0];
  for (const m of moves) cum.push(cum[cum.length - 1] + moveMs(m));
  view = { from, to, moves, cum, lead: [] };
  scope = null;
  load([...scramble, ...(result.setupRotation ?? []), ...result.solution.slice(0, from)].join(" "), annotate(result.steps, from, to));
  player.timestamp = "start";
  clearHighlight();
  $("progress").max = cum[cum.length - 1];
  $("progress").value = 0;
  markActive(from);
  if (moves.length) playFrom(0, from);
}

/** Show moves that are not part of the solution (e.g. getting a smart cube to the scramble), looping. */
function useCustom(setup, moves) {
  const cum = [0];
  for (const m of moves) cum.push(cum[cum.length - 1] + moveMs(m));
  view = { from: 0, to: moves.length, moves, cum, custom: true, lead: [] };
  scope = null;
  load(setup, moves.join(" "));
  player.timestamp = "start";
  clearHighlight();
  document.querySelectorAll(".active").forEach((e) => e.classList.remove("active"));
  $("progress").max = cum[cum.length - 1];
  $("progress").value = 0;
  if (moves.length) playFrom(0, 0);
}

/** What a playback loops over / stops at, from the loop mode, the clicked scope and position g (default: the highlighted move). */
function updateWindow(g = cur) {
  if (!view) return null;
  const mode = loopMode();
  let range = { s: view.from, e: view.to };
  if (view.custom && !/^\d$/.test(mode)) range = range; // a list of its own (step 0): algo, step and all are all of it
  else if (mode === "algo") range = layout.units.find((x) => g >= x.s && g < x.e) ?? range;
  else if (mode === "step") range = layout.steps.find((x) => g >= x.s && g < x.e) ?? range;
  else if (/^\d$/.test(mode) && +mode > 0) {
    // that many moves, counted from the current one (rotations come along for free)
    let e = Math.min(Math.max(g, view.from), view.to), n = 0;
    while (e < view.to && n < +mode) { if (!/^[xyz]/.test(view.moves[e - view.from])) n++; e++; }
    while (e < view.to && /^[xyz]/.test(view.moves[e - view.from])) e++;
    range = { s: Math.max(g, view.from), e };
  } else if (mode === "off" && scope) range = scope;
  const s = Math.max(range.s, view.from), e = Math.min(range.e, view.to);
  win = { a: msOf(s), b: msOf(e), s, e };
  return { s, e };
}

/** Jump there, wait one rotation, then play (from the move that starts at ms). */
function playFrom(ms, g = startAt(ms)) {
  pin = { ms, g };
  lastTs = ms;
  updateWindow(g);
  wantPlay = true;
  player.pause();
  player.timestamp = ms;
  afterHold(() => player.play());
}

$("random").addEventListener("click", async () => {
  $("random").disabled = true;
  setStatus("Scrambling…");
  $("scramble").value = await newScramble();
  $("random").disabled = false;
  solve();
});

const algsets = initAlgsets({ onChange: () => solve() });
const methods = initMethods({ onChange: () => solve(), algsets });
const options = () => methods.options();

/** Solve whatever the scramble field and options say now; any calculation still running is aborted. */
function solve() {
  let scramble;
  try {
    scramble = parseScramble($("scramble").value);
  } catch (err) {
    setStatus(err.message, true);
    return;
  }
  nextId++;
  pending = null;
  if (!scramble.length) {
    setStatus("Enter a scramble.");
    show([], []);
    $("result").hidden = true;
    current = { scramble, result: null };
    return;
  }
  setStatus("Solving…");
  $("result").classList.add("stale");
  show(scramble.typed, []);
  current = { scramble, result: null };
  // the steps travel with the request: your own steps with their definitions, every step with the algorithms of its set
  const request = { id: nextId, scramble, ...options() };
  const mine = nextId;
  methods.requestSteps().then((steps) => { if (mine === nextId) dispatch({ ...request, steps }); })
    .catch((err) => { if (mine === nextId) setStatus("Could not load the algorithm sets: " + err.message, true); });
}

let typing = null;
$("scramble").addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(solve, 500);
});

function finish(result) {
  $("result").classList.remove("stale");
  if (result.error) {
    setStatus(errorText(result), true);
    return;
  }
  current.result = result;
  const extra = result.f2lPairs ? ` (cross + ${result.f2lPairs} F2L pairs)` : "";
  setStatus(`Solved in ${result.total} moves, MCC ${result.mcc.toFixed(1)}${extra}.`);
  render(current);
  setControls(true);
  useSolution();
  scope = null;
  playFrom(0, 0);
  smart.onSolution();
}

const SERIES_KINDS = ["edge", "corner", "f2l", "turns", "daisy", "insert", "alg"];
const KIND_LABEL = { alg: "algorithm", daisy: "daisy: white edges up around the yellow center", insert: "half turn into the white cross", edge: "Hedgeslammer / Sledgehammer / sexy move (edge series)", corner: "Niklas (corner series)", setup: "setup / undo turns", undo: "undo", turns: "turns", rotate: "cube rotation", f2l: "F2L algorithm" };
// the legend above the solution: [kind, text, tooltip], shown for the kinds the solution has
const LEGEND = [
  ["edge", "Hedgeslammer / Sledgehammer / sexy move", "F R' F' R, its inverse R' F R F' and all their turned or mirrored forms such as R U R' U'"],
  ["corner", "Niklas", "U R U' L' U R' U' L and its inverse"],
  ["f2l", "F2L algorithm", "inserts a corner-edge pair next to the cross"],
  ["alg", "algorithm", "an algorithm of the method (from an algorithm set, or a beginner step)"],
  ["daisy", "beginner cross", "the daisy, then half turns into the white cross"],
  ["setup", "setup / undo turns", "bring the pieces into position before a series, and back after it"],
  ["turns", "plain turns", "face turns that line up the pieces"],
  ["rotate", "cube rotation", "turn the whole cube (not counted as a move)"],
];

function renderLegend(steps) {
  const kinds = new Set(steps.flatMap((st) => st.parts.map((p) => (p.kind === "insert" ? "daisy" : p.kind === "undo" ? "setup" : p.kind))));
  $("legend").replaceChildren(...LEGEND.filter(([kind]) => kinds.has(kind)).map(([kind, text, title]) => {
    const chip = document.createElement("span");
    chip.className = "chip " + kind;
    chip.title = title;
    chip.textContent = text;
    return chip;
  }));
}

/** What a part of the solution does, for the // comments in the player and its Twizzle link. */
function describe(p, parts, k) {
  const next = parts[k + 1]?.kind;
  const series = (kind) => kind === "edge" || kind === "corner";
  if (p.note) return p.note;
  if (p.kind === "edge") {
    const name = p.moves.join(" ") === "F R' F' R" ? "Hedgeslammer" : p.moves.join(" ") === "R' F R F'" ? "Sledgehammer"
      : p.moves.every((m) => "RLUD".includes(m[0])) ? "Sexy move (a Hedgeslammer/Sledgehammer turned or mirrored)" : "Hedgeslammer/Sledgehammer, turned";
    return `${name}: cycles three edge pieces, corners get disturbed`;
  }
  if (p.kind === "corner") return `Niklas${p.moves[0] === "U" ? "" : " inverse"} (corner series): cycles three corners and twists them, edges stay put`;
  if (p.kind === "f2l") return "F2L algorithm: insert a corner-edge pair next to the cross";
  if (p.kind === "daisy" || p.kind === "insert") return "Beginner cross";
  if (p.kind === "alg") return p.label ?? "Algorithm";
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


function setControls(on) {
  document.querySelectorAll("#controls button, #controls input, #progress").forEach((e) => { e.disabled = !on; });
  if (!on) $("twizzle").classList.add("disabled");
}

function render({ scramble, result }) {
  $("result").hidden = false;
  $("total").textContent = `(${result.total} moves)`;
  $("total2").textContent = `(${result.total} moves)`;
  renderLegend(result.steps);
  const ol = $("steps");
  ol.replaceChildren();
  layout = { steps: [], units: [] };
  view = null;
  let at = 0;
  result.steps.forEach((step, i) => {
    const li = document.createElement("li");
    li.className = "step";
    li.dataset.step = i;
    const stepStart = at;
    const head = document.createElement("div");
    head.className = "step-head";
    head.innerHTML = `<span class="step-name">${i + 1}. ${step.name}</span><span class="step-count" title="Movecount coefficient: estimated execution cost, lower is better">${step.count} moves · MCC ${step.mcc.toFixed(1)}</span>`;
    const body = document.createElement("div");
    if (!step.parts.length) body.textContent = "Already solved.";
    // a series (with the setup and rotations leading up to it) is one unit; trailing parts join the last unit
    const groups = [];
    let open = [];
    for (const part of step.parts) {
      open.push(part);
      if (SERIES_KINDS.includes(part.kind)) { groups.push(open); open = []; }
    }
    if (open.length) groups.length ? groups[groups.length - 1].push(...open) : groups.push(open);
    for (const group of groups) {
      const unit = document.createElement("span");
      unit.className = "unit";
      unit.dataset.unit = layout.units.length;
      const s = at;
      for (const part of group) {
        const chip = document.createElement("span");
        chip.className = "chip " + part.kind;
        chip.title = KIND_LABEL[part.kind];
        for (const m of part.moves) {
          const mv = document.createElement("span");
          mv.className = "mv";
          mv.dataset.i = at++;
          mv.textContent = m;
          chip.append(mv, " ");
        }
        unit.append(chip, " ");
      }
      layout.units.push({ s, e: at, step: i, part: group.find((x) => SERIES_KINDS.includes(x.kind)), parts: group.map((x) => ({ kind: x.kind, moves: x.moves })) });
      body.append(unit, " ");
    }
    layout.steps.push({ s: stepStart, e: at });
    li.append(head, body);
    ol.append(li);
  });
}

// innermost clickable thing under the pointer: move > series > step > whole solution
const target = (e) => e.target.closest?.(".mv, .unit, .step, .solution");
$("solution").addEventListener("click", (e) => {
  if (!current?.result || !layout) return;
  const t = target(e);
  if (!t) return;
  if (view && view.to - view.from !== current.result.solution.length) { smart.release(); useSolution(); }
  if (t.classList.contains("mv")) {
    const k = +t.dataset.i;
    // first click jumps to the state after the move, a second click plays from the move (including it)
    if (lit === k && !wantPlay) { scope = null; playFrom(msOf(k), k); return; }
    cancelHold();
    wantPlay = false;
    player.pause();
    lastTs = msOf(k + 1);
    pin = null;
    player.timestamp = lastTs;
    return;
  }
  if (t.classList.contains("unit")) {
    const u = layout.units[+t.dataset.unit];
    scope = { s: u.s, e: u.e };
    setLoop("algo"); // clicking a series loops it
    playFrom(msOf(u.s), u.s);
  } else if (t.classList.contains("step")) {
    const st = layout.steps[+t.dataset.step];
    scope = null;
    setLoop("step"); // clicking a step loops it
    playFrom(msOf(st.s), st.s);
  } else {
    scope = null;
    setLoop("all"); // the outer border plays everything
    playFrom(0, 0);
  }
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

// ---- speed: the cubing.js tempo (the pauses between loops follow it) ----
function setSpeed(i) {
  speed = SPEEDS[i] ?? 1;
  player.tempoScale = speed;
  $("speed").value = String(i);
  $("speed").title = `Playback speed ${speed}×`;
  try { localStorage.setItem("marshall-speed", String(i)); } catch {}
}
$("speed").addEventListener("input", () => setSpeed(+$("speed").value));
try {
  const saved = localStorage.getItem("marshall-speed");
  setSpeed(saved !== null && SPEEDS[+saved] ? +saved : 2);
} catch { setSpeed(2); }

// ---- transport controls ----
$("playpause").addEventListener("click", () => {
  if (!view) return;
  if (isPlaying || holding) {
    cancelHold();
    wantPlay = false;
    player.pause();
    if (isPlaying) {
      // stop on a whole move: back to the start of the move being played or on to its end, whichever is nearer;
      // that move stays highlighted (Play then repeats it, or goes on with the next one)
      const g = startAt(lastTs);
      lastTs = snapMs(lastTs);
      pin = { ms: lastTs, g };
      player.timestamp = lastTs;
    }
    updatePlayButton();
    return;
  }
  if (scope && (lastTs < msOf(scope.s) - 5 || lastTs >= msOf(scope.e) - 5)) scope = null;
  const end = view.cum[view.moves.length];
  playFrom(lastTs >= end - 5 ? 0 : lastTs);
});
$("loop").addEventListener("input", () => {
  setLoop(LOOPS[+$("loop").value]);
  if (!view) return;
  // the new loop starts from its own beginning: restart there (playing on if it was playing, else just moved)
  const range = updateWindow();
  if (wantPlay || holding) playFrom(msOf(range.s), range.s);
  else {
    cancelHold();
    lastTs = msOf(range.s);
    pin = { ms: lastTs, g: range.s };
    updateWindow(range.s);
    player.pause();
    player.timestamp = lastTs;
  }
  markActive(range.s);
});

/** Jump to a series or step start; after a jump playback resumes following one rotation of pause. */
function go(kind, dir) {
  if (!view) return;
  // counted from the highlighted move (at a boundary the time alone cannot say which side of it we are on);
  // back goes to the start of the current algorithm or step first, unless we are already there
  const list = (kind === "algo" ? layout.units : layout.steps).filter((x) => x.e > x.s);
  let at = -1; // the algorithm or step the highlighted move belongs to (the last one starting at or before it)
  list.forEach((x, i) => { if (x.s <= cur) at = i; });
  const target = dir > 0
    ? list.find((x) => x.s > cur)
    : at >= 0 && lastTs > msOf(list[at].s) + 1 ? list[at] : list[Math.max(at - 1, 0)];
  if (!target) {
    // nothing further: jump to the end of the solution
    const end = view.cum[view.moves.length];
    if (dir < 0 || lastTs >= end - 1) return;
    cancelHold();
    wantPlay = false;
    pin = null;
    lastTs = end;
    player.pause();
    player.timestamp = end;
    return;
  }
  if (kind === "algo" && scope) scope = { s: target.s, e: target.e };
  else if (kind === "step") scope = null;
  lastTs = msOf(target.s);
  pin = { ms: lastTs, g: target.s };
  updateWindow(target.s);
  cancelHold();
  player.pause();
  player.timestamp = lastTs;
  if (wantPlay) afterHold(() => player.play());
}
$("prev-step").addEventListener("click", () => go("step", -1));
$("prev-series").addEventListener("click", () => go("algo", -1));
$("next-series").addEventListener("click", () => go("algo", 1));
$("next-step").addEventListener("click", () => go("step", 1));

// our own progress bar
$("progress").addEventListener("pointerdown", () => { dragging = true; });
$("progress").addEventListener("pointerup", () => { dragging = false; });
$("progress").addEventListener("input", () => {
  if (!view) return;
  lastTs = snapMs(+$("progress").value); // whole moves only
  pin = null;
  player.timestamp = lastTs;
  updateWindow(startAt(lastTs));
});
$("progress").addEventListener("change", () => { $("progress").value = lastTs; }); // the thumb settles on the move boundary

const smart = initSmartCube({
  player,
  get: () => ({ current, layout }),
  async newScramble() {
    $("scramble").value = await newScramble();
    solve();
  },
  /** a smart cube was connected: what is left of an algorithm is shown in a loop, so looping is switched on */
  onConnected() {
    if (loopMode() === "off") setLoop("3");
  },
  /** a smart cube is connected: the cube shows what is left of the current algorithm, in a loop */
  showRange(from, to) {
    if (!current?.result || !layout) return;
    useRange(from, to);
  },
  /** coloured groups of solution unit k from global move `from` on */
  unitGroups(k, from) { return unitGroups(k, from); },
  /** step and algorithm name for solution unit k */
  unitInfo(k) {
    const u = layout?.units[k];
    if (!u) return null;
    return { title: `${u.step + 1}. ${current.result.steps[u.step].name}`, sub: shortInfo(u.part) };
  },
  /** the panel text, written by the smart cube: { title, sub, moves, done, did } or null to hand it back */
  setInfo(info) {
    infoLocked = !!info;
    if (!info) { if (view) showInfo(view.from); else $("algo-bg").hidden = true; return; }
    $("algo-bg").hidden = false;
    $("algo-title").textContent = info.title;
    $("algo-sub").textContent = info.sub ?? "";
    const m = $("algo-moves");
    m.classList.toggle("done", !!info.done && info.action === "scramble"); // (only "New scramble" is a button)
    m.dataset.action = info.action ?? "";
    if (info.done) m.textContent = info.action === "scramble" ? "New scramble" : "Done";
    else {
      const n = renderLine(info.groups ?? [{ kind: "turns", moves: (info.moves ?? "").split(" ").filter(Boolean) }]);
      if (!n) m.textContent = "";
    }
    $("algo-did").hidden = !info.did;
    $("algo-did").textContent = info.did ?? "";
  },
  showCustom(setup, moves) {
    useCustom(setup, moves);
  },
  showFull() {
    infoLocked = false;
    $("algo-did").hidden = true;
    $("algo-moves").classList.remove("done");
    if (current?.result && layout) { useSolution(); wantPlay = false; player.pause(); }
  },
  setScramble(text) {
    $("scramble").value = text;
    solve();
  },
});

$("scramble").value = randomScramble().join(" ");
show(parseScramble($("scramble").value).typed, []);
newScramble().then((text) => {
  if (!current) { $("scramble").value = text; solve(); }
});
// solve the first scramble once a worker is ready
if (!current) {
  setStatus("Preparing solver…");
}

// a click anywhere that is not a move drops the selection
document.addEventListener("click", (e) => { if (!e.target.closest?.(".mv")) clearHighlight(); });

// ---- installable, works offline (PWA) ----
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
  // a new version took over: this page's scripts may be gone from the cache and the server (the solver workers are started
  // again on every new solve), so load the page again - at once if it has only just opened, else when the user is ready
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return; // the first install, nothing changed
    if (Date.now() - startedAt < 10000) location.reload();
    else $("update").hidden = false;
  });
}
$("update").addEventListener("click", () => location.reload());
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("install").hidden = false;
});
window.addEventListener("appinstalled", () => { installPrompt = null; $("install").hidden = true; });
$("install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("install").hidden = true;
});
