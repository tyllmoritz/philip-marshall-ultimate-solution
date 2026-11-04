// Smart cube support (Web Bluetooth via cubing.js): the player on the left mirrors the real cube,
// the one on the right repeats the next algorithm of the solution. "Next algorithm" is enabled once the
// real cube shows the state that algorithm leads to.
import { connectSmartPuzzle } from "cubing/bluetooth";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
import { cube3x3x3 } from "cubing/puzzles";
import { TwistyPlayer } from "cubing/twisty";
import { connectGanCube } from "gan-web-bluetooth";
import { rotationOf } from "./engine/flat.js";
import { faceletsToPattern } from "./facelets.js";

const $ = (id) => document.getElementById(id);
const moveMs = (m) => (m.endsWith("2") ? 1500 : 1000);
const isRotation = (m) => /^[xyz]/.test(m);

/** Edges and corners only (a smart cube keeps its centres where they are). */
function samePieces(a, b) {
  const d = (p) => p.patternData;
  for (const orbit of ["EDGES", "CORNERS"]) {
    const x = d(a)[orbit], y = d(b)[orbit];
    if (x.pieces.join() !== y.pieces.join() || x.orientation.join() !== y.orientation.join()) return false;
  }
  return true;
}

/**
 * The solution as the cube itself sees it: whole-cube rotations are not moves of a smart cube
 * (its centres never move), they only change which cube face a following turn lands on.
 */
export function cubeFrameMoves(solution) {
  const rotations = [];
  const out = [];
  for (const m of solution) {
    if (isRotation(m)) { rotations.push(m); continue; }
    const frame = rotations.length ? rotationOf(rotations) : null;
    out.push(frame ? frame[m[0]] + m.slice(1) : m);
  }
  return out;
}

export function initSmartCube(api) {
  let kpuzzle = null;
  let puzzle = null; // connected BluetoothPuzzle
  let pattern = null; // what the real cube looks like now
  let plan = null; // { before: [KPattern per unit start], after: [...] , units }
  let algIndex = 0;
  let live = null;
  let next = null;
  let nextMs = 0;
  let nextWaiting = false;
  const status = (t, err = false) => { $("bt-status").textContent = t; $("bt-status").classList.toggle("error", err); };

  const makePlayer = (host) => {
    const p = new TwistyPlayer({ puzzle: "3x3x3", visualization: "3D", background: "none", controlPanel: "none", hintFacelets: "none" });
    $(host).appendChild(p);
    return p;
  };

  async function patternToScramble(p) {
    const alg = (await experimentalSolve3x3x3IgnoringCenters(p)).invert();
    return alg.toString().replace(/2'/g, "2"); // F2' is just F2
  }

  /** Expected cube patterns at every unit boundary of the current solution, starting from the current scramble. */
  function computePlan() {
    plan = null;
    const { current, layout } = api.get();
    if (!kpuzzle || !current?.result || !layout) return;
    const cube = cubeFrameMoves(current.result.solution);
    // number of cube-frame moves before solution move g
    const cubeBefore = [0];
    current.result.solution.forEach((m) => cubeBefore.push(cubeBefore[cubeBefore.length - 1] + (isRotation(m) ? 0 : 1)));
    let p = kpuzzle.defaultPattern().applyAlg(current.scramble.join(" "));
    const states = [p];
    for (const m of cube) { p = p.applyMove(m); states.push(p); }
    plan = { units: layout.units, at: (g) => states[cubeBefore[g]] };
    algIndex = 0;
    showNext();
    check();
  }

  function showNext() {
    const { current } = api.get();
    if (!next || !plan) return;
    const u = plan.units[algIndex];
    $("bt-alg-title").textContent = u ? `Next algorithm (${algIndex + 1} of ${plan.units.length})` : "Solved";
    if (!u) { next.alg = ""; nextMs = 0; return; }
    const sol = current.result.solution;
    next.experimentalSetupAlg = [...current.scramble, ...sol.slice(0, u.s)].join(" ");
    next.alg = sol.slice(u.s, u.e).join(" ");
    nextMs = sol.slice(u.s, u.e).reduce((t, m) => t + moveMs(m), 0);
    next.timestamp = "start";
    next.play();
  }

  /** Enable "Next algorithm" once the real cube is where this algorithm leads. */
  function check() {
    const btn = $("bt-next");
    if (!plan || !pattern || algIndex >= plan.units.length) { btn.disabled = true; return; }
    const done = samePieces(pattern, plan.at(plan.units[algIndex].e));
    btn.disabled = !done;
    if (done) status("Algorithm done - press Next algorithm.");
  }

  async function onMove(e) {
    const move = e.latestAlgLeaf;
    pattern = pattern.applyMove(move);
    live.experimentalAddMove(move);
    check();
  }

  /**
   * GAN Gen2, Gen3 and Gen4 cubes (356 i3, 356 i Carry 2, 12 ui, Maglev, ...) talk a newer, encrypted protocol that
   * cubing.js does not speak (it only knows the first generation); gan-web-bluetooth does. This wraps its connection
   * in the few methods the rest of the page needs.
   */
  async function connectGan() {
    kpuzzle ??= await cube3x3x3.kpuzzle();
    const conn = await connectGanCube(async (_device, isFallback) => (isFallback
      ? window.prompt("The cube's MAC address could not be read automatically.\nEnter it (like AB:12:34:CD:56:EF; Chrome: chrome://bluetooth-internals shows it):")
      : null));
    const listeners = [];
    const waiting = [];
    let facelets = null;
    const sub = conn.events$.subscribe((ev) => {
      if (ev.type === "FACELETS") {
        facelets = ev.facelets;
        waiting.splice(0).forEach((resolve) => resolve(facelets));
      } else if (ev.type === "MOVE") {
        listeners.forEach((f) => f({ latestAlgLeaf: ev.move, timeStamp: Date.now() }));
      }
    });
    await conn.sendCubeCommand({ type: "REQUEST_FACELETS" });
    return {
      name: () => conn.deviceName,
      disconnect() { sub.unsubscribe(); conn.disconnect(); },
      async getPattern() {
        return faceletsToPattern(kpuzzle, facelets ?? await new Promise((resolve) => waiting.push(resolve)));
      },
      addAlgLeafListener: (f) => listeners.push(f),
    };
  }

  async function connect(provider) {
    $("bt-connect").disabled = true;
    $("bt-connect-gan").disabled = true;
    $("bt-connect-gan").classList.remove("hint-me");
    status("Connecting…");
    try {
      kpuzzle ??= await cube3x3x3.kpuzzle();
      puzzle = await (provider ?? connectSmartPuzzle)();
      pattern = await puzzle.getPattern();
      puzzle.addAlgLeafListener(onMove);
      $("bt").hidden = false;
      live ??= makePlayer("bt-live");
      next ??= makePlayer("bt-next-cube");
      next.experimentalModel.detailedTimelineInfo.addFreshListener((info) => {
        if (nextMs && !nextWaiting && info.timestamp >= nextMs - 5) {
          nextWaiting = true;
          setTimeout(() => { nextWaiting = false; next.timestamp = "start"; next.play(); }, 1000); // repeat
        }
      });
      live.alg = "";
      live.experimentalSetupAlg = await patternToScramble(pattern);
      $("bt-connect").textContent = "Disconnect";
      $("bt-connect").disabled = false;
      $("bt-connect-gan").hidden = true;
      status(`Connected${puzzle.name?.() ? ": " + puzzle.name() : ""}.`);
      computePlan();
    } catch (err) {
      $("bt-connect").disabled = false;
      $("bt-connect-gan").disabled = false;
      const msg = String(err?.message ?? "");
      if (/No Services matching UUID/i.test(msg)) {
        // cubing.js picked its first-generation GAN driver for a cube that speaks a newer protocol
        status("This cube uses a newer GAN protocol (Gen2-Gen4) that cubing.js cannot read. Press \"Connect GAN cube (Gen2-4)\" and pick it again.", true);
        $("bt-connect-gan").classList.add("hint-me");
      } else {
        status(msg ? "Could not connect: " + msg : "Could not connect.", true);
      }
    }
  }

  function disconnect() {
    try { puzzle?.disconnect(); } catch {}
    puzzle = null;
    $("bt").hidden = true;
    $("bt-connect").textContent = "Connect smart cube";
    $("bt-connect-gan").hidden = false;
    $("bt-connect-gan").disabled = false;
    status("Disconnected.");
  }

  $("bt-connect").addEventListener("click", () => (puzzle ? disconnect() : connect()));
  $("bt-connect-gan").addEventListener("click", () => connect(connectGan));
  $("bt-take").addEventListener("click", async () => {
    if (!pattern) return;
    status("Reading the cube…");
    const alg = await patternToScramble(pattern);
    live.alg = "";
    live.experimentalSetupAlg = alg;
    api.setScramble(alg);
    status("Cube state taken as the scramble.");
  });
  $("bt-next").addEventListener("click", () => {
    algIndex++;
    showNext();
    check();
    status(algIndex >= (plan?.units.length ?? 0) ? "All algorithms done." : "Do the algorithm shown on the right.");
  });

  if (!navigator.bluetooth) {
    $("bt-connect-gan").title = "Web Bluetooth is not available in this browser (try Chrome or Edge)";
    $("bt-connect").title = "Web Bluetooth is not available in this browser (try Chrome or Edge)";
  }
  // test hook: connect with a stand-in puzzle
  window.__marshallSmart = { connect, cubeFrameMoves, get kpuzzle() { return kpuzzle; }, ready: cube3x3x3.kpuzzle().then((k) => (kpuzzle ??= k)) };
  return { onSolution: computePlan };
}
