/**
 * Loader hooks that make the Cloudflare-bound agent runtime importable by node.
 *
 * `db/index.ts` resolves the D1 binding from `cloudflare:workers` at module
 * scope, so every module that touches storage — tasks, approvals, the executor,
 * the runtime loop, the scheduled worker — is unloadable in a plain node test.
 * That is why the durable runtime had no executable coverage, and why two
 * statements that cannot run in production shipped anyway: a raw `sql` template
 * is not checked by the compiler, so only running it finds the defect.
 *
 * These hooks substitute three things and nothing else:
 *
 *   - `cloudflare:workers` -> an env object the harness controls
 *   - `@/db`               -> a drizzle instance over in-memory SQLite
 *   - the model router      -> a stub the test scripts
 *
 * Everything else is the real module, resolved through the same `@/` alias vite
 * uses and transpiled with esbuild (node's strip-only TypeScript mode rejects
 * parameter properties, which this repo uses).
 */

import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const VIRTUAL = {
  "cloudflare:workers": "export const env = globalThis.__CF_ENV__ ?? {};",
  "@/db": "export function getDb() { return globalThis.__DB__; }",
  "@/lib/ask-aval/model-router": "export async function callModel(env, orgId, params) { return globalThis.__MODEL__(env, orgId, params); }",
};
const virtualUrl = (s) => `debugstub:${encodeURIComponent(s)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in VIRTUAL) return { url: virtualUrl(specifier), shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = `${ROOT}/${specifier.slice(2)}`;
      for (const candidate of [base, `${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
      throw new Error(`debug harness could not resolve ${specifier}`);
    }
    // vite resolves extensionless relative imports; node does not.
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const base = new URL(specifier, context.parentURL);
      if (!existsSync(base.pathname)) {
        for (const ext of [".ts", ".tsx", "/index.ts", ".js"]) {
          if (existsSync(base.pathname + ext)) return { url: base.href + ext, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("debugstub:")) {
      return { format: "module", source: VIRTUAL[decodeURIComponent(url.slice("debugstub:".length))], shortCircuit: true };
    }
    // node's strip-only TS mode chokes on parameter properties and enums that
    // exist in this repo; esbuild is already a dependency and handles them.
    if (url.startsWith("file:") && (url.endsWith(".ts") || url.endsWith(".tsx"))) {
      const path = fileURLToPath(url);
      const { code } = transformSync(readFileSync(path, "utf8"), {
        loader: url.endsWith(".tsx") ? "tsx" : "ts",
        jsx: "automatic",
        format: "esm",
        target: "es2022",
        sourcefile: path,
      });
      return { format: "module", source: code, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
