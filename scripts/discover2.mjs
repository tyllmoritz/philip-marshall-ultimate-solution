import { cube3x3x3 } from "cubing/puzzles";
import { buildMoveTables, emptyState, applyTo, parseAlg } from "../src/engine/cube.js";
const kp = await cube3x3x3.kpuzzle();
const T = buildMoveTables(kp);
const run = (a) => parseAlg(a).reduce((s, m) => applyTo(s, T[m]), emptyState());
const sides = ["R","L","F","B","R'","L'","F'","B'"];
const inv = (m) => (m.endsWith("'") ? m[0] : m + "'");
for (const t of ["U","U'"]) for (const a of sides) for (const b of sides) {
  for (const pat of [[a,b,inv(a),inv(b)]]) {
    const alg = [t,pat[0],inv(t),pat[1],t,pat[2],inv(t),pat[3]].join(" ");
    const s = run(alg);
    const edgesOk = s.ep.every((p,i)=>p===i)&&s.eo.every(o=>!o);
    const moved = [...s.cp].filter((p,i)=>p!==i).length;
    if (edgesOk && moved===3) console.log(alg, [...s.cp].map((p,i)=>p!==i?i+"<-"+p+"("+s.co[i]+")":null).filter(Boolean).join(" "));
  }
}
