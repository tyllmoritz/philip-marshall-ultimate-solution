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
player.style.width = "100%";
player.style.maxWidth = "520px";
player.style.height = "360px";
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
  worker.postMessage({ id: nextId, scramble });
  current = { scramble, result: null };
}

function finish(result) {
  $("solve").disabled = false;
  if (result.error) {
    setStatus("Could not solve: " + result.error, true);
    return;
  }
  current.result = result;
  setStatus(`Solved in ${result.total} moves (cross on the ${result.crossFace} face).`);
  render(current);
  show(current.scramble, result.solution);
  player.play();
}

const KIND_LABEL = { edge: "edge series", corner: "corner series", setup: "setup", undo: "undo", turns: "turns" };

function render({ scramble, result }) {
  $("result").hidden = false;
  $("viewbar").hidden = false;
  $("total").textContent = `— ${result.total} moves`;
  $("plain").textContent = result.solution.join(" ");
  const ol = $("steps");
  ol.replaceChildren();
  let before = [];
  result.steps.forEach((step, i) => {
    const li = document.createElement("li");
    const head = document.createElement("button");
    head.type = "button";
    head.className = "step-head";
    head.innerHTML = `<span class="step-name">${i + 1}. ${step.name}</span><span class="step-count">${step.count} moves</span>`;
    const body = document.createElement("div");
    body.className = "step-body";
    if (!step.parts.length) body.textContent = "Already solved.";
    for (const part of step.parts) {
      const chip = document.createElement("span");
      chip.className = "chip " + part.kind;
      chip.title = KIND_LABEL[part.kind];
      chip.textContent = part.moves.join(" ");
      body.append(chip, " ");
    }
    const setupMoves = [...scramble, ...before];
    const stepMoves = step.parts.flatMap((p) => p.moves);
    head.addEventListener("click", () => { show(setupMoves, stepMoves); player.play(); });
    before = before.concat(stepMoves);
    li.append(head, body);
    ol.append(li);
  });
}

$("view-scramble").addEventListener("click", () => current && show(current.scramble, []));
$("view-full").addEventListener("click", () => {
  if (current?.result) { show(current.scramble, current.result.solution); player.play(); }
});

$("scramble").value = randomScramble().join(" ");
show(parseScramble($("scramble").value), []);
