import { Alg } from "cubing/alg";
import { randomScrambleForEvent } from "cubing/scramble";
import { TwistyPlayer } from "cubing/twisty";
import { initSmartCube } from "./smartcube.js";

const $ = (id) => document.getElementById(id);
const MOVE = /^[UDFBRL][2']?$/;

const player = new TwistyPlayer({
  puzzle: "3x3x3",
  visualization: "3D",
  background: "none",
  controlPanel: "none",
  hintFacelets: "none",
});
$("player").appendChild(player);

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

/** Scramble text -> face turns, via cubing's alg parser (comments, groupings, commutators, repeats all work). */
function parseScramble(text) {
  let alg;
  try {
    alg = new Alg(text.replace(/[’‘`]/g, "'"));
  } catch (err) {
    throw new Error("Could not read the scramble: " + err.message);
  }
  const moves = [...alg.expand().experimentalLeafMoves()].map((m) => m.toString().replace("2'", "2"));
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
let scope = null; // {s, e}: a series that was clicked and plays on its own (repeat off)
let win = null; // {a, b} in ms: what the current playback loops over or stops at
let dragging = false;
let pin = null; // {ms, g}: a jump target; at exactly this time the move g is the current one (not the one that just ended)
const HOLD = 1000; // one rotation of pause before and after jumps
const REPEATS = ["off", "all", "step", "algo"];

// whole-turn animation lengths used by cubing.js, to turn a move index into a timestamp
const moveMs = (m) => (m.endsWith("2") ? 1500 : 1000);
const msOf = (g) => view.cum[Math.min(Math.max(g - view.from, 0), view.moves.length)];
const repeatMode = () => $("repeat").dataset.mode;

function setRepeat(mode) {
  const b = $("repeat");
  b.dataset.mode = mode;
  b.textContent = "↻ " + (mode === "off" ? "repeat" : mode);
  b.classList.toggle("off", mode === "off");
  b.title = { off: "Repeat: off (click to cycle)", all: "Repeat the whole solution", step: "Repeat the current step", algo: "Repeat the current series" }[mode];
}
setRepeat("off");

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

/** Active borders: the step and series being played, and the solution when the whole of it is. */
function markActive(g) {
  document.querySelectorAll(".active").forEach((e) => e.classList.remove("active"));
  if (!view || view.custom) return;
  const wholeSolution = !scope && (repeatMode() === "off" || repeatMode() === "all");
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
    case "corner": return `Niklas${part.moves[0] === "U" ? "" : " (inverse)"} · cycles three corners`;
    case "f2l": return "F2L algorithm · inserts a corner-edge pair";
    case "daisy": return "Daisy · white edges up around the yellow centre";
    case "insert": return "Half turn · drops a white edge into the cross";
    default: return "Turns · line up the pieces";
  }
}

/** The step, what its algorithm does, and the algorithm itself (what is left of it) as the panel's background. */
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
  box2.replaceChildren();
  const from = Math.max(u.s, view.from);
  const moves = current.result.solution.slice(from, u.e);
  if (!moves.length) box2.textContent = "done";
  moves.forEach((m, i) => {
    const span = document.createElement("span");
    span.textContent = m;
    if (from + i === lit) span.className = "now"; // the move being played, like in the solution list
    box2.append(span, " ");
  });
  $("algo-did").hidden = true;
}

function updatePlayButton() {
  const on = isPlaying || holding;
  $("playpause").textContent = on ? "⏸" : "▶";
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
  }, HOLD);
}

function onTime(ts) {
  lastTs = ts;
  if (!view) return;
  if (!dragging) $("progress").value = ts;
  clearHighlight();
  const g = pin && Math.abs(ts - pin.ms) < 1 ? pin.g : indexAt(ts);
  if (ts > 0) {
    lit = g;
    document.querySelector(`.mv[data-i="${g}"]`)?.classList.add("now");
  }
  markActive(g);
  // at the end of the playback window: pause one rotation, then loop (or stop)
  if (wantPlay && !holding && win && ts >= win.b - 5) {
    player.pause();
    if (repeatMode() !== "off") {
      afterHold(() => {
        player.timestamp = win.a;
        afterHold(() => player.play());
      });
    } else wantPlay = false;
  }
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
  player.experimentalSetupAlg = setupMoves.join(" ");
  player.alg = algMoves.join(" ");
  player.timestamp = "start";
  clearHighlight();
  document.querySelectorAll(".active").forEach((e) => e.classList.remove("active"));
  setControls(false);
}

/** Load the full solution (with // comments explaining every part) into the player. */
function useSolution() {
  const { scramble, result } = current;
  const cum = [0];
  for (const m of result.solution) cum.push(cum[cum.length - 1] + moveMs(m));
  view = { from: 0, to: result.solution.length, moves: result.solution, cum };
  const alg = annotate(result.steps, 0, result.solution.length);
  player.experimentalSetupAlg = scramble.join(" ");
  player.alg = alg;
  player.timestamp = "start";
  clearHighlight();
  $("progress").max = cum[cum.length - 1];
  $("progress").value = 0;
  $("twizzle").href = "https://alpha.twizzle.net/edit/?" + new URLSearchParams({ alg, "setup-alg": scramble.join(" ") });
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
  view = { from, to, moves, cum };
  scope = null;
  player.experimentalSetupAlg = [...scramble, ...result.solution.slice(0, from)].join(" ");
  player.alg = annotate(result.steps, from, to);
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
  view = { from: 0, to: moves.length, moves, cum, custom: true };
  scope = null;
  player.experimentalSetupAlg = setup;
  player.alg = moves.join(" ");
  player.timestamp = "start";
  clearHighlight();
  document.querySelectorAll(".active").forEach((e) => e.classList.remove("active"));
  $("progress").max = cum[cum.length - 1];
  $("progress").value = 0;
  if (moves.length) playFrom(0, 0);
}

/** What a playback loops over / stops at, from the repeat mode, the clicked scope and position g. */
function updateWindow(g = indexAt(lastTs)) {
  if (!view) return;
  const mode = repeatMode();
  let range = { s: view.from, e: view.to };
  if (mode === "algo") range = layout.units.find((x) => g >= x.s && g < x.e) ?? range;
  else if (mode === "step") range = layout.steps.find((x) => g >= x.s && g < x.e) ?? range;
  else if (mode === "off" && scope) range = scope;
  win = { a: msOf(range.s), b: msOf(range.e) };
}

/** Jump there, wait one rotation, then play. */
function playFrom(ms, g = indexAt(ms)) {
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

const options = () => ({
  f2l: $("f2l").checked,
  yellowTop: $("yellow").checked || $("beginner").checked,
  beginner: $("beginner").checked,
});

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
  show(scramble, []);
  current = { scramble, result: null };
  dispatch({ id: nextId, scramble, ...options() });
}

let typing = null;
$("scramble").addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(solve, 500);
});

function finish(result) {
  $("result").classList.remove("stale");
  if (result.error) {
    setStatus("Could not solve: " + result.error, true);
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

const SERIES_KINDS = ["edge", "corner", "f2l", "turns", "daisy", "insert"];
const KIND_LABEL = { daisy: "daisy: white edges up around the yellow centre", insert: "half turn into the white cross", edge: "Hedgeslammer / Sledgehammer / sexy move (edge series)", corner: "Niklas (corner series)", setup: "setup / undo turns", undo: "undo", turns: "turns", rotate: "cube rotation", f2l: "F2L algorithm" };

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
  document.querySelectorAll("#controls button, #progress").forEach((e) => { e.disabled = !on; });
  if (!on) $("twizzle").classList.add("disabled");
}

function render({ scramble, result }) {
  $("result").hidden = false;
  $("total").textContent = `— ${result.total} moves`;
  $("total2").textContent = `— ${result.total} moves`;
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
      layout.units.push({ s, e: at, step: i, part: group.find((x) => SERIES_KINDS.includes(x.kind)) });
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
    playFrom(msOf(u.s), u.s);
  } else if (t.classList.contains("step")) {
    const st = layout.steps[+t.dataset.step];
    scope = null;
    setRepeat("step"); // clicking a step repeats it
    playFrom(msOf(st.s), st.s);
  } else {
    scope = null;
    if (repeatMode() === "step" || repeatMode() === "algo") setRepeat("off");
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

// ---- transport controls ----
$("playpause").addEventListener("click", () => {
  if (!view) return;
  if (isPlaying || holding) {
    cancelHold();
    wantPlay = false;
    player.pause();
    updatePlayButton();
    return;
  }
  if (scope && (lastTs < msOf(scope.s) - 5 || lastTs >= msOf(scope.e) - 5)) scope = null;
  const end = view.cum[view.moves.length];
  playFrom(lastTs >= end - 5 ? 0 : lastTs);
});
$("repeat").addEventListener("click", () => {
  setRepeat(REPEATS[(REPEATS.indexOf(repeatMode()) + 1) % REPEATS.length]);
  updateWindow();
  if (view) markActive(indexAt(lastTs));
});

/** Jump to a series or step start; after a jump playback resumes following one rotation of pause. */
function go(kind, dir) {
  if (!view) return;
  const list = kind === "algo" ? layout.units : layout.steps;
  const eps = 1;
  const target = dir > 0
    ? list.find((x) => msOf(x.s) > lastTs + eps)
    : [...list].reverse().find((x) => msOf(x.s) < lastTs - eps) ?? list[0];
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
  lastTs = +$("progress").value;
  pin = null;
  player.timestamp = lastTs;
  updateWindow();
});

let repeatBeforeSmart = null;
const smart = initSmartCube({
  player,
  get: () => ({ current, layout }),
  /** a smart cube is connected: the cube shows what is left of the current algorithm, in a loop */
  showRange(from, to) {
    if (!current?.result || !layout) return;
    if (repeatBeforeSmart === null) repeatBeforeSmart = repeatMode();
    setRepeat("all");
    useRange(from, to);
  },
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
    m.classList.toggle("done", !!info.done);
    if (info.done) m.textContent = "done: next algorithm";
    else {
      m.replaceChildren();
      (info.moves ?? "").split(" ").filter(Boolean).forEach((t, i) => {
        const span = document.createElement("span");
        span.textContent = t;
        if (i < (info.undo ?? 0)) span.className = "undo"; // wrong turns to take back come first
        m.append(span, " ");
      });
    }
    $("algo-did").hidden = !info.did;
    $("algo-did").textContent = info.did ?? "";
  },
  showCustom(setup, moves) {
    if (repeatBeforeSmart === null) repeatBeforeSmart = repeatMode();
    setRepeat("all");
    useCustom(setup, moves);
  },
  showFull() {
    infoLocked = false;
    $("algo-did").hidden = true;
    $("algo-moves").classList.remove("done");
    if (repeatBeforeSmart !== null) { setRepeat(repeatBeforeSmart); repeatBeforeSmart = null; }
    if (current?.result && layout) { useSolution(); wantPlay = false; player.pause(); }
  },
  setScramble(text) {
    $("scramble").value = text;
    solve();
  },
});

const OPTION_IDS = ["f2l", "yellow", "beginner"];
const syncOptions = () => {
  // the beginner cross is built from the yellow side, so it implies yellow on top
  if ($("beginner").checked) $("yellow").checked = true;
  $("yellow").disabled = $("beginner").checked;
};
try {
  for (const id of OPTION_IDS) $(id).checked = localStorage.getItem("marshall-" + id) === "1";
} catch {}
syncOptions();
for (const id of OPTION_IDS) {
  $(id).addEventListener("change", () => {
    syncOptions();
    try { localStorage.setItem("marshall-" + id, $(id).checked ? "1" : "0"); } catch {}
    solve(); // re-solve with the new option
  });
}

$("scramble").value = randomScramble().join(" ");
show(parseScramble($("scramble").value), []);
newScramble().then((text) => {
  if (!current) { $("scramble").value = text; solve(); }
});
// solve the first scramble once a worker is ready
if (!current) {
  setStatus("Preparing solver…");
}

// a click anywhere that is not a move drops the selection
document.addEventListener("click", (e) => { if (!e.target.closest?.(".mv")) clearHighlight(); });
