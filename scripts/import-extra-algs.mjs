// Algorithm sets from two other projects, in the format the page loads (public/algsets):
//   node scripts/import-extra-algs.mjs <cubedex folder> <zz-method-docs algs folder> [output folder, default public/algsets]
//  - Cubedex (Pau Oliva, MIT): src/data/defaultAlgs.json, the 3x3x3 sets
//  - zz-method-docs, cubingmethods branch (crystalcuber, MIT): algs/OCLL.ts, CP.ts, EPLL.ts, PLL.ts
// Each set: { name, source, sheets: [{ sheet, cases: [{ index, name, algs }] }] } plus an entry in index.json.
import fs from "node:fs";
import path from "node:path";

const [, , cubedexDir, zzDir, out = "public/algsets"] = process.argv;
if (!cubedexDir || !zzDir) { console.error("usage: node scripts/import-extra-algs.mjs <cubedex> <zz-method-docs/algs> [out]"); process.exit(1); }

const normalize = (alg) => alg.replace(/[’‘`]/g, "'").replace(/[()]/g, " ").replace(/2'/g, "2").replace(/\s+/g, " ").trim();
const sets = [];

// ---- Cubedex ----
const cubedex = JSON.parse(fs.readFileSync(path.join(cubedexDir, "src/data/defaultAlgs.json"), "utf8"));
const fromCubedex = (key, slug, name, kind) => {
  const groups = cubedex[key];
  if (!groups) return;
  const sheets = groups.map((g) => ({
    sheet: g.subset,
    cases: g.algorithms.map((a, i) => ({ index: i + 1, name: a.name, algs: [normalize(a.algorithm)] })).filter((c) => c.algs[0]),
  })).filter((s) => s.cases.length);
  sets.push({ slug, kind, set: { name, source: "Cubedex (Pau Oliva Fora, MIT) - src/data/defaultAlgs.json: " + key, sheets } });
};
fromCubedex("PLL", "pll-cubedex", "PLL (Cubedex)", "pll");
fromCubedex("2-Look PLL", "pll-2look-cubedex", "2-look PLL (Cubedex)", "pll");
fromCubedex("OLL", "oll-cubedex", "OLL (Cubedex)", "oll");
fromCubedex("2-Look OLL", "oll-2look-cubedex", "2-look OLL (Cubedex)", "oll");
fromCubedex("F2L", "f2l-cubedex", "F2L (Cubedex)", "f2l");
fromCubedex("COLL", "coll-cubedex", "COLL (Cubedex)", "coll");
fromCubedex("CMLL", "cmll-cubedex", "CMLL (Cubedex)", "cmll");
fromCubedex("ZBLL", "zbll-cubedex", "ZBLL (Cubedex)", "zbll");

// ---- zz-method-docs ----
const fromZz = (file, slug, name, kind) => {
  const text = fs.readFileSync(path.join(zzDir, file), "utf8");
  const cases = [];
  for (const m of text.matchAll(/name:\s*"([^"]+)",\s*algs:\s*\[([^\]]*)\]/g)) {
    const algs = [...m[2].matchAll(/"([^"]+)"/g)].map((a) => normalize(a[1])).filter(Boolean);
    if (algs.length) cases.push({ index: cases.length + 1, name: m[1], algs });
  }
  sets.push({ slug, kind, set: { name, source: "zz-method-docs, cubingmethods branch (crystalcuber, MIT) - algs/" + file, sheets: [{ sheet: name, cases }] } });
};
fromZz("OCLL.ts", "ocll", "OCLL (zz-method-docs)", "ocll");
fromZz("CP.ts", "cp", "CP (zz-method-docs)", "cp");
fromZz("EPLL.ts", "epll", "EPLL (zz-method-docs)", "epll");
fromZz("PLL.ts", "pll-zz-docs", "PLL (zz-method-docs)", "pll");

fs.mkdirSync(out, { recursive: true });
const indexFile = path.join(out, "index.json");
const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
for (const { slug, kind, set } of sets) {
  fs.writeFileSync(path.join(out, slug + ".json"), JSON.stringify(set) + "\n");
  const entry = { slug, name: set.name, file: slug + ".json", kind, source: set.source.split(" - ")[0] };
  const at = index.findIndex((e) => e.slug === slug);
  if (at >= 0) index[at] = entry; else index.push(entry);
  const cases = set.sheets.reduce((n, s) => n + s.cases.length, 0);
  console.log(set.name.padEnd(30), String(cases).padStart(4), "cases");
}
fs.writeFileSync(indexFile, JSON.stringify(index, null, 1) + "\n");
