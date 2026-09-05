#!/usr/bin/env node
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hashPassword } from "../lib/auth/password.ts";

// Stable, reserved identity: no customer user IDs or business rows are touched.
export const VERIFICATION_USER_ID = "system_release_verification_v1";
export const VERIFICATION_EMAIL = "release-verification@aval.invalid";
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
export function accountSql(passwordHash, now = Date.now()) {
  const orgId = `org_${createHash("sha256").update(VERIFICATION_USER_ID).digest("hex").slice(0, 24)}`;
  return `INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at)
VALUES (${quote(VERIFICATION_USER_ID)},${quote(VERIFICATION_EMAIL)},${quote(passwordHash)},'Release verification',${now},${now})
ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,updated_at=excluded.updated_at
WHERE users.email=${quote(VERIFICATION_EMAIL)} AND users.display_name='Release verification';
INSERT INTO organizations (id,name,owner_user_id,created_at,updated_at)
VALUES (${quote(orgId)},'Release verification',${quote(VERIFICATION_USER_ID)},${now},${now})
ON CONFLICT(id) DO NOTHING;`;
}
export async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP) throw Error("Run this preparation inside the deployment workflow.");
  const output = path.join(process.env.RUNNER_TEMP, "aval-smoke-credentials.json");
  const suppliedEmail = process.env.AVAL_SMOKE_EMAIL, suppliedPassword = process.env.AVAL_SMOKE_PASSWORD;
  if (Boolean(suppliedEmail) !== Boolean(suppliedPassword)) throw Error("Provide both optional smoke credentials, or neither to use the isolated verification account.");
  const email = suppliedEmail || VERIFICATION_EMAIL;
  const password = suppliedPassword || randomBytes(32).toString("base64url");
  // GitHub masks this before any child process runs. Never echo credentials elsewhere.
  console.log(`::add-mask::${password}`);
  if (!suppliedEmail) {
    const sqlFile = path.join(process.env.RUNNER_TEMP, "aval-smoke-account.sql");
    writeFileSync(sqlFile, accountSql(await hashPassword(password)), { mode: 0o600 });
    try {
      execFileSync("npx", ["wrangler", "d1", "execute", "aval-production", "--remote", "--config", "wrangler.deploy.jsonc", "--file", sqlFile], { stdio: "inherit" });
    } finally { unlinkSync(sqlFile); }
  }
  writeFileSync(output, JSON.stringify({ email, password }), { mode: 0o600 });
  console.log("Prepared isolated authenticated deployment verification.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
