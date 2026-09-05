# QuickBooks sync worker — design

**Date:** 2026-09-04
**Status:** approved, not yet implemented

## Why

`POST /api/sync` inserts a `sync_runs` row and answers "queued for the provider
worker". There is no provider worker. Nothing has ever pulled a record from a
connected provider, so every dashboard figure in the product comes from sample
data.

This builds the first one. QuickBooks Online is the target because it is the
only provider Aval can reach today without a partner program: OAuth 2.0 is
already wired end to end, Intuit issues free sandbox companies, and the data it
returns — a chart of accounts and journal activity — lands in `gl_accounts` and
`gl_transactions`, which the import layer already handles.

## What already exists

Most of the ingestion half is built. This work is narrower than it first looks.

| Piece | State |
|---|---|
| `POST /api/integrations/connect` | Builds the Intuit authorize URL |
| `GET /api/oauth/callback` | Exchanges the code, encrypts and stores access + refresh tokens, marks the connection `connected` |
| `lib/integrations/crypto.ts` | AES-GCM secret encryption |
| `lib/operations/import-plan.ts` | Pure planner: ordering, external-id reference resolution |
| `lib/operations/import-apply.ts` | Applier: idempotent on `(organizationId, sourceProvider, externalId)`, partial failures counted and returned |
| `sync_runs` table | Has `cursorJson`, `countsJson`, `status`, `error` |
| Cron | `* * * * *` already runs for the agent runtime |

Two gaps in what exists, both of which this work must close:

1. **`realmId` is never captured.** Intuit returns it as a query parameter on
   the callback redirect, not in the token response. Every QBO API call needs
   it in the path, so without it no call is possible. `externalAccountId` is
   currently left null.
2. **Nothing refreshes an integration connection's token.**
   `lib/ask-aval/model-router.ts` refreshes *subscription* tokens; no
   equivalent exists for `integration_connections`. A QBO access token lasts
   one hour, so an unattended cron-driven sync would fail on its second run.

## Architecture

Five pieces, following the pure/impure split the codebase already uses
(`metrics/` against repositories, `import-plan` against `import-apply`).

```
lib/integrations/quickbooks.ts             impure  QBO HTTP: refresh, realmId, queries, CDC
lib/integrations/quickbooks-normalize.ts   PURE    QBO JSON -> ImportBatch. Every mapping rule.
lib/integrations/sync-worker.ts            impure  claim a run, drive it, advance the cursor
app/api/oauth/callback/route.ts            edit    capture realmId into externalAccountId
worker/index.ts                            edit    the minute cron also drains sync runs
```

The worker normalizes nothing and writes no entity rows itself. It calls the
normalizer, hands the resulting batch to the existing `planImport` /
`applyImport`, and records what happened. Every rule with a sharp edge lives in
the pure module, where a `node --test` run can reach it.

## Data flow

```
cron (existing * * * * *)
 └─ claimSyncRun()                 queued -> running, atomic, same predicate shape as claimTask
     ├─ decrypt access token; refresh if expired or expiring within 5 minutes
     ├─ fetch
     │    first run  -> SELECT * FROM Account       (paginated)
     │                  SELECT * FROM JournalEntry  (paginated)
     │    later      -> /cdc?entities=Account,JournalEntry&changedSince=<cursor>
     ├─ normalizeQuickbooks(payload) -> ImportBatch        [pure, tested]
     ├─ planImport(batch) -> applyImport(plan)             [existing, tested]
     └─ write countsJson, advance cursorJson, status = completed
```

## Mapping rules

These are the decisions worth testing, and they all live in
`quickbooks-normalize.ts`.

### Account type

| QBO `AccountType` | Aval `GlAccountType` |
|---|---|
| `Income`, `Other Income` | `income` |
| `Expense`, `Other Expense`, `Cost of Goods Sold` | `operating_expense` |
| `Bank`, `Accounts Receivable`, `Other Current Asset`, `Fixed Asset`, `Other Asset` | `asset` |
| `Accounts Payable`, `Credit Card`, `Other Current Liability`, `Long Term Liability` | `liability` |
| `Equity` | `equity` |

An unrecognized `AccountType` is **rejected and reported**, never guessed into a
default. A misfiled account silently distorts NOI, and a distorted figure that
looks plausible is worse than a row that visibly did not import.

### Amount direction

`profitAndLoss` sums `entry.amountCents` directly into income and expense
totals, so Aval's convention is **positive in the account's natural
direction** — not signed debits and credits. A QBO journal line carries
`DebitAmount` or `CreditAmount` plus a `PostingType`, so:

- income, liability, equity accounts: `credit − debit`
- asset, expense accounts: `debit − credit`

Getting this backwards produces a P&L that is exactly wrong rather than
obviously broken, which is why it is a tested rule rather than an inline
ternary.

### Cents

QBO returns decimal dollars; Aval stores integer cents. Conversion goes through
`decimalToCents` in `lib/finance/money.ts`.

That helper is `Math.round(value * 100)`, which is the shape that classically
loses a cent — but not for this input. Checked against every two-decimal value
from `$0.00` to `$20,000.00`: 2,000,001 conversions, zero mismatches. It fails
only on three-decimal inputs (`1.005` → `100`, not `101`), and QBO returns
currency amounts at two decimals.

So the risk here is not rounding, it is an over-precision value arriving
unnoticed. The normalizer therefore rejects any amount that is not finite or
carries more than two decimal places, and reports it, rather than rounding it
quietly — the same posture as an unrecognized account type.

### External ids

One QBO `JournalEntry` holds many `Line` entries, each with its own
`AccountRef`, so one journal entry becomes N `ImportGlTransaction` rows. Each
needs a stable, unique external id: `` `${JournalEntry.Id}:${Line.Id}` ``. This
is what makes a re-sent entry report as `unchanged` rather than duplicating the
portfolio's activity.

### Trust accounts

`isTrustAccount` defaults to `false`. QBO does not flag trust accounts, and a
name heuristic ("escrow", "deposit") would be guessing about client money.

This is safe rather than lucky: `profitAndLoss` only sums income and expense
types, and a security-deposit account maps to `liability`, so it is already
excluded from the rollup by type. A workspace that needs the distinction marks
the account itself.

## Cursor and incremental sync

`cursorJson` holds `{ changedSince: <ISO 8601> }`.

- **No cursor** — first run. Full `query` for both entities, paginated with
  `STARTPOSITION` / `MAXRESULTS`.
- **Cursor present** — `cdc?entities=Account,JournalEntry&changedSince=...`.

The cursor advances **only on a successful run**. A failed run therefore
re-fetches the same window on its next attempt rather than skipping it: the
import path is idempotent on external id, so re-fetching costs a no-op while
skipping loses data permanently.

## Error handling

| Condition | Behaviour |
|---|---|
| `401` | Refresh once and retry. If the refresh fails, connection → `status: "expired"`, run → `failed` with a message naming reconnection as the fix. |
| `429`, `5xx` | Run → `queued` with backoff, reusing the shape in `lib/agents/retry-policy.ts`. |
| Unknown account type, unparseable line | Row is skipped and counted. The run completes; `countsJson` reports what did not land. |
| Partial apply | `applyImport` already returns per-entity counts and failures. Written to `countsJson`; the run completes. |
| Two workers, one run | The atomic claim predicate means the second matches zero rows and moves on. |

Refresh tokens **rotate on use**, so the new `refresh_token` in a refresh
response must be re-encrypted and stored. Dropping it silently strands the
connection 100 days later, when the old token expires and nobody remembers why.

## Configuration

QBO sandbox and production have different API hosts. A
`QUICKBOOKS_API_BASE_URL` binding selects between them, defaulting to
production. The existing `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET`
are already declared in the catalog and used by the OAuth flow.

## Testing

**Pure normalizer** — `tests/quickbooks-normalize.test.ts`, `node --test`:

- every `AccountType` in the table maps as specified
- an unrecognized type is rejected, not defaulted
- income credit and expense debit both produce positive amounts
- a reversing entry produces the negative of the original
- two-decimal dollar amounts convert exactly
- a three-decimal or non-finite amount is rejected and reported, not rounded
- one journal entry with three lines becomes three rows with distinct ids

**Worker** — `tests/integration/quickbooks-sync.integration.mjs`, on the
existing harness with `fetch` stubbed:

- claim → fetch → normalize → apply → cursor advance, against real SQLite built
  from the project's own migrations
- a second worker cannot claim a running sync
- a `401` refreshes the token, retries, and stores the rotated refresh token
- a failed run leaves the cursor where it was
- re-running the same window imports zero new rows

## Out of scope

- **The dashboard.** QBO has no units, leases, residents, or work orders, so
  occupancy, the leasing funnel and maintenance stay on sample data. NOI and
  rent-collected become derivable from real GL, but wiring that into
  `portfolio_snapshots` is deliberately separate.
- **Other providers.** The adapter contract is not being generalized from a
  single example; the second connector is when its shape becomes knowable.
- **Webhooks.** The catalog declares `webhook: true` for QuickBooks. Polling on
  the existing cron is enough to prove the path, and a webhook has its own
  verification and replay concerns.

## Deliberate limits

**`JournalEntry` is not the whole general ledger.** Most real QBO activity
arrives as `Invoice`, `Payment`, `Bill` and `Deposit`; journal entries are the
adjustments. A workspace synced through this will see a real but incomplete
picture of its books.

The faithful source is the `reports/GeneralLedger` endpoint, which returns
actual GL lines across every transaction type. It is not used here because its
response is a nested columnar report rather than entities, and it cannot be
driven by CDC — incremental sync would become a re-fetched date window.

`JournalEntry` is the right first cut: it proves the entire pipe with real
remote data, incrementally and unattended, and it is honest about covering less
than the full ledger. Widening to the GeneralLedger report is the documented
next step, not a hidden TODO.
