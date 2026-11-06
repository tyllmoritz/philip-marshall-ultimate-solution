// Writes THIRD_PARTY_NOTICES.md (and public/licenses.txt, served with the page): every package the page ships, with its licence text,
// plus the projects, data and ideas that are not npm packages. Run after changing dependencies:  node scripts/make-notices.mjs
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").trim();

// ---- npm packages that end up in the build (production dependency tree) ----
const dirs = execSync("npm ls --omit=dev --all --parseable", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean).filter((d) => d !== root);
const seen = new Set();
const packages = [];
for (const dir of dirs) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  if (seen.has(pkg.name + pkg.version)) continue;
  seen.add(pkg.name + pkg.version);
  const file = fs.readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(f));
  packages.push({
    name: pkg.name, version: pkg.version, license: typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? "see package",
    homepage: pkg.homepage ?? (typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? ""),
    text: file ? fs.readFileSync(path.join(dir, file), "utf8").trim() : null,
  });
}
packages.sort((a, b) => a.name.localeCompare(b.name));

// ---- projects, data and ideas that are not npm packages ----
const projects = [
  { name: "cubing.js", by: "Lucas Garron and contributors", url: "https://github.com/cubing/cubing.js", license: "MPL-2.0 OR GPL-3.0-or-later (used unmodified; source at the link)", use: "the cube player, alg parser, scrambler, 3x3x3 solver for smart cube states (min2phase by Shuang Chen)", npm: true },
  { name: "smartcube-web-bluetooth", by: "Pau Oliva Fora (fork of gan-web-bluetooth by Andy Fedotov)", url: "https://github.com/poliva/smartcube-web-bluetooth", license: "MIT", use: "Bluetooth connection to GAN, MoYu, Giiker, GoCube, QiYi cubes", npm: true },
  { name: "Movecount Coefficient", by: "Trangium", url: "https://github.com/trangium/trangium.github.io/tree/master/MovecountCoefficient", license: "MIT", use: "src/engine/mcc.js - the estimate of how fast an algorithm is to execute, used to pick the best candidate of every step", file: "third_party/trangium-LICENSE.txt" },
  { name: "Cubedex", by: "Pau Oliva Fora", url: "https://github.com/poliva/cubedex", license: "MIT", use: "algorithm collections (src/data/defaultAlgs.json) and ideas (installable offline app, smart cube handling)", file: "third_party/cubedex-LICENSE.txt" },
  { name: "zz-method-docs (cubingmethods branch)", by: "crystalcuber", url: "https://github.com/crystalcuber/zz-method-docs/tree/cubingmethods", license: "MIT", use: "the ZZ last layer algorithm sets OCLL, CP, EPLL and PLL (algs/*.ts)", file: "third_party/zz-method-docs-LICENSE.txt" },
  { name: "Tao Yu's Alg Trainer", by: "Tao Yu and the people named in the spreadsheets (Justin Taylor, Jabari Nuruddin, Micki Kanaiya Harning, Feliks Zemdegs, Chad Batten, Jayden McNeill, Shadowslice, Arc, SqAree, Matt diPalma, Finn Ickler, Ishaan Agrawal, Cale Schoon, Daniel Rose-Levine and others)", url: "", license: "no licence stated; community-compiled algorithm collections", use: "the F2L, OLL, PLL, ZBLL, COLL, ELL and CMLL algorithm sets in public/algsets (made with scripts/import-algsets.mjs)" },
  { name: "rubiksplace.com F2L algorithms", by: "rubiksplace.com", url: "https://www.rubiksplace.com/speedcubing/F2L-algorithms/", license: "no licence stated", use: "the built-in list of F2L insertion algorithms (src/engine/f2l.js)" },
  { name: "Philip Marshall's solution", by: "Philip Marshall (page by helm.lu)", url: "https://www.helm.lu/cube/MarshallPhilipp/", license: "-", use: "the method this solver is named after: edge series, corner series and its five steps" },
  { name: "philip-marshall-ultimate-solution", by: "tyllmoritz", url: "https://github.com/tyllmoritz/philip-marshall-ultimate-solution", license: "-", use: "reference for how cubing.js is used on a docs site" },
  { name: "Vite", by: "Evan You and contributors", url: "https://vitejs.dev", license: "MIT", use: "build tool (development dependency, not shipped)" },
  { name: "Hedgeslammer, Sledgehammer, Niklas, Sune and the other algorithm names", by: "the speedcubing community", url: "https://www.speedsolving.com/wiki/", license: "-", use: "names used in the text" },
];

let out = "# Third-party notices\n\nThis project's own code is MIT licensed (see LICENSE). It builds on the work below; thank you to everyone named here.\n\n## Projects, data and ideas\n\n";
for (const p of projects) {
  out += `### ${p.name}\n\n- by ${p.by}\n${p.url ? `- ${p.url}\n` : ""}- licence: ${p.license}\n- used for: ${p.use}\n`;
  if (p.file) out += `\n\`\`\`\n${read(p.file)}\n\`\`\`\n`;
  out += "\n";
}
out += "## npm packages in the build\n\n";
for (const p of packages) {
  out += `### ${p.name} ${p.version}\n\n- licence: ${p.license}\n${p.homepage ? `- ${p.homepage}\n` : ""}`;
  if (p.text) out += `\n\`\`\`\n${p.text}\n\`\`\`\n`;
  out += "\n";
}
fs.writeFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), out);
fs.mkdirSync(path.join(root, "public"), { recursive: true });
fs.writeFileSync(path.join(root, "public/licenses.txt"), out.replace(/^#+ /gm, ""));
console.log(`${projects.length} projects, ${packages.length} packages -> THIRD_PARTY_NOTICES.md, public/licenses.txt`);
