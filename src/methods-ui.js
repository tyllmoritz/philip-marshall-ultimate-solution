// The "Method" part of the page: a preset (ready-made or your own), its steps, the options, and the step editor.
// A method's step is a step id, or { id, set } when an algorithm set was picked for it. Kept in localStorage: your own
// methods ("marshall-presets"), the method being worked on ("marshall-method") and your own steps ("marshall-steps").
import { BUILT_IN_PRESETS, STEP_LIBRARY, START_STEPS, OPTION_STEPS, cleanPreset, cleanCustomStep, refId, stepSet } from "./engine/presets.js";
import { goalStickers } from "./engine/goals.js";
import { cubeNet } from "./net.js";

const $ = (id) => document.getElementById(id);
const KEY_PRESETS = "marshall-presets";
const KEY_METHOD = "marshall-method";
const KEY_STEPS = "marshall-steps";
const CUSTOM = "__custom";
const NEW_STEP = "__new";

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const store = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

// goals to start a step from, in the solver's frame (yellow on top)
const F2L = goalStickers({ edges: [4, 5, 6, 7, 8, 9, 10, 11], corners: [4, 5, 6, 7] });
const GOAL_SHORTCUTS = [
  ["White cross", goalStickers({ edges: [4, 5, 6, 7] })],
  ["First two layers", F2L],
  ["Yellow top face", [...F2L, 0, 1, 2, 3, 5, 6, 7, 8]],
  ["Whole cube", [...Array(54).keys()]],
  ["Clear", []],
];

export function initMethods({ onChange, algsets }) {
  let steps = load(KEY_STEPS, []).map(cleanCustomStep).filter(Boolean); // your own step definitions
  const customIds = () => steps.map((s) => s.id);
  const stepDef = (id) => STEP_LIBRARY.find((s) => s.id === id) ?? steps.find((s) => s.id === id) ?? null;
  let custom = load(KEY_PRESETS, []).map((p) => cleanPreset(p, customIds())).filter((p) => p.id);
  const find = (id) => [...BUILT_IN_PRESETS, ...custom].find((p) => p.id === id);
  const copy = (p) => ({ ...cleanPreset(p, customIds()), id: p.id, name: p.name });
  let method = (() => {
    const saved = load(KEY_METHOD, null);
    return saved ? { ...cleanPreset(saved, customIds()), id: String(saved.id ?? CUSTOM) } : copy(BUILT_IN_PRESETS[0]);
  })();

  const changed = () => { method.id = CUSTOM; method.name = "Custom"; };
  const persist = () => store(KEY_METHOD, method);
  const isCustomSaved = () => custom.some((p) => p.id === method.id);
  const ids = () => method.steps.map(refId);

  /** The set a step uses (its slug), or null: the one picked for it, else the default of its kind (or of the custom step). */
  const setSlug = (ref) => {
    const def = stepDef(refId(ref));
    if (!stepSet(ref, def, method)) return null;
    if (typeof ref === "object" && ref.set) return ref.set;
    return def.custom ? def.set : algsets.defaultFor(def.set);
  };

  function setSelect(ref, i) {
    const def = stepDef(refId(ref));
    const sel = document.createElement("select");
    sel.className = "step-set";
    sel.setAttribute("aria-label", `Algorithm set for ${def.label}`);
    const current = setSlug(ref);
    const options = algsets.setsFor(def.custom ? algsets.kindOf(def.set) : def.set);
    if (!options.some((s) => s.slug === current)) options.unshift({ slug: current, name: current + " (not available)" });
    for (const s of options) sel.append(new Option(s.name, s.slug, false, s.slug === current));
    sel.addEventListener("change", () => {
      method.steps[i] = { id: refId(ref), set: sel.value };
      if (!def.custom) algsets.remember(def.set, sel.value); // the default for this kind from now on
      changed();
      update(true);
    });
    return sel;
  }

  const button = (text, title, fn, disabled) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = !!disabled;
    b.addEventListener("click", fn);
    return b;
  };

  function renderSteps() {
    const list = $("steps-list");
    list.replaceChildren();
    method.steps.forEach((ref, i) => {
      const id = refId(ref), def = stepDef(id);
      // one row: the goal on a small net | the name (and the step's algorithm set) | the buttons
      const li = document.createElement("li");
      const main = document.createElement("div");
      main.className = "step-main";
      const tools = document.createElement("div");
      tools.className = "step-tools";
      li.append(cubeNet({ stickers: goalStickers(def?.goal), label: `Goal of ${def?.label ?? id}` }).el, main, tools);
      if (i === 0) {
        const sel = document.createElement("select");
        sel.setAttribute("aria-label", "First step");
        for (const s of START_STEPS.map((x) => STEP_LIBRARY.find((l) => l.id === x))) sel.append(new Option(s.label, s.id, false, s.id === id));
        sel.addEventListener("change", () => { method.steps[0] = sel.value; changed(); update(true); });
        main.append(sel);
      } else {
        const name = document.createElement("span");
        name.className = "step-label";
        name.textContent = def?.label ?? id;
        name.title = def?.hint ?? "";
        main.append(name);
        if (setSlug(ref)) main.append(setSelect(ref, i));
        if (def?.custom) tools.append(button("✎", "Edit this step", () => openEditor(def)));
        tools.append(
          button("↑", "Move up", () => { [method.steps[i - 1], method.steps[i]] = [method.steps[i], method.steps[i - 1]]; changed(); update(true); }, i === 1),
          button("↓", "Move down", () => { [method.steps[i + 1], method.steps[i]] = [method.steps[i], method.steps[i + 1]]; changed(); update(true); }, i === method.steps.length - 1),
          button("×", "Remove this step", () => { method.steps.splice(i, 1); changed(); update(true); }),
        );
      }
      list.append(li);
    });
    $("steps-count").textContent = String(method.steps.length);
  }

  function renderSelect() {
    const sel = $("preset");
    sel.replaceChildren();
    const group = (label, presets) => {
      if (!presets.length) return;
      const g = document.createElement("optgroup");
      g.label = label;
      for (const p of presets) g.append(new Option(p.name, p.id));
      sel.append(g);
    };
    group("Ready-made", BUILT_IN_PRESETS);
    group("My methods", custom);
    if (method.id === CUSTOM) sel.append(new Option("Custom (not saved)", CUSTOM));
    sel.value = method.id;
    $("preset-info").textContent = method.id === CUSTOM ? "Changed. Press Save as… to keep it as your own method." : (find(method.id)?.description ?? "");
    $("preset-delete").hidden = !isCustomSaved();
    $("method-name").textContent = `(${method.name})`;
  }

  function render() {
    renderSelect();
    renderSteps();
    const fromYellow = ["cross-daisy", "zz-eoline", "roux-fb"].includes(ids()[0]); // these are built in the turned-over frame
    $("yellow").checked = method.yellowTop || fromYellow;
    $("yellow").disabled = fromYellow;
    $("f2l").checked = method.f2l;
    $("openslot").checked = method.openSlot;
    $("lastlayer").checked = method.lastLayer;
    // options that only change some steps are shown when the method has one of them
    for (const [id, field] of [["f2l", "f2l"], ["openslot", "openSlot"], ["lastlayer", "lastLayer"]]) {
      $(id).closest("label").hidden = !OPTION_STEPS[field].some((s) => ids().includes(s));
    }
    renderAbout();
    const add = $("step-add");
    add.replaceChildren(new Option("Add a step…", ""));
    for (const g of [...new Set(STEP_LIBRARY.filter((s) => s.group !== "Cross").map((s) => s.group))]) {
      const og = document.createElement("optgroup");
      og.label = g;
      for (const s of STEP_LIBRARY.filter((x) => x.group === g)) og.append(new Option(s.label, s.id));
      add.append(og);
    }
    const mine = document.createElement("optgroup");
    mine.label = "My steps";
    for (const s of steps) mine.append(new Option(s.label, s.id));
    mine.append(new Option("New step…", NEW_STEP));
    add.append(mine);
  }

  /** "How it works": the steps of the method in use, one sentence each. */
  function renderAbout() {
    $("about-method").textContent = `(${method.name})`;
    const list = $("about-steps");
    list.replaceChildren();
    for (const id of ids()) {
      const step = stepDef(id);
      const li = document.createElement("li");
      const name = document.createElement("b");
      name.textContent = step?.label ?? id;
      li.append(name, ": " + (step?.explain ?? step?.hint ?? ""));
      list.append(li);
    }
  }

  function update(resolve) {
    persist();
    render();
    if (resolve) onChange();
  }

  // ---- the step editor: a goal painted on the net, algorithms from a set or a list, what may surround them ----
  let editing = null; // the step being edited (null: a new one)
  let goal = new Set();
  const net = cubeNet({ onToggle: (i) => { goal.has(i) ? goal.delete(i) : goal.add(i); net.set([...goal]); }, label: "Goal: the stickers that must show their color" });
  $("se-net").append(net.el);
  for (const [label, list] of GOAL_SHORTCUTS) {
    $("se-goals").append(button(label, `Goal: ${label.toLowerCase()}`, () => { goal = new Set(list.filter((i) => i % 9 !== 4)); net.set([...goal]); }));
  }
  const sourceIsSet = () => $("se-source-set").checked;
  const showSource = () => { $("se-set").disabled = !sourceIsSet(); $("se-list").disabled = sourceIsSet(); };
  $("se-source-set").addEventListener("change", showSource);
  $("se-source-list").addEventListener("change", showSource);

  function openEditor(def = null) {
    editing = def;
    $("step-editor").hidden = false;
    $("se-title").textContent = def ? `Edit step: ${def.label}` : "New step";
    $("se-name").value = def?.label ?? "";
    goal = new Set((def?.goal.stickers ?? GOAL_SHORTCUTS[2][1]).filter((i) => i % 9 !== 4));
    net.set([...goal]);
    const sel = $("se-set");
    sel.replaceChildren();
    for (const s of algsets.setsFor(null)) sel.append(new Option(s.name, s.slug));
    sel.value = def?.set ?? algsets.defaultFor("oll");
    $("se-source-set").checked = !def || !!def.set;
    $("se-source-list").checked = !!def && !def.set;
    $("se-list").value = (def?.algorithms ?? []).map((a) => a.alg).join("\n");
    $("se-pre").checked = def ? def.pre : true;
    $("se-post").checked = !!def?.post;
    $("se-rotate").checked = !!def?.rotate;
    $("se-repeat").value = String(def?.repeat ?? 1);
    $("se-delete").hidden = !def;
    $("se-message").textContent = "";
    showSource();
    $("step-editor").scrollIntoView({ block: "nearest" });
    $("se-name").focus();
  }
  const closeEditor = () => { $("step-editor").hidden = true; editing = null; };

  $("se-save").addEventListener("click", () => {
    const algorithms = $("se-list").value.split("\n").map((l) => l.trim()).filter(Boolean).map((alg) => ({ alg }));
    const def = cleanCustomStep({
      id: editing?.id ?? "step-" + Date.now().toString(36),
      label: $("se-name").value,
      goal: { stickers: [...goal] },
      ...(sourceIsSet() ? { set: $("se-set").value } : { algorithms }),
      pre: $("se-pre").checked, post: $("se-post").checked, rotate: $("se-rotate").checked, repeat: +$("se-repeat").value,
    });
    if (!def) {
      $("se-message").textContent = !goal.size ? "Mark at least one sticker for the goal." : "Type at least one algorithm, or pick a set.";
      return;
    }
    steps = editing ? steps.map((s) => (s.id === def.id ? def : s)) : [...steps, def];
    store(KEY_STEPS, steps);
    if (!editing) { method.steps.push(def.id); changed(); }
    closeEditor();
    update(true);
  });
  $("se-delete").addEventListener("click", () => {
    if (!editing || !window.confirm(`Delete the step "${editing.label}"? Methods that use it lose it.`)) return;
    const id = editing.id;
    steps = steps.filter((s) => s.id !== id);
    store(KEY_STEPS, steps);
    if (ids().includes(id)) { method.steps = method.steps.filter((r) => refId(r) !== id); changed(); }
    custom = custom.map((p) => ({ ...p, steps: p.steps.filter((r) => refId(r) !== id) }));
    store(KEY_PRESETS, custom);
    closeEditor();
    update(true);
  });
  $("se-cancel").addEventListener("click", closeEditor);

  // ---- the method ----
  $("preset").addEventListener("change", () => {
    const p = find($("preset").value);
    if (!p) return;
    method = copy(p);
    update(true);
  });
  for (const [id, field] of [["yellow", "yellowTop"], ["f2l", "f2l"], ["openslot", "openSlot"], ["lastlayer", "lastLayer"]]) {
    $(id).addEventListener("change", () => { method[field] = $(id).checked; changed(); update(true); });
  }
  $("step-add").addEventListener("change", () => {
    const id = $("step-add").value;
    $("step-add").value = "";
    if (!id) return;
    if (id === NEW_STEP) { openEditor(null); return; }
    method.steps.push(id);
    changed();
    update(true);
  });
  $("preset-save").addEventListener("click", () => {
    const name = window.prompt("Name for this method:", method.id === CUSTOM ? "" : method.name)?.trim();
    if (!name) return;
    const existing = custom.find((p) => p.name === name);
    const saved = { ...cleanPreset(method, customIds()), id: existing?.id ?? "custom-" + Date.now().toString(36), name, description: "" };
    custom = existing ? custom.map((p) => (p.id === existing.id ? saved : p)) : [...custom, saved];
    store(KEY_PRESETS, custom);
    method = copy(saved);
    update(false);
  });
  $("preset-delete").addEventListener("click", () => {
    if (!isCustomSaved() || !window.confirm(`Delete "${method.name}"?`)) return;
    custom = custom.filter((p) => p.id !== method.id);
    store(KEY_PRESETS, custom);
    method = copy(BUILT_IN_PRESETS[0]);
    update(true);
  });

  render();
  algsets.ready.then(() => renderSteps()); // the set drop-downs know the sets once the list is loaded
  return {
    /** what the solver is told besides the steps (see requestSteps) */
    options: () => ({
      f2l: method.f2l,
      yellowTop: method.yellowTop || ["cross-daisy", "zz-eoline", "roux-fb"].includes(ids()[0]),
      openSlot: method.openSlot,
      lastLayer: method.lastLayer,
    }),
    /** the method's steps for the solver: { id, def (your own steps), cases (the algorithms of the step's set) } */
    async requestSteps() {
      await algsets.ready;
      return Promise.all(method.steps.map(async (ref) => {
        const id = refId(ref), def = stepDef(id);
        const slug = setSlug(ref);
        return { id, ...(def?.custom ? { def } : {}), ...(slug ? { cases: await algsets.cases(slug) } : {}) };
      }));
    },
  };
}
