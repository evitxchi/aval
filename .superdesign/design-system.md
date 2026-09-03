# Aval Product and Design System

## Product

Aval is a calm, connected property-operations workspace for leasing, accounting, resident communications, maintenance, infrastructure, documents, and AI-assisted decisions. The desktop product is a dense operational dashboard for property managers, not a marketing site.

The Settings → Intelligence surface lets an operator choose which provider powers Ask Aval and its agents, connect credentials or subscriptions, pick a model where viable, and understand connection limitations without interpreting backend errors.

## Visual identity

- Use the existing local Inter Variable family exclusively.
- Preserve Aval's monochrome Apple-grey shell: `#f5f5f7` canvas, white surfaces, `#1d1d1f` ink, `#6e6e73` muted text, and subtle translucent lines.
- Use the semantic accent colors only for data/status. Orange is warning; green is successful/active; red is destructive/error.
- Controls are compact, quiet, and tactile: 9–11px supporting type, 11–13px controls, 38–42px control heights, 9–14px control radii, 16–24px card/shell radii.
- Use restrained shadows and 160–200ms snap-eased motion. Never add gradients, decorative display type, glassmorphism, neon colors, or oversized marketing typography.
- Provider identity must use the real `BrandMark` implementation. Never replace the OpenAI knot, Anthropic mark, or Aval mark with initials or generic icons.

## Layout and component rules

- Preserve the 244px sticky sidebar and rounded white content shell.
- Settings is a two-column grid; Intelligence spans both columns.
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

## Accessibility and responsive behavior

- Maintain visible keyboard focus and semantic buttons.
- Warning text must meet contrast requirements and should not rely on orange alone; pair it with an icon/title.
- Allow long model/provider names to truncate, but let explanatory prose wrap naturally.
- At narrow widths, stack provider/model triggers without horizontal overflow and keep the popover within `80vw`.
- Honor reduced-motion preferences.
