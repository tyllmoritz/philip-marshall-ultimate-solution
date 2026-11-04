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

// ---- what the player shows: always the full solution or one complete step ----
// view = { kind: "full" | "step", step, from, to, moves, cum } (global move indices; cum = start time of each move in ms)
let view = null;
let layout = null; // { steps: [{s, e}], units: [{s, e, step}] } for the current solution
let lit = null; // move index highlighted to follow the animation
let lastTs = 0;
let isPlaying = false;
let scope = null; // {s, e}: a series that was clicked and plays on its own (repeat off)
let win = null; // {a, b} in ms: what the current playback loops over or stops at

// whole-turn animation lengths used by cubing.js, to turn a move index into a timestamp
const moveMs = (m) => (m.endsWith("2") ? 1500 : 1000);
const msOf = (g) => view.cum[Math.min(Math.max(g - view.from, 0), view.moves.length)];

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

/** The active border path: solution (when showing everything) > step > series > the move being played. */
function markActive(g) {
  document.querySelectorAll(".active").forEach((e) => e.classList.remove("active"));
  if (!view) return;
  if (view.kind === "full") $("solution").classList.add("active");
  const step = layout.steps.findIndex((x) => g >= x.s && g < x.e);
  const unit = layout.units.findIndex((x) => g >= x.s && g < x.e);
  document.querySelector(`.step[data-step="${view.kind === "step" ? view.step : step}"]`)?.classList.add("active");
  if (view.kind === "full" || (unit >= 0 && layout.units[unit].step === view.step)) document.querySelector(`.unit[data-unit="${unit}"]`)?.classList.add("active");
}

function onTime(ts) {
  lastTs = ts;
  if (!view) return;
  clearHighlight();
  const g = indexAt(ts);
  if (ts > 0) {
    lit = g;
    document.querySelector(`.mv[data-i="${g}"]`)?.classList.add("now");
  }
  markActive(g);
  // loop or stop at the end of the playback window
  if (isPlaying && win && ts >= win.b - 5) {
    if ($("repeat").value !== "off") {
      player.timestamp = win.a;
      player.play();
    } else if (win.b < view.cum[view.moves.length] - 5) player.pause();
  }
}
// the highlight and borders follow the animation (and the scrubber)
player.experimentalModel.detailedTimelineInfo.addFreshListener((info) => onTime(info.timestamp));
player.experimentalModel.playingInfo.addFreshListener((info) => {
  isPlaying = info.playing;
  $("playpause").textContent = isPlaying ? "⏸" : "▶";
  $("playpause").title = isPlaying ? "Pause" : "Play";
});

/** Plain player state without a solution (e.g. while solving). */
function show(setupMoves, algMoves) {
  view = null;
  layout = null;
  scope = null;
  win = null;
  player.experimentalSetupAlg = setupMoves.join(" ");
  player.alg = algMoves.join(" ");
  player.timestamp = "start";
  clearHighlight();
  document.querySelectorAll(".active").forEach((e) => e.classList.remove("active"));
  setControls(false);
}

/** Load the full solution or one step into the player (nothing happens if it is already loaded). */
function useView(kind, step = 0) {
  const { scramble, result } = current;
  if (view && view.kind === kind && (kind === "full" || view.step === step)) return;
  const from = kind === "step" ? layout.steps[step].s : 0;
  const to = kind === "step" ? layout.steps[step].e : result.solution.length;
  const moves = result.solution.slice(from, to);
  const cum = [0];
  for (const m of moves) cum.push(cum[cum.length - 1] + moveMs(m));
  view = { kind, step, from, to, moves, cum };
  player.experimentalSetupAlg = [...scramble, ...result.solution.slice(0, from)].join(" ");
  player.alg = annotate(result.steps, from, to);
  player.timestamp = "start";
  clearHighlight();
  markActive(from);
}

/** Make sure the player shows something that contains global moves [s, e). */
function ensureContains(s, e) {
  if (view && view.from <= s && e <= view.to) return;
  useView("step", layout.steps.findIndex((x) => s >= x.s && s < x.e));
}

function updateWindow() {
  if (!view) return;
  const g = indexAt(lastTs + 2); // the move about to be played, so a boundary belongs to what follows
  const mode = $("repeat").value;
  const whole = { s: view.from, e: view.to };
  let range = whole;
  if (mode === "series") range = layout.units.find((x) => g >= x.s && g < x.e) ?? whole;
  else if (mode === "step") range = layout.steps.find((x) => g >= x.s && g < x.e) ?? whole;
  else if (mode === "off" && scope) range = scope;
  range = { s: Math.max(range.s, view.from), e: Math.min(range.e, view.to) };
  win = { a: msOf(range.s), b: msOf(range.e) };
}

function playFrom(ms) {
  lastTs = ms;
  updateWindow(); // before seeking, so the time listener never sees the old window
  player.timestamp = ms;
  player.play();
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
  setControls(true);
  useView("full");
  scope = null;
  playFrom(0);
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


function setControls(on) {
  document.querySelectorAll("#controls button, #controls select").forEach((e) => { e.disabled = !on; });
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
      if (part.kind === "edge" || part.kind === "corner" || part.kind === "f2l" || part.kind === "turns") { groups.push(open); open = []; }
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
      layout.units.push({ s, e: at, step: i });
      body.append(unit, " ");
    }
    layout.steps.push({ s: stepStart, e: at });
    li.append(head, body);
    ol.append(li);
  });
}

// innermost clickable thing under the pointer: move > series > step > whole solution
const target = (e) => e.target.closest?.(".mv, .unit, .step, .solution");
const unitOf = (el) => layout.units[+el.dataset.unit];
$("solution").addEventListener("click", async (e) => {
  if (!current?.result || !layout) return;
  const t = target(e);
  if (!t) return;
  if (t.classList.contains("mv")) {
    const k = +t.dataset.i;
    ensureContains(k, k + 1);
    // a second click on the highlighted move plays from that move (including it)
    if (lit === k && !isPlaying) { scope = null; playFrom(msOf(k)); return; }
    player.pause();
    player.timestamp = msOf(k + 1);
    lastTs = msOf(k + 1);
    return;
  }
  if (t.classList.contains("unit")) {
    const u = unitOf(t);
    ensureContains(u.s, u.e);
    scope = { s: u.s, e: u.e };
    playFrom(msOf(u.s));
  } else if (t.classList.contains("step")) {
    const i = +t.dataset.step;
    useView("step", i);
    scope = null;
    playFrom(0);
  } else {
    useView("full");
    scope = null;
    playFrom(0);
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
  if (isPlaying) { player.pause(); return; }
  if (scope && (lastTs < msOf(scope.s) - 5 || lastTs >= msOf(scope.e) - 5)) scope = null;
  playFrom(lastTs >= view.cum[view.moves.length] - 5 ? 0 : lastTs);
});
$("repeat").addEventListener("change", updateWindow);

/** Jump to a series or step boundary; keeps playing if it was playing. */
function go(kind, dir) {
  if (!view) return;
  const was = isPlaying;
  const list = kind === "series" ? layout.units : layout.steps;
  const inView = list.filter((x) => x.s >= view.from && x.e <= view.to);
  const eps = 1;
  let target = null; // global move index to start at
  if (dir > 0) {
    target = inView.find((x) => msOf(x.s) > lastTs + eps);
    if (!target && view.kind === "step") {
      const next = layout.steps[view.step + 1];
      if (next) { useView("step", view.step + 1); target = { s: next.s, e: next.e, switched: true }; }
    }
  } else {
    target = [...inView].reverse().find((x) => msOf(x.s) < lastTs - eps);
    if (!target && view.kind === "step" && view.step > 0) {
      useView("step", view.step - 1);
      const prev = (kind === "series" ? layout.units : layout.steps).filter((x) => x.s >= view.from && x.e <= view.to);
      target = prev[prev.length - 1] ?? { s: view.from, e: view.to };
    }
    target ??= { s: view.from, e: view.to };
  }
  if (!target) return;
  if (kind === "series" && scope) scope = { s: target.s, e: target.e };
  else if (kind === "step") scope = null;
  lastTs = msOf(target.s);
  updateWindow();
  player.timestamp = lastTs;
  if (was) player.play();
}
$("prev-step").addEventListener("click", () => go("step", -1));
$("prev-series").addEventListener("click", () => go("series", -1));
$("next-series").addEventListener("click", () => go("series", 1));
$("next-step").addEventListener("click", () => go("step", 1));

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
