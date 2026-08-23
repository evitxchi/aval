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
