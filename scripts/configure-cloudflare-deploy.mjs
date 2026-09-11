#!/usr/bin/env node

/** Materialize a deployable config without committing a Hyperdrive id. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(process.argv[2] ?? "wrangler.deploy.jsonc");
const destination = path.resolve(process.argv[3] ?? "wrangler.deploy.generated.jsonc");
const hyperdriveId = process.env.AVAL_HYPERDRIVE_ID?.trim() ?? "";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuid.test(hyperdriveId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(hyperdriveId)) {
  throw new Error("AVAL_HYPERDRIVE_ID must be the non-placeholder Hyperdrive UUID");
}

const placeholder = "00000000-0000-0000-0000-000000000000";
const template = await readFile(source, "utf8");
if (!template.includes(placeholder)) throw new Error(`Hyperdrive placeholder is missing from ${source}`);
await writeFile(destination, template.replaceAll(placeholder, hyperdriveId));
console.log(`Wrote ${path.relative(process.cwd(), destination)} with the protected Hyperdrive id`);
