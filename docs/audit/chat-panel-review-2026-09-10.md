# Aval chat panel review — 2026-09-10

The Superdesign frosted-chat draft (project `d0d8e392-c082-412b-af30-d332521675c2`,
draft `d367a900-48da-4039-8ff4-5e89c8030608`, version 2) implements the user's
latest glass and minimalist-composer references. The earlier 12ui exploration
was superseded by these references; its generated logo and raster icon cutouts
were not shipped. Aval's real brand assets are retained; the Lucide glyphs from the
Superdesign draft are rendered as SVG components. The requested navigation glyphs
are PanelLeftClose/Open, LayoutGrid, Building2, KeyRound, Wrench, and Landmark.

## Behavior and scope

- Independence/context collapse into one animated line. The guide remains reachable.
- The selected agent powers both question and task requests; the action is selected
  separately through Chat / Run task. One arrow submits either operation.
- Floating, right docking, eight resize handles, edge-drag collapse, minimize,
  expand, and separate-window return preserve in-memory chat state and draft.
- Only panel geometry is saved in local storage. The welcome acknowledgement is
  saved per user and workspace in D1, with monotonic acknowledgement and revision checks.
- Web question progress reports actual model/tool/check stages over opt-in NDJSON,
  with no extra model calls and no private reasoning. Existing JSON clients remain supported.
- Native ChatGPT questions retain their existing bridge and working indicator.
  Detached windows require the parent dashboard to remain open; browser popup
  policy may require the explicit pop-out button. Desktop child windows keep
  sandboxing, context isolation, no Node integration, and navigation restrictions.

## Verification

- Full suite: 510 unit tests and 149 runtime integration tests passed; typecheck,
  locale parity, and production build passed. Lint: zero errors, five existing
  image-element warnings.
- Desktop suite: all 21 tests passed. Electron created a sandboxed, Node-disabled
  native chat window and returned the original draft to the parent successfully.
- New regression coverage: panel bounds/resize anchors, progress framing and
  interrupted UTF-8 streams, trusted native-window creation, and per-user/workspace
  welcome acknowledgement that older clients cannot reset.
- Isolated Chromium used a synthetic local user. Frontend task/answer payload tests
  used intercepted fixtures; no provider messages were sent. Verified selected
  maintenance agent in the task POST, Enter routing, answer rendering, one-time
  welcome reload, folding, docking, resize, edge minimize, button and drag detach,
  draft preservation on return (including detaching from minimized state), all three mode selections, and non-overlapping
  narrow-width composer controls. Visual checks corrected a dropped blur property,
  closed-disclosure content leakage, and inherited span styling.
- The earlier completion-review live actor/reviewer validation remains recorded in
  `agent-llm-comparison-completion-review-verification.json`: supervised, assisted, autonomous all
  completed using synthetic provider endpoints. Those receipts do not establish
  live delivery to any external communications provider.

## Delivery

Desktop 0.1.13 local assets target `http://127.0.0.1:3010`. They are ad-hoc signed
and **not notarized**. Production Developer ID and notarization requirements are
unchanged. The server must be running with migration 0031 applied. Release assets
and their SHA-256 checksums belong on GitHub `desktop-latest` alongside clearly
separated historical hosted assets.

Visual captures: [collapsed](chat-panel-2026-09-10/collapsed.png), [expanded](chat-panel-2026-09-10/expanded.png), [narrow width](chat-panel-2026-09-10/mobile.png), [native window](chat-panel-2026-09-10/native.png).
