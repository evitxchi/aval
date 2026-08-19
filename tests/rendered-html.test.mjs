import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Portero operations dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Portero está trabajando/);
  assert.match(html, /Buenas tardes, Camila/);
  assert.match(html, /Hoy requiere tu atención/);
  assert.match(html, /class="ledger-card/);
  assert.match(html, /Español \(México\)/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships Portero metadata, typography, tokens, and social preview", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /type Locale = "es" \| "en"/);
  assert.match(page, /Formal · usted/);
  assert.match(page, /const ledgerItems/);
  assert.match(layout, /Instrument_Serif/);
  assert.match(layout, /Inter/);
  assert.match(layout, /IBM_Plex_Mono/);
  assert.match(layout, /\/og\.png/);
  assert.match(layout, /Operaciones de renta, resueltas/);
  assert.match(css, /--canvas:\s*#efefee/i);
  assert.match(css, /--accent:\s*#24453b/i);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await access(new URL("../public/og.png", import.meta.url));
});
