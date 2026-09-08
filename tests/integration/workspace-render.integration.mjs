import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

// These tests exercise the workspace after the separately tested onboarding
// gate has admitted a returning user. Navigation is inert during server render.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/app/components/onboarding") return { url: "workspace-test:onboarding", shortCircuit: true };
    if (specifier === "@/app/[locale]/navigation" || specifier === "./navigation" && context.parentURL?.includes("dashboard-client")) return { url: "workspace-test:navigation", shortCircuit: true };
    return nextResolve(specifier === "next/headers" ? "next/headers.js" : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "workspace-test:onboarding") return { format: "module", source: "export const OnboardingBoundary = ({children}) => children; export const OnboardingPreferences = () => null;", shortCircuit: true };
    if (url === "workspace-test:navigation") return { format: "module", source: 'export const useRouter = () => ({push(){}, replace(){}}); export const usePathname = () => "/en";', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { AvalDashboard } = await import("../../app/[locale]/dashboard-client.tsx");
function render(view, locale = "en") {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  return renderToStaticMarkup(React.createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" }, React.createElement(AvalDashboard, { authMode: "chatgpt", displayName: "Evan", email: "evan@example.test", requestedView: view })));
}
test("completed onboarding reaches the real workspace in both languages", () => {
  const html = render("overview");
  assert.match(html, /data-workspace-mode="live"/);
  assert.match(html, /Portfolio overview/);
  assert.match(html, /Aval use tracker/); assert.match(html, /Chart type/); assert.match(html, /Welcome back, Evan/);
  const spanish = render("overview", "es-mx");
  assert.match(spanish, /Resumen del portafolio/);
  assert.doesNotMatch(spanish, /Portfolio overview/);
});
test("returning users reach every workspace view without fabricated demo records", () => {
  for (const view of ["overview", "settings", "setup", "tasks", "connections", "calendar", "projects", "teams", "inbox", "documents", "reviewCenter", "infrastructure", "leasing", "accounting", "maintenance"]) {
    const html = render(view);
    assert.match(html, /data-workspace-mode="live"/, view);
    assert.doesNotMatch(html, /DEMO DATA|Exit demo|Demo workspace|Alex Morgan|fictional sample/i, view);
    if (view === "tasks") assert.match(html, /Aval Tasks/);
  }
});
test("setup keeps specialist selection between wiring and memory", () => {
  const html = render("setup");
  assert.ok(html.indexOf("What this agent can reach") >= 0);
  assert.ok(html.indexOf("What this agent can reach") < html.indexOf("Choose the center agent"));
  assert.ok(html.indexOf("Choose the center agent") < html.indexOf("What Aval remembers"));
});
test("overview places real use tracking before the greeting without sample activity", () => {
  const html = render("overview");
  assert.doesNotMatch(html, /activity-heatmap-grid|Aug 12–18/);
  assert.ok(html.indexOf("Aval use tracker") >= 0);
  assert.ok(html.indexOf("Aval use tracker") < html.indexOf("Welcome back, Evan"));
});
