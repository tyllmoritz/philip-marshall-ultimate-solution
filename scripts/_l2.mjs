import { cube3x3x3 } from "cubing/puzzles";
import { MarshallSolver } from "../src/engine/solver.js";
import { FACES } from "../src/engine/cube.js";
const kp = await cube3x3x3.kpuzzle();
const s = new MarshallSolver(kp);
const all = ["cross-daisy", "lbl-corners", "lbl-middle", "lbl-ycross", "lbl-yedges", "lbl-ycorners-pos", "lbl-ycorners-twist"];
for (let n = 2; n <= all.length; n++) {
  let ok = 0, err = {}, ms = 0;
  for (let i = 0; i < 20; i++) {
    const scr = []; let last = "";
    for (let j = 0; j < 30; j++) { let f; do f = FACES[(Math.random() * 6) | 0]; while (f === last); last = f; scr.push(f + ["", "2", "'"][(Math.random() * 3) | 0]); }
    const t = performance.now(); const r = s.solve(scr, { steps: all.slice(0, n), partial: true }); ms += performance.now() - t;
    r.error ? (err[r.error] = (err[r.error] ?? 0) + 1) : ok++;
  }
  console.log(String(n).padStart(2), all[n - 1].padEnd(20), "ok", ok, "/20", "avg ms", (ms / 20) | 0, JSON.stringify(err));
}
