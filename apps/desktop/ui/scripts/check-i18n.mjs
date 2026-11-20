/* global console, process, URL */
// Verifies that every locale matches English and that all static t("...") keys exist.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]
  );
// Maps every node to its kind (array, object or string). Only plain objects are walked,
// so an array and an object with the same indices are still told apart.
const kindOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
const kinds = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => [
    [`${p}${k}`, kindOf(v)],
    ...(kindOf(v) === "object" ? kinds(v, `${p}${k}.`) : []),
  ]);
const localeDir = join(root, "i18n/locales");
const readKeys = (file) => new Set(flat(JSON.parse(readFileSync(join(localeDir, file), "utf8"))));
const readKinds = (file) => new Map(kinds(JSON.parse(readFileSync(join(localeDir, file), "utf8"))));
const en = readKeys("en.json");
const enKinds = readKinds("en.json");
let bad = 0;
const localeFiles = readdirSync(localeDir).filter((file) => file !== "en.json" && file.endsWith(".json")).sort();
for (const file of localeFiles) {
  if (!statSync(join(localeDir, file)).isFile()) continue;
  const locale = file.slice(0, -".json".length);
  const keys = readKeys(file);
  for (const key of en) {
    if (keys.has(key)) continue;
    console.error(`missing in ${locale}: ${key}`);
    bad++;
  }
  const localeKinds = readKinds(file);
  for (const [key, kind] of enKinds) {
    const other = localeKinds.get(key);
    if (other === undefined || other === kind) continue;
    console.error(`kind mismatch in ${locale}: ${key} (expected ${kind}, got ${other})`);
    bad++;
  }
  for (const key of keys) {
    if (en.has(key)) continue;
    console.error(`extra in ${locale}: ${key}`);
    bad++;
  }
}

const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(f) ? [p] : [];
  });
const unknown = new Set();
for (const file of walk(root)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([^"$]+)"/g)) {
    const key = m[1];
    if (en.has(key) || unknown.has(key)) continue;
    unknown.add(key);
    console.error(`${file}: unknown key ${key}`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log(`i18n ok (${en.size} keys)`);
