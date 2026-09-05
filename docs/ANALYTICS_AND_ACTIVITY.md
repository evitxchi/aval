# Analytics and activity

Operations and Portfolio Overview read the same organization-scoped reporting endpoint. Financial time series use the existing P&L rules over disjoint UTC calendar buckets, and reconcile to the selected reporting period. Refunds retain their signs, trust movement and capital expense stay outside NOI, unknown accounts remain reported in accounting notes, and absent ledger data remains empty.

Chart preferences are visual-only, stored per chart on the device. Categorical comparisons offer columns, horizontal bars, and dot silhouettes. Temporal series also offer line, area and steps. Stacked columns/areas are available only for additive, complete, non-negative series. Leasing cohort stages and income/expense/NOI are never stacked together. Dot textures fill the exact-value silhouette: dots do not count individual units. Charts offer keyboard inspection, hover details, an exact data table, and reduced-motion support.

`workspace_usage` (migration 0023) records at most one active minute per organization/user/server minute. The client records while the app is visible and focused, with interaction during the preceding minute. Duplicate tabs cannot double count. No typed content, page names, or client-provided identity/timestamp is stored. The grid displays the previous 365 UTC days above the greeting; no historical activity is fabricated. Buckets older than 367 days are pruned on the subject's next activity.

There is no demo mode. Legacy `?data=sample` links cannot enable sample data. Anonymous requests require authentication; `/mobile` redirects to the responsive authenticated dashboard. Existing historical fixture modules remain only as test fixtures/type definitions, not a selectable workspace.

## Deployment

Desktop 0.1.7 loads the hosted application. The desktop release waits for the same commit's successful website deployment before publishing signed/notarized assets.

Since anonymous demo access is removed, the durable-agent production smoke must sign in. Configure the production GitHub environment secrets `AVAL_SMOKE_EMAIL` and `AVAL_SMOKE_PASSWORD` for a dedicated verification account with Aval Intelligence available. The workflow validates these before applying migrations or deploying. Credentials and session cookies are never printed. The smoke still proves an actual authenticated enqueue, model call, tool call, and persisted answer; it does not replace that check with an anonymous page load.

For machines that cannot mount temporary disk images, build the app with `npm run package:mac:local --prefix desktop` and then run `npm run package:mac:dmg-local --prefix desktop`. The fallback creates a true HFS+ UDZO DMG with an Applications link, verifies its checksum, and preserves the app bundle. It is a local, non-notarized artifact; GitHub release builds retain Developer ID signing, notarization, and Gatekeeper checks.
