// The "Method" part of the page: a preset (ready-made or your own), its steps, and the options. Custom presets live in
// localStorage ("marshall-presets"); the method being worked on is remembered too ("marshall-method").
import { BUILT_IN_PRESETS, STEP_LIBRARY, START_STEPS, OPTION_STEPS, cleanPreset, stepLabel } from "./engine/presets.js";

const $ = (id) => document.getElementById(id);
const KEY_PRESETS = "marshall-presets";
const KEY_METHOD = "marshall-method";
const CUSTOM = "__custom";

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const store = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

export function initMethods({ onChange }) {
  let custom = load(KEY_PRESETS, []).map((p) => cleanPreset(p)).filter((p) => p.id);
  const find = (id) => [...BUILT_IN_PRESETS, ...custom].find((p) => p.id === id);
  const copy = (p) => ({ ...cleanPreset(p), id: p.id, name: p.name, steps: [...p.steps] });
  let method = (() => {
    const saved = load(KEY_METHOD, null);
    return saved ? { ...cleanPreset(saved), id: String(saved.id ?? CUSTOM) } : copy(BUILT_IN_PRESETS[0]);
  })();

  const changed = () => { method.id = CUSTOM; method.name = "Custom"; };
  const persist = () => store(KEY_METHOD, method);
  const isCustomSaved = () => custom.some((p) => p.id === method.id);

  function renderSteps() {
    const list = $("steps-list");
    list.replaceChildren();
    method.steps.forEach((id, i) => {
      const li = document.createElement("li");
      if (i === 0) {
        const sel = document.createElement("select");
        for (const s of START_STEPS.map((x) => STEP_LIBRARY.find((l) => l.id === x))) sel.append(new Option(s.label, s.id, false, s.id === id));
        sel.addEventListener("change", () => { method.steps[0] = sel.value; changed(); update(true); });
        li.append(sel);
      } else {
        const name = document.createElement("span");
        name.className = "step-label";
        name.textContent = stepLabel(id);
        name.title = STEP_LIBRARY.find((s) => s.id === id)?.hint ?? "";
        li.append(name);
        const mk = (text, title, fn, disabled) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = text;
          b.title = title;
          b.disabled = !!disabled;
          b.addEventListener("click", fn);
          return b;
        };
        li.append(
          mk("↑", "Move up", () => { [method.steps[i - 1], method.steps[i]] = [method.steps[i], method.steps[i - 1]]; changed(); update(true); }, i === 1),
          mk("↓", "Move down", () => { [method.steps[i + 1], method.steps[i]] = [method.steps[i], method.steps[i + 1]]; changed(); update(true); }, i === method.steps.length - 1),
          mk("×", "Remove this step", () => { method.steps.splice(i, 1); changed(); update(true); }),
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
    $("preset-info").textContent = method.id === CUSTOM ? "Changed - press Save as… to keep it as your own method." : (find(method.id)?.description ?? "");
    $("preset-delete").hidden = !isCustomSaved();
    $("method-name").textContent = "- " + method.name;
  }

  function render() {
    renderSelect();
    renderSteps();
    const fromYellow = ["cross-daisy", "zz-eoline", "roux-fb"].includes(method.steps[0]); // these are built in the turned-over frame
    $("yellow").checked = method.yellowTop || fromYellow;
    $("yellow").disabled = fromYellow;
    $("f2l").checked = method.f2l;
    $("openslot").checked = method.openSlot;
    $("lastlayer").checked = method.lastLayer;
    // options that only change some steps are shown when the method has one of them
    for (const [id, field] of [["f2l", "f2l"], ["openslot", "openSlot"], ["lastlayer", "lastLayer"]]) {
      $(id).closest("label").hidden = !OPTION_STEPS[field].some((s) => method.steps.includes(s));
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
  }

  /** "How it works": the steps of the method in use, one sentence each. */
  function renderAbout() {
    $("about-method").textContent = "- " + method.name;
    const list = $("about-steps");
    list.replaceChildren();
    for (const id of method.steps) {
      const step = STEP_LIBRARY.find((s) => s.id === id);
      const li = document.createElement("li");
      const name = document.createElement("b");
      name.textContent = stepLabel(id);
      li.append(name, " — " + (step?.explain ?? step?.hint ?? ""));
      list.append(li);
    }
  }

  function update(resolve) {
    persist();
    render();
    if (resolve) onChange();
  }

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
    if (!id) return;
    method.steps.push(id);
    changed();
    update(true);
  });
  $("preset-save").addEventListener("click", () => {
    const name = window.prompt("Name for this method:", method.id === CUSTOM ? "" : method.name)?.trim();
    if (!name) return;
    const existing = custom.find((p) => p.name === name);
    const saved = { ...cleanPreset(method), id: existing?.id ?? "custom-" + Date.now().toString(36), name, description: "" };
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
  return {
    /** what the solver is told */
    options: () => ({
      steps: [...method.steps],
      f2l: method.f2l,
      yellowTop: method.yellowTop || ["cross-daisy", "zz-eoline", "roux-fb"].includes(method.steps[0]),
      openSlot: method.openSlot,
      lastLayer: method.lastLayer,
    }),
  };
}
