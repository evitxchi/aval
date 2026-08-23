#!/usr/bin/env node
// Fails (exit 1) if messages/en.json and messages/es-mx.json don't have exactly
// the same set of keys. Run in CI so a missing translation never ships silently.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const en = JSON.parse(readFileSync(`${root}/messages/en.json`, "utf8"));
const esMx = JSON.parse(readFileSync(`${root}/messages/es-mx.json`, "utf8"));

function flatten(obj, prefix = "") {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flatten(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

const enKeys = new Set(flatten(en));
const esKeys = new Set(flatten(esMx));

const missingInEs = [...enKeys].filter((key) => !esKeys.has(key)).sort();
const missingInEn = [...esKeys].filter((key) => !enKeys.has(key)).sort();

if (missingInEs.length === 0 && missingInEn.length === 0) {
  console.log(`i18n parity OK — ${enKeys.size} keys match in en.json and es-mx.json.`);
  process.exit(0);
}

if (missingInEs.length > 0) {
  console.error(`Missing in messages/es-mx.json (${missingInEs.length}):`);
  for (const key of missingInEs) console.error(`  - ${key}`);
}
if (missingInEn.length > 0) {
  console.error(`Missing in messages/en.json (${missingInEn.length}):`);
  for (const key of missingInEn) console.error(`  - ${key}`);
}
process.exit(1);
