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
- `AnimatedNumber` formats every number via a hardcoded `toLocaleString("en-US", …)`
  regardless of active locale. Left alone in this pass — it's a P1.3-shaped fix (thread the
  real active locale through) — but noted so it isn't lost.
