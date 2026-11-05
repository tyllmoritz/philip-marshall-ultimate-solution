// Smart cube support (Web Bluetooth via cubing.js): the player on the left mirrors the real cube,
// the solution cube loops what is left of the current algorithm. "Next algorithm" is enabled once the
// real cube shows the state that algorithm leads to.
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
import { cube3x3x3 } from "cubing/puzzles";
import { TwistyPlayer } from "cubing/twisty";
import { connectSmartCube } from "smartcube-web-bluetooth";
import { rotationOf } from "./engine/flat.js";
import { invertAlg } from "./engine/cube.js";
import { mergeTurns } from "./engine/solver.js";
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

const MAC_KEY = "marshall-gan-macs";
function loadMacs() {
  try { return JSON.parse(localStorage.getItem(MAC_KEY)) ?? {}; } catch { return {}; }
}
function storeMacs(macs) {
  try { localStorage.setItem(MAC_KEY, JSON.stringify(macs)); } catch {}
}

const TURNS = ["U", "D", "F", "B", "R", "L"].flatMap((f) => [f, f + "'", f + "2"]);

/** One or two turns from `pattern` to a state of the solution at or after token `from` (within the algorithm) - or null. */
function pathShortcut(plan, pattern, from, to) {
  const onPath = (p) => { for (let g = to; g >= from; g--) if (samePieces(p, plan.at(g))) return g; return -1; };
  let best = null;
  for (const a of TURNS) {
    const p1 = pattern.applyMove(a);
    const g1 = onPath(p1);
    if (g1 >= 0 && (!best || best.moves.length > 1)) best = { moves: [a], g: g1 };
  }
  if (best) return best;
  for (const a of TURNS) {
    const p1 = pattern.applyMove(a);
    for (const b of TURNS) {
      if (b[0] === a[0]) continue;
      const g2 = onPath(p1.applyMove(b));
      if (g2 >= 0) return { moves: [a, b], g: g2 };
    }
  }
  return null;
}

export function initSmartCube(api) {
  let kpuzzle = null;
  let puzzle = null; // connected BluetoothPuzzle
  let pattern = null; // what the real cube looks like now
  let plan = null; // { before: [KPattern per unit start], after: [...] , units }
  let algIndex = 0;
  let live = null;
  let following = true; // the solution cube follows the real cube's progress
  let shownKey = "";
  let stage = 1; // 0: bring the cube to the scramble, 1: follow the solution
  let scrPath = null; // { start, moves, states, token }: the way from where the cube was to the scramble
  let recorded = []; // moves made since the cube left the path
  let offPath = false;
  let recordedCube = []; // the same moves as the cube reports them (its own faces)
  let lastOn = null; // where the cube last was on the path: { g } on the solution, { k } on the way to the scramble
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
    if (!puzzle || !kpuzzle || !current?.result || !layout) return;
    const cube = cubeFrameMoves(current.result.solution);
    // number of cube-frame moves before solution move g
    const cubeBefore = [0];
    current.result.solution.forEach((m) => cubeBefore.push(cubeBefore[cubeBefore.length - 1] + (isRotation(m) ? 0 : 1)));
    let p = kpuzzle.defaultPattern().applyAlg(current.scramble.join(" "));
    const states = [p];
    for (const m of cube) { p = p.applyMove(m); states.push(p); }
    plan = { units: layout.units, at: (g) => states[cubeBefore[g]], count: (g) => cubeBefore[g], total: current.result.solution.length };
    algIndex = 0;
    shownKey = "";
    following = true;
    stage = 0;
    scrPath = null;
    recorded = [];
    recordedCube = [];
    lastOn = null;
    showAlgorithm();
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

  /** The moves that take the cube from where it is to the scramble (and an alg that builds where it is). */
  async function planScramble() {
    const { current } = api.get();
    const from = pattern;
    const start = await patternToScramble(from);
    const target = kpuzzle.algToTransformation(current.scramble.join(" "));
    const q = target.invert().applyTransformation(from.experimentalToTransformation());
    const alg = await experimentalSolve3x3x3IgnoringCenters(q.toKPattern());
    const moves = alg.toString().replace(/2'/g, "2").split(/\s+/).filter(Boolean);
    const states = [from];
    for (const m of moves) states.push(states[states.length - 1].applyMove(m));
    return { start, moves, states };
  }

  const done = (u) => plan && samePieces(pattern, plan.at(u.e));
  let planning = 0;

  /**
   * Decide where the real cube is - on the way to the scramble ("step 0"), on the solution, or neither - and show
   * the matching algorithm: only what is left of it, with the moves already made left out.
   */
  async function showAlgorithm() {
    if (!puzzle || !pattern) return; // no smart cube: the page shows the solution as it is
    if (!plan) { api.showFull(); $("bt-take").hidden = true; return; }
    // where on the solution is the cube? (the largest index whose state matches)
    // (the same state recurs over rotation tokens; inside the current algorithm that one wins, so the end of an
    // algorithm is not mistaken for the start of the next)
    let g = -1;
    const cur = stage === 1 ? unit() : null;
    if (cur) for (let i = cur.e; i >= cur.s; i--) if (samePieces(pattern, plan.at(i))) { g = i; break; }
    if (g < 0) for (let i = plan.total; i >= 0; i--) if (samePieces(pattern, plan.at(i))) { g = i; break; }
    if (stage === 0 && g > 0) stage = 1; // already solving
    let info, range = null, custom = null;
    if (stage === 0) {
      if (g === 0 && scrPath) {
        info = { title: "0. Scramble", sub: "from your cube to the scramble", done: true };
        range = { from: 0, to: 0 };
      } else if (g === 0) {
        stage = 1; // the cube is at the scramble already
      } else {
        const k = scrPath ? scrPath.states.map((p, i) => (samePieces(pattern, p) ? i : -1)).reduce((a, b) => Math.max(a, b), -1) : -1;
        if (!scrPath) {
          const mine = ++planning;
          const fresh = await planScramble();
          if (mine !== planning) return;
          scrPath = fresh;
          return showAlgorithm();
        }
        offPath = k < 0;
        if (k >= 0) {
          lastOn = { k };
          const remaining = scrPath.moves.slice(k);
          custom = { setup: [scrPath.start, ...scrPath.moves.slice(0, k)].join(" "), moves: remaining };
          info = { title: "0. Scramble", sub: "from your cube to the scramble", moves: remaining.join(" ") };
        } else {
          // off the path: first take the wrong turns back, then carry on from where the cube left the path
          const at = lastOn?.k ?? 0;
          const undo = invertAlg(mergeTurns(recordedCube));
          const moves = [...undo, ...scrPath.moves.slice(at)];
          custom = { setup: [scrPath.start, ...scrPath.moves.slice(0, at), ...recordedCube].join(" "), moves };
          info = { title: "0. Scramble", sub: "from your cube to the scramble", moves: moves.join(" "), undo: undo.length };
        }
      }
    }
    if (stage === 1) {
      let u = unit();
      if (g >= 0 && u && (g < u.s || g > u.e)) {
        // the cube moved to another algorithm: follow it
        const k = plan.units.findIndex((x) => g > x.s && g <= x.e);
        algIndex = k >= 0 ? k : 0;
        u = unit();
      }
      if (!u) {
        info = { title: "Solved", sub: "all algorithms done", moves: "" };
        range = { from: plan.total, to: plan.total };
      } else {
        const inside = g >= u.s && g <= u.e;
        offPath = g < 0;
        const base = api.unitInfo(algIndex);
        if (inside) {
          lastOn = { g };
          info = { ...base, moves: solution().slice(g, u.e).join(" "), done: g === u.e };
          range = { from: g, to: u.e };
        } else {
          // off the path: first take the wrong turns back (unless they were just another way to a state on the path,
          // which the state comparison above has already recognised), then carry on from where the cube left it
          const at = lastOn?.g ?? u.s;
          const sol = solution();
          const rotations = sol.slice(0, at).filter(isRotation);
          const frame = rotations.length ? rotationOf(rotations) : null; // what the shown orientation was at that point
          const toView = (m) => (frame ? Object.keys(frame).find((p) => frame[p] === m[0]) + m.slice(1) : m);
          const undo = invertAlg(mergeTurns(recordedCube)).map(toView);
          let lead = undo, resume = at;
          // maybe one or two turns lead to a state further on the path (a different way to the same state): then that
          // is shorter than taking everything back
          const fix = pathShortcut(plan, pattern, at, u.e);
          const count = (from) => sol.slice(from, u.e).filter((m) => !isRotation(m)).length;
          if (fix && fix.moves.length + count(fix.g) < undo.length + count(at)) { lead = fix.moves.map(toView); resume = fix.g; }
          const moves = [...lead, ...sol.slice(resume, u.e)];
          const setup = [...api.get().current.scramble, ...sol.slice(0, at), ...recordedCube.map(toView)].join(" ");
          custom = { setup, moves };
          info = { ...base, moves: moves.join(" "), undo: lead.length };
        }
      }
    }
    if (stage === 1 || (stage === 0 && g === 0)) offPath = stage === 1 ? offPath : false;
    if (!offPath) { recorded = []; recordedCube = []; }
    info.did = offPath && recorded.length ? `You did: ${recorded.join(" ")}` : "";
    $("bt-take").hidden = !offPath;
    const key = `${stage}:${algIndex}:${range ? range.from : "p"}:${offPath}:${custom ? custom.setup + "|" + custom.moves.join(" ") : ""}`;
    api.setInfo(info);
    if (key === shownKey || !following) return;
    shownKey = key;
    if (custom) api.showCustom(custom.setup, custom.moves);
    else if (range && range.from < range.to) api.showRange(range.from, range.to);
    else if (range) api.showRange(range.from, range.from);
    api.setInfo(info);
  }

  /** "done: next algorithm": go on to the next step 0 / algorithm. */
  function nextAlgorithm() {
    if (!plan) return;
    if (stage === 0) { stage = 1; algIndex = 0; }
    else algIndex++;
    shownKey = "";
    following = true;
    showAlgorithm();
    alignLive();
    status(algIndex >= plan.units.length ? "All algorithms done." : "Do the algorithm shown at the top.");
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
    showAlgorithm();
  }

  async function onMove(e) {
    lastMoveAt = Date.now();
    const move = e.latestAlgLeaf.toString();
    pattern = pattern.applyMove(move);
    recordedCube.push(move);
    following = true;
    const sol = solution(), u = unit();
    if (!plan || !u) {
      live.experimentalAddMove(move); // no solution to follow: show the move as the cube reports it
    } else {
      emitRotations();
      // the cube reports turns of its own faces; show them on whichever position that face has in the shown orientation
      const frame = displayRot.length ? rotationOf(displayRot) : null;
      const position = frame ? Object.keys(frame).find((p) => frame[p] === move[0]) : move[0];
      live.experimentalAddMove(position + move.slice(1));
      recorded.push(position + move.slice(1));
      if (cursor < u.e && !isRotation(sol[cursor])) cursor++; // that was the expected move
      if (cursor >= u.e || sol.slice(cursor, u.e).every(isRotation)) emitRotations(); // rotate back at the end
    }
    showAlgorithm();
  }

  /**
   * One connection for every supported brand (GAN Gen1-4, MoYu, Giiker/Mi, GoCube, QiYi, ...): smartcube-web-bluetooth
   * recognises the cube, speaks its protocol and reports the same events for all of them. This wraps its connection
   * in the few methods the rest of the page needs.
   */
  async function connectAnyCube() {
    kpuzzle ??= await cube3x3x3.kpuzzle();
    const macs = loadMacs();
    let usedSaved = null; // device name whose saved MAC address was used this time
    const conn = await connectSmartCube(async (device, isFallback) => {
      const saved = macs[device.name];
      if (!isFallback) {
        if (saved) usedSaved = device.name;
        return saved ?? null; // a MAC we already know; otherwise the browser tries to read it itself
      }
      const typed = window.prompt(
        "The cube's MAC address could not be read automatically.\nEnter it (like AB:12:34:CD:56:EF; Chrome: chrome://bluetooth-internals shows it):",
        saved ?? Object.values(macs).at(-1) ?? "",
      );
      return typed?.trim() || null;
    });
    const listeners = [], faceletListeners = [], lostListeners = [];
    const waiting = [];
    let facelets = null;
    const sub = conn.events$.subscribe((ev) => {
      if (ev.type === "FACELETS") {
        if (ev.facelets.length !== 54) return; // only the 3x3x3 is supported
        // snapshots from the cube itself are the truth; "moves" states are only what the driver added up
        if (ev.source !== "moves") {
          facelets = ev.facelets;
          waiting.splice(0).forEach((resolve) => resolve(facelets));
          faceletListeners.forEach((f) => f(ev.facelets));
        }
      } else if (ev.type === "MOVE") {
        listeners.forEach((f) => f({ latestAlgLeaf: ev.move, timeStamp: Date.now() }));
      } else if (ev.type === "DISCONNECT") {
        lostListeners.forEach((f) => f());
      }
    });
    if (conn.capabilities.facelets) await conn.sendCommand({ type: "REQUEST_FACELETS" });
    // a MAC address is only kept once the cube's state could be read with it (a wrong one decrypts to nonsense)
    try {
      const first = facelets ?? await Promise.race([
        new Promise((resolve) => waiting.push(resolve)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("no answer from the cube")), 8000)),
      ]);
      faceletsToPattern(kpuzzle, first);
    } catch (err) {
      sub.unsubscribe();
      conn.disconnect();
      if (usedSaved) { delete macs[usedSaved]; storeMacs(macs); }
      throw new Error(`Could not read the cube (${err.message}); check its MAC address and try again.`);
    }
    if (conn.deviceMAC) { macs[conn.deviceName] = conn.deviceMAC; storeMacs(macs); }
    return {
      name: () => `${conn.deviceName} (${conn.protocol?.name ?? "smart cube"})`,
      disconnect() { sub.unsubscribe(); conn.disconnect(); },
      async getPattern() {
        return faceletsToPattern(kpuzzle, facelets ?? await new Promise((resolve) => waiting.push(resolve)));
      },
      addAlgLeafListener: (f) => listeners.push(f),
      // the cube also reports its state now and then; used to notice and repair missed moves
      onState: (f) => faceletListeners.push((str) => f(faceletsToPattern(kpuzzle, str))),
      onLost: (f) => lostListeners.push(f),
      readState: conn.capabilities.facelets ? () => conn.sendCommand({ type: "REQUEST_FACELETS" }) : undefined,
      resetToSolved: conn.capabilities.reset ? () => conn.sendCommand({ type: "REQUEST_RESET" }) : undefined,
    };
  }

  async function connect(provider) {
    $("bt-connect").disabled = true;
    status("Connecting…");
    try {
      kpuzzle ??= await cube3x3x3.kpuzzle();
      puzzle = await (provider ?? connectAnyCube)();
      pattern = await puzzle.getPattern();
      $("bt").hidden = false;
      live ??= makePlayer("bt-live");
      $("bt-live-wrap").hidden = false;
      if (!cameraLinked) { linkCameras(live, api.player); cameraLinked = true; }
      // listeners go on only now that both cubes exist, so no move can arrive too early and be lost
      puzzle.addAlgLeafListener((e) => onMove(e).catch((err) => status("Could not show a move: " + err.message, true)));
      puzzle.onState?.(onCubeState);
      puzzle.onLost?.(() => { status("Connection to the cube was lost - press Connect again.", true); disconnect(false); });
      $("bt-reread").hidden = !puzzle.readState;
      $("bt-reset").hidden = !puzzle.resetToSolved;
      liveBase = await patternToScramble(pattern);
      live.alg = "";
      live.experimentalSetupAlg = liveBase;
      displayRot = [];
      cursor = 0;
      $("bt-connect").textContent = "Disconnect";
      $("bt-connect").disabled = false;
      status(`Connected${puzzle.name?.() ? ": " + puzzle.name() : ""}.`);
      computePlan();
    } catch (err) {
      $("bt-connect").disabled = false;
      const msg = String(err?.message ?? "");
      status(msg ? "Could not connect: " + msg : "Could not connect.", true);
    }
  }

  function disconnect(say = true) {
    try { puzzle?.disconnect(); } catch {}
    puzzle = null;
    $("bt").hidden = true;
    $("bt-live-wrap").hidden = true;
    $("bt-take").hidden = true;
    api.showFull();
    $("bt-connect").textContent = "Connect smart cube";
    if (say) status("Disconnected.");
  }

  $("bt-connect").addEventListener("click", () => (puzzle ? disconnect() : connect()));
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
  $("algo-moves").addEventListener("click", (e) => { if (e.currentTarget.classList.contains("done")) nextAlgorithm(); });

  if (!navigator.bluetooth) {
    $("bt-connect").title = "Web Bluetooth is not available in this browser (try Chrome or Edge)";
  }
  // test hook: connect with a stand-in puzzle
  window.__marshallSmart = { connect, cubeFrameMoves, get live() { return live; }, get kpuzzle() { return kpuzzle; }, ready: cube3x3x3.kpuzzle().then((k) => (kpuzzle ??= k)) };
  return { onSolution: computePlan, release() { following = false; } };
}
