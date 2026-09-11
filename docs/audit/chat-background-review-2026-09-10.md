# Detached chat background and progress — 2026-09-10

Settings → Preferences now offers White / Frosted glass. The setting uses the
existing account appearance JSON, with allowlisted values and a white default
for older records. No database migration or provider change is required.

On macOS, a narrowly scoped IPC method lets the trusted main dashboard apply
`under-window` vibrancy to its tracked chat windows. The renderer background is
transparent for glass and opaque/light for white. Arbitrary material names and
requests from other windows are rejected. Sandbox and context isolation remain
enabled and Node integration remains disabled. Browser pop-outs use an opaque
tinted fallback; reduced-transparency preferences get an opaque surface.

Progress moved above the composer and no longer uses character-by-character
interval timers owned by the potentially backgrounded main window. A complete
label includes the submitted question, then updates from existing tool/check
stages. No additional model call or private reasoning is involved.

Verification:
- 512 unit tests and 150 runtime integration tests passed, including saved
  appearance isolation, invalid-value rejection, and backward compatibility.
- 22 desktop tests passed, including reversible native material changes.
- Typecheck, locale parity, production build, lint (0 errors; 5 existing image
  warnings), strict/deep signature checks, DMG integrity and packaged startup passed.
- Electron UI tests saved the glass setting, detached chat, observed native
  `setVibrancy('under-window')`, verified a transparent renderer, switched back to
  white without reopening, saved, and confirmed the selection after reload.
- A delayed fixture response verified the complete question-specific progress
  label above the composer while the main window was minimized. Completion removed
  the indicator. This passed through both the web-answer path and the active native
  ChatGPT bridge with a stubbed IPC answer. No live provider or model was invoked.
- Existing Chromium regression checks passed for all three mode selections,
  welcome persistence, dock/resize/minimize, drag and button detach, agent task
  routing, draft preservation, and the narrow-width composer.
- Renderer screenshots cannot capture the macOS compositor's blurred desktop;
  the glass capture retains alpha (37/255 at a blank sample pixel). The material
  API calls and renderer transparency were verified separately.

Superdesign draft `d367a900-48da-4039-8ff4-5e89c8030608` was directly corrected to
version 3 for the exact progress-placement request, with no generation calls.
The preferences control reuses Aval's existing segmented-choice component styling.

Captures: [Preferences](chat-background-2026-09-10/preferences.png),
[progress](chat-background-2026-09-10/thinking.png),
[white](chat-background-2026-09-10/white.png),
[glass renderer alpha](chat-background-2026-09-10/glass-renderer.png).

Desktop 0.1.14 local assets target http://127.0.0.1:3010, require the local server,
and are ad-hoc signed, not notarized. Production signing requirements are unchanged.
