# Aval Product and Design System

## Product

Aval is a calm, connected property-operations workspace for leasing, accounting, resident communications, maintenance, infrastructure, documents, and AI-assisted decisions. The desktop product is a dense operational dashboard for property managers, not a marketing site.

The Settings → Intelligence surface lets an operator choose which provider powers Ask Aval and its agents, connect credentials or subscriptions, pick a model where viable, and understand connection limitations without interpreting backend errors.

## Visual identity

- Use the existing local Inter Variable family exclusively.
- Preserve Aval's monochrome Apple-grey shell: `#f5f5f7` canvas, white surfaces, `#1d1d1f` ink, `#6e6e73` muted text, and subtle translucent lines.
- Use the semantic accent colors only for data/status. Orange is warning; green is successful/active; red is destructive/error.
- Controls are compact, quiet, and tactile: 9–11px supporting type, 11–13px controls, 38–42px control heights, 9–14px control radii, 16–24px card/shell radii.
- Use restrained shadows and 160–200ms snap-eased motion. Keep gradients inside analytical marks: blue, mint, lilac, and amber translucent fills, optional diagonal hatching, and exact-value dot textures. Keep the shell neutral; avoid decorative display type, glassmorphism, neon colors, or oversized marketing typography.
- Provider identity must use the real `BrandMark` implementation. Never replace the OpenAI knot, Anthropic mark, or Aval mark with initials or generic icons.

## Layout and component rules

- Preserve the 244px sticky sidebar and rounded white content shell.
- Settings uses grouped Personal / Workspace navigation and one content surface with section dividers. Appearance shares a 24-portrait and 9-character library between profile pictures and agent overrides; choices include background and system/animated/still motion. Use readable 14–16px settings controls and preserve account-backed saves. Navigation becomes a select on narrow screens.
- Keep provider selection and model selection legible as one sentence: provider / model.
- Popovers are anchored to their trigger, no wider than needed, and must stay within the viewport.
- Search is shown only when there are genuinely searchable choices.
- Status explanations must not occupy the same visual hierarchy as selectable menu rows.

## Blocked provider state

An OpenAI ChatGPT subscription may authenticate successfully while OpenAI's edge blocks Aval's hosted Worker from using the private Codex backend. This is not a stale credential and reconnecting does not help.

When that state is known:

- Do not show fallback model IDs as selectable; they cannot work from this deployment.
- Do not show a green check or “Default model” as if a usable model is active.
- Replace the option list with a compact unavailable state: warning icon, short title, one concise sentence.
- Provide one primary action to switch to Aval Intelligence and one secondary path to configure an OpenAI API key.
- Keep the popover around 300–340px wide with 16px internal spacing. Avoid a paragraph of orange text spanning the menu.
- Preserve honest connection semantics: authorization can remain “connected,” but the active inference route must visibly read unavailable.
- Normal JSON 401/403 credential failures retain the reconnect guidance; do not conflate them with the hosted edge challenge.

## Desktop-local ChatGPT integration

The packaged desktop app reuses Aval's existing dashboard shell and adds one trusted local capability: a narrow Electron bridge to the locally spawned Codex App Server. This is the supported design direction for ChatGPT Plus / Pro inside Aval; the hosted browser app must not imply it can run the same subscription route from Cloudflare Workers.

- Present ChatGPT Plus / Pro and the OpenAI API key as two separate connection methods. Do not merge their billing, credentials, or status language.
- Label the subscription route `Desktop only` and describe it as `Managed locally by Codex App Server`.
- The primary signed-out action is `Connect ChatGPT`. OAuth opens in the system browser and completion returns automatically through App Server notifications; never show callback URLs, authorization codes, or token fields.
- Expose local lifecycle state compactly: `Starting local service`, `Ready to connect`, `Waiting for browser approval`, `Connected`, `Restarting`, `Codex not installed`, and `Update required`.
- Be precise about privacy: OAuth credentials and refresh are managed locally by Codex. Prompts still go to OpenAI when ChatGPT is used. Never claim that inference or all data stays on-device.
- Keep App Server's current experimental status visible but subordinate: one quiet information row or badge with a documentation link, not an alarming error banner.
- The desktop chrome may add only a restrained, drag-safe title-bar region and a small local-service indicator. It must not replace or visually fork Aval's existing 244px sidebar and rounded content shell.
- Browser Aval should show the subscription method as available in the desktop app, with Aval Intelligence and API-key providers remaining usable on the web.

## Accessibility and responsive behavior

- Maintain visible keyboard focus and semantic buttons.
- Warning text must meet contrast requirements and should not rely on orange alone; pair it with an icon/title.
- Allow long model/provider names to truncate, but let explanatory prose wrap naturally.
- At narrow widths, stack provider/model triggers without horizontal overflow and keep the popover within `80vw`.
- Honor reduced-motion preferences.

## Analytics and activity

- Operations and Portfolio Overview share live reporting data and configurable chart representations. Categorical comparisons use columns, horizontal bars, or dot silhouettes. Time series additionally allow lines, stepped areas, and gradient areas. Stack only additive, complete, non-negative values.
- Header dividers have 24px clearance before following cards. Shared inbox uses two panes and a flexible message thread; short timeline durations have separate readable captions.
- Aval use tracker sits above the greeting. It records only authenticated active minutes, isolated per user/workspace, with UTC day labels and no seeded history. There is no demo mode.
