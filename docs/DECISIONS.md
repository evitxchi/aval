# Decisions

## 2026-08-22 — Target market: both US and LatAm, US prioritized

**Context.** `docs/TASKS.md` P1.1 asked whether this demo targets the US
(QuickBooks/Xero + AppFolio/Buildium, USD, mm/dd/yyyy) or Mexico/LatAm (CONTPAQi/Alegra/Xero,
no PMS requirement, MXN, oxxo/spei, dd/mm/yyyy, `colonia` on addresses), and said not to
implement both.

**Decision.** Support both markets. US is the default and the prioritized experience —
it's what a new session sees, what gets built out first, and what other work (P1.2's
per-tile unlocking, P0's sample data) assumes unless stated otherwise. LatAm is a real,
supported second market, not a stub.

**Why.** Product decision from the person directing this work, made explicitly to override
the brief's original either/or framing.

**What this changes vs. the brief's original LatAm-only branch.**
- A `Market` type (`"us" | "latam"`) is introduced, independent of `Locale` (language).
  They're orthogonal: an English-speaking LatAm operator and a Spanish-speaking US operator
  are both real users. Conflating market with language (as the original `Locale = "en" |
  "latam"` did) doesn't hold once both markets are real.
- Market defaults to `"us"`. A switcher lives next to the existing language toggle.
- Accounting connectors: QuickBooks and Xero are the default (US) recommendation;
  CONTPAQi and Alegra are added for `latam` market and become the recommendation there.
  Xero is offered in both, matching the brief's own LatAm connector list.
- Leasing/PMS requirement (AppFolio, Buildium) is kept for both markets rather than removed
  for LatAm, since the US flow — the prioritized one — depends on it and the two markets
  now share the same product surface.
- Currency prefix on the Overview KPI tiles is now market-aware (`$` for US, `MX$` for
  LatAm) rather than hardcoded.

**Deliberately not done in this pass — flagged, not forgotten.**
- Date formatting (`mm/dd/yyyy` vs `dd/mm/yyyy`) needs real `Intl.DateTimeFormat` locale
  handling, not string hacks. That belongs with P1.3's i18n work, where locale-aware
  formatting gets built properly; it shouldn't be half-done ahead of it.
- Payment methods (`oxxo`, `spei`) and address display (`colonia`) have no existing UI
  surface anywhere in this app yet — there's no payments screen and no address field to
  extend. Adding them now would mean inventing new UI outside what was asked; they're
  real LatAm requirements to pick up when a payments/property-address feature exists.
- `AnimatedNumber` formatted every number via a hardcoded `toLocaleString("en-US", …)`
  regardless of active locale. **Fixed as part of P1.3** (below) — it now uses the real
  active locale via `useLocale()`.

## 2026-08-22 — P1.3: migrated to next-intl, real URL-segmented locales

**Compatibility check.** Before committing to the migration, built an isolated proof-of-concept
(`/poc-intl/[locale]`, since removed) to confirm next-intl actually works on `vinext`
(this app doesn't run on real Next.js — vinext reimplements the Next.js API surface on Vite).
Confirmed working end-to-end: middleware-based locale redirect, `[locale]` dynamic segments,
`generateStaticParams`, `NextIntlClientProvider`, and real ICU plural grammar. One adaptation
was required: next-intl's Next.js-config plugin (which points the internal `next-intl/config`
module at `i18n/request.ts`) has nothing to patch here since there's no `next.config.js` — so
the same alias is set directly in `vite.config.ts`'s `resolve.alias` instead.

**What changed.**
- Routes restructured under `app/[locale]/` (`page.tsx`, `mobile/`, and the layout that used to
  be `app/layout.tsx`). `middleware.ts` now covers the whole app (previously scoped to the
  POC route only), redirecting `/` → `/{locale}` and validating the locale segment.
- The old hand-rolled `copy(english, latam)` mechanism (`ExperienceProvider`'s `locale` /
  `setLocale` / `copy`) is gone. Every one of its ~380 call sites across `page.tsx`,
  `aval-assistant.tsx`, and `mobile/page.tsx` now calls `useTranslations()` with a message key.
  `Market` (P1.1, independent of language) is untouched.
- `messages/en.json` and `messages/es-mx.json` hold 374 keys across 12 namespaces (one per
  top-level component). ICU MessageFormat is used wherever content is generated dynamically
  (funnel percentages, unit counts, module names) rather than string concatenation.
- Static bilingual data (`navGroups`, task columns, `operationCopy`, and `sample.ts`'s
  figures) now store a `labelKey`/`detailKey` string instead of an inline `[en, es]` pair —
  the content itself lives only in the message catalogs, so there's exactly one place to look
  for any string.
- Locale switcher (Settings and the profile menu) now navigates via next-intl's `useRouter`/
  `usePathname`, swapping the URL segment, instead of flipping local component state. Shows
  "English" / "Español (México)" — no flags, own-language names, per the brief.
- `scripts/check-i18n-parity.mjs` deep-compares the two catalogs' key sets and exits 1 on any
  mismatch; wired into `npm test` so a missing translation fails the build, not just eyeballing.
- `terms.es-mx.json` records the canonical glossary. Two entries deliberately diverge from the
  brief's suggested word list (`unidad` over `departamento`, `residente` over `inquilino`) —
  see the file for why; both are about matching this product's actual English register, not
  arbitrary substitution.
- `analyzeQuestion` in `aval-assistant.tsx` (the "Ask Aval" canned-response engine, ~70 strings
  across 8 topic branches) now takes `t` as a parameter — it's a plain function, not a
  component, so it can't call the hook itself — and returns fully-resolved text instead of
  raw `[en, es]` pairs.

**Known gap, not addressed here.** Verifying layout survives ~30% Spanish text expansion
needs an actual browser; this session didn't have one available. Worth a visual pass, especially
on the sidebar nav labels and the profile-menu locale/market switcher buttons, which are the
tightest-fitting text in the UI.

## 2026-09-02 — Backend expansion: infrastructure module, finance/currency libs, address normalization

**Context.** A GitHub sourcing pass (four parallel research agents) looked for high-value
open-source infrastructure across property management, financial analysis, document drafting,
and energy/water/plumbing measurement. Conclusion, stated plainly to the user: real-estate/
property-tech open source is thin. Almost nothing is embeddable as a dependency — the value
was in schemas to reference (Brick Schema for meter↔unit↔property modeling), methodologies to
port rather than depend on (CalTRACK/eemeter's energy-savings approach), and two genuine
drop-in wins (`dinero.js`, `docxtemplater`). Full findings aren't reproduced here; this entry
covers what was actually built. The user then said to implement as much of it as possible,
build a new "infrastructure" module for electricity/water/etc., improve backend code where it
helps, and to proceed without stopping for confirmation.

**What shipped.**
- `lib/finance/money.ts` — `dinero.js` v2-backed money arithmetic/formatting for Aval's two
  supported currencies (USD, MXN — see this file's P1.1 entry above). dinero.js 2.0.2 ships
  every ISO 4217 currency directly (no need for the separate, alpha-tagged
  `@dinero.js/currencies` package). Amounts are always integer cents, never floats, to avoid
  the rounding drift that shows up once amounts are added or allocated.
- `lib/finance/metrics.ts` — NOI, cap rate, cash-on-cash, DSCR, operating expense ratio,
  break-even occupancy, GRM, NPV, IRR (Newton-Raphson with a bisection fallback), and mortgage
  amortization. Hand-written, not sourced from a dependency: the research found nothing beyond
  single-maintainer, sub-10-star repos for real-estate-specific finance formulas. This matches
  what `lib/ask-aval/handler.ts` and `draft.ts` already tell the model — cap rate/DSCR/
  cash-on-cash/IRR/NPV all require a property valuation or debt terms this system doesn't have
  yet — so these functions exist as tested, ready-to-use building blocks for when real
  valuation/debt inputs exist, not wired into the model's tools yet (there's nothing real to
  feed them without fabricating a valuation, which the Ask Aval system prompt explicitly
  forbids).
- `lib/integrations/address.ts` — heuristic US/MX address normalization. libpostal and
  usaddress (the strong tools here) are C/Python, not embeddable in a Cloudflare Worker.
  This is a smaller, dependency-free regex-based parser for both of Aval's markets, honest
  about its limits via a `confidence: "high" | "low"` field rather than a false-precision
  parse.
- **New `lib/infrastructure/` module** — the headline new deliverable, genuinely new ground
  (Aval had no electricity/water/gas feature before this):
  - `db/schema.ts` gained `utility_meters` and `utility_bills` (migration
    `drizzle/0009_clever_maggott.sql`). There is no `properties`/`units` table yet, so meters
    are scoped to the org with a free-text `propertyLabel`/`unitLabel`, the same shape
    `insightDecisions` already uses for referencing an id with no real table behind it —
    revisit as `propertyId`/`unitId` once a real property table exists.
  - `usage-metrics.ts` — cost-per-unit, usage-intensity-per-sqft, and a
    `compareBaselineToReporting` normalized-usage comparison. This is a deliberately
    simplified stand-in for CalTRACK/eemeter's weather-normalized regression (no weather-data
    source is connected), normalizing only for period length. Said so directly in the doc
    comment: a mild winter will look like a real reduction until degree-day weighting is
    added.
  - `plumbing.ts` — water-supply fixture-unit (WSFU) totals and a rough nominal pipe-size
    estimate from commonly published IPC/UPC figures, framed explicitly as a planning
    estimate, not a code-compliance tool.
  - `bill-extraction.ts` — turns a utility bill's raw text into structured fields via a single
    forced-tool-call to Claude (reusing `lib/ask-aval/anthropic.ts`, `usage.ts`'s daily-cap/
    token-balance gates, and `loop.ts`'s `json()` helper), because the OSS options for utility
    bill parsing were a 0-star proof-of-concept and otherwise commercial data brokers. Returns
    a draft for the user to review; never auto-saves, matching the rest of the app's
    "AI proposes, a human confirms" shape.
  - `meters.ts` / `summary.ts` — org-scoped CRUD and a KPI rollup per utility type.
    `recordBill` explicitly verifies the target meter belongs to the caller's org before
    attaching a bill to it, rather than trusting a caller-supplied `meterId`.
  - Routes: `GET/POST /api/infrastructure/meters`, `GET/POST /api/infrastructure/bills`,
    `POST /api/infrastructure/bills/extract`, `GET /api/infrastructure/summary`.
- `docxtemplater` + `pizzip` added as dependencies for a future branded-template document-export
  path (alongside the existing hand-rolled block-model exporter in `lib/ask-aval/export.ts`,
  which research judged already more fit-for-purpose than any markdown→docx converter found —
  left as-is).

**Deliberately not done in this pass.** No UI surface for the infrastructure module yet
(no dashboard tiles, no sample-data entries) — `app/[locale]/dashboard-client.tsx` and
`app/data/sample.ts` are both large, tightly consistency-checked files (i18n parity,
`assertSampleConsistency`), and backend correctness was prioritized within the time available.
`docxtemplater` is installed but not yet wired to a real template or route. Cross-currency
utility summaries report only the utility type's most common currency's total, flagging the
rest via `otherCurrencyBillCount` rather than converting — real FX conversion is a separate,
unstarted piece of work.

**Verification.** `npx tsc --noEmit`, `npm run build`, `npm run lint`, and `node --test`
(43 passing, including all pre-existing tests) all pass as of this entry.

## 2026-09-02 — Agent avatar system and named agent personas

**Context.** Same session as the infrastructure-module pass above. The user asked for a
"cohesive premium visual system" of abstract, illuminated agent avatars (soft volumetric glow,
asymmetric two-source lighting, dark dimensional forms, clean silhouettes at 24-40px — explicitly
not sparkles, robot heads, generic AI stars, or plain gradient circles), a reusable component
separating shape geometry from lighting/theme, and named agent personas (financial, brokerage,
real estate, market research, maintenance) a user can select — plus a request to research
high-star GitHub agent frameworks and "implement the best one," without stopping to ask.

**Agent framework research (one fork agent).** Verified via the GitHub API: microsoft/autogen
(60.8k★), crewAI (58.0k★), openai-agents-python (29.1k★), and semantic-kernel (28.5k★) are all
Python/.NET, server-only — not deployable in a Cloudflare Worker. Of the TypeScript-native
options, vercel/ai (26.5k★) and langchainjs (18.2k★) can run on Workers but bring chain/agent
abstractions Aval's simple bounded loop doesn't need; mastra-ai/mastra (27.6k★) and vercel/ai
both carry a GitHub-reported "Other"/`NOASSERTION` license needing manual verification before
any real dependency decision. cloudflare/agents (5.5k★, MIT) is the one actually built for this
runtime, but solves a different problem (persistent, stateful Durable-Object-backed agents) than
Aval's stateless-per-request tool loop. Every real example of "named persona, own system prompt,
scoped tool subset" found in the research was a plain `{id, systemPromptAddition, toolSubset}`
registry, not a framework feature.

**Decision: extend in-house, no new dependency.** None of the TS-native frameworks know about
`lib/ask-aval/loop.ts`'s faithfulness gate (rejects any answer citing a number no tool returned)
or its per-org usage/billing caps — adopting one would mean reimplementing those safety checks
inside someone else's abstraction, for a feature the research itself shows is just a config
table. Shipped as `lib/ask-aval/personas.ts`: six personas (general/financial/brokerage/
realEstate/marketResearch/maintenance), each an id + label + system-prompt addition + a tool-name
subset, filtered via `personaTools()` against the existing `TOOLS`/`DRAFT_TOOLS` registries.
`handleAskAval` and `handleAskAvalDraft` both take an optional `personaId` (default preserves
today's exact behavior) and route through the unchanged `runAskAvalLoop` — every persona is
still faithfulness-gated and usage-metered identically to the default assistant. Plumbed through
`/api/assistant/ask`, `/api/assistant/draft`, and `CreateDraftInput` end to end.

**Avatar system: `app/components/agent-avatar/`.** Shape geometry (`shapes.tsx`) and color/
lighting themes (`themes.ts`) are fully decoupled — any of 6 shapes (arch, shard, portal,
four-point, monolith, intersecting planes) can carry any of 6 themes (Aval Blue, Violet, Aqua,
Ember, Aurora, Orchid), so a new persona is a config entry, not a new graphic. Each avatar is an
SVG built from three layers over a shared silhouette: an unmasked, blurred, primary-colored
bloom halo sitting behind everything (the only layer allowed to bleed past the edge); the
silhouette used as an SVG `<mask>` constraining a dark base gradient plus two asymmetric radial
lights (positioned from *each shape's own bounding box*, not a fixed canvas point — see the bug
below); and, inside that mask, a thin rim-light outline plus a small specular highlight.
`fourPoint` deliberately avoids a symmetric sparkle/star silhouette (explicitly ruled out by the
brief) by elongating and offsetting its arms. Wired into `aval-assistant.tsx`: the header shows
the active persona's avatar (falling back to Aval's own brand mark for the general persona,
left untouched), and a "Choose agent" control opens a picker grid of all six.

**Two real bugs caught by visually testing in a browser before calling this done** (per this
session's own standing instruction to verify UI changes in-browser, not just typecheck them):
1. *Flat/dim non-`fourPoint` shapes.* The primary/secondary light gradients were centered at a
   fixed canvas position tuned for `fourPoint` (which happens to span nearly the full 100×100
   viewBox). Narrower shapes like `monolith` left their hotspot mostly outside their own
   silhouette, masking away the brightest part of the gradient. Fixed by giving every shape an
   explicit `bbox` and deriving each light's position/radius from that shape's own bounds
   (`AgentAvatar.tsx`), and by enlarging every shape to use close to the full canvas rather than
   leaving an internal margin on top of the container's own padding.
2. *Header avatar rendering solid black.* `.aval-agent-avatar`'s container used `padding: 17%`
   in CSS. Percentage padding resolves against the *containing block's width* by spec, not the
   element's own size — inside `.aval-assistant-identity` (a wide flex row) this computed to
   far more padding than the 38px avatar could hold, and CSS `border-box` sizing doesn't rescue
   this: when padding alone exceeds the specified width, content clamps to zero and the box
   grows past its declared size to fit the padding. Fixed by computing padding as a pixel value
   from the `size` prop inside the component instead of a CSS percentage. Caught only by
   screenshotting the actual header instance, not the picker grid, where a narrower container
   happened to keep the same bug from being quite as visually catastrophic.

**Deliberately not done.** No visual iteration with the user — this is a first implementable
pass true to the technical brief (asymmetric lighting, bloom, rim, specular, no clichés), not a
claim of final "premium" polish, which needs a human's eye. The `planes` (intersecting-planes)
shape reads the weakest of the six — recognizable but its two facets don't visually separate at
small sizes; a seam highlight between the two paths would help and was left for a follow-up.
`vinext dev`'s hot-reload was found to throw an intermittent `useTranslations`/
`NextIntlClientProvider` error in `DesktopApp` that reproduces on the pre-existing `main` branch
with no source changes at all (confirmed via `git stash`) — a dev-server-only quirk, absent from
the production build (`vinext build && vinext start`), not something this session introduced or
fixed.

**Verification.** `tsc --noEmit`, `npm run build`, `npm run lint`, and `node --test` (43 passing)
all clean. Manually verified in a real browser (Playwright against the production build, since
`vinext dev` was the one with the unrelated pre-existing flake) — screenshotted the persona
picker and the header avatar before and after both bug fixes above.

## 2026-09-02 — docxtemplater wired up: branded-template document fill

**Context.** Last item from this session's original five-part plan (docs/DECISIONS.md's first
2026-09-02 entry): `docxtemplater` and `pizzip` were installed but unused. This ships the actual
integration — filling a user-supplied .docx template's placeholders with real data, as a
complement to (not a replacement for) `lib/ask-aval/export.ts`'s existing hand-rolled exporter,
which stays exactly as-is.

**What shipped.** `lib/ask-aval/docx-template.ts`: `renderDocxFromTemplate(templateBytes, data)`
wraps `pizzip` + `docxtemplater`, returning a `Uint8Array` via `generate({ type: "uint8array" })`
— no Node `Buffer` dependency, so this runs directly in the Worker request path (unlike
`export.ts`'s libraries, which need a DOM and stay client-side). `POST
/api/assistant/fill-template` accepts multipart `template` (a .docx file) + `data` (JSON) and
streams back the filled .docx — stateless, no template-storage surface yet (would need R2; see
the deferred list below).

**Bug caught by the test, not by inspection.** `docxtemplater`'s own default delimiter is
single-brace (`{tag}`), not the mustache-style `{{tag}}` used throughout this integration's docs
and tests. Left at the default, a template containing `{{title}}` parses as two back-to-back
single-brace tags and throws "duplicate open/close tag" — confirmed by generating a real
docx-library template buffer, round-tripping it through `renderDocxFromTemplate`, and reading
`word/document.xml` back out of the result. Fixed with an explicit `delimiters: { start: "{{",
end: "}}" }` in the `Docxtemplater` constructor options. Also hit, incidentally: Node's native
TypeScript type-stripping (`node --test` on this project's Node 24) does not support TypeScript
parameter-property syntax (`constructor(message: string, readonly x: number)`) — silently works
today in `lib/ask-aval/anthropic.ts`'s `AnthropicError` only because no test file imports it
directly; `DocxTemplateError` here uses a plain constructor + explicit field assignment instead,
specifically so its own test file can import it.

**Deliberately not done.** No template-upload/storage UI — an operator has no way yet to save a
branded template for reuse; today's route takes the template bytes fresh on every call. No
mapping from Ask Aval's draft data model (headline/narrative/metrics/document) to a template's
placeholder names — that mapping is a product decision (what should a template author be able to
reference?) better made with real example templates in hand, not invented here.

**Verification.** `tsc --noEmit`, `npm run build` (route registered:
`/api/assistant/fill-template`), `npm run lint`, `npm run i18n:check`, and `node --test` (45
passing) all clean.

## 2026-09-02 — Custom agent creation, not just selection

**Context.** After shipping the fixed six-persona roster and avatar picker (this file's earlier
2026-09-02 "Agent avatar system" entry), the user's brief specifically called out that agent
*creation* — not just selection from a preset list — was the important part: "maybe even create
agents that users can use for different tasks... this agent selection, creation is crucial." This
entry adds that.

**What shipped.** `agent_personas` (db/schema.ts, migration `drizzle/0010_lethal_changeling.sql`):
one row per workspace-defined agent — label, a free-text `focusDescription`, an optional
`toolNamesJson` subset, and a `shape`/`theme` pair for its avatar. `lib/ask-aval/
persona-validation.ts` holds the pure validation rules (label/focus length caps, shape/theme
enum checks, tool-name filtering) split into its own file specifically so it stays unit-testable
— the sibling `custom-personas.ts` (the actual DB CRUD) imports `@/db`, which itself imports
`cloudflare:workers`, neither of which plain `node --test` can resolve outside the Workers/Vite
build. `personas.ts` gained `resolvePersona(id, organizationId)`, an async sibling to the
existing sync `getPersona()`: checks the fixed built-in roster first, then falls back to a
workspace's own custom persona, scoped by `organizationId` like every other row in this app.
`handleAskAval`/`handleAskAvalDraft` now call `resolvePersona` instead of `getPersona`.

Routes: `GET/POST /api/agents`, `DELETE /api/agents/:id`. UI: the existing persona picker in
`aval-assistant.tsx` now fetches and lists an org's custom personas alongside the six built-ins,
with a per-tile delete control and a "+" tile opening an inline creation form (name, focus
description, and live-preview shape/theme swatch rows built from `AvalAgentAvatar` itself —
picking a swatch shows the exact avatar the new agent will get).

**Why an operator-authored `focusDescription` can't be used to bypass this app's safety model**
(documented in `custom-personas.ts`'s doc comment, worth restating here): it only ever becomes a
system-prompt *addition* appended after the hard rules in `handler.ts`/`draft.ts`, but even a
fully-compliant model following a "estimate freely" instruction still can't get an invented
number past `faithfulness.ts`'s gate, which checks the *final answer* against what tools actually
returned — independent of anything the system prompt said. `toolNames` is enforced by which tool
schemas are literally sent to the model (`personaTools()`), so prompt text can't grant access to
a tool that was never offered either. Full-org-scoping keeps this simple, too: `organizationId`
is `hash(userId)` (see `session.ts`), so there is no shared-team-membership case to worry about —
every user's custom personas are only ever visible to that same user.

**A real layout bug caught only by testing the actual UI, not by inspection.**
`.aval-assistant-panel` is a fixed-height CSS grid (`grid-template-rows: auto auto minmax(0,1fr)
auto auto auto`). Adding the creation form's inputs and swatch rows made `.aval-assistant-context`
(one `auto` row) taller than the grid had room left to give it once the panel's total fixed
height was accounted for — and because that section had `overflow: visible`, the excess didn't
clip, it spilled straight down and visually overlapped the message-suggestions section below it
(confirmed by comparing `getBoundingClientRect()` on both: they shared the same top coordinate).
Fixed with `max-height: 340px; overflow-y: auto` on `.aval-assistant-context` so it scrolls
internally past that point instead of overflowing into its sibling.

**Deliberately not done.** No tool-subset picker in the creation form — every custom persona
gets `toolNames: null` (every tool), the same permissiveness as the general assistant; a
checkbox UI for the six tool names is a small, low-risk follow-up. No edit — only create/delete;
editing would reuse the same form, just prefilled and PATCHing instead of POSTing.

**Verification.** `tsc --noEmit`, `npm run build` (routes registered: `/api/agents`,
`/api/agents/:id`), `npm run lint`, `npm run i18n:check`, and `node --test` (53 passing) all
clean. UI verified live (Playwright against the production build): picker shows built-ins + a
"+" tile, the creation form opens without the overlap bug above, shape/theme swatches preview
correctly, and a failed submission (this sandbox's local preview has no working D1 binding —
`cloudflare:workers` isn't resolvable outside the real Workers runtime, the same limitation
noted for every other D1-backed route tonight) leaves the form open and re-enabled rather than
stuck or crashed. The actual create → select → chat round trip needs a real D1 binding to verify
end to end.
