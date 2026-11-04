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
  let cameraLinked = false;
  // the live cube follows the orientation and the moves of the algorithm shown on the right
  let liveBase = ""; // alg that builds the real cube's state from solved
  let displayRot = []; // whole-cube rotations the live cube has been given
  let cursor = 0; // where the live cube is in the solution (index of the next token)
  const status = (t, err = false) => { $("bt-status").textContent = t; $("bt-status").classList.toggle("error", err); };

  const makePlayer = (host) => {
    const p = new TwistyPlayer({ puzzle: "3x3x3", visualization: "3D", background: "none", controlPanel: "none", hintFacelets: "none" });
    $(host).appendChild(p);
    return p;
  };

  /** Dragging or touching either cube turns the other one the same way. */
  function linkCameras(a, b) {
    const follow = (from, to) => from.experimentalModel.twistySceneModel.orbitCoordinates.addFreshListener((c) => {
      if (!c) return;
      const cur = to.experimentalModel.twistySceneModel.orbitCoordinates;
      cur.get().then((o) => {
        if (Math.abs(o.latitude - c.latitude) < 0.01 && Math.abs(o.longitude - c.longitude) < 0.01) return; // already there: no ping-pong
        to.cameraLatitude = c.latitude;
        to.cameraLongitude = c.longitude;
      });
    });
    follow(a, b);
    follow(b, a);
  }

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
    resetLive();
  }

  /** Show the real cube again from its current state, in the orientation the first algorithm starts with. */
  async function resetLive() {
    if (!live || !pattern) return;
    const mine = (resetToken = (resetToken ?? 0) + 1);
    const base = await patternToScramble(pattern);
    if (mine !== resetToken) return;
    liveBase = base;
    live.alg = "";
    live.experimentalSetupAlg = base;
    displayRot = [];
    cursor = 0;
    alignLive();
  }
  let resetToken = 0;

  const solution = () => api.get().current?.result?.solution ?? [];
  const unit = () => plan?.units[algIndex];

  /** Rotate the live cube like the solution does, up to the next move of the current algorithm. */
  function emitRotations() {
    const sol = solution(), u = unit();
    while (u && cursor < u.e && isRotation(sol[cursor])) {
      live.experimentalAddMove(sol[cursor]);
      displayRot.push(sol[cursor]);
      cursor++;
    }
  }

  /** Bring the live cube to the orientation of the solution at the start of the current algorithm. */
  function alignLive() {
    const sol = solution(), u = unit();
    if (!u) return;
    for (; cursor < u.s; cursor++) {
      if (isRotation(sol[cursor])) { live.experimentalAddMove(sol[cursor]); displayRot.push(sol[cursor]); }
    }
    cursor = u.s;
    emitRotations();
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
    alignLive();
  }

  /** Enable "Next algorithm" once the real cube is where this algorithm leads. */
  function check() {
    const btn = $("bt-next");
    if (!plan || !pattern || algIndex >= plan.units.length) { btn.disabled = true; return; }
    const done = samePieces(pattern, plan.at(plan.units[algIndex].e));
    btn.disabled = !done;
    if (done) status("Algorithm done - press Next algorithm.");
  }

  let lastMoveAt = 0;

  /**
   * The cube reports its own state every now and then. When it disagrees with what the moves added up to
   * (a move got lost), the cube's state wins.
   */
  function onCubeState(fresh) {
    if (!pattern || Date.now() - lastMoveAt < 1200) return; // moves still coming in
    if (samePieces(fresh, pattern)) return;
    pattern = fresh;
    status("Re-synced with the state the cube reports.");
    resetLive();
    check();
  }

  async function onMove(e) {
    lastMoveAt = Date.now();
    const move = e.latestAlgLeaf.toString();
    pattern = pattern.applyMove(move);
    const sol = solution(), u = unit();
    if (!plan || !u) {
      live.experimentalAddMove(move); // no solution to follow: show the move as the cube reports it
    } else {
      emitRotations();
      // the cube reports turns of its own faces; show them on whichever position that face has in the shown orientation
      const frame = displayRot.length ? rotationOf(displayRot) : null;
      const position = frame ? Object.keys(frame).find((p) => frame[p] === move[0]) : move[0];
      live.experimentalAddMove(position + move.slice(1));
      if (cursor < u.e && !isRotation(sol[cursor])) cursor++; // that was the expected move
      if (cursor >= u.e || sol.slice(cursor, u.e).every(isRotation)) emitRotations(); // rotate back at the end
    }
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
    const listeners = [], faceletListeners = [], lostListeners = [];
    const waiting = [];
    let facelets = null;
    const sub = conn.events$.subscribe((ev) => {
      if (ev.type === "FACELETS") {
        facelets = ev.facelets;
        waiting.splice(0).forEach((resolve) => resolve(facelets));
        faceletListeners.forEach((f) => f(ev.facelets));
      } else if (ev.type === "MOVE") {
        listeners.forEach((f) => f({ latestAlgLeaf: ev.move, timeStamp: Date.now() }));
      } else if (ev.type === "DISCONNECT") {
        lostListeners.forEach((f) => f());
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
      // the cube also reports its state now and then; used to notice and repair missed moves
      onState: (f) => faceletListeners.push((str) => f(faceletsToPattern(kpuzzle, str))),
      onLost: (f) => lostListeners.push(f),
      readState: () => conn.sendCubeCommand({ type: "REQUEST_FACELETS" }),
      resetToSolved: () => conn.sendCubeCommand({ type: "REQUEST_RESET" }),
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
      $("bt").hidden = false;
      live ??= makePlayer("bt-live");
      next ??= makePlayer("bt-next-cube");
      if (!cameraLinked) { linkCameras(live, next); cameraLinked = true; }
      // listeners go on only now that both cubes exist, so no move can arrive too early and be lost
      puzzle.addAlgLeafListener((e) => onMove(e).catch((err) => status("Could not show a move: " + err.message, true)));
      puzzle.onState?.(onCubeState);
      puzzle.onLost?.(() => { status("Connection to the cube was lost - press Connect again.", true); disconnect(false); });
      $("bt-reread").hidden = $("bt-reset").hidden = !puzzle.resetToSolved;
      next.experimentalModel.detailedTimelineInfo.addFreshListener((info) => {
        if (nextMs && !nextWaiting && info.timestamp >= nextMs - 5) {
          nextWaiting = true;
          setTimeout(() => { nextWaiting = false; next.timestamp = "start"; next.play(); }, 1000); // repeat
        }
      });
      liveBase = await patternToScramble(pattern);
      live.alg = "";
      live.experimentalSetupAlg = liveBase;
      displayRot = [];
      cursor = 0;
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

  function disconnect(say = true) {
    try { puzzle?.disconnect(); } catch {}
    puzzle = null;
    $("bt").hidden = true;
    $("bt-connect").textContent = "Connect smart cube";
    $("bt-connect-gan").hidden = false;
    $("bt-connect-gan").disabled = false;
    if (say) status("Disconnected.");
  }

  $("bt-connect").addEventListener("click", () => (puzzle ? disconnect() : connect()));
  $("bt-connect-gan").addEventListener("click", () => connect(connectGan));
  $("bt-take").addEventListener("click", async () => {
    if (!pattern) return;
    status("Reading the cube…");
    const alg = await patternToScramble(pattern);
    liveBase = alg;
    live.alg = "";
    live.experimentalSetupAlg = alg;
    displayRot = [];
    cursor = 0;
    api.setScramble(alg);
    status("Cube state taken as the scramble.");
  });
  $("bt-reread").addEventListener("click", async () => {
    status("Reading the cube…");
    await puzzle?.readState?.();
  });
  $("bt-reset").addEventListener("click", async () => {
    if (!puzzle?.resetToSolved) return;
    if (!window.confirm("Reset the cube's internal state to SOLVED?\nOnly do this when the physical cube is solved (the same as Reset in the GAN app).")) return;
    await puzzle.resetToSolved();
    await puzzle.readState?.();
    status("Cube reset to solved.");
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
  window.__marshallSmart = { connect, cubeFrameMoves, get live() { return live; }, get next() { return next; }, get kpuzzle() { return kpuzzle; }, ready: cube3x3x3.kpuzzle().then((k) => (kpuzzle ??= k)) };
  return { onSolution: computePlan };
}
