// Algorithm sets: the bundled ones (public/algsets, from Tao Yu's Alg Trainer, Cubedex and zz-method-docs, see
// scripts/import-algsets.mjs and import-extra-algs.mjs) and sets imported from a .json file, kept in localStorage
// ("marshall-algsets"). Each step of a method picks its set (methods-ui.js); a kind's default is the bundled set of that
// kind, or the set last chosen for it ("marshall-algset-<kind>").
import { algsetCases, ALGSET_KINDS } from "./engine/presets.js";

const KEY_SETS = "marshall-algsets";
const KEY_CHOICE = (kind) => "marshall-algset-" + kind;

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value)); } catch {}
};
const readText = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};

export function initAlgsets({ onChange }) {
  let bundled = []; // [{ slug, name, file, kind }]
  let imported = read(KEY_SETS, []); // [{ slug, name, set }]
  const cache = new Map(); // slug -> set (bundled ones are fetched when first needed)
  const choice = Object.fromEntries(ALGSET_KINDS.map((k) => [k, readText(KEY_CHOICE(k)) ?? k]));

  // the list of bundled sets; everything that needs it waits for it
  const ready = fetch("./algsets/index.json").then((r) => r.json()).then((list) => { bundled = list; }, () => { bundled = []; });

  /** Every set: { slug, name, kind (null for imported ones), bundled }. */
  const all = () => [...bundled.map((b) => ({ slug: b.slug, name: b.name, kind: b.kind ?? null, bundled: true })), ...imported.map((s) => ({ slug: s.slug, name: s.name + " (imported)", kind: null, bundled: false }))];

  async function setOf(slug) {
    await ready;
    const imp = imported.find((s) => s.slug === slug);
    if (imp) return imp.set;
    if (cache.has(slug)) return cache.get(slug);
    const entry = bundled.find((b) => b.slug === slug);
    if (!entry) throw new Error(`algorithm set "${slug}" is not available`);
    const set = await (await fetch("./algsets/" + entry.file)).json();
    cache.set(slug, set);
    return set;
  }

  function renderImported() {
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
        renderImported();
        onChange();
      });
      li.append(b);
      list.append(li);
    }
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
        status.textContent = `Imported ${name}: ${algsetCases(set, "x").length} cases. Pick it for a step in the step list.`;
      } catch (err) {
        status.textContent = `${file.name}: ${err.message}`;
      }
    }
    e.target.value = "";
    renderImported();
    onChange();
  });

  renderImported();
  return {
    ready,
    /** The sets a step of this kind can use: the bundled ones of the kind, then every imported one (any kind: null = all bundled). */
    setsFor(kind) {
      return all().filter((s) => !kind || !s.bundled || s.kind === kind || !s.kind);
    },
    /** The default set of a kind: the one chosen for it last, if it still exists. */
    defaultFor(kind) {
      return all().some((s) => s.slug === choice[kind]) ? choice[kind] : kind;
    },
    /** Remember a choice for a kind (the default for steps of that kind from now on). */
    remember(kind, slug) {
      if (!ALGSET_KINDS.includes(kind)) return;
      choice[kind] = slug;
      write(KEY_CHOICE(kind), slug);
    },
    /** The kind of a set (null for imported ones). */
    kindOf(slug) {
      return bundled.find((b) => b.slug === slug)?.kind ?? null;
    },
    /** The cases of a set as the solver wants them: [{ label, algs }]. */
    async cases(slug) {
      const set = await setOf(slug);
      return algsetCases(set, this.kindOf(slug) ?? String(set?.name ?? "").split(/\s/)[0] ?? "");
    },
  };
}
