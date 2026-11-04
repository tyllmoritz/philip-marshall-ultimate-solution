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

function parseScramble(text) {
  const tokens = text.replace(/[’‘`]/g, "'").trim().split(/\s+/).filter(Boolean);
  const bad = tokens.find((t) => !MOVE.test(t));
  if (bad) throw new Error(`Unsupported move "${bad}". Use U D F B R L with ' or 2.`);
  return tokens;
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

function show(setupMoves, algMoves) {
  player.experimentalSetupAlg = setupMoves.join(" ");
  player.alg = algMoves.join(" ");
  player.timestamp = "start";
}

$("random").addEventListener("click", () => {
  const scr = randomScramble();
  $("scramble").value = scr.join(" ");
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
  show(current.scramble, result.solution);
  player.play();
}

const KIND_LABEL = { edge: "edge series", corner: "corner series", setup: "setup", undo: "undo", turns: "turns", rotate: "cube rotation", f2l: "F2L pair" };

/** Twizzle editor link: the solution with a `// comment` after every group of moves. */
function twizzleUrl(scramble, steps) {
  const SERIES = ["edge", "corner"];
  const lines = ["// Solution: white cross first, series always at the front/top"];
  steps.forEach((step, i) => {
    lines.push("", `// Step ${i + 1}: ${step.name}`);
    if (!step.parts.length) lines.push("// already solved");
    step.parts.forEach((p, k) => {
      const next = step.parts[k + 1]?.kind;
      const prev = step.parts[k - 1]?.kind;
      let note = p.note;
      if (note) {}
      else if (p.kind === "edge") note = "Edge series: cycles three edge pieces (corners get disturbed)";
      else if (p.kind === "corner") note = "Corner series: cycles three corners and twists them (edges stay put)";
      else if (p.kind === "f2l") note = "F2L algorithm: insert a corner-edge pair next to the cross";
      else if (p.kind === "rotate") note = SERIES.includes(next) ? "Rotate the cube so the series is done at the front/top" : "Rotate back to the original orientation";
      else if (p.kind === "setup") note = SERIES.includes(next) || next === "rotate" ? "Setup: bring the pieces into position" : "Undo the setup";
      else note = prev ? "Turn the layer to line up the next pieces" : "Turn the layer to line up the pieces";
      lines.push(`${p.moves.join(" ")} // ${note}`);
    });
  });
  const q = new URLSearchParams({ alg: lines.join("\n"), "setup-alg": scramble.join(" ") });
  return "https://alpha.twizzle.net/edit/?" + q;
}

// whole-turn animation lengths used by cubing.js, to turn a move index into a timestamp
const moveMs = (m) => (m.endsWith("2") ? 1500 : 1000);

function play(setupMoves, algMoves) {
  show(setupMoves, algMoves);
  player.play();
}

/** Show the full solution, paused right after move `k`. */
function jumpTo(k) {
  const { scramble, result } = current;
  show(scramble, result.solution);
  player.pause();
  player.timestamp = result.solution.slice(0, k + 1).reduce((t, m) => t + moveMs(m), 0);
  document.querySelectorAll(".mv.now").forEach((e) => e.classList.remove("now"));
  document.querySelector(`.mv[data-i="${k}"]`)?.classList.add("now");
}

function render({ scramble, result }) {
  $("result").hidden = false;
  $("total").textContent = `— ${result.total} moves`;
  $("total2").textContent = `— ${result.total} moves`;
  $("twizzle").href = twizzleUrl(scramble, result.steps);
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
$("solution").addEventListener("click", (e) => {
  if (!current?.result) return;
  const t = target(e);
  if (!t) return;
  const sol = current.result.solution;
  if (t.classList.contains("mv")) { jumpTo(+t.dataset.i); return; }
  const s = +t.dataset.s, end = +t.dataset.e;
  play([...current.scramble, ...sol.slice(0, s)], sol.slice(s, end));
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
