# Aval resumption — September 7, 2026

## Scope recovered

The checkout contained unfinished communication delivery, call routing, inbox polling,
Meta marketing, collaboration-mode enforcement, specialist recommendations, and provider
branding changes. These changes are retained. The older `docs/TASKS.md` Overview brief
is not the current unfinished work.

## Completed in this resumption

- Fixed the undefined `category` reference that prevented TypeScript compilation.
- Fixed lint errors and excluded generated Wrangler bundles from source linting.
- Bound specialist recommendations to the goal that produced them so an old response
  cannot recommend a specialist for a different or cleared goal.
- Preserved callback-confirmed delivery status when the original provider request times out.
  A replay still reuses the operation instead of sending again.
- Rejected null, array, scalar, and malformed request bodies on the conversation,
  inbox-refresh, and marketing endpoints before provider access.
- Made the connection controls show loading/empty states, refresh the source list after
  enabling automatic refresh, handle stop failures, and respect the current workspace role.
  Blank optional call-route keywords are accepted as an empty list.
- Updated onboarding documentation to describe the enforced collaboration modes.

## Validation

The full suite passes: 486 unit/render/desktop tests plus 94 runtime integration tests.
TypeScript and translation parity pass (1,548 keys in each language). Lint has zero
errors and five existing image-element warnings. Regression tests cover the delivery
callback/timeout race and malformed API requests. Runtime tests cover supervised review,
exact-plan approval, autonomous routine actions, changed collaboration preferences,
membership revocation, inbound recipient confinement, and send deduplication.

The final production build also passes. Local migrations 0026–0028 applied successfully.
HTTP smoke checks against the built Worker pass for English and Spanish pages, call
settings, inbox sources, specialist recommendations, marketing readiness, and malformed
request rejection. The packaged desktop application passes its startup smoke check.

Provider responses in these tests are simulated. No real messages, calls, or marketing
posts were sent to validate providers. Browser interaction testing was not performed.

## Local delivery

The refreshed installer is `desktop/dist/Aval-0.1.8-local-arm64.dmg`; the ZIP and
`Aval-0.1.8-local-SHA256SUMS` are alongside it. The packaged app targets
`http://127.0.0.1:3000`. It is ad-hoc signed and **not notarized**. The disk-image checksum
and app signature verify. Production signing configuration is unchanged.

Run `npm run start:local` from the repository root to apply local migrations and serve
the built app. Keep that server running while using the local installer. Migrations
0026–0028 add delivery/settings storage, inbound task scope, and inbox polling sources;
they must be applied before a future hosted deployment.

The local server was left running at delivery. Its current log is
`/tmp/aval-resume-local-server.log`.

## Remaining external work

The existing Sites project `appgprj_6a852ce6585881918d6e900d4ebf93ae` still returns
`project_not_found`. No replacement Site was created and no hosted deployment was made.
The earlier GitHub billing/spending-limit failure is recorded in
`ONBOARDING_AND_CONNECTIONS.md`; its current status was not rechecked here.

Live provider credentials, OAuth consent, account-specific contracts, and vendor
validation are still required before claiming the new adapters work against real
accounts. Partner-only property portals remain unavailable. The work remains in the
checkout for review; nothing was pushed to `main`.
