// Reads algorithm-trainer spreadsheets (Tao Yu's Alg Trainer: one .xlsx per technique) and writes JSON.
//   node scripts/import-algsets.mjs "<folder with .xlsx files>" [output folder]
// No dependencies: an .xlsx is a zip of XML files; the zip is read with node:zlib.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** The files of a zip archive as { name: Buffer } (stored and deflated entries). */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out[name] = method === 0 ? data : zlib.inflateRawSync(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const textOf = (xml) => decode([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

/** { sheetName: [{ row, cells: { A: "text", ... } }] } */
function readWorkbook(file) {
  const files = unzip(fs.readFileSync(file));
  const shared = files["xl/sharedStrings.xml"]
    ? [...files["xl/sharedStrings.xml"].toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];
  const wb = files["xl/workbook.xml"].toString("utf8");
  const names = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decode(m[1]));
  const out = {};
  names.forEach((name, i) => {
    const xml = files[`xl/worksheets/sheet${i + 1}.xml`]?.toString("utf8");
    if (!xml) return;
    const rows = [];
    for (const r of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = {};
      for (const c of r[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
        const type = /t="([^"]*)"/.exec(c[1])?.[1];
        const body = c[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = null;
        if (type === "s" && v !== undefined) value = shared[+v];
        else if (type === "inlineStr") value = textOf(body);
        else if (v !== undefined) value = decode(v);
        if (col && value !== null && value !== "" && !value.startsWith("#REF!")) cells[col] = value;
      }
      if (Object.keys(cells).length) rows.push({ row: +r[1], cells });
    }
    out[name] = rows;
  });
  return out;
}

const MOVE = /^(?:[UDFBRLudfbrlMESxyz](?:2'|2|')?|\(|\)|[0-9]+)$/;
/** A cell is an algorithm list when every whitespace-separated token looks like a move. */
const looksLikeAlg = (text) => text.split(/\s+/).filter(Boolean).every((t) => MOVE.test(t));
const normalize = (alg) => alg.replace(/[’‘`]/g, "'").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

/** Cells -> cases. A text cell without moves names the case below it ("Ua" over its algorithms); a cell with moves is a case. */
function sheetCases(rows) {
  const cases = [];
  const byColumn = {};
  for (const { cells } of rows) {
    for (const [col, text] of Object.entries(cells)) {
      const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every(looksLikeAlg)) {
        cases.push({ name: byColumn[col] ?? null, algs: lines.map(normalize).filter(Boolean) });
        byColumn[col] = undefined;
      } else {
        byColumn[col] = text.replace(/\s+/g, " ").trim();
      }
    }
  }
  return cases.map((c, i) => ({ index: i + 1, ...c }));
}

const [, , input, output = "data/algsets"] = process.argv;
if (!input) { console.error('usage: node scripts/import-algsets.mjs "<folder>" [output folder]'); process.exit(1); }
fs.mkdirSync(output, { recursive: true });
const index = [];
for (const file of fs.readdirSync(input).filter((f) => f.toLowerCase().endsWith(".xlsx")).sort()) {
  const name = file.replace(/\.xlsx$/i, "");
  try {
    const sheets = Object.entries(readWorkbook(path.join(input, file))).map(([sheet, rows]) => ({ sheet, cases: sheetCases(rows) })).filter((s) => s.cases.length);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    fs.writeFileSync(path.join(output, slug + ".json"), JSON.stringify({ name, source: file, sheets }, null, 1) + "\n");
    const caseCount = sheets.reduce((n, s) => n + s.cases.length, 0);
    const algCount = sheets.reduce((n, s) => n + s.cases.reduce((m, c) => m + c.algs.length, 0), 0);
    index.push({ slug, name, cases: caseCount, algs: algCount });
    console.log(name.padEnd(48), String(caseCount).padStart(5), "cases", String(algCount).padStart(6), "algs");
  } catch (err) {
    console.log(name.padEnd(48), "FAILED:", err.message);
  }
}
fs.writeFileSync(path.join(output, "index.json"), JSON.stringify(index, null, 1) + "\n");
