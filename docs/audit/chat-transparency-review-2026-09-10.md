# Frosted glass transparency — 2026-09-10

Settings → Preferences → Chat window background → Frosted glass now reveals a
keyboard-accessible Transparency slider from 0–100%, with a 20% default.
Changes preview immediately in the native detached chat window. Only the surface
tint changes; text and controls remain opaque. Native vibrancy continues to blur
the desktop. Light/dark tint colors and the movable native title strip remain.
White mode hides the slider and renders opaque. Switching back preserves its
value. Save appearance persists it with the existing account/guest appearance
record; no schema migration or model call is needed. Browser pop-outs retain
their opaque fallback. Reduced-transparency media preferences override glass.

Verification:
- 514 unit, 150 runtime integration, and 23 desktop tests passed. Coverage includes
  integer bounds, rejection of invalid values, zero preservation, old records,
  account isolation, and rejection without overwriting saved settings.
- Typecheck, locale parity, production build and lint passed (five existing image
  warnings, zero errors).
- Electron UI checks used keyboard Home/End/Arrow keys at 0%, 100% and 55%; native
  renderer alpha followed 1, 0 and .45 while text opacity stayed 1. White/glass
  switching, light/dark transitions, return to dashboard, save and reload passed.
- Strict/deep signature validation, DMG integrity, packaged startup, and packaged
  source/version/local-target verification passed.
- The user explicitly confirmed that dragging the top strip moves the whole
  window. Automated pointer checks were inconclusive; this confirmation is from
  the user, not an automated drag assertion.
- The Superdesign chat draft was directly updated to version 5 with a preferences
  slider and refetched to verify the same draft and the requested control.
- Contrast figures in the earlier title-bar audit apply to its default tint,
  not all user-selected transparency values. Higher transparency deliberately
  shows more of the native material/desktop.

[Preferences](chat-transparency-2026-09-10/preferences.png) ·
[Light renderer](chat-transparency-2026-09-10/light.png) ·
[Dark renderer](chat-transparency-2026-09-10/dark.png)

Desktop 0.1.16 local assets target http://127.0.0.1:3010 and require the local
server. They are ad-hoc signed, not notarized. Production signing is unchanged.
