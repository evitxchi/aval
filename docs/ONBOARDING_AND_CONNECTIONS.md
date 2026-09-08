# Onboarding and connections — September 7, 2026

## Delivered behavior

Authenticated accounts complete seven resumable onboarding steps: existing software, work priorities, communication, documents, calls, marketing, and preferred collaboration style. Steps can be skipped, except the collaboration preference defaults to assisted. Choices belong to the signed-in user and current workspace, persist in D1, and can be edited in Settings → Preferences. Optimistic revisions prevent stale tabs from silently replacing another save. Load/save failures show retry or reload guidance. The signed-out path remains outside this account-only flow.

Completed choices accompany Ask Aval requests as context. Selecting software does not connect it. Durable tasks now enforce the selected collaboration mode: supervised actions require review, assisted actions require individual approval or an approved plan with exact arguments, and autonomous tasks can perform routine permitted actions. Publication and financial actions retain their approval gates. Mode changes never grant tool permissions or bypass workspace membership checks.

## Connection readiness

The catalog is shared between the server and the client fallback. Unavailable providers explain their prerequisites and do not collect credentials or display a usable connection. Existing provider-specific contracts are retained.

New API credential verification covers Asana, Rentvine, Propstack, Street, GoHighLevel, and Meta Pages. New OAuth identity plus product-read probes cover Google Chat, Google Drive, Google Sheets, Microsoft Teams, OneDrive, and Box. Tests use simulated provider responses; no customer credentials or vendor sandboxes were used to certify these connections live.

Reapit and Arthur remain unavailable until installation/entity selection and account-specific access can be implemented and validated. Other partner-only or ambiguous products remain explicitly unavailable, including the additional Yardi products, SME Professional, 10ninety, Joblogic, BuildingStack, Igloohome, Peach, Res:Harmonics, Realpad, RentVision, RM Cloud, ShowMojo, TenantCloud, consumer iMessage, and the property listing portals. Their catalog entries list specific prerequisites.

OAuth states expire after ten minutes, belong to a user and workspace, and are consumed before exchange to prevent replay. Google and Microsoft use PKCE. Return paths stay on the current origin and retain the selected language. Access and refresh tokens are encrypted; missing permissions and malformed provider responses fail closed. Verification requires the workspace owner and cannot approve credentials replaced while a request was in flight.

## Automatic imports and live validation

QuickBooks now has a durable, opt-in automatic importer. Enable or pause it from a connected QuickBooks dialog. A minute worker processes bounded pages; a completed cycle schedules another cycle after fifteen minutes. `GET /api/sync?provider=quickbooks` reports the latest run and checkpoint status. Other providers continue to return an explicit `sync_unavailable` response.

This first importer covers **USD chart-of-accounts data and journal adjustments**, not the entire general ledger. It imports accounts in pages, then journals; later cycles refresh accounts and use QuickBooks change-data capture. Existing source IDs deduplicate retries. Refresh tokens rotate under a per-connection lease. Rate limits and transient provider errors retry up to four attempts without advancing the failed page. Interrupted workers recover their saved checkpoint.

Changed or deleted journals, account-type changes, incompatible currency, partial application, stale CDC windows, and excessive page sizes pause for review. These cases never silently duplicate money or mark a partial import fresh. The importer does not overwrite historical journal amounts or claim to perform accounting reconciliation. It does not import invoices, bills, payments, deposits, document contents, or leasing/maintenance data. Accounts use pages of 25; a journal response is bounded to 250 lines, and a CDC response reaching Intuit's 1,000-entity limit requires review. Local and remote imports remain opt-in.

Disconnecting clears credentials and pauses scheduling while preserving the connection record, import checkpoints, and ledger provenance. Only the workspace owner can disconnect a provider.

`POST /api/integrations/validate` performs actual identity/read-access probes for the selected owner-authorized account. The connection dialog has a **Validate live access** action. `npm run validate:providers -- <origin>` reports passing, failing, and not-tested results without emitting credentials. Use `AVAL_SESSION_COOKIE` for a remote authenticated workspace. The validator never installs Telegram webhooks, sends messages, imports data, or bills model calls. Expired OAuth access tokens must be refreshed by the worker or reauthorized before validation.

Production inspection on September 7 found only model-subscription connections plus a failed personal WhatsApp setup: there is no live QuickBooks/PMS/document account to validate. Only the model API key, encryption key, and session secret were configured; provider OAuth applications still need their credentials. These are external launch blockers, not fixture tests passing as live proof.

## Deployment

Apply migrations `0024_rare_madame_hydra.sql` and `0025_romantic_justin_hammer.sql` before deploying the application. Preserve the existing encryption key. Configure provider application credentials through the deployment secret manager; `.env.example` contains empty names, including the new Box application credentials.

The checkout's Sites project returned `project_not_found` during the September 7 resumption. The existing Cloudflare deployment is accessible independently of Sites. No production migration was performed during local validation. The repository also contains its established Cloudflare deployment workflow; pushing `main` triggers that workflow and the desktop release, so the user-authorized push may start both workflows. GitHub reports those jobs are blocked before execution by failed account payments or a spending limit.

## API references checked

- [Asana authenticated user](https://developers.asana.com/reference/users)
- [Rentvine API](https://docs.rentvine.com/)
- [Propstack units](https://docs.propstack.de/reference/objekte)
- [Street Open API](https://developers.street.co.uk/docs/street-open-api/api-reference)
- [HighLevel location identity](https://marketplace.gohighlevel.com/docs/ghl/locations/get-location/)
- [Google Drive metadata](https://developers.google.com/workspace/drive/api/guides/file-metadata)
- [Google Chat spaces](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces/list)
- [Microsoft drive children](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0)
- [Box folder items](https://developer.box.com/reference/get-folders-id-items)
- [Meta lead forms SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/leadgenform.py)

## Verification

Coverage includes persisted onboarding, concurrent first saves, stale revisions, user/workspace isolation, invalid choices, database failure, OAuth replay/expiry/decline, partial consent, long tokens, encrypted storage, upstream errors, request bounds, account mismatch, replacement-key races, and all returning-user workspace views in server rendering. Browser interaction and live vendor tests have not been performed.

Final local checks passed: 483 unit/render/desktop tests and 84 runtime tests, TypeScript, translation parity, and the production build. Lint has zero errors and five image-element warnings. HTTP smoke checks against the built Worker confirmed onboarding save/resume and conflict handling, workspace isolation, both language pages and their JavaScript assets, the 64-provider catalog, and the scheduled handler. The live-provider CLI accurately reported `blocked_no_connected_providers`. The DMG checksum, app code signature, packaged local URL, and desktop startup smoke check passed.

## Local delivery

`npm run start:local` applies migrations to an isolated local D1 database, starts the production Worker at `http://127.0.0.1:3000`, and invokes its scheduler every minute. The local database persists under `.wrangler/aval-local-state`. It never uses `--remote` or imports production data. Keep the process running while using the local DMG.

The local desktop installer is version 0.1.8, ad-hoc signed, and not notarized. Its package metadata targets the local server. Production desktop builds continue to default to the hosted Aval URL and retain Developer ID/notarization requirements. The user's preference to refresh DMGs for future deliveries is recorded in `AGENTS.md`.
