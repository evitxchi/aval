#!/usr/bin/env node

/** Copies reviewed Drizzle SQL into Supabase's timestamped migration format. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = path.join(root, "db/postgres/migrations");
const destination = path.join(root, "supabase/migrations");
const files = [
  ["0000_superb_black_knight.sql", "20260910000100_postgres_backend.sql"],
];

await mkdir(destination, { recursive: true });
for (const [input, output] of files) {
  const sql = await readFile(path.join(source, input), "utf8");
  await writeFile(path.join(destination, output), `-- Generated from db/postgres/migrations/${input}.\n${sql.replaceAll("\r\n", "\n")}`);
}
console.log(`Published ${files.length} timestamped Supabase migrations`);
