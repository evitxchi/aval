# Extractable Components

Aval's desktop shell and header are embedded inside the 1,978-line `dashboard-client.tsx` rather than exported as reusable components. For the current Intelligence dropdown correction, extracting them would add no reuse value and would risk diverging from the real render branch. The components below are basic/shared references; per workflow, they should remain inline design context rather than become Superdesign DraftComponents.

## BrandMark
- Source: `app/components/brand-mark.tsx`
- Category: basic
- Description: Canonical real provider logo inside Aval's rounded icon holder.
- Extractable props: `provider`, `small`
- Hardcoded: SVG paths, image source, icon selection logic, CSS class naming

## Foldout
- Source: `app/components/foldout.tsx`
- Category: basic
- Description: Animated disclosure shell used for advanced settings.
- Extractable props: `summary`, `children`, `className`
- Hardcoded: chevron icon and 0fr/1fr animation structure

## ConnectionDialog
- Source: `app/components/connection-dialog.tsx`
- Category: basic
- Description: Shared modal used to configure and verify integrations.
- Extractable props: `provider`, `onClose`, `onRefresh`
- Hardcoded: Radix dialog/tab composition and integration flow labels

## Layout extraction decision
- No standalone layout component is currently safe to extract.
- `AppHeader`, the sidebar, and the content shell are internal to `dashboard-client.tsx`.
- Skip component extraction for this target and pass their actual source ranges as context.
