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
  { id: "lbl-marshall", name: "Two layers, then Marshall", description: "beginner first two layers, Marshall's series for the last layer", steps: ["cross-daisy", "lbl-corners", "lbl-middle", "marshall-top", "marshall-last", "marshall-corners", "marshall-end"], ...flags, yellowTop: true },
];

export const stepLabel = (id) => STEP_LIBRARY.find((s) => s.id === id)?.label ?? id;

/** A preset someone typed or stored: only known fields, known steps, a cross first. */
export function cleanPreset(p) {
  const known = new Set(STEP_LIBRARY.map((s) => s.id));
  const steps = (Array.isArray(p?.steps) ? p.steps : []).filter((id) => known.has(id));
  if (!steps.length || !steps[0].startsWith("cross-")) steps.unshift("cross-optimal");
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
      if (Array.isArray(c.algs) && c.algs.length) out.push({ label: `${kind.toUpperCase()} ${c.name ?? c.index}`, algs: c.algs.map(String) });
    }
  }
  return out;
}
