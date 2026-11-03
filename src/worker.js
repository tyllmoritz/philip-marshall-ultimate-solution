import { cube3x3x3 } from "cubing/puzzles";
import { MarshallSolver } from "./engine/solver.js";

const ready = cube3x3x3.kpuzzle().then((kp) => new MarshallSolver(kp));
ready.then(() => postMessage({ type: "ready" }));

onmessage = async (e) => {
  const solver = await ready;
  try {
    const result = solver.solve(e.data.scramble, { f2l: !!e.data.f2l });
    postMessage({ type: "result", id: e.data.id, result });
  } catch (err) {
    postMessage({ type: "result", id: e.data.id, result: { error: String(err.message || err) } });
  }
};
