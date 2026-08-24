import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
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

test("redirects the unlocalized root to the default locale", async () => {
  const response = await render("/");
  assert.equal(response.status, 307);
  const location = response.headers.get("location") ?? "";
  const pathname = location.startsWith("http") ? new URL(location).pathname : location;
  assert.match(pathname, /^\/en\/?$/);
});

test("server-renders the Aval connected operations dashboard", async () => {
  const response = await render("/en");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Aval workspace/);
  assert.match(html, /Portfolio overview/);
  assert.match(html, /Lead-to-lease funnel/);
  assert.match(html, /\d+ of \d+ connected/);
  assert.match(html, /Work moving through the system/);
  assert.match(html, /Acme Residential/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("renders the es-mx locale with real translated content, not English fallback", async () => {
  const response = await render("/es-mx");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Resumen del portafolio/);
  assert.match(html, /Embudo de prospecto a contrato/);
  assert.doesNotMatch(html, /Portfolio overview/);
});

test("ships Monument typography, monochrome tokens, integrations, and durable storage", async () => {
  const [page, layout, css, packageJson, messagesEn] = await Promise.all([
    readFile(new URL("../app/[locale]/dashboard-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /WhatsApp Business/);
  assert.match(page, /Apple Messages/);
  assert.match(page, /QuickBooks Online/);
  assert.match(messagesEn, /Connect two upstream systems/);
  assert.match(layout, /localFont/);
  assert.match(layout, /ABCMonumentGroteskTrial-Regular\.otf/);
  assert.match(layout, /Property operations, connected/);
  assert.match(css, /--canvas:\s*#efeeeb/i);
  assert.match(css, /--ink:\s*#0b0b0a/i);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../app/fonts/ABCMonumentGroteskTrial-Regular.otf", import.meta.url));
  await access(new URL("../drizzle/0000_brainy_squirrel_girl.sql", import.meta.url));
});
