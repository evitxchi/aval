import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { DataChart } from "../../app/components/data-chart.tsx";
const messages = JSON.parse(readFileSync("messages/en.json", "utf8"));
const rows = [{ label: "Jan", values: { rent: 150, fees: 20 } }, { label: "Feb", values: { rent: 110, fees: 12 } }, { label: "Mar", values: { rent: 180, fees: 23 } }];
const series = [{ key: "rent", label: "Rental income", color: "#2f6fed" }, { key: "fees", label: "Fees", color: "#a855f7" }];
function render(kind, data = rows) { return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages, timeZone: "UTC" }, createElement(DataChart, { title: "Income", rows: data, series, temporal: true, additive: true, initialKind: kind }))); }
test("all eight chart representations render accessible, finite geometry and exact observations", () => {
  for (const kind of ["bars", "horizontal", "dots", "stacked", "line", "area", "steps", "stackedArea"]) {
    const html = render(kind);
    assert.match(html, new RegExp(`data-chart-kind="${kind}"`));
    assert.match(html, /aria-label="Jan: Rental income 150, Fees 20"/);
    assert.match(html, /tabindex="0"/);
    assert.match(html, /linearGradient/);
    assert.doesNotMatch(html, /NaN|Infinity|undefined/);
    if (kind === "steps") assert.match(html, /d="M[^" ]+ H/);
  }
});
test("negative and missing series cannot enter stacked representations", () => {
  assert.match(render("stackedArea", [{ label: "Jan", values: { rent: -5, fees: 2 } }]), /data-chart-kind="bars"/);
  assert.match(render("stacked", [{ label: "Jan", values: { rent: null, fees: 2 } }]), /data-chart-kind="bars"/);
  assert.doesNotMatch(render("area", [{ label: "Jan", values: { rent: null, fees: null } }]), /<svg/);
});
