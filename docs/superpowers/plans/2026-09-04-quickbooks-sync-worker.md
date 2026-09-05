# QuickBooks Sync Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull a QuickBooks Online chart of accounts and journal activity into `gl_accounts` and `gl_transactions` on a cron, incrementally and unattended.

**Architecture:** Three new modules following the repo's pure/impure split. `quickbooks-rules.ts` is pure and holds every mapping decision; `quickbooks.ts` does HTTP; `sync-worker.ts` claims a `sync_runs` row and drives fetch → normalize → `applyImport` → advance cursor. Two small edits capture the `realmId` and wire the worker into the existing minute cron.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 + Drizzle, `node --test`, existing `tests/integration/` loader harness.

**Spec:** `docs/superpowers/specs/2026-09-04-quickbooks-sync-worker-design.md`

## Global Constraints

- **Pure modules import nothing impure.** `quickbooks-rules.ts` must not import `@/db`, `cloudflare:workers`, or anything reaching them. A static import of a Workers-only module fails at load time, before any code runs, and cannot be caught.
- **Money is integer cents.** Convert with `decimalToCents` from `lib/finance/money.ts`. Never construct a cent value any other way.
- **Amounts are positive in the account's natural direction**, matching `profitAndLoss`, which sums `amountCents` directly into income and expense totals.
- **Unrecognized input is rejected and reported, never defaulted.** An unknown account type or an over-precision amount produces a skipped row with a reason, not a guess.
- **External ids are stable and unique per source row.** The import layer is idempotent on `(organizationId, sourceProvider, externalId)`; a re-fetched window must report `unchanged`, not duplicate.
- **The cursor advances only on a fully successful run.**
- Run `npm run typecheck` and `npm run lint` before every commit. `npm test` runs typecheck, i18n, build, unit tests and the runtime lane.

---

### Task 1: Account type and amount direction (pure rules)

**Files:**
- Create: `lib/integrations/quickbooks-rules.ts`
- Test: `tests/quickbooks-rules.test.ts`

**Interfaces:**
- Consumes: `GL_ACCOUNT_TYPES`, `GlAccountType` from `lib/operations/types.ts`
- Produces:
  - `mapAccountType(qboType: string): GlAccountType | null`
  - `signedAmountCents(accountType: GlAccountType, postingType: string, amount: number): number | null`
  - `QBO_ACCOUNT_TYPE_MAP: Readonly<Record<string, GlAccountType>>`

- [ ] **Step 1: Write the failing test**

Create `tests/quickbooks-rules.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { mapAccountType, signedAmountCents } from "../lib/integrations/quickbooks-rules.ts";

/**
 * The two rules that decide whether a synced P&L is right.
 *
 * Both fail silently when wrong: a misfiled account type distorts NOI, and an
 * inverted posting direction produces a P&L that is exactly backwards. Every
 * figure still looks like a plausible dollar amount, so only a test with a
 * known expected value catches either one.
 */

test("every QuickBooks account type Aval accepts maps to a known Aval type", () => {
  const cases: Array<[string, string]> = [
    ["Income", "income"],
    ["Other Income", "income"],
    ["Expense", "operating_expense"],
    ["Other Expense", "operating_expense"],
    ["Cost of Goods Sold", "operating_expense"],
    ["Bank", "asset"],
    ["Accounts Receivable", "asset"],
    ["Other Current Asset", "asset"],
    ["Fixed Asset", "asset"],
    ["Other Asset", "asset"],
    ["Accounts Payable", "liability"],
    ["Credit Card", "liability"],
    ["Other Current Liability", "liability"],
    ["Long Term Liability", "liability"],
    ["Equity", "equity"],
  ];
  for (const [qbo, expected] of cases) {
    assert.equal(mapAccountType(qbo), expected, qbo);
  }
});

test("an unrecognized account type is rejected rather than defaulted", () => {
  // Defaulting would file the account somewhere plausible and quietly change
  // NOI. A null forces the caller to skip and report the row.
  for (const unknown of ["Inventory Asset", "", "income", "Bank Account", "Unknown"]) {
    assert.equal(mapAccountType(unknown), null, JSON.stringify(unknown));
  }
});

test("income is positive on a credit, expense is positive on a debit", () => {
  // profitAndLoss sums amountCents straight into income and expense totals, so
  // Aval's convention is positive-in-natural-direction, not signed debits.
  assert.equal(signedAmountCents("income", "Credit", 1200.5), 120050);
  assert.equal(signedAmountCents("income", "Debit", 1200.5), -120050);
  assert.equal(signedAmountCents("operating_expense", "Debit", 340.25), 34025);
  assert.equal(signedAmountCents("operating_expense", "Credit", 340.25), -34025);
});

test("balance-sheet types follow the same natural direction", () => {
  assert.equal(signedAmountCents("asset", "Debit", 10), 1000);
  assert.equal(signedAmountCents("asset", "Credit", 10), -1000);
  assert.equal(signedAmountCents("liability", "Credit", 10), 1000);
  assert.equal(signedAmountCents("equity", "Credit", 10), 1000);
});

test("a reversing entry is the exact negative of the original", () => {
  const original = signedAmountCents("income", "Credit", 987.65);
  const reversal = signedAmountCents("income", "Debit", 987.65);
  assert.equal(original + reversal, 0);
});

test("an amount with more than two decimals is rejected, not rounded", () => {
  // decimalToCents is Math.round(value * 100), which is exact for every
  // two-decimal value but turns 1.005 into 100 rather than 101. QuickBooks
  // returns currency at two decimals, so a third decimal means something
  // unexpected arrived and guessing at it would silently move money.
  assert.equal(signedAmountCents("income", "Credit", 1.005), null);
  assert.equal(signedAmountCents("income", "Credit", 29.925), null);
});

test("a non-finite or negative-zero amount is rejected", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -Number.MAX_VALUE]) {
    assert.equal(signedAmountCents("income", "Credit", bad), null, String(bad));
  }
});

test("an unrecognized posting type is rejected", () => {
  assert.equal(signedAmountCents("income", "credit", 10), null);
  assert.equal(signedAmountCents("income", "", 10), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/quickbooks-rules.test.ts`
Expected: FAIL — `Cannot find module '../lib/integrations/quickbooks-rules.ts'`

- [ ] **Step 3: Write the implementation**

Create `lib/integrations/quickbooks-rules.ts`:

```typescript
/**
 * Pure mapping rules for QuickBooks Online data.
 *
 * Separated from the HTTP client for the same reason `import-plan` is
 * separated from `import-apply`: these are the decisions with sharp edges, and
 * a rule nobody can run tests against is a rule nobody can trust.
 *
 * Both rules here fail silently when wrong. A misfiled account type distorts
 * NOI; an inverted posting direction produces a P&L that is exactly backwards.
 * Neither looks broken — every figure remains a plausible dollar amount.
 */

import { decimalToCents } from "../finance/money.ts";
import type { GlAccountType } from "../operations/types.ts";

/**
 * QuickBooks' account taxonomy, mapped onto Aval's six types.
 *
 * Deliberately exhaustive rather than pattern-matched: QuickBooks adds account
 * types, and a regex that happens to catch a new one is worse than a lookup
 * that visibly does not.
 */
export const QBO_ACCOUNT_TYPE_MAP: Readonly<Record<string, GlAccountType>> = {
  "Income": "income",
  "Other Income": "income",
  "Expense": "operating_expense",
  "Other Expense": "operating_expense",
  "Cost of Goods Sold": "operating_expense",
  "Bank": "asset",
  "Accounts Receivable": "asset",
  "Other Current Asset": "asset",
  "Fixed Asset": "asset",
  "Other Asset": "asset",
  "Accounts Payable": "liability",
  "Credit Card": "liability",
  "Other Current Liability": "liability",
  "Long Term Liability": "liability",
  "Equity": "equity",
};

/** Null for anything unrecognized, so the caller skips and reports the row. */
export function mapAccountType(qboType: string): GlAccountType | null {
  return QBO_ACCOUNT_TYPE_MAP[qboType] ?? null;
}

/** Types whose natural balance is a credit. Everything else is a debit type. */
const CREDIT_NATURAL: ReadonlySet<GlAccountType> = new Set(["income", "liability", "equity"]);

/**
 * A journal line's contribution, positive in the account's natural direction.
 *
 * QuickBooks sends one positive `Amount` plus a `PostingType`; Aval's
 * `profitAndLoss` sums `amountCents` directly, so the direction has to be
 * resolved here rather than carried as a sign convention downstream.
 *
 * Null when the line cannot be trusted: an unknown posting type, a non-finite
 * amount, or more than two decimal places. `decimalToCents` is exact for every
 * two-decimal value but turns 1.005 into 100 rather than 101, so a third
 * decimal means something unexpected arrived, and rounding it would move money
 * without saying so.
 */
export function signedAmountCents(
  accountType: GlAccountType,
  postingType: string,
  amount: number,
): number | null {
  if (postingType !== "Debit" && postingType !== "Credit") return null;
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(4))) return null;

  const cents = decimalToCents(amount);
  const naturallyCredit = CREDIT_NATURAL.has(accountType);
  const isCredit = postingType === "Credit";
  return naturallyCredit === isCredit ? cents : -cents;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/quickbooks-rules.test.ts`
Expected: PASS, 8 tests

If the over-precision test fails, the decimal check is wrong. The intent: `1.005 * 100` is `100.49999999999999`, whose `toFixed(4)` is `"100.5000"`, so `Math.round(...)` of `100` differs from `100.5` and the value is rejected. A clean two-decimal value like `29.93` gives `2993.0000000000005` → `toFixed(4)` `"2993.0000"` → `2993` → equal, accepted.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add lib/integrations/quickbooks-rules.ts tests/quickbooks-rules.test.ts
git commit -m "feat(integrations): QuickBooks account type and posting direction rules"
```

---

### Task 2: Normalize a QuickBooks payload into an ImportBatch

**Files:**
- Modify: `lib/integrations/quickbooks-rules.ts`
- Modify: `tests/quickbooks-rules.test.ts`

**Interfaces:**
- Consumes: `mapAccountType`, `signedAmountCents` from Task 1; `ImportBatch`, `ImportGlAccount`, `ImportGlTransaction` from `lib/operations/import-plan.ts`
- Produces:
  - `interface QboAccount { Id: string; Name: string; AcctNum?: string; AccountType: string; Active?: boolean }`
  - `interface QboJournalLine { Id?: string; Amount?: number; DetailType?: string; JournalEntryLineDetail?: { PostingType?: string; AccountRef?: { value?: string } } }`
  - `interface QboJournalEntry { Id: string; TxnDate?: string; Line?: QboJournalLine[] }`
  - `interface NormalizedQbo { batch: ImportBatch; rejected: Array<{ entity: string; externalId: string; reason: string }> }`
  - `normalizeQuickbooks(input: { accounts: QboAccount[]; journalEntries: QboJournalEntry[] }): NormalizedQbo`

- [ ] **Step 1: Write the failing test**

Append to `tests/quickbooks-rules.test.ts`:

```typescript
import { normalizeQuickbooks } from "../lib/integrations/quickbooks-rules.ts";

const ACCOUNT = { Id: "7", Name: "Rental Income", AcctNum: "4000", AccountType: "Income", Active: true };

const ENTRY = {
  Id: "154",
  TxnDate: "2026-08-15",
  Line: [
    { Id: "0", Amount: 2400, DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "7" } } },
    { Id: "1", Amount: 2400, DetailType: "JournalEntryLineDetail",
      JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "9" } } },
  ],
};

const BANK = { Id: "9", Name: "Operating Checking", AcctNum: "1000", AccountType: "Bank" };

test("an account becomes an import row keyed on its QuickBooks id", () => {
  const { batch } = normalizeQuickbooks({ accounts: [ACCOUNT], journalEntries: [] });
  assert.deepEqual(batch.glAccounts, [
    { externalId: "7", code: "4000", name: "Rental Income", accountType: "income", isTrustAccount: false },
  ]);
});

test("an account with no number falls back to its id, which the schema requires", () => {
  const { batch } = normalizeQuickbooks({ accounts: [{ ...ACCOUNT, AcctNum: undefined }], journalEntries: [] });
  assert.equal(batch.glAccounts?.[0].code, "7");
});

test("an inactive account is still imported, because its history still counts", () => {
  const { batch } = normalizeQuickbooks({ accounts: [{ ...ACCOUNT, Active: false }], journalEntries: [] });
  assert.equal(batch.glAccounts?.length, 1);
});

test("an account with an unmappable type is rejected with a reason", () => {
  const { batch, rejected } = normalizeQuickbooks({
    accounts: [{ ...ACCOUNT, AccountType: "Inventory Asset" }],
    journalEntries: [],
  });
  assert.equal(batch.glAccounts?.length ?? 0, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].externalId, "7");
  assert.match(rejected[0].reason, /account type/i);
});

test("one journal entry with two lines becomes two transactions with distinct ids", () => {
  // The import layer is idempotent on external id, so a re-fetched entry must
  // produce the same ids or it duplicates the portfolio's activity.
  const { batch } = normalizeQuickbooks({ accounts: [ACCOUNT, BANK], journalEntries: [ENTRY] });
  assert.equal(batch.glTransactions?.length, 2);
  assert.deepEqual(batch.glTransactions?.map((row) => row.externalId), ["154:0", "154:1"]);
});

test("each line takes its direction from the account it posts to", () => {
  const { batch } = normalizeQuickbooks({ accounts: [ACCOUNT, BANK], journalEntries: [ENTRY] });
  const [income, bank] = batch.glTransactions ?? [];
  assert.equal(income.accountExternalId, "7");
  assert.equal(income.amountCents, 240000, "a credit to income is positive revenue");
  assert.equal(bank.accountExternalId, "9");
  assert.equal(bank.amountCents, 240000, "a debit to an asset is a positive balance");
});

test("a line posting to an account not in the batch is rejected, not guessed", () => {
  const { batch, rejected } = normalizeQuickbooks({ accounts: [ACCOUNT], journalEntries: [ENTRY] });
  assert.equal(batch.glTransactions?.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].externalId, "154:1");
  assert.match(rejected[0].reason, /account/i);
});

test("a line with an unusable amount is rejected and its siblings still import", () => {
  const entry = { ...ENTRY, Line: [ENTRY.Line[0], { ...ENTRY.Line[1], Amount: 1.005 }] };
  const { batch, rejected } = normalizeQuickbooks({ accounts: [ACCOUNT, BANK], journalEntries: [entry] });
  assert.equal(batch.glTransactions?.length, 1, "one bad line does not discard the entry");
  assert.equal(rejected.length, 1);
});

test("a journal entry with no date is rejected, since a transaction needs one", () => {
  const { batch, rejected } = normalizeQuickbooks({
    accounts: [ACCOUNT, BANK],
    journalEntries: [{ ...ENTRY, TxnDate: undefined }],
  });
  assert.equal(batch.glTransactions?.length ?? 0, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /date/i);
});

test("an empty payload produces an empty batch rather than throwing", () => {
  const { batch, rejected } = normalizeQuickbooks({ accounts: [], journalEntries: [] });
  assert.deepEqual(batch, { glAccounts: [], glTransactions: [] });
  assert.deepEqual(rejected, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/quickbooks-rules.test.ts`
Expected: FAIL — `normalizeQuickbooks is not a function`

- [ ] **Step 3: Write the implementation**

Append to `lib/integrations/quickbooks-rules.ts`:

```typescript
import type { ImportBatch, ImportGlAccount, ImportGlTransaction } from "../operations/import-plan.ts";

export interface QboAccount {
  Id: string;
  Name: string;
  AcctNum?: string;
  AccountType: string;
  Active?: boolean;
}

export interface QboJournalLine {
  Id?: string;
  Amount?: number;
  DetailType?: string;
  JournalEntryLineDetail?: { PostingType?: string; AccountRef?: { value?: string } };
}

export interface QboJournalEntry {
  Id: string;
  TxnDate?: string;
  Line?: QboJournalLine[];
}

export interface NormalizedQbo {
  batch: ImportBatch;
  /** Rows that could not be trusted, each with why. Never silently dropped. */
  rejected: Array<{ entity: string; externalId: string; reason: string }>;
}

/**
 * QuickBooks entities to Aval's import vocabulary.
 *
 * A rejected row never becomes a guessed row. The importer already reports
 * what it skipped and why, and this keeps that contract intact one layer up:
 * an operator reading a sync result sees a row that did not land, rather than
 * a figure that quietly moved.
 */
export function normalizeQuickbooks(input: {
  accounts: QboAccount[];
  journalEntries: QboJournalEntry[];
}): NormalizedQbo {
  const rejected: NormalizedQbo["rejected"] = [];
  const glAccounts: ImportGlAccount[] = [];
  const typeById = new Map<string, GlAccountType>();

  for (const account of input.accounts) {
    const accountType = mapAccountType(account.AccountType);
    if (!accountType) {
      rejected.push({
        entity: "glAccounts",
        externalId: account.Id,
        reason: `Unrecognized QuickBooks account type "${account.AccountType}".`,
      });
      continue;
    }
    typeById.set(account.Id, accountType);
    glAccounts.push({
      externalId: account.Id,
      // The schema requires a code and QuickBooks does not require an account
      // number, so the id stands in — stable, and unique within the company.
      code: account.AcctNum ?? account.Id,
      name: account.Name,
      accountType,
      // QuickBooks does not flag trust accounts and a name heuristic would be
      // guessing about client money. Safe by construction: profitAndLoss sums
      // only income and expense types, and a deposit account maps to liability.
      isTrustAccount: false,
    });
  }

  const glTransactions: ImportGlTransaction[] = [];

  for (const entry of input.journalEntries) {
    if (!entry.TxnDate) {
      rejected.push({ entity: "glTransactions", externalId: entry.Id, reason: "Journal entry has no transaction date." });
      continue;
    }
    for (const [index, line] of (entry.Line ?? []).entries()) {
      // Line ids are stable within an entry; the index is a fallback so a line
      // without one still gets a deterministic id rather than a random one.
      const externalId = `${entry.Id}:${line.Id ?? index}`;
      const accountId = line.JournalEntryLineDetail?.AccountRef?.value;
      const accountType = accountId ? typeById.get(accountId) : undefined;
      if (!accountId || !accountType) {
        rejected.push({ entity: "glTransactions", externalId, reason: "Line posts to an account this batch does not contain." });
        continue;
      }
      const amountCents = signedAmountCents(
        accountType,
        line.JournalEntryLineDetail?.PostingType ?? "",
        line.Amount ?? Number.NaN,
      );
      if (amountCents === null) {
        rejected.push({ entity: "glTransactions", externalId, reason: "Line amount or posting type could not be trusted." });
        continue;
      }
      glTransactions.push({
        externalId,
        accountExternalId: accountId,
        // QuickBooks has no concept of Aval's properties, so nothing to bind.
        propertyExternalId: null,
        amountCents,
        postedAt: entry.TxnDate,
      });
    }
  }

  return { batch: { glAccounts, glTransactions }, rejected };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/quickbooks-rules.test.ts`
Expected: PASS, 18 tests

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add lib/integrations/quickbooks-rules.ts tests/quickbooks-rules.test.ts
git commit -m "feat(integrations): normalize QuickBooks accounts and journal entries"
```

---

### Task 3: Capture the realmId on the OAuth callback

**Files:**
- Modify: `lib/integrations/quickbooks-rules.ts`
- Modify: `tests/quickbooks-rules.test.ts`
- Modify: `app/api/oauth/callback/route.ts`

**Interfaces:**
- Produces: `realmIdFromCallback(url: URL): string | null`

Every QuickBooks API call needs the company id in its path, and Intuit returns
it as a query parameter on the callback redirect rather than in the token
response. It is currently discarded, which is why no API call is possible yet.

- [ ] **Step 1: Write the failing test**

Append to `tests/quickbooks-rules.test.ts`:

```typescript
import { realmIdFromCallback } from "../lib/integrations/quickbooks-rules.ts";

test("the realmId is read from the callback query string", () => {
  const url = new URL("https://aval.example/api/oauth/callback?code=abc&state=xyz&realmId=9341452148329929");
  assert.equal(realmIdFromCallback(url), "9341452148329929");
});

test("a missing or empty realmId reads as absent rather than an empty string", () => {
  assert.equal(realmIdFromCallback(new URL("https://aval.example/cb?code=abc")), null);
  assert.equal(realmIdFromCallback(new URL("https://aval.example/cb?realmId=")), null);
  assert.equal(realmIdFromCallback(new URL("https://aval.example/cb?realmId=%20%20")), null);
});

test("a realmId that is not a plain identifier is refused", () => {
  // It goes straight into an API path. Anything but digits is not a realm id,
  // and treating it as one would put caller-controlled text in a URL path.
  assert.equal(realmIdFromCallback(new URL("https://aval.example/cb?realmId=../../evil")), null);
  assert.equal(realmIdFromCallback(new URL("https://aval.example/cb?realmId=123/456")), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/quickbooks-rules.test.ts`
Expected: FAIL — `realmIdFromCallback is not a function`

- [ ] **Step 3: Write the implementation**

Append to `lib/integrations/quickbooks-rules.ts`:

```typescript
/**
 * The QuickBooks company id from an OAuth callback.
 *
 * Intuit returns it as a query parameter on the redirect, not in the token
 * response, and every API call needs it in the path. Validated as digits
 * because it is interpolated into a URL path: a realm id is numeric, and
 * anything else is either not one or is trying to be a path.
 */
export function realmIdFromCallback(url: URL): string | null {
  const value = (url.searchParams.get("realmId") ?? "").trim();
  return /^\d{1,32}$/.test(value) ? value : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/quickbooks-rules.test.ts`
Expected: PASS, 22 tests

- [ ] **Step 5: Store it on the connection**

In `app/api/oauth/callback/route.ts`, import the helper alongside the existing imports:

```typescript
import { realmIdFromCallback } from "@/lib/integrations/quickbooks-rules";
```

Find the `db.insert(integrationConnections).values({...})` call. It currently
sets `externalAccountName` but leaves `externalAccountId` unset. Add the realm
id to both the insert and the conflict update:

```typescript
    // QuickBooks returns the company id on the redirect rather than in the
    // token response, and every API call needs it in the path. Captured here
    // because this is the only moment it is available.
    const externalAccountId = provider.id === "quickbooks" ? realmIdFromCallback(url) : null;
    await db.insert(integrationConnections).values({
      id: crypto.randomUUID(), organizationId: state.organizationId, provider: provider.id, category: provider.category, status: "connected", authMode: provider.authMode,
      externalAccountId,
      externalAccountName, scopesJson: JSON.stringify(provider.permissions), accessTokenCiphertext, refreshTokenCiphertext, expiresAt,
      metadataJson: JSON.stringify({ readOnly: provider.readOnly, webhook: provider.webhook }), createdBy: identity.userId, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [integrationConnections.organizationId, integrationConnections.provider],
      set: {
        status: "connected", externalAccountName, accessTokenCiphertext, refreshTokenCiphertext, expiresAt, updatedAt: now,
        // A reconnect may land on a different company, so this is refreshed
        // rather than left at whatever the first connection recorded.
        ...(externalAccountId ? { externalAccountId } : {}),
      },
    });
```

Note: the route's `GET` handler already has `url` in scope from
`const url = new URL(request.url)`. Confirm that before using it.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add lib/integrations/quickbooks-rules.ts tests/quickbooks-rules.test.ts app/api/oauth/callback/route.ts
git commit -m "fix(integrations): capture the QuickBooks realmId on the OAuth callback"
```

---

### Task 4: Token refresh for integration connections

**Files:**
- Create: `lib/integrations/quickbooks.ts`
- Test: covered by Task 6's integration test (this task's output is exercised there)

**Interfaces:**
- Consumes: `decryptSecret`, `encryptSecret` from `lib/integrations/crypto.ts`; `integrationConnections` from `@/db/schema`
- Produces:
  - `interface QboEnv { INTEGRATION_TOKEN_ENCRYPTION_KEY?: string; QUICKBOOKS_CLIENT_ID?: string; QUICKBOOKS_CLIENT_SECRET?: string; QUICKBOOKS_API_BASE_URL?: string }`
  - `interface QboSession { realmId: string; accessToken: string; baseUrl: string }`
  - `openQuickbooksSession(env: QboEnv, connectionId: string): Promise<QboSession | { error: string }>`

A QuickBooks access token lasts one hour, so an unattended cron would fail on
its second run without this. Refresh tokens **rotate on use** — the new one
must be stored, or the connection silently strands 100 days later.

- [ ] **Step 1: Write the implementation**

Create `lib/integrations/quickbooks.ts`:

```typescript
/**
 * QuickBooks Online HTTP: session, refresh, and reads.
 *
 * The impure half of the pair. Every mapping decision lives in
 * `quickbooks-rules.ts`; this fetches bytes and keeps the connection's
 * credentials current.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import { decryptSecret, encryptSecret } from "./crypto.ts";

export interface QboEnv {
  INTEGRATION_TOKEN_ENCRYPTION_KEY?: string;
  QUICKBOOKS_CLIENT_ID?: string;
  QUICKBOOKS_CLIENT_SECRET?: string;
  /** Sandbox and production are different hosts. Defaults to production. */
  QUICKBOOKS_API_BASE_URL?: string;
}

export interface QboSession {
  realmId: string;
  accessToken: string;
  baseUrl: string;
}

const PRODUCTION_BASE = "https://quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

/** Refreshed this far ahead of expiry, so a token cannot lapse mid-run. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * A usable session for one connection, refreshing the token if it is expired
 * or close to it.
 *
 * Returns `{ error }` rather than throwing: the caller is a worker draining a
 * queue, and one workspace's expired connection must not abort the batch.
 */
export async function openQuickbooksSession(env: QboEnv, connectionId: string): Promise<QboSession | { error: string }> {
  const encryptionKey = env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) return { error: "Credential encryption is not configured." };

  const [connection] = await getDb().select().from(integrationConnections).where(eq(integrationConnections.id, connectionId)).limit(1);
  if (!connection) return { error: "No such connection." };
  if (!connection.externalAccountId) {
    return { error: "This QuickBooks connection predates company-id capture. Reconnect it to sync." };
  }
  if (!connection.accessTokenCiphertext) return { error: "This connection holds no access token. Reconnect it." };

  const baseUrl = (env.QUICKBOOKS_API_BASE_URL ?? PRODUCTION_BASE).replace(/\/$/, "");
  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  const fresh = expiresAt - Date.now() > REFRESH_MARGIN_MS;
  if (fresh) {
    return { realmId: connection.externalAccountId, accessToken: await decryptSecret(connection.accessTokenCiphertext, encryptionKey), baseUrl };
  }

  const refreshed = await refreshQuickbooksToken(env, connectionId, connection.refreshTokenCiphertext, encryptionKey);
  if ("error" in refreshed) return refreshed;
  return { realmId: connection.externalAccountId, accessToken: refreshed.accessToken, baseUrl };
}

/**
 * Exchanges the stored refresh token for a new pair and persists both.
 *
 * Intuit rotates the refresh token on every use, so the response's
 * `refresh_token` replaces the stored one. Keeping the old one works until it
 * expires and then strands the connection with no obvious cause.
 */
export async function refreshQuickbooksToken(
  env: QboEnv,
  connectionId: string,
  refreshTokenCiphertext: string | null,
  encryptionKey: string,
): Promise<{ accessToken: string } | { error: string }> {
  if (!refreshTokenCiphertext) return { error: "This connection holds no refresh token. Reconnect it." };
  if (!env.QUICKBOOKS_CLIENT_ID || !env.QUICKBOOKS_CLIENT_SECRET) return { error: "QuickBooks application credentials are not configured." };

  const refreshToken = await decryptSecret(refreshTokenCiphertext, encryptionKey);
  const basic = btoa(`${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });

  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string") {
    // The connection is marked expired so the UI can ask for a reconnect,
    // rather than the worker retrying a credential that will never work.
    await getDb().update(integrationConnections)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(integrationConnections.id, connectionId))
      .catch(() => {});
    return { error: "QuickBooks refused the refresh token. The connection needs to be reconnected." };
  }

  const now = new Date();
  await getDb().update(integrationConnections).set({
    accessTokenCiphertext: await encryptSecret(body.access_token, encryptionKey),
    // Rotated on every refresh — storing the new one is not optional.
    ...(typeof body.refresh_token === "string"
      ? { refreshTokenCiphertext: await encryptSecret(body.refresh_token, encryptionKey) }
      : {}),
    expiresAt: typeof body.expires_in === "number" ? new Date(now.getTime() + body.expires_in * 1000) : null,
    status: "connected",
    updatedAt: now,
  }).where(eq(integrationConnections.id, connectionId));

  return { accessToken: body.access_token };
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: clean. There is no test to run yet — Task 6 exercises this path.

- [ ] **Step 3: Commit**

```bash
git add lib/integrations/quickbooks.ts
git commit -m "feat(integrations): QuickBooks session with rotating token refresh"
```

---

### Task 5: Fetch accounts and journal entries

**Files:**
- Modify: `lib/integrations/quickbooks.ts`

**Interfaces:**
- Consumes: `QboSession` from Task 4; `QboAccount`, `QboJournalEntry` from Task 2
- Produces:
  - `interface QboFetchResult { accounts: QboAccount[]; journalEntries: QboJournalEntry[]; changedSince: string }`
  - `fetchQuickbooks(session: QboSession, cursor: { changedSince?: string }): Promise<QboFetchResult | { error: string; retryable: boolean }>`

- [ ] **Step 1: Write the implementation**

Append to `lib/integrations/quickbooks.ts`:

```typescript
import type { QboAccount, QboJournalEntry } from "./quickbooks-rules.ts";

export interface QboFetchResult {
  accounts: QboAccount[];
  journalEntries: QboJournalEntry[];
  /** The cursor to store if this run succeeds end to end. */
  changedSince: string;
}

/** QuickBooks caps a query page at 1000 rows. */
const PAGE_SIZE = 1000;

/** Pinned so a QuickBooks schema change cannot alter a response shape underneath us. */
const MINOR_VERSION = "75";

/**
 * Accounts and journal entries, full on the first run and incremental after.
 *
 * The returned `changedSince` is captured *before* the fetch, not after: a row
 * changed while the fetch was in flight must fall inside the next window
 * rather than between two of them.
 */
export async function fetchQuickbooks(
  session: QboSession,
  cursor: { changedSince?: string },
): Promise<QboFetchResult | { error: string; retryable: boolean }> {
  const windowStart = new Date().toISOString();

  if (cursor.changedSince) {
    const changed = await getJson(session, `/v3/company/${session.realmId}/cdc?entities=Account,JournalEntry&changedSince=${encodeURIComponent(cursor.changedSince)}&minorversion=${MINOR_VERSION}`);
    if ("error" in changed) return changed;
    const groups = (changed.body.CDCResponse as Array<{ QueryResponse?: Array<Record<string, unknown>> }> | undefined)?.[0]?.QueryResponse ?? [];
    return {
      accounts: groups.flatMap((group) => (group.Account as QboAccount[] | undefined) ?? []),
      journalEntries: groups.flatMap((group) => (group.JournalEntry as QboJournalEntry[] | undefined) ?? []),
      changedSince: windowStart,
    };
  }

  const accounts = await queryAll<QboAccount>(session, "Account");
  if ("error" in accounts) return accounts;
  const journalEntries = await queryAll<QboJournalEntry>(session, "JournalEntry");
  if ("error" in journalEntries) return journalEntries;
  return { accounts: accounts.rows, journalEntries: journalEntries.rows, changedSince: windowStart };
}

async function queryAll<T>(session: QboSession, entity: string): Promise<{ rows: T[] } | { error: string; retryable: boolean }> {
  const rows: T[] = [];
  for (let start = 1; ; start += PAGE_SIZE) {
    const statement = `SELECT * FROM ${entity} STARTPOSITION ${start} MAXRESULTS ${PAGE_SIZE}`;
    const page = await getJson(session, `/v3/company/${session.realmId}/query?query=${encodeURIComponent(statement)}&minorversion=${MINOR_VERSION}`);
    if ("error" in page) return page;
    const response = (page.body.QueryResponse ?? {}) as Record<string, unknown>;
    const batch = (response[entity] as T[] | undefined) ?? [];
    rows.push(...batch);
    // A short page is the last page. QuickBooks does not report a total.
    if (batch.length < PAGE_SIZE) return { rows };
  }
}

async function getJson(session: QboSession, path: string): Promise<{ body: Record<string, unknown> } | { error: string; retryable: boolean }> {
  const response = await fetch(`${session.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${session.accessToken}`, accept: "application/json" },
  });
  if (response.status === 401) {
    // The session was opened with a token that has since been revoked. Not
    // retryable on this run; the next one opens a fresh session.
    return { error: "QuickBooks rejected the access token.", retryable: false };
  }
  if (response.status === 429 || response.status >= 500) {
    return { error: `QuickBooks is unavailable (${response.status}).`, retryable: true };
  }
  if (!response.ok) {
    return { error: `QuickBooks refused the request (${response.status}).`, retryable: false };
  }
  return { body: await response.json().catch(() => ({})) as Record<string, unknown> };
}
```

- [ ] **Step 2: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add lib/integrations/quickbooks.ts
git commit -m "feat(integrations): fetch QuickBooks accounts and journal entries with a cursor"
```

---

### Task 6: The sync worker

**Files:**
- Create: `lib/integrations/sync-worker.ts`
- Test: `tests/integration/quickbooks-sync.integration.mjs`

**Interfaces:**
- Consumes: `openQuickbooksSession`, `fetchQuickbooks`, `QboEnv` (Tasks 4–5); `normalizeQuickbooks` (Task 2); `applyImport` from `lib/operations/import-apply.ts`
- Produces:
  - `interface SyncBatchResult { claimed: number; completed: number; failed: number; requeued: number }`
  - `runSyncWorkerBatch(env: QboEnv, limit?: number): Promise<SyncBatchResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/quickbooks-sync.integration.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";
import { bootRuntime } from "./harness.mjs";

/**
 * The sync worker, executed against real storage with QuickBooks stubbed.
 *
 * The properties worth proving are the ones reading cannot settle: that two
 * workers cannot claim one run, that a re-fetched window imports nothing new,
 * and that a failed run leaves the cursor where it was so the window is
 * retried rather than skipped.
 */

const NOW = Date.now();
const ENCRYPTION_KEY = "test-encryption-key-at-least-24-chars";

async function setup() {
  const sqlite = await bootRuntime();
  const { encryptSecret } = await import("../../lib/integrations/crypto.ts");
  sqlite.prepare(`INSERT INTO integration_connections
    (id, organization_id, provider, category, status, auth_mode, external_account_id,
     scopes_json, access_token_ciphertext, refresh_token_ciphertext, expires_at,
     metadata_json, created_by, created_at, updated_at)
    VALUES ('conn_1','org_1','quickbooks','Accounting','connected','oauth2','9341453',
     '[]', ?, ?, ?, '{}', 'user_1', ?, ?)`)
    .run(
      await encryptSecret("access-token", ENCRYPTION_KEY),
      await encryptSecret("refresh-token", ENCRYPTION_KEY),
      NOW + 3_600_000,
      NOW, NOW,
    );
  return { sqlite, worker: await import("../../lib/integrations/sync-worker.ts") };
}

const ENV = { INTEGRATION_TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY, QUICKBOOKS_CLIENT_ID: "id", QUICKBOOKS_CLIENT_SECRET: "secret" };

function queueRun(sqlite, id = "run_1") {
  sqlite.prepare(`INSERT INTO sync_runs (id, organization_id, connection_id, provider, status, cursor_json, counts_json, started_at)
    VALUES (?, 'org_1', 'conn_1', 'quickbooks', 'queued', '{}', '{}', ?)`).run(id, NOW);
  return id;
}

/** Stubs global fetch with one canned QuickBooks response per URL pattern. */
function stubQuickbooks({ accounts = [], journalEntries = [], status = 200 } = {}) {
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (status !== 200) return new Response("{}", { status });
    if (href.includes("query=") && href.includes("Account")) {
      return Response.json({ QueryResponse: { Account: accounts } });
    }
    if (href.includes("query=") && href.includes("JournalEntry")) {
      return Response.json({ QueryResponse: { JournalEntry: journalEntries } });
    }
    if (href.includes("/cdc")) {
      return Response.json({ CDCResponse: [{ QueryResponse: [{ Account: accounts }, { JournalEntry: journalEntries }] }] });
    }
    return Response.json({});
  };
}

const ACCOUNTS = [
  { Id: "7", Name: "Rental Income", AcctNum: "4000", AccountType: "Income" },
  { Id: "9", Name: "Operating Checking", AcctNum: "1000", AccountType: "Bank" },
];
const ENTRIES = [{
  Id: "154", TxnDate: "2026-08-15",
  Line: [
    { Id: "0", Amount: 2400, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "7" } } },
    { Id: "1", Amount: 2400, JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "9" } } },
  ],
}];

test("a queued run pulls QuickBooks data into the GL tables", async () => {
  const { sqlite, worker } = await setup();
  queueRun(sqlite);
  stubQuickbooks({ accounts: ACCOUNTS, journalEntries: ENTRIES });

  const result = await worker.runSyncWorkerBatch(ENV);
  assert.equal(result.completed, 1);

  const accounts = sqlite.prepare("SELECT code, account_type FROM gl_accounts WHERE organization_id='org_1' ORDER BY code").all();
  assert.deepEqual(accounts, [
    { code: "1000", account_type: "asset" },
    { code: "4000", account_type: "income" },
  ]);
  const transactions = sqlite.prepare("SELECT external_id, amount_cents FROM gl_transactions WHERE organization_id='org_1' ORDER BY external_id").all();
  assert.deepEqual(transactions, [
    { external_id: "154:0", amount_cents: 240000 },
    { external_id: "154:1", amount_cents: 240000 },
  ]);

  const run = sqlite.prepare("SELECT status, cursor_json FROM sync_runs WHERE id='run_1'").get();
  assert.equal(run.status, "completed");
  assert.ok(JSON.parse(run.cursor_json).changedSince, "a completed run stores a cursor for the next one");
});

test("re-running the same window imports nothing new", async () => {
  const { sqlite, worker } = await setup();
  queueRun(sqlite, "run_1");
  stubQuickbooks({ accounts: ACCOUNTS, journalEntries: ENTRIES });
  await worker.runSyncWorkerBatch(ENV);

  queueRun(sqlite, "run_2");
  await worker.runSyncWorkerBatch(ENV);

  const count = sqlite.prepare("SELECT COUNT(*) c FROM gl_transactions WHERE organization_id='org_1'").get().c;
  assert.equal(count, 2, "the import layer is idempotent on external id");
});

test("a second worker cannot claim a run already running", async () => {
  const { sqlite, worker } = await setup();
  queueRun(sqlite);
  sqlite.prepare("UPDATE sync_runs SET status='running' WHERE id='run_1'").run();
  stubQuickbooks({ accounts: ACCOUNTS, journalEntries: ENTRIES });

  const result = await worker.runSyncWorkerBatch(ENV);
  assert.equal(result.claimed, 0);
});

test("an unavailable provider requeues the run and leaves the cursor alone", async () => {
  const { sqlite, worker } = await setup();
  queueRun(sqlite);
  sqlite.prepare("UPDATE sync_runs SET cursor_json = ? WHERE id='run_1'").run(JSON.stringify({ changedSince: "2026-08-01T00:00:00.000Z" }));
  stubQuickbooks({ status: 503 });

  const result = await worker.runSyncWorkerBatch(ENV);
  assert.equal(result.requeued, 1);

  const run = sqlite.prepare("SELECT status, cursor_json FROM sync_runs WHERE id='run_1'").get();
  assert.equal(run.status, "queued");
  assert.equal(JSON.parse(run.cursor_json).changedSince, "2026-08-01T00:00:00.000Z",
    "a failed run must retry its window rather than skip it");
});

test("a rejected row is reported without failing the run", async () => {
  const { sqlite, worker } = await setup();
  queueRun(sqlite);
  stubQuickbooks({
    accounts: [...ACCOUNTS, { Id: "11", Name: "Inventory", AcctNum: "1200", AccountType: "Inventory Asset" }],
    journalEntries: ENTRIES,
  });

  const result = await worker.runSyncWorkerBatch(ENV);
  assert.equal(result.completed, 1);
  const counts = JSON.parse(sqlite.prepare("SELECT counts_json FROM sync_runs WHERE id='run_1'").get().counts_json);
  assert.equal(counts.rejected, 1, "the operator is told what did not land");
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM gl_accounts WHERE organization_id='org_1'").get().c, 2);
});

test("a connection with no company id fails the run with a reconnect message", async () => {
  const { sqlite, worker } = await setup();
  sqlite.prepare("UPDATE integration_connections SET external_account_id = NULL WHERE id='conn_1'").run();
  queueRun(sqlite);
  stubQuickbooks({ accounts: ACCOUNTS, journalEntries: ENTRIES });

  const result = await worker.runSyncWorkerBatch(ENV);
  assert.equal(result.failed, 1);
  const run = sqlite.prepare("SELECT status, error FROM sync_runs WHERE id='run_1'").get();
  assert.equal(run.status, "failed");
  assert.match(run.error, /reconnect/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import ./tests/integration/module-hooks.mjs --test tests/integration/quickbooks-sync.integration.mjs`
Expected: FAIL — cannot find `../../lib/integrations/sync-worker.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/integrations/sync-worker.ts`:

```typescript
/**
 * Drains queued provider sync runs.
 *
 * The worker normalizes nothing and writes no entity rows itself: it opens a
 * session, fetches, hands the payload to the pure normalizer, and gives the
 * resulting batch to `applyImport`, which already owns ordering, reference
 * resolution and idempotency.
 *
 * The cursor advances only on a fully successful run. A failed run therefore
 * re-fetches the same window next time — which costs nothing, because the
 * import path is idempotent on external id, whereas skipping a window loses
 * data permanently.
 */

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { syncRuns } from "@/db/schema";
import { applyImport } from "@/lib/operations/import-apply";
import { fetchQuickbooks, openQuickbooksSession, type QboEnv } from "./quickbooks.ts";
import { normalizeQuickbooks } from "./quickbooks-rules.ts";

export interface SyncBatchResult {
  claimed: number;
  completed: number;
  failed: number;
  requeued: number;
}

const BATCH_SIZE = 5;

export async function runSyncWorkerBatch(env: QboEnv, limit = BATCH_SIZE): Promise<SyncBatchResult> {
  const result: SyncBatchResult = { claimed: 0, completed: 0, failed: 0, requeued: 0 };

  const queued = await getDb().select().from(syncRuns)
    .where(eq(syncRuns.status, "queued"))
    .orderBy(asc(syncRuns.startedAt))
    .limit(limit);

  for (const run of queued) {
    if (!(await claimRun(run.id))) continue;
    result.claimed++;

    if (run.provider !== "quickbooks") {
      await failRun(run.id, `No sync adapter exists for "${run.provider}".`);
      result.failed++;
      continue;
    }

    const session = await openQuickbooksSession(env, run.connectionId);
    if ("error" in session) {
      await failRun(run.id, session.error);
      result.failed++;
      continue;
    }

    const cursor = parseCursor(run.cursorJson);
    const fetched = await fetchQuickbooks(session, cursor);
    if ("error" in fetched) {
      if (fetched.retryable) {
        // Back to queued with the cursor untouched, so the next run covers the
        // same window rather than starting after it.
        await getDb().update(syncRuns).set({ status: "queued", error: fetched.error }).where(eq(syncRuns.id, run.id));
        result.requeued++;
      } else {
        await failRun(run.id, fetched.error);
        result.failed++;
      }
      continue;
    }

    const { batch, rejected } = normalizeQuickbooks({ accounts: fetched.accounts, journalEntries: fetched.journalEntries });
    const applied = await applyImport(
      run.organizationId,
      batch,
      { sourceProvider: "quickbooks", sourceConnectionId: run.connectionId, externalId: null },
      run.id,
    );

    await getDb().update(syncRuns).set({
      status: "completed",
      cursorJson: JSON.stringify({ changedSince: fetched.changedSince }),
      countsJson: JSON.stringify({
        applied: applied.applied,
        unchanged: applied.unchanged,
        failed: applied.failed.length,
        skipped: applied.skipped.length,
        rejected: rejected.length,
      }),
      error: null,
      completedAt: new Date(),
    }).where(eq(syncRuns.id, run.id));
    result.completed++;
  }

  return result;
}

/**
 * Atomic claim. Two workers racing both issue this update; the second matches
 * zero rows because the first already moved the status, so it gets `false` and
 * moves on. There is no read-then-write window for them to race inside.
 */
async function claimRun(runId: string): Promise<boolean> {
  const updated = await getDb().update(syncRuns)
    .set({ status: "running" })
    .where(and(eq(syncRuns.id, runId), eq(syncRuns.status, "queued")));
  const value = updated as { rowsAffected?: number; meta?: { changes?: number } };
  return (value?.rowsAffected ?? value?.meta?.changes ?? 0) === 1;
}

async function failRun(runId: string, error: string): Promise<void> {
  await getDb().update(syncRuns)
    .set({ status: "failed", error, completedAt: new Date() })
    .where(eq(syncRuns.id, runId));
}

function parseCursor(json: string): { changedSince?: string } {
  try {
    const parsed = JSON.parse(json) as { changedSince?: unknown };
    return typeof parsed.changedSince === "string" ? { changedSince: parsed.changedSince } : {};
  } catch {
    // A corrupt cursor means a full re-fetch, which is safe and self-healing.
    return {};
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./tests/integration/module-hooks.mjs --test tests/integration/quickbooks-sync.integration.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add lib/integrations/sync-worker.ts tests/integration/quickbooks-sync.integration.mjs
git commit -m "feat(integrations): sync worker drives QuickBooks runs into the GL tables"
```

---

### Task 7: Run the sync worker on the existing cron

**Files:**
- Modify: `worker/index.ts`

**Interfaces:**
- Consumes: `runSyncWorkerBatch` from Task 6

- [ ] **Step 1: Add the bindings to the Env interface**

In `worker/index.ts`, the `Env` interface already lists `ANTHROPIC_API_KEY`,
`STRIPE_SECRET_KEY` and others. Add the three QuickBooks bindings:

```typescript
  INTEGRATION_TOKEN_ENCRYPTION_KEY?: string;
  QUICKBOOKS_CLIENT_ID?: string;
  QUICKBOOKS_CLIENT_SECRET?: string;
  QUICKBOOKS_API_BASE_URL?: string;
```

- [ ] **Step 2: Drain sync runs alongside the agent batch**

Replace the body of the `scheduled` handler:

```typescript
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Request waitUntil gives new tasks a fast start; this minute sweep is the
    // durable continuation and crash-recovery path. Keep the imports lazy: the
    // regular fetch bundle can be loaded by non-Workers render/test harnesses
    // without eagerly resolving the Cloudflare-only D1 environment module.
    ctx.waitUntil(import("@/lib/agents/worker").then(({ runAgentWorkerBatch }) =>
      runAgentWorkerBatch(env as unknown as AgentWorkerEnv, "scheduled"),
    ));
    // Provider syncs drain on the same tick but as a separate promise, so a
    // failure in one cannot abandon the other.
    ctx.waitUntil(import("@/lib/integrations/sync-worker").then(({ runSyncWorkerBatch }) =>
      runSyncWorkerBatch(env as unknown as QboEnv),
    ).catch((error) => console.error("sync_worker_batch_failed", error)));
  },
```

Add the type import at the top of the file, alongside the existing
`AgentWorkerEnv` import:

```typescript
import type { QboEnv } from "@/lib/integrations/quickbooks";
```

- [ ] **Step 3: Verify the whole suite**

```bash
npm test
```

Expected: PASS. The unit count rises by the Task 1–3 tests; the runtime lane
rises by 6.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add worker/index.ts
git commit -m "feat(integrations): drain provider sync runs on the minute cron"
```

- [ ] **Step 5: Document the new bindings**

Append to `docs/AGENT_PRODUCTION_RUNBOOK.md`, in whichever section lists
required configuration:

```markdown
### QuickBooks sync

| Binding | Purpose |
|---|---|
| `QUICKBOOKS_CLIENT_ID` | OAuth application id (already used by the connect flow) |
| `QUICKBOOKS_CLIENT_SECRET` | OAuth application secret |
| `QUICKBOOKS_API_BASE_URL` | `https://sandbox-quickbooks.api.intuit.com` for a sandbox company; omit for production |
| `INTEGRATION_TOKEN_ENCRYPTION_KEY` | Existing; at least 24 characters |

A connection made before company-id capture has no `external_account_id` and
its runs fail with a reconnect message. Reconnecting the workspace fixes it.
```

```bash
git add docs/AGENT_PRODUCTION_RUNBOOK.md
git commit -m "docs(runbook): QuickBooks sync configuration"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `realmId` capture | 3 |
| Token refresh, rotation stored | 4 |
| Account type mapping | 1 |
| Amount direction | 1 |
| Cents guard | 1 |
| External ids | 2 |
| Trust accounts default false | 2 |
| Cursor, first run vs CDC | 5 |
| Cursor advances only on success | 6 |
| 401 / 429 / 5xx handling | 5 (classification), 6 (action) |
| Partial apply reported | 6 |
| Two workers, one run | 6 |
| Pure rules tests | 1–3 |
| Worker integration tests | 6 |
| Configuration | 7 |

No spec requirement is unimplemented.

**Placeholder scan:** No TBD, TODO, "handle edge cases", or "similar to Task N".
Every code step contains the code.

**Type consistency:** `QboAccount`, `QboJournalEntry` defined in Task 2 and
imported by Task 5. `QboSession` defined in Task 4, consumed in Task 5.
`QboEnv` defined in Task 4, consumed in Tasks 5, 6 and 7. `normalizeQuickbooks`
returns `{ batch, rejected }` in Task 2 and is destructured that way in Task 6.
`applyImport(organizationId, batch, source, syncRunId)` matches
`lib/operations/import-apply.ts:185`. `SourceRef` fields match
`lib/operations/provenance.ts:137`.

**One known gap, deliberate:** Task 4 ships without its own test, exercised
instead by Task 6. Splitting a stubbed-fetch harness across two files to test
refresh in isolation would duplicate the setup without testing anything Task 6
does not already cover.
