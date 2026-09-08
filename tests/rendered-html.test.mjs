import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/", authenticated = true) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`https://aval.test${path}`, {
      headers: { host: "aval.test", "x-forwarded-host": "aval.test", accept: "text/html", ...(authenticated ? { "oai-authenticated-user-id": "render-user", "oai-authenticated-user-email": "render@example.test", "oai-authenticated-user-full-name": "Evan" } : {}) },
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

test("authenticated first render waits for saved onboarding state", async () => {
  const response = await render("/en");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(visibleMain(html), /onboarding-loading/);
  assert.match(visibleMain(html), /Getting your workspace ready/);
  assert.doesNotMatch(visibleMain(html), /data-workspace-mode|auth-gate/);
});

test("onboarding loading is localized in Spanish without English fallback", async () => {
  const response = await render("/es-mx");
  assert.equal(response.status, 200);
  const main = visibleMain(await response.text());
  assert.match(main, /Preparando tu espacio de trabajo/);
  assert.doesNotMatch(main, /Getting your workspace ready/);
});

test("ships Inter typography, an off-white Apple-grey palette, integrations, and durable storage", async () => {
  const [catalog, layout, css, packageJson, messagesEn] = await Promise.all([
    readFile(new URL("../lib/integrations/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  ]);

  assert.match(catalog, /WhatsApp Business/);
  assert.match(catalog, /Apple Messages/);
  assert.match(catalog, /QuickBooks Online/);
  assert.match(messagesEn, /Connect two upstream systems/);
  assert.match(layout, /localFont/);
  assert.match(layout, /InterVariable\.woff2/);
  assert.match(layout, /Property operations, connected/);
  assert.match(css, /--canvas:\s*#f5f5f7/i);
  assert.match(css, /--surface:\s*#ffffff/i);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../app/fonts/InterVariable.woff2", import.meta.url));
  await access(new URL("../drizzle/0000_brainy_squirrel_girl.sql", import.meta.url));
});


function visibleMain(html) {
  return html.match(/<main[\s\S]*?<\/main>/)?.[0] ?? "";
}

test("legacy sample and view URLs cannot bypass onboarding", async () => {
  for (const view of ["overview", "settings", "setup", "tasks", "connections", "calendar", "projects", "teams", "inbox", "documents", "reviewCenter", "infrastructure", "leasing", "accounting", "maintenance"]) {
    const response = await render(`/en?data=sample&view=${view}`);
    assert.equal(response.status, 200, view);
    const main = visibleMain(await response.text());
    assert.match(main, /onboarding-loading/, view);
    assert.doesNotMatch(main, /DEMO DATA|Exit demo|Demo workspace|Alex Morgan|fictional sample/i, view);
  }
});

test("anonymous visits and legacy demo links require sign-in", async () => {
  for (const path of ["/en", "/en?data=sample", "/en?data=sample&view=settings"]) {
    const response = await render(path, false);
    const html = await response.text();
    assert.match(html, /auth-gate/);
    assert.doesNotMatch(html, /data-workspace-mode="demo"|data-workspace-mode="live"/);
  }
});

// Returning-user workspace regressions run in integration/workspace-render.integration.mjs.
