# Detached chat title bar and contrast — 2026-09-10

Desktop 0.1.15 restores a 32px macOS title strip with native traffic lights,
explicit move/resize support, and drag regions on the strip and chat header.
Header buttons remain outside drag regions. Native vibrancy uses a regular
window rather than Electron's transparent-window mode. The glass material
follows Aval's explicit light/dark theme through nativeTheme.themeSource.
Light and dark surfaces now provide sufficient tint for readable text over
arbitrary desktop content. White mode remains opaque and light.

Verification:
- 513 unit tests, 150 runtime integration tests, and 23 desktop tests passed.
- Typecheck, locale parity and production build passed. Lint has zero errors
  and five existing image warnings.
- Electron UI checks toggled light → dark → light with the detached window open;
  renderer theme and native theme matched each transition. Computed drag regions,
  non-draggable buttons, non-selectable header text, native movable/resizable
  flags, sandboxing and disabled Node integration were checked.
- Worst-case composited text contrast was 9.95:1 / 5.12:1 for primary / secondary
  light text, and 8.81:1 / 5.60:1 in dark mode (minimum 4.5:1).
- Actual macOS screenshots showed the title strip and readable light glass.
  The captured renderer images below show both theme variants.
- Manual macOS drag verification remains inconclusive: Computer Use reported
  user changes, missing windows and timeouts as the test windows changed or
  closed. No successful pointer-driven movement is claimed from CSS/native flags.
- Superdesign draft d367a900-48da-4039-8ff4-5e89c8030608 was updated directly to
  version 4 and refetched to verify the title strip. No generation call was used.

[Light renderer](chat-titlebar-2026-09-10/light.png) ·
[Dark renderer](chat-titlebar-2026-09-10/dark.png)

The local DMG targets http://127.0.0.1:3010 and requires that local server.
It is ad-hoc signed and not notarized. Install the new desktop build for the
native window changes. Production signing requirements are unchanged.
The existing three-mode completion validation remains recorded in the prior
completion-review audit; this UI correction does not rerun live model/provider tasks.
