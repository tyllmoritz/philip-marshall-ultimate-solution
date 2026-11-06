// The steps a method is made of, and ready-made methods (presets). A preset is
//   { id, name, steps: [step ids], yellowTop, f2l, openSlot, lastLayer }
// and the first step is always a cross. Custom presets are kept in the browser (see main.js).

export const STEP_LIBRARY = [
  { id: "cross-optimal", group: "Cross", label: "White cross (shortest)", hint: "the four white edges with the fewest moves" },
  { id: "cross-daisy", group: "Cross", label: "White cross (daisy, then half turns)", hint: "beginner: daisy around the yellow centre, then 180° turns" },
  { id: "lbl-corners", group: "Layer by layer", label: "First layer corners", hint: "R U R' U' repeated" },
  { id: "lbl-middle", group: "Layer by layer", label: "Second layer edges", hint: "U R U' R' U' F' U F and its mirror" },
  { id: "lbl-ycross", group: "Layer by layer", label: "Yellow cross", hint: "F R U R' U' F'" },
  { id: "lbl-yedges", group: "Layer by layer", label: "Yellow edges", hint: "Sune / anti-Sune" },
  { id: "lbl-ycorners-pos", group: "Layer by layer", label: "Yellow corners: position", hint: "Niklas" },
  { id: "lbl-ycorners-twist", group: "Layer by layer", label: "Yellow corners: twist", hint: "R' D' R D repeated" },
  { id: "marshall-mid", group: "Marshall", label: "3 center section edges / F2L pairs", hint: "edge series (or F2L pairs with the F2L option)" },
  { id: "marshall-top", group: "Marshall", label: "Top edge pieces", hint: "edge series down to the key position" },
  { id: "marshall-last", group: "Marshall", label: "Last three edge pieces", hint: "the one series from the key position" },
  { id: "marshall-corners", group: "Marshall", label: "Five corner pieces", hint: "Niklas until the last 2-3 corners share a side" },
  { id: "marshall-end", group: "Marshall", label: "The end game", hint: "one Niklas (or two)" },
  { id: "cfop-f2l", group: "CFOP", label: "F2L (all four pairs)", hint: "corner-edge pairs by F2L algorithms" },
  { id: "cfop-oll", group: "CFOP", label: "OLL", hint: "orient the last layer with the OLL algorithm set" },
  { id: "cfop-pll", group: "CFOP", label: "PLL", hint: "permute the last layer with the PLL algorithm set" },
  { id: "zz-eoline", group: "ZZ", label: "EOLine", hint: "orient every edge and place DF and DB" },
  { id: "zz-block-left", group: "ZZ", label: "Left block (2x2x3)", hint: "with R, U and L only" },
  { id: "zz-block-right", group: "ZZ", label: "Right block (2x2x3)", hint: "with R, U and L only" },
  { id: "zz-ocll", group: "ZZ", label: "OCLL", hint: "orient the last layer corners (7 algorithms)" },
  { id: "zz-cpll", group: "ZZ", label: "Corner permutation (CP)", hint: "permute the last layer corners (2 algorithms)" },
  { id: "zz-epll", group: "ZZ", label: "EPLL", hint: "permute the last layer edges (4 algorithms)" },
  { id: "zz-zbll", group: "ZZ", label: "ZBLL", hint: "the last layer in one algorithm from the ZBLL set" },
  { id: "zz-coll", group: "ZZ", label: "COLL", hint: "the last layer's corners from the COLL set (edges stay oriented)" },
  { id: "zz-ell", group: "ZZ", label: "ELL", hint: "the last layer's edges from the ELL set" },
  { id: "roux-fb", group: "Roux", label: "First block (1x2x3)", hint: "the left block, any moves" },
  { id: "roux-sb", group: "Roux", label: "Second block (1x2x3)", hint: "the right block with R, r, U and M" },
  { id: "roux-cmll", group: "Roux", label: "CMLL", hint: "the last layer's corners from the CMLL set" },
  { id: "roux-lse", group: "Roux", label: "Last six edges", hint: "with M and U only" },
  { id: "edges-all", group: "Anything left", label: "All remaining edges (series)", hint: "edge series with setup, until all edges are home" },
  { id: "corners-all", group: "Anything left", label: "All remaining corners (Niklas)", hint: "Niklas with setup, until the cube is solved" },
];

const LBL_STEPS = ["lbl-corners", "lbl-middle", "lbl-ycross", "lbl-yedges", "lbl-ycorners-pos", "lbl-ycorners-twist"];
const MARSHALL_REST = ["marshall-mid", "marshall-top", "marshall-last", "marshall-corners", "marshall-end"];
const flags = { yellowTop: false, f2l: false, openSlot: false, lastLayer: false };

export const BUILT_IN_PRESETS = [
  { id: "marshall", name: "Marshall", description: "Philip Marshall's method: edge series, then corner series", steps: ["cross-optimal", ...MARSHALL_REST], ...flags },
  { id: "marshall-f2l", name: "Marshall with F2L pairs", description: "three corner-edge pairs instead of the three middle edges", steps: ["cross-optimal", ...MARSHALL_REST], ...flags, f2l: true },
  { id: "marshall-daisy", name: "Marshall, beginner cross", description: "daisy and half turns for the cross, then Marshall", steps: ["cross-daisy", ...MARSHALL_REST], ...flags, yellowTop: true },
  { id: "lbl", name: "Beginner: layer by layer", description: "white cross (daisy), first layer, second layer, yellow cross, yellow edges, yellow corners", steps: ["cross-daisy", ...LBL_STEPS], ...flags, yellowTop: true },
  { id: "lbl-short", name: "Layer by layer, shortest cross", description: "the beginner steps after the shortest white cross", steps: ["cross-optimal", ...LBL_STEPS], ...flags },
  { id: "cfop", name: "CFOP", description: "cross, F2L, OLL, PLL (the algorithm sets can be changed under Methods & algorithms)", steps: ["cross-optimal", "cfop-f2l", "cfop-oll", "cfop-pll"], ...flags, yellowTop: true },
  { id: "zz", name: "ZZ (ZBLL)", description: "EOLine, two blocks with R U L, then ZBLL for the whole last layer", steps: ["zz-eoline", "zz-block-left", "zz-block-right", "zz-zbll"], ...flags, yellowTop: true },
  { id: "zz-coll", name: "ZZ (COLL + ELL)", description: "EOLine, two blocks, COLL for the corners and ELL for the edges", steps: ["zz-eoline", "zz-block-left", "zz-block-right", "zz-coll", "zz-ell"], ...flags, yellowTop: true },
  { id: "zz-3look", name: "ZZ (OCLL, CP, EPLL)", description: "EOLine, two blocks, then the last layer in three looks: 13 algorithms in all", steps: ["zz-eoline", "zz-block-left", "zz-block-right", "zz-ocll", "zz-cpll", "zz-epll"], ...flags, yellowTop: true },
  { id: "zz-ocll-pll", name: "ZZ (OCLL + PLL)", description: "EOLine, two blocks, OCLL, then a PLL", steps: ["zz-eoline", "zz-block-left", "zz-block-right", "zz-ocll", "cfop-pll"], ...flags, yellowTop: true },
  { id: "roux", name: "Roux", description: "two 1x2x3 blocks, CMLL, then the last six edges with M and U", steps: ["roux-fb", "roux-sb", "roux-cmll", "roux-lse"], ...flags, yellowTop: true },
  { id: "lbl-marshall", name: "Two layers, then Marshall", description: "beginner first two layers, Marshall's series for the last layer", steps: ["cross-daisy", "lbl-corners", "lbl-middle", "marshall-top", "marshall-last", "marshall-corners", "marshall-end"], ...flags, yellowTop: true },
];

/** Steps a method can begin with (they do not need anything built before them). */
export const START_STEPS = ["cross-optimal", "cross-daisy", "zz-eoline", "roux-fb"];
/** The algorithm set kind a step needs. */
export const STEP_ALGSET = { "cfop-f2l": "f2l", "cfop-oll": "oll", "cfop-pll": "pll", "zz-zbll": "zbll", "zz-ocll": "ocll", "zz-cpll": "cp", "zz-epll": "epll", "zz-coll": "coll", "zz-ell": "ell", "roux-cmll": "cmll" };
export const ALGSET_KINDS = ["f2l", "oll", "pll", "zbll", "coll", "ell", "cmll", "ocll", "cp", "epll"];
export const neededKinds = (steps, f2l = false) => [...new Set([...steps.map((id) => STEP_ALGSET[id]), ...(f2l && steps.includes("marshall-mid") ? ["f2l"] : [])].filter(Boolean))];

export const stepLabel = (id) => STEP_LIBRARY.find((s) => s.id === id)?.label ?? id;

/** A preset someone typed or stored: only known fields, known steps, a cross first. */
export function cleanPreset(p) {
  const known = new Set(STEP_LIBRARY.map((s) => s.id));
  const steps = (Array.isArray(p?.steps) ? p.steps : []).filter((id) => known.has(id));
  if (!steps.length || !START_STEPS.includes(steps[0])) steps.unshift("cross-optimal");
  return {
    id: String(p?.id ?? ""),
    name: String(p?.name ?? "Custom").slice(0, 60),
    description: String(p?.description ?? "").slice(0, 200),
    steps: steps.filter((id, i) => i === 0 || !id.startsWith("cross-")),
    yellowTop: !!p?.yellowTop, f2l: !!p?.f2l, openSlot: !!p?.openSlot, lastLayer: !!p?.lastLayer,
  };
}

/** The cases of an imported algorithm set as the solver wants them: [{ label, algs }]. */
export function algsetCases(set, kind) {
  const out = [];
  for (const sheet of set?.sheets ?? []) {
    for (const c of sheet.cases ?? []) {
      if (Array.isArray(c.algs) && c.algs.length) out.push({ label: c.name && String(c.name).toUpperCase().startsWith(kind.toUpperCase()) ? String(c.name) : `${kind.toUpperCase()} ${c.name ?? c.index}`, algs: c.algs.map(String) });
    }
  }
  return out;
}
