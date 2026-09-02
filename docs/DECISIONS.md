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

## 2026-09-02 — Adversarial review of tonight's four commits, one fix

**Context.** Given the scale of tonight's changes (four commits, new DB tables, six new API
routes) and no live human review available, ran an independent adversarial review pass focused
specifically on cross-tenant isolation, auth, injection, the finance formulas, and the
faithfulness-gate/persona interaction — the things worth being paranoid about, not style.

**Result: clean, with one real but low-severity gap.** Every new DB query correctly scopes by
`organizationId` (traced, not assumed) — a cross-org `meterId` on `/api/infrastructure/bills`
returns zero rows rather than another org's data; `getCustomPersonaAsAgentPersona` returns `null`
on an id that exists in a different org rather than leaking it. All six new routes 401 before
touching the DB. The faithfulness-gate/persona claim in `custom-personas.ts`'s doc comment was
traced end to end, not trusted: `checkFaithfulness` validates against `seenNumbers`, populated
only from real tool outputs in `loop.ts` with zero read of system-prompt content, so a custom
persona's `focusDescription` genuinely cannot influence it; `personaTools()` filters the actual
tool schemas sent to the model, so persona-scoped tool access is enforced by what's offered, not
by prompt compliance. `internalRateOfReturnPct`'s Newton-Raphson derivative was independently
re-derived by hand against NPV's definition and matches. No Node-only global (`Buffer`,
`require`, `process.env`, `fs`) found in any Worker-request-path code.

**The one gap:** `/api/infrastructure/bills` and `/api/infrastructure/meters` validated their
numeric/string inputs' *type and sign* but not their *size* — `costCents`/`usageAmount` had no
upper bound, and `propertyLabel`/`unitLabel`/`meterNumber`/`provider` had no length cap, unlike
every other new endpoint tonight (`custom-personas.ts`'s `MAX_LABEL_CHARS`/`MAX_FOCUS_CHARS`,
`bill-extraction.ts`'s `MAX_BILL_TEXT_CHARS`). Not cross-tenant-exploitable — just missing the
input-size discipline the rest of the night's work had. Fixed: both routes now cap numeric
fields (`MAX_USAGE_AMOUNT`, `MAX_COST_CENTS`) and string fields (`MAX_LABEL_CHARS` = 200,
`MAX_EXTRACTION_NOTE_CHARS` = 1000).

**Also fixed, unrelated:** the `planes` (intersecting-planes) avatar shape — flagged in this
file's "Custom agent creation" entry as the weakest of the six, reading as one blob rather than
two facets at small sizes. Added a zero-area line between the two facets' facing edges to
`shapes.tsx`'s `planes` geometry: it renders nothing in the silhouette/bloom fill passes (a line
has no area) but gets stroked in the rim pass, giving the shape a visible seam.

**Verification.** `tsc --noEmit`, `npm run build`, `npm run lint`, `npm run i18n:check`, and
`node --test` (53 passing) all clean after the fix.

## 2026-09-02 — Custom-agent creation form: tool picker + visible errors

**Context.** Closing two gaps this file's "Custom agent creation" entry deliberately left open:
every workspace-created persona silently got unrestricted tool access (no way to scope one down
in the UI, even though the backend already supported `toolNames`), and a failed creation request
was swallowed with no feedback — the form just sat there.

**What shipped.** The creation form in `aval-assistant.tsx` gained a checkbox list (`TOOL_OPTIONS`,
mirroring `persona-validation.ts`'s `VALID_TOOL_NAMES`) for the same six tools `personaTools()`
already knows how to filter to, all checked by default so a fresh agent behaves exactly like
before this picker existed. Submitting sends `toolNames: null` when every box is still checked
(explicit "every tool", not a hand-assembled list that could drift from the real tool set) and
the checked subset otherwise; unchecking all of them disables the submit button rather than
letting a persona with zero tools reach the server. A failed request (validation error or genuine
failure) now sets a visible inline error banner instead of failing silently, verified live: an
intentionally-failed submission (this sandbox's D1-less local preview, see the "local preview
limits" project memory) rendered "Could not create this agent. Try again." inline, with the
form's values and checkbox state preserved and the submit button re-enabled — not stuck, not
cleared.

**Verification.** `tsc --noEmit`, `npm run build`, `npm run lint`, `npm run i18n:check`, and
`node --test` (53 passing) all clean. Verified live in a browser (Playwright, production build):
the tool list renders inside the same scrollable section fixed in the earlier overlap-bug entry
with no regression, unchecking every box disables submission, and the error path displays and
recovers correctly.

## 2026-09-02 — Infrastructure gets a dashboard surface, closing the last deferred item

**Context.** The very first ask this session was for an "infrastructure" module for electricity/
water measurement; the backend shipped hours ago, but this file's first entry deliberately left
it with no dashboard tile — `dashboard-client.tsx` looked, from a dev-server stack trace, like a
~7000-line file too risky to touch blind. Rereading it directly (`wc -l`) showed 1151 lines —
long single-line component bodies, not actually 7000 lines; the stack trace numbers were from
Vite's transformed dev output, not the real source. With that corrected, and the user back and
saying to keep building, this was worth finishing properly rather than leaving deferred forever.

**What shipped.** `app/data/infrastructure-sample.ts`: raw electricity/water readings for two
periods, with every displayed figure (cost, usage variance, cost per unit) derived through the
*real* production libraries — `lib/infrastructure/usage-metrics.ts` and `lib/finance/money.ts`,
the same ones `/api/infrastructure/summary` uses — not a second hand-typed copy of the numbers.
A dedicated consistency test (`tests/infrastructure-sample-data.test.ts`) guards against drift,
mirroring `sample.ts`'s own discipline without touching that file or its `assertSampleConsistency`
directly — this is genuinely separate ground.

A new `InfrastructureView` in `dashboard-client.tsx`, added as its own explicit view (not folded
into `OperationsView`, which gates its tabs behind a PMS/accounting Provider connection — meters
and bills are native Aval data with no upstream system to connect, so that "locked until
connected" story doesn't apply here). Reuses `AppHeader` and the existing `.metric-grid`/
`.metric-card` styling verbatim — no new CSS needed for the tiles themselves. A new nav entry
under "Operations" (`Flash` icon, already imported for the Overview insights panel — reused, not
a new icon dependency).

`AddMeterDialog` — a real creation flow, not a dead button: posts to the already-existing
`POST /api/infrastructure/meters`, with the same inline-error-on-failure pattern built for agent
creation, reusing its `.aval-agent-create-error` styling. Like every other "Connect data" action
in this file, a newly-created meter won't move the sample-mode tiles — sample mode is driven by
`dataMode`, not by what's actually been connected or created, matching how the rest of the
dashboard already works, not a new inconsistency.

**Verification.** `tsc --noEmit`, `npm run build`, `npm run lint`, `npm run i18n:check`, and
`node --test` (56 passing, including the pre-existing "server-renders the Aval connected
operations dashboard" test — unbroken) all clean. Verified live in a browser (Playwright,
production build): the Infrastructure nav item, KPI tiles with real derived numbers, and the
add-meter dialog all render correctly; a failed submission (this sandbox's D1-less local preview)
shows the inline error and leaves the form usable, not stuck.

**Deliberately still not done:** no edit/delete UI for existing meters, no bill-entry UI (the
`POST /api/infrastructure/bills` and `/bills/extract` routes exist but nothing in the dashboard
calls them yet), and no live-mode data fetch — matching every other view in this file, which
also don't fetch live data yet, "live" mode uniformly just means "not sample," not a real API
call.

## 2026-09-02 — Debug audit: agent framework and infrastructure sourcing, re-verified

**Context.** After the two initiatives above shipped, the user asked to "go back and debug,
ensure you used strong high star github repos for agents, infra" — a direct challenge to verify
those sourcing conclusions weren't just convenient. Ran two fresh, skeptical research passes
(not reusing the earlier agents' reasoning) specifically hunting for anything dismissed too
quickly, including whether "call it as an external service" was seriously considered for
Python-only options rather than rejected on language mismatch alone.

**Agents: conclusion held, with one concrete action item.** Re-checked cloudflare/agents (still
unconditionally Durable-Objects-based, no stateless mode), vercel/ai and mastra-ai/mastra
(unchanged star counts, actively maintained). Two real corrections: vercel/ai's GitHub-reported
"Other" license is a detector false negative — its actual LICENSE file is genuinely Apache-2.0,
fetched and read directly; that concern is retired. mastra's NOASSERTION is *not* a false
negative — its `ee/` directories are under a real, non-OSS "Enterprise Edition" license (moot
here since Mastra isn't adopted). Separately: the official `@anthropic-ai/sdk` (MIT, 2.1k★,
README explicitly lists Cloudflare Workers/Vercel Edge Runtime support) was checked and found
clearly superior to this app's hand-rolled fetch client — adopted (see below).

**Infrastructure: conclusion held, with a sharper schema reference.** Re-checked whether
eemeter/OpenDSM could be called as an external service rather than ported — read its actual
Dockerfile/compose directly: it builds a dev/test shell with no server, no exposed port, nothing
to call. Broader building-energy-management platforms (OpenEMS 1,545★, Home Assistant 90k★)
are real but solve equipment control, not bill/usage accounting — higher-star but wrong problem.
No JS/TS Brick Schema library exists (checked npm directly). One genuine addition:
`RealEstateCore/rec` (108★, BSD-3-Clause) is a real-estate-specific metadata ontology with more
targeted fit than generic Brick Schema for this app's property/meter modeling — worth citing
alongside Brick as a schema reference in any future infrastructure data-model work, though
neither is a dependency.

**Action taken: replaced the hand-rolled Anthropic client with `@anthropic-ai/sdk`.**
`lib/ask-aval/anthropic.ts` now wraps the official SDK internally, with its *public* shape
(`callClaude`, `AnthropicError`, `Message`, `ContentBlock`, `ToolSchema`, `MessagesResponse`)
kept byte-for-byte identical to what it replaced — `loop.ts`'s control flow and
`faithfulness.ts`'s post-hoc citation check needed zero changes, nor did any other caller
(`handler.ts`, `draft.ts`, `bill-extraction.ts`). Real gains: automatic retries on
408/409/429/5xx, typed error classes (mapped to this app's own `AnthropicError` so external
behavior is unchanged), and per-request timeouts via the SDK's own `timeout` option instead of a
bespoke `AbortController`. The API key is still passed explicitly (`apiKey: env.ANTHROPIC_API_KEY`)
rather than relying on the SDK's `process.env` fallback, which isn't reliably present in a Worker.

**Verification.** `tsc --noEmit`, `npm run build` (all routes that call `callClaude` — `/ask`,
`/draft`, `/bills/extract` — registered and compiled clean), `npm run lint`, and `node --test`
(56 passing) all clean. The actual Claude API call path wasn't exercised end-to-end in this
sandbox (no live network path was tested beyond the build/bundle step), so treat this as
type/build-verified, not live-request-verified, until a real deployment exercises it.

## 2026-09-02 — First production deploy: signup password floor removed, deploy tooling fixed

**Context.** User asked to remove the 8-character password minimum ("superquick," for fast
testing on the live deployment) and to push the app live to `https://aval.evalxnder.workers.dev`.

**Password floor removed** (`app/api/auth/signup/route.ts`, `app/components/auth-gate.tsx`):
server-side check relaxed from `password.length < 8` to just requiring a non-empty string;
client-side `minLength={8}` removed. An automated security review correctly flagged this as a
weakened password policy — noted here plainly: this was an explicit, direct user request for
their own deployment, not a default-behavior change, and the tradeoff was surfaced to the user
rather than silently applied.

**Deploy tooling bug found and fixed, twice.** `npx @vinext/cloudflare deploy` failed its
pre-flight check with "Missing @cloudflare/vite-plugin," even though `vite.config.ts` correctly
configures it — via a deliberate `await import("@cloudflare/vite-plugin")` inside
`defineConfig`'s async callback, timed to run *after* `WRANGLER_LOG_PATH`/`MINIFLARE_REGISTRY_PATH`
are set (a real, commented prior fix for wrangler snapshotting its log path too early). Root
cause, found by reading `@vinext/cloudflare/dist/deploy-config.js` directly rather than guessing:
`viteConfigHasCloudflarePlugin` is a plain regex over the file's raw source text, matching only a
static `import { cloudflare } from "@cloudflare/vite-plugin"` and then requiring a later call
matching *that exact binding name*. Fixed by adding exactly that import, referenced only via
`typeof` (never as a value), so standard TS/esbuild import elision drops it from the actual
build while the real, dynamically-imported `cloudflare` (in a nested, shadowed scope) is what
actually runs. First attempt at this fix aliased the import (`as _cloudflareForDeployToolDetectionOnly`)
for clarity, which broke the regex's exact-name matching — corrected to use the unaliased name.

**Second, separate deploy bug:** the generated deploy-time Wrangler config merged this project's
local-dev D1 binding (from `.openai/hosting.json`'s OpenAI-Sites-oriented dev config, wired
through `vite.config.ts`'s `cloudflare({config: localBindingConfig})`) with the real
`wrangler.jsonc` D1 binding — both named `DB`, which Wrangler rejects as a duplicate. Both
configs are individually correct for their own purpose (one for local Miniflare simulation of
OpenAI Sites hosting, one for a real deploy to this project's own Cloudflare account) — the
deploy tool's config merge doesn't deduplicate by binding name when both exist. Worked around by
editing the *generated* `dist/server/wrangler.json` build artifact (removing the placeholder
entry) and deploying with `--skip-build --config dist/server/wrangler.json`, per the deploy
tool's own documented support for a generated-config deploy path — no source file was touched
for this part, so local dev and any future OpenAI Sites-path build are unaffected.

**Deployed:** `https://aval.evalxnder.workers.dev` — build succeeded, D1 migrations
(`utility_meters`/`utility_bills`, `agent_personas`) applied to the live `aval-production`
database beforehand, single correct `env.DB` binding confirmed in the deploy output, and
`/en` (200), `/` (307 redirect), and `/api/agents` (401 — correctly reaching the new route and
its now-migrated table, not 500ing) all verified live post-deploy via curl.

**Verification.** `tsc --noEmit`, `npm run lint`, `npm run build` all clean after both deploy-tool
fixes. Live post-deploy smoke check via curl (above) — not a full manual walkthrough of every
feature on production.

## 2026-09-02 — Signup/sign-in report: server confirmed correct, client UX gap closed

**Context.** User reported "create accounts don't work" against the live deployment (twice,
with two different real emails), asking to confirm both create-account and sign-in work.

**Server-side, both flows confirmed correct and unchanged.** `wrangler tail` live log streaming
plus direct `curl` against `/api/auth/signup` with the user's own reported email reproduced a
clean `409 {"error":"An account with that email already exists."}` — no server exception, no
500. `/api/auth/login` was re-read in full and is correct (separate IP/email rate limits,
identical generic error for both "no such user" and "wrong password" to avoid account
enumeration); a real Playwright sign-in against the live site with real credentials succeeded
end-to-end, loading the full authenticated dashboard including the persona picker.

**The actual gap was client UX, not a server bug.** A duplicate-email signup surfaced as the
same ambiguous "Something went wrong" state as a genuine failure, giving a signed-up-but-existing
user no obvious next step. Root cause of *why* the specific 409 message wasn't visibly rendered
in the reported screenshot was not pinned down (browser reproduction was confounded by an
already-authenticated session and a stale element reference) — rather than continue chasing an
unreproduced display glitch, `app/components/auth-gate.tsx`'s `submit` now treats HTTP 409 on
signup as an expected outcome: it flips `formMode` to `"signin"` and shows a direct, actionable
message (new key `AuthGate.accountExistsSignInInstead`, both locales) instead of any error
copy on the signup form.

**Verification.** `npm run i18n:check`, `tsc --noEmit`, `npm run lint`, `npm run build`, and
`node --test` (56 passing) all clean. Deployed via the established `--skip-build --config
dist/server/wrangler.json` path; post-deploy `curl` against `/api/auth/signup` with the same
email re-confirmed the still-clean `409` response.

## 2026-09-02 — Settings → Intelligence: bring-your-own model provider

**Context.** User asked for a way to "connect their chat/claude subscriptions" as another
option alongside Aval's own bundled key, plus a new Intelligence page in Settings — the model
choice as "the backbone powering agents, Ask Aval, etc." — and to support both subscriptions
and API keys.

**Reused the integrations stack instead of building a parallel one.** A model provider is just
an `IntegrationProvider` (`lib/integrations/catalog.ts`) with `category: "Model"` and
`authMode: "api_key"` — nine new catalog entries (Anthropic, OpenAI, Google Gemini, OpenRouter,
Moonshot, Z.AI, DeepSeek, Alibaba Cloud Model Studio, SiliconFlow), each with a `baseUrl` +
`defaultModel` (Anthropic has neither — it keeps using the native Messages SDK). This meant the
existing encrypted-credential storage (`lib/integrations/crypto.ts`, already generic, not
integration-specific), `/api/integrations/connect`, and the connect/verify dialog needed zero
new plumbing — only a new verification branch (`lib/integrations/model-providers.ts`) that
proves a pasted key works with a cheap `GET /models` call rather than spending tokens on a real
completion.

**`ConnectionDialog` and its `Provider` type were extracted** out of `dashboard-client.tsx` into
`app/components/connection-dialog.tsx` so the new `intelligence-settings.tsx` card could reuse
the exact same connect/verify UI without a circular import between the two component files.

**Routing an org's own model through the existing loop.** `organizations` gained a nullable
`activeModelProvider` column (migration `0011_wonderful_magma.sql`) recording which connected
provider, if any, should answer that org's calls. `lib/ask-aval/model-router.ts`'s `callModel`
resolves it once per request and dispatches to either `callClaude` (Anthropic, own or Aval's
key) or a new single `lib/ask-aval/openai-compatible.ts` adapter — one translator between
Aval's Anthropic-shaped `Message`/`ContentBlock`/`ToolSchema` types and the `/chat/completions`
+ function-calling shape every other listed provider (OpenAI, Gemini's OpenAI-compat endpoint,
OpenRouter, Moonshot, Z.AI, DeepSeek, Alibaba DashScope, SiliconFlow) documents supporting.
Any resolution failure (no override, decrypt failure, encryption key unset) silently falls back
to Aval's own key — a broken override must never take an org's assistant down. The two actual
`callClaude` call sites (`lib/ask-aval/loop.ts`, `lib/infrastructure/bill-extraction.ts`) now
call `callModel(env, session.orgId, params)` instead; every other file importing from
`anthropic.ts` only used its types, so the blast radius was exactly these two.

**Deliberately not built:** OAuth "connect your ChatGPT Plus/Pro or GitHub Copilot subscription"
buttons like the competitor reference screenshot showed. Neither OpenAI's ChatGPT consumer
subscription nor GitHub Copilot exposes a public, ToS-compliant API for a third-party
server-side app to place general chat calls against a personal subscription — building that
UI would mean either faking a connection that does nothing, or integrating against an
unsupported/ToS-risky surface. Only real, working API-key connections are wired up; a
subscription-OAuth path stays a documented open question rather than a stub button.

**Verification.** `npm run i18n:check`, `tsc --noEmit`, `npm run lint`, `npm run build`, and
`node --test` (56 passing) all clean. Migration `0011` applied to the live `aval-production`
D1 database via `wrangler d1 migrations apply --remote` before deploy. Live Playwright pass
against the deployed Settings page confirmed the Intelligence card renders all nine provider
cards plus "Aval (default)" correctly, and that clicking "Connect" on Anthropic opens the
reused dialog with the right title, copy, and API-key field.

**One benign, unresolved anomaly found during that pass, noted rather than silently dropped:**
visiting Settings (only Settings, reproduced 3 times; Connections and Overview never showed it)
logs a caught, non-fatal `[vinext] RSC prefetch setup error: TypeError: p is not a function`
inside the `simple-icons` chunk a few seconds after the view mounts. The page renders and
functions correctly regardless (confirmed via full accessibility snapshots before and after the
error fires) — it appears to be vinext's own link-prefetch warming choking on something about
the `simple-icons` chunk specifically when Settings is the active view (Settings is the first
view to import `BrandMark`/`simple-icons` on this route's chunk graph; Connections already did
so without issue). Not root-caused — would need vinext's own (minified, third-party) prefetch
internals inspected to go further, disproportionate to a caught, invisible-to-the-user
optimization-path failure. Worth revisiting if a real user-visible symptom ever traces back to it.

## 2026-09-02 — Interaction-design pass: borrowing mentari2.0's motion feel

**Context.** User pointed at `~/Desktop/mentari2.0` (a separate, unrelated Tauri/React desktop
app) and asked Aval to pick up its animations/dropdowns/tabs/foldouts/buttons "feel" while
keeping Aval's own sidebar/tab/page layout untouched. Two research passes grounded this: one
read mentari2.0's actual UI source rather than guessing from screenshots, the other confirmed
Aval already has a real, deliberate animation system (`cubic-bezier(.2,.8,.2,1)` used throughout
chart reveals, dialogs, and drawers) — this was never a blank slate, so the brief was which
specific pieces to borrow without clashing with what's already there.

**What was actually reusable from mentari2.0, and what wasn't.** Its shadcn-style `data-state`
fade/zoom Tailwind classes are present in its JSX but the plugin that would make them do
anything (`tailwindcss-animate`) isn't installed there — those panels don't actually animate.
The one piece of *real, working* motion in that codebase is its Tooltip component, built by hand
with `duration: 0.2s, ease: [0.16, 1, 0.3, 1]` (a fast-out, no-overshoot curve) plus a scale/fade/
slide. That's the specific thing worth porting — not a component library, a timing curve.

**What shipped, all in `app/globals.css` plus two small component edits — no new dependency.**
- A new `--ease-snap: cubic-bezier(.16,1,.3,1)` token, scoped to floating/interactive UI
  (menus, tabs, foldouts). Aval's existing reveal/chart animations keep their own easing —
  this doesn't replace them, it sits alongside for a different category of motion.
- **Buttons**: `.icon-button` is now a true circle (was 12px radius on a 39px square);
  `.soft-button`/`.primary-button`/`.wide-button` are now fully pill-shaped (`999px`), matching
  mentari2.0's `rounded-full` control shape. `.primary-button:hover` moved from a hardcoded
  `background: #2a2a28` to `filter: brightness(.9)` — the hardcoded hex was a **latent dark-theme
  bug**, found while touching this rule: in dark mode `--ink` is a light fill with dark
  `--inverse-ink` text, and forcing the hover background to a hardcoded dark gray while the text
  stayed dark would have made hover text nearly unreadable. `filter: brightness()` darkens
  correctly in both themes without a `[data-theme="dark"]` override.
- **Tabs** (`.dialog-tabs button`, `.segmented button`): added a `background`/`box-shadow`/`color`
  transition on `--ease-snap` — these previously snapped instantly between active/inactive.
- **Floating menus** (`.profile-menu`, `.menu-popover`): swapped `menu-in`'s plain `ease` for
  `--ease-snap` and gave the keyframe more travel (`translateY(-5px) scale(.98)` →
  `translateY(-8px) scale(.95)`), closer to mentari2.0's actual Tooltip motion. Their row buttons
  gained a real hover transition (previously instant).
- **Foldouts**: native `<details>`/`<summary>` can't smoothly animate height across browsers
  (the pseudo-element that would allow it, `::details-content`, is Chrome-only so far). Built a
  small controlled `Foldout` component (`app/components/connection-dialog.tsx`) using the
  `grid-template-rows: 0fr → 1fr` technique instead — broadly supported, no library needed —
  and swapped it in for the one existing `<details>` use (the connection dialog's "technical
  reference" disclosure), with a chevron that rotates on `--ease-snap`.
- **Intelligence provider cards** (`app/components/intelligence-settings.tsx`): borrowed
  mentari2.0's semantic "state = shape" cue directly — `.intelligence-provider-card` now renders
  a dashed border until a `connected` class is applied (Aval's own bundled default and any
  provider with a verified connection), then switches to solid, on the same `--ease-snap` timing.

**Deliberately not done.** No new animation dependency (`motion`/Framer Motion) — mentari2.0's
own real motion is hand-rolled CSS/JS, not library-driven, and Aval's existing system is already
consistent hand-rolled CSS; adding a library for one easing curve isn't justified. No structural
"nested chrome" double-panel rebuild of `.menu-popover`/`.profile-menu` — their current single-
layer look (border + blur + shadow) already reads as a refined floating panel; reworking the
DOM for a subtler visual nicety wasn't worth the risk relative to what was actually asked for.
Also noticed but left alone: `guides` copy in `connection-dialog.tsx` promises "Choose the exact
model in Advanced" for every model provider, but no such per-provider model-override field
exists anywhere in the UI or the connect API (only `apiKey` is collected) — a real gap, but a
functional one belonging to the Intelligence *feature* work above, not this aesthetic pass;
flagged here rather than folded in un-asked-for.

**Verification.** `npm run i18n:check`, `tsc --noEmit`, `npm run lint`, `npm run build`, and
`node --test` (56 passing) all clean.

## 2026-09-02 — Closed the flagged gap: per-connection model override

**Context.** The previous entry's dialog copy already promised "Choose the exact model in
Advanced" for every model provider, but no such field existed anywhere — `lib/integrations/
catalog.ts`'s `defaultModel` was hardcoded per provider with no way to override it. Closing
that gap rather than leaving copy that describes a feature that isn't there.

**No new plumbing needed on the backend.** `/api/integrations/connect` already stores
`body.credentials` verbatim as encrypted JSON — it only validates the provider's declared
`credentialFields` (just `apiKey` for every model provider), so an extra `model` key riding
alongside `apiKey` was already safe to store; same for `/verify`, which only ever reads
`credentials.apiKey`. The only real changes: `connection-dialog.tsx` gained an Advanced
`Foldout` (model providers only) with a Model text input, defaulting to the catalog's
`defaultModel` as a placeholder and explaining in a hint that blank means "use the
recommended model"; and `lib/ask-aval/model-router.ts`'s `resolveOverride` now also reads
`credentials.model`, preferring it over `catalogEntry.defaultModel` when both an Anthropic and
an OpenAI-compatible override path resolve the model to call.

**Verification.** `npm run i18n:check`, `tsc --noEmit`, `npm run lint`, `npm run build`, and
`node --test` (56 passing) all clean.
