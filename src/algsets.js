// Algorithm sets for the OLL / PLL steps: the bundled ones (public/algsets, made from Tao Yu's Alg Trainer with
// scripts/import-algsets.mjs) and sets imported from a .json file, kept in localStorage ("marshall-algsets").
import { algsetCases, ALGSET_KINDS } from "./engine/presets.js";

const KEY_SETS = "marshall-algsets";
const KEY_CHOICE = (kind) => "marshall-algset-" + kind;

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value)); } catch {}
};

export function initAlgsets({ onChange }) {
  let bundled = []; // [{ slug, name, file }]
  let imported = read(KEY_SETS, []); // [{ slug, name, set }]
  const cache = new Map(); // slug -> set (bundled ones are fetched when first needed)
  const choice = Object.fromEntries(ALGSET_KINDS.map((k) => [k, localStorage.getItem(KEY_CHOICE(k)) ?? k]));
  const box = document.getElementById("algsets-selects");
  const rows = {}; // kind -> [label, select], hidden when the method does not use that kind
  for (const kind of ALGSET_KINDS) {
    const label = document.createElement("label");
    label.htmlFor = "algset-" + kind;
    label.textContent = kind.toUpperCase();
    const sel = document.createElement("select");
    sel.id = "algset-" + kind;
    box.append(label, sel);
    rows[kind] = [label, sel];
  }

  const all = () => [...bundled.map((b) => ({ ...b, bundled: true })), ...imported];

  async function fetchBundled() {
    try {
      bundled = await (await fetch("./algsets/index.json")).json();
    } catch { bundled = []; }
    render();
  }

  async function setOf(slug) {
    const imp = imported.find((s) => s.slug === slug);
    if (imp) return imp.set;
    if (cache.has(slug)) return cache.get(slug);
    const entry = bundled.find((b) => b.slug === slug);
    if (!entry) throw new Error(`algorithm set "${slug}" is not available`);
    const set = await (await fetch("./algsets/" + entry.file)).json();
    cache.set(slug, set);
    return set;
  }

  function render() {
    for (const kind of ALGSET_KINDS) {
      const sel = document.getElementById("algset-" + kind);
      sel.replaceChildren();
      // the bundled sets of this kind, and everything imported
      const options = all().filter((s) => !s.bundled || s.kind === kind || !s.kind);
      for (const s of options) sel.append(new Option(s.name + (s.bundled ? "" : " (imported)"), s.slug));
      if (!options.some((s) => s.slug === choice[kind])) choice[kind] = options.find((s) => s.slug === kind)?.slug ?? options[0]?.slug ?? "";
      sel.value = choice[kind];
    }
    const list = document.getElementById("algset-imported");
    list.replaceChildren();
    for (const s of imported) {
      const li = document.createElement("li");
      li.append(`${s.name} `);
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "×";
      b.title = "Remove this imported set";
      b.addEventListener("click", () => {
        imported = imported.filter((x) => x.slug !== s.slug);
        write(KEY_SETS, imported);
        render();
        onChange();
      });
      li.append(b);
      list.append(li);
    }
  }

  for (const kind of ALGSET_KINDS) {
    document.getElementById("algset-" + kind).addEventListener("change", (e) => {
      choice[kind] = e.target.value;
      write(KEY_CHOICE(kind), choice[kind]);
      onChange();
    });
  }

  document.getElementById("algset-file").addEventListener("change", async (e) => {
    const status = document.getElementById("algset-status");
    for (const file of e.target.files) {
      try {
        const set = JSON.parse(await file.text());
        if (!algsetCases(set, "x").length) throw new Error("no cases with algorithms in it");
        const name = String(set.name ?? file.name.replace(/\.json$/i, ""));
        const slug = "imported-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        imported = [...imported.filter((s) => s.slug !== slug), { slug, name, set }];
        write(KEY_SETS, imported);
        status.textContent = `Imported ${name}: ${algsetCases(set, "x").length} cases.`;
      } catch (err) {
        status.textContent = `${file.name}: ${err.message}`;
      }
    }
    e.target.value = "";
    render();
    onChange();
  });

  fetchBundled();
  return {
    /** show the drop-downs of these kinds only (the ones the method's steps use) */
    showKinds(kinds) {
      for (const kind of ALGSET_KINDS) for (const el of rows[kind]) el.hidden = !kinds.includes(kind);
      document.getElementById("algsets-none").hidden = kinds.length > 0;
    },
    /** the sets the given kinds use: { oll: [{ label, algs }], ... } */
    async payload(kinds = ALGSET_KINDS) {
      const out = {};
      for (const kind of kinds) out[kind] = algsetCases(await setOf(choice[kind]), kind);
      return out;
    },
  };
}
