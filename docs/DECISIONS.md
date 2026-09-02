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
