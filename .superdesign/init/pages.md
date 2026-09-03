# Page Dependency Trees

## `/[locale]` — Dashboard and all desktop views

Entry: `app/[locale]/page.tsx`

Dependencies:
- `lib/integrations/session.ts`
  - `lib/auth/session-cookie.ts`
  - `lib/integrations/organizations.ts`
  - `db/index.ts`
  - `db/schema.ts`
- `app/components/auth-gate.tsx`
- `app/[locale]/dashboard-client.tsx`
  - `app/[locale]/navigation.ts`
  - `app/[locale]/routing.ts`
  - `app/components/experience.tsx`
  - `app/components/aval-assistant.tsx`
    - `app/components/agent-avatar/AgentAvatar.tsx`
    - `app/components/markdown-preview.tsx`
    - `app/components/ask-aval-tasks.tsx`
  - `app/components/ask-aval-tasks.tsx`
  - `app/components/brand-mark.tsx`
  - `app/components/billing-settings.tsx`
  - `app/components/intelligence-settings.tsx`
    - `app/components/connection-dialog.tsx`
      - `app/components/experience.tsx`
      - `app/components/brand-mark.tsx`
      - `app/components/foldout.tsx`
      - `lib/integrations/model-providers.ts`
        - `lib/integrations/catalog.ts`
        - `lib/integrations/subscription-oauth.ts`
        - `lib/integrations/provider-errors.ts`
    - `app/components/foldout.tsx`
    - `app/components/brand-mark.tsx`
  - `app/components/connection-dialog.tsx`
  - `app/components/automation-timeline.tsx`
  - `app/components/charts.tsx`
  - `app/components/agent-avatar/AgentAvatar.tsx`
  - `app/components/agent-avatar/personas.ts`
  - `app/data/sample.ts`
  - `app/data/infrastructure-sample.ts`
  - `lib/finance/money.ts`
  - `lib/infrastructure/types.ts`
- `app/[locale]/layout.tsx`
  - `app/globals.css`
  - `app/[locale]/routing.ts`
  - `app/fonts/InterVariable.woff2`

### Settings → Intelligence target context

Use:
- `app/[locale]/dashboard-client.tsx:1742:1744` for `SettingsView`
- `app/[locale]/dashboard-client.tsx:1970:1976` for the actual desktop shell branch
- full `app/components/intelligence-settings.tsx` (under 900 lines)
- full `app/components/brand-mark.tsx`
- full `app/components/foldout.tsx`
- full `app/components/connection-dialog.tsx`
- `.superdesign/init/theme.md:1:22` for compact tokens
- `app/globals.css:1262:1330` for Intelligence-specific rules
- `app/globals.css:102:139` for shared buttons/cards/popovers, after confirming selectors
- the attached screenshot as a temporary visual reference

## `/[locale]/mobile` — Aval Mobile

Entry: `app/[locale]/mobile/page.tsx`

Dependencies:
- `app/[locale]/mobile/mobile.css`
- `app/components/brand-mark.tsx`
- `app/components/agent-avatar/AgentAvatar.tsx`
  - `app/components/agent-avatar/personas.ts`
  - `app/components/agent-avatar/render-shape.tsx`
  - `app/components/agent-avatar/shapes.tsx`
  - `app/components/agent-avatar/themes.ts`
- `app/[locale]/navigation.ts`
- `app/[locale]/layout.tsx`
