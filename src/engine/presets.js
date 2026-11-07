// The steps a method is made of, and ready-made methods (presets). A preset is
//   { id, name, steps: [step id, or { id, set }], yellowTop, f2l, openSlot, lastLayer }
// and the first step is always a start step (a cross, ZZ's EOLine or Roux's first block). `set` picks the algorithm set
// of that step. Custom presets and custom steps are kept in the browser (see methods-ui.js).
//
// A step is data: the state it reaches (`goal`, see goals.js) and the engine that gets there:
//   algorithms  apply algorithms until the goal is reached: from an algorithm set (`set`: its kind, the default set)
//               or a list (`algorithms`: [{ alg, repeat, label }]); pre / post: turn the top layer before / after an
//               algorithm, rotate: also with the cube turned (y), keepProgress: pieces of the goal that are home stay home
//   series      Marshall's corner (or edge) series with setup turns, until the goal is reached
//   block       a search with the listed moves (`moves`: "RUL", "all" or "roux-sb") up to `maxDepth`
//   ...         and the built-in engines of steps that are searches or lookups of their own (cross, EOLine, LSE, Marshall)
// Whatever the steps before reached stays reached; the engines are told so (see solveFrom).

// what the goals are made of, in the solver's frame (white cross on D, yellow on U)
const LL = [0, 1, 2, 3], CROSS = [4, 5, 6, 7], MIDDLE = [8, 9, 10, 11], D_CORNERS = [4, 5, 6, 7], ALL_EDGES = [...Array(12).keys()];
const GOAL = {
  cross: { edges: CROSS },
  pairs: { edges: MIDDLE, corners: D_CORNERS },
  llOriented: { edgesOriented: LL, cornersOriented: LL },
  ll: { edges: LL, corners: LL },
};
// the algorithms of the layer-by-layer method (right-hand versions, the other slots by turning the cube)
const LBL = {
  corners: [{ alg: "R U R' U'", repeat: [1, 2, 3, 4, 5], label: "Insert the corner" }],
  middle: [
    { alg: "U R U' R' U' F' U F", label: "Edge to the right" },
    { alg: "U' L' U L U F U' F'", label: "Edge to the left" },
  ],
  ycross: [
    { alg: "F R U R' U' F'", repeat: [1, 2], label: "Yellow cross" },
    { alg: "F U R U' R' F'", repeat: [1, 2], label: "Yellow cross (mirrored)" },
  ],
  yedges: [
    { alg: "R U R' U R U2 R'", label: "Swap yellow edges (Sune)" },
    { alg: "R' U' R U' R' U2 R", label: "Swap yellow edges (anti-Sune)" },
  ],
};
const fromSet = (set, post) => ({ engine: "algorithms", set, pre: true, post });
const ENGINES = {
  "cross-optimal": { engine: "cross-optimal", goal: GOAL.cross },
  "cross-daisy": { engine: "cross-daisy", goal: GOAL.cross },
  "lbl-corners": { engine: "algorithms", algorithms: LBL.corners, pre: true, rotate: true, keepProgress: true, goal: { corners: D_CORNERS } },
  "lbl-middle": { engine: "algorithms", algorithms: LBL.middle, pre: true, rotate: true, keepProgress: true, goal: { edges: MIDDLE } },
  "lbl-ycross": { engine: "algorithms", algorithms: LBL.ycross, pre: true, rotate: true, goal: { edgesOriented: LL } },
  "lbl-yedges": { engine: "algorithms", algorithms: LBL.yedges, pre: true, rotate: true, goal: { edges: LL } },
  "lbl-ycorners-pos": { engine: "series", series: "corner", goal: { cornersPlaced: LL } },
  "lbl-ycorners-twist": { engine: "twist", goal: { corners: LL } },
  "marshall-mid": { engine: "marshall-mid", set: "f2l", setOption: "f2l", goal: { edges: MIDDLE, atLeast: 3 } },
  "marshall-top": { engine: "marshall-top", goal: { rule: "key-position" } },
  "marshall-last": { engine: "marshall-last", goal: { edges: ALL_EDGES } },
  "marshall-corners": { engine: "marshall-corners", goal: { corners: [...Array(8).keys()], atLeast: 5, rule: "corners-on-one-side" } },
  "marshall-end": { engine: "marshall-end", goal: { corners: [...Array(8).keys()] } },
  "cfop-f2l": { engine: "cfop-f2l", set: "f2l", goal: GOAL.pairs },
  "cfop-oll": { ...fromSet("oll", false), goal: GOAL.llOriented },
  "cfop-pll": { ...fromSet("pll", true), goal: GOAL.ll },
  "zz-eoline": { engine: "eoline", goal: { edgesOriented: ALL_EDGES, edges: [4, 6] } },
  "zz-block-left": { engine: "block", moves: "RUL", maxDepth: 12, goal: { edges: [7, 9, 11], corners: [5, 6] } },
  "zz-block-right": { engine: "block", moves: "RUL", maxDepth: 12, goal: { edges: [5, 8, 10], corners: [4, 7] } },
  "zz-ocll": { ...fromSet("ocll", false), goal: { cornersOriented: LL } },
  "zz-cpll": { ...fromSet("cp", true), goal: { cornersPlaced: LL } },
  "zz-epll": { ...fromSet("epll", true), goal: { edges: LL } },
  "zz-zbll": { ...fromSet("zbll", true), goal: GOAL.ll },
  "zz-coll": { ...fromSet("coll", true), goal: { corners: LL } },
  "zz-ell": { ...fromSet("ell", true), goal: { edges: LL } },
  "roux-fb": { engine: "block", moves: "all", maxDepth: 11, goal: { edges: [7, 9, 11], corners: [5, 6] } },
  "roux-sb": { engine: "block", moves: "roux-sb", maxDepth: 12, goal: { edges: [5, 8, 10], corners: [4, 7] } },
  "roux-cmll": { ...fromSet("cmll", true), goal: { corners: LL } },
  "roux-lse": { engine: "lse", goal: { edges: [0, 1, 2, 3, 4, 6] } },
  "edges-all": { engine: "edges-all", goal: { edges: ALL_EDGES } },
  "corners-all": { engine: "series", series: "corner", keepProgress: true, goal: { corners: [...Array(8).keys()] } },
};

// hint: a few words for the step list; explain: a sentence for "How it works"; needs: what must be solved before the step
// (shown when the step cannot be finished)
const FIRST_TWO_LAYERS = "the first two layers";
export const STEP_LIBRARY = [
  { id: "cross-optimal", group: "Cross", label: "White cross (shortest)", hint: "the four white edges with the fewest moves",
    explain: "The four white edges around the white center, found with a short search." },
  { id: "cross-daisy", group: "Cross", label: "White cross (daisy, then half turns)", hint: "beginner: daisy around the yellow center, then 180° turns",
    explain: "The beginner way: first a daisy (the four white edges around the yellow center, white facing up), then each edge is turned above its center and dropped into the cross with a half turn." },
  { id: "lbl-corners", group: "Layer by layer", label: "First layer corners", hint: "R U R' U' repeated",
    explain: "Each white corner is brought above its slot and put in with R U R' U', repeated until it sits right.", needs: "the white cross" },
  { id: "lbl-middle", group: "Layer by layer", label: "Second layer edges", hint: "U R U' R' U' F' U F and its mirror",
    explain: "Each middle-layer edge is inserted from the top layer to the right (U R U' R' U' F' U F) or to the left (the mirror).", needs: "the white cross and the first layer corners" },
  { id: "lbl-ycross", group: "Layer by layer", label: "Yellow cross", hint: "F R U R' U' F'",
    explain: "F R U R' U' F' (once or twice) turns the yellow edges up into a cross.", needs: FIRST_TWO_LAYERS },
  { id: "lbl-yedges", group: "Layer by layer", label: "Yellow edges", hint: "Sune / anti-Sune",
    explain: "Sune or anti-Sune swaps the yellow edges until they match their side centers.", needs: "the first two layers and the yellow cross" },
  { id: "lbl-ycorners-pos", group: "Layer by layer", label: "Yellow corners: position", hint: "Niklas",
    explain: "Niklas cycles three yellow corners until all four sit in their places (twisted or not).", needs: "the first two layers and the yellow edges" },
  { id: "lbl-ycorners-twist", group: "Layer by layer", label: "Yellow corners: twist", hint: "R' D' R D repeated",
    explain: "R' D' R D, repeated, twists each yellow corner in place; the layers below look scrambled meanwhile and come back at the end.", needs: "everything but the twist of the yellow corners" },
  { id: "marshall-mid", group: "Marshall", label: "3 center section edges / F2L pairs", hint: "edge series (or F2L pairs with the F2L option)",
    explain: "The Edge Series (Hedgeslammer F R' F' R, inverse: Sledgehammer) cycles three edges; setup turns bring the pieces into position and are undone afterwards. With the F2L option, three corner-edge pairs go in next to the cross instead (F2L algorithms, or the series if that is shorter).", needs: "the white cross" },
  { id: "marshall-top", group: "Marshall", label: "Top edge pieces", hint: "edge series down to the key position",
    explain: "Edge series until the key position: one middle-layer edge and two last-layer edges are wrong and a single series solves them. An aligning U turn may end the step.", needs: "the white cross and three middle-layer edges (or F2L pairs)" },
  { id: "marshall-last", group: "Marshall", label: "Last three edge pieces", hint: "the one series from the key position",
    explain: "The one edge series that finishes the edges from the key position.", needs: "the key position (the step Top edge pieces)" },
  { id: "marshall-corners", group: "Marshall", label: "Five corner pieces", hint: "Niklas until the last 2–3 corners share a side",
    explain: "The Corner Series (Niklas, U R U' L' U R' U' L) cycles three corners without touching any edge, until the last 2–3 corners share one side.", needs: "all edges solved" },
  { id: "marshall-end", group: "Marshall", label: "The end game", hint: "one Niklas (or two)",
    explain: "The last corners fall into place together, usually with one Niklas after a rotation and a few setup turns.", needs: "all edges solved and the last corners on one side" },
  { id: "cfop-f2l", group: "CFOP", label: "F2L (all four pairs)", hint: "corner-edge pairs by F2L algorithms",
    explain: "The four corner-edge pairs go in next to the cross with F2L algorithms, completing the first two layers.", needs: "the white cross" },
  { id: "cfop-oll", group: "CFOP", label: "OLL", hint: "orient the last layer with the OLL algorithm set",
    explain: "One algorithm from the OLL set turns the whole last layer yellow side up.", needs: FIRST_TWO_LAYERS },
  { id: "cfop-pll", group: "CFOP", label: "PLL", hint: "permute the last layer with the PLL algorithm set",
    explain: "One algorithm from the PLL set moves the last-layer pieces into their places.", needs: "the first two layers and an oriented last layer" },
  { id: "zz-eoline", group: "ZZ", label: "EOLine", hint: "orient every edge and place DF and DB",
    explain: "Every edge is oriented and the two line edges (DF, DB) are placed, so the rest needs no F or B turns." },
  { id: "zz-block-left", group: "ZZ", label: "Left block (2x2x3)", hint: "with R, U and L only",
    explain: "The left 2x2x3 block, with R, U and L turns only (the edges stay oriented).", needs: "the EOLine" },
  { id: "zz-block-right", group: "ZZ", label: "Right block (2x2x3)", hint: "with R, U and L only",
    explain: "The right 2x2x3 block, again with R, U and L only, completing the first two layers.", needs: "the EOLine and the left block" },
  { id: "zz-ocll", group: "ZZ", label: "OCLL", hint: "orient the last layer corners (7 algorithms)",
    explain: "One of 7 algorithms turns the last-layer corners yellow side up (the edges already are).", needs: "the first two layers with all edges oriented" },
  { id: "zz-cpll", group: "ZZ", label: "Corner permutation (CP)", hint: "permute the last layer corners (2 algorithms)",
    explain: "One of 2 algorithms puts the last-layer corners in their places.", needs: "the first two layers and an oriented last layer" },
  { id: "zz-epll", group: "ZZ", label: "EPLL", hint: "permute the last layer edges (4 algorithms)",
    explain: "One of 4 algorithms puts the last-layer edges in their places.", needs: "everything but the last-layer edges' places" },
  { id: "zz-zbll", group: "ZZ", label: "ZBLL", hint: "the last layer in one algorithm from the ZBLL set",
    explain: "One algorithm from the ZBLL set solves the whole last layer.", needs: "the first two layers with all edges oriented" },
  { id: "zz-coll", group: "ZZ", label: "COLL", hint: "the last layer's corners from the COLL set (edges stay oriented)",
    explain: "One algorithm from the COLL set solves the last-layer corners and keeps the edges oriented.", needs: "the first two layers with all edges oriented" },
  { id: "zz-ell", group: "ZZ", label: "ELL", hint: "the last layer's edges from the ELL set",
    explain: "One algorithm from the ELL set solves the last-layer edges.", needs: "the first two layers and the last-layer corners" },
  { id: "roux-fb", group: "Roux", label: "First block (1x2x3)", hint: "the left block, any moves",
    explain: "The left 1x2x3 block, with any moves." },
  { id: "roux-sb", group: "Roux", label: "Second block (1x2x3)", hint: "the right block with R, r, U and M",
    explain: "The right 1x2x3 block, with R, r, U and M turns, so the first block stays put.", needs: "the first block" },
  { id: "roux-cmll", group: "Roux", label: "CMLL", hint: "the last layer's corners from the CMLL set",
    explain: "One algorithm from the CMLL set solves the four top corners; the middle slice may be disturbed.", needs: "both blocks" },
  { id: "roux-lse", group: "Roux", label: "Last six edges", hint: "with M and U only",
    explain: "The six remaining edges (and the centers), with M and U turns only.", needs: "both blocks and the top corners (CMLL)" },
  { id: "edges-all", group: "Anything left", label: "All remaining edges (series)", hint: "edge series with setup, until all edges are home",
    explain: "Edge series with setup turns until every edge is home." },
  { id: "corners-all", group: "Anything left", label: "All remaining corners (Niklas)", hint: "Niklas with setup, until the cube is solved",
    explain: "Niklas with setup turns until every corner is home and the cube is solved.", needs: "all edges solved" },
].map((s) => ({ ...s, ...ENGINES[s.id] }));

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
export const ALGSET_KINDS = ["f2l", "oll", "pll", "zbll", "coll", "ell", "cmll", "ocll", "cp", "epll"];

export const stepLabel = (id) => STEP_LIBRARY.find((s) => s.id === id)?.label ?? id;
/** The id of a method's step (an id, or { id, set }). */
export const refId = (ref) => (typeof ref === "string" ? ref : ref?.id);
/**
 * The algorithm set a step of a method uses, or null: the one chosen for it, else the step's own default. Marshall's
 * second step uses its set only with the F2L option (`setOption`).
 */
export function stepSet(ref, def, options = {}) {
  if (!def?.set || (def.setOption && !options[def.setOption])) return null;
  return (typeof ref === "object" && ref.set) || def.set;
}

/** Options that only matter to some steps: the option is shown when the method has one of them. */
export const OPTION_STEPS = {
  f2l: ["marshall-mid"],
  openSlot: ["marshall-top", "marshall-last", "edges-all"],
  lastLayer: ["marshall-corners"],
};

/** A solver error as a sentence: which step could not be finished, and what it needs. */
export function errorText({ error, errorInfo: info } = {}) {
  if (!info) return "Could not solve: " + error;
  if (info.code === "unsolved") return "The steps of this method end before the cube is solved. Add steps that finish it, e.g. All remaining edges and All remaining corners.";
  const name = `Step ${info.step} (${info.name ?? stepLabel(info.id)})`;
  if (info.code === "no-algs") return `${name} has no algorithms: choose an algorithm set for it under Methods & algorithms.`;
  const needs = STEP_LIBRARY.find((s) => s.id === info.id)?.needs;
  return `${name} could not be finished from where the steps before it leave the cube.` + (needs ? ` It needs ${needs} first.` : "");
}

/**
 * A preset someone typed or stored: only known fields, known steps (built in, or the ids of custom steps), a start step
 * first. A step is kept as its id, or as { id, set } when an algorithm set was chosen for it.
 */
export function cleanPreset(p, customIds = []) {
  const known = new Set([...STEP_LIBRARY.map((s) => s.id), ...customIds]);
  const steps = (Array.isArray(p?.steps) ? p.steps : [])
    .map((r) => (typeof r === "string" ? r : r && typeof r.id === "string" ? (typeof r.set === "string" && r.set ? { id: r.id, set: r.set.slice(0, 80) } : r.id) : null))
    .filter((r) => r && known.has(refId(r)));
  if (!steps.length || !START_STEPS.includes(refId(steps[0]))) steps.unshift("cross-optimal");
  return {
    id: String(p?.id ?? ""),
    name: String(p?.name ?? "Custom").slice(0, 60),
    description: String(p?.description ?? "").slice(0, 200),
    steps: steps.filter((r, i) => i === 0 || !refId(r).startsWith("cross-")),
    yellowTop: !!p?.yellowTop, f2l: !!p?.f2l, openSlot: !!p?.openSlot, lastLayer: !!p?.lastLayer,
  };
}

/**
 * A custom step someone made in the step editor (or stored): an algorithms step with a sticker goal. Returns the step's
 * definition, or null when it is not usable.
 */
export function cleanCustomStep(s) {
  if (!s || typeof s.id !== "string" || !/^step-[a-z0-9]+$/.test(s.id)) return null;
  const stickers = [...new Set((Array.isArray(s.goal?.stickers) ? s.goal.stickers : []).filter((i) => Number.isInteger(i) && i >= 0 && i < 54))];
  const algorithms = (Array.isArray(s.algorithms) ? s.algorithms : []).map((a) => String(a?.alg ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 200).map((alg) => ({ alg }));
  const set = typeof s.set === "string" && s.set ? s.set.slice(0, 80) : null;
  if (!stickers.length || (!set && !algorithms.length)) return null;
  const label = String(s.label ?? "My step").trim().slice(0, 60) || "My step";
  return {
    id: s.id, group: "My steps", custom: true, label, engine: "algorithms", goal: { stickers },
    ...(set ? { set } : { algorithms }),
    pre: s.pre !== false, post: !!s.post, rotate: !!s.rotate, repeat: Math.min(Math.max(Number(s.repeat) || 1, 1), 6),
    hint: set ? "algorithms from a set" : `${algorithms.length} algorithm${algorithms.length === 1 ? "" : "s"} of your own`,
    explain: `Your step: ${set ? "algorithms from the chosen set" : "your algorithms"}, until the marked stickers are solved.`,
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
