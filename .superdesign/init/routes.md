# Routes

Aval uses Next.js App Router semantics through vinext and next-intl locale middleware.

## User-facing routes

- `/` → locale middleware redirect to `/en`
- `/[locale]` → `app/[locale]/page.tsx` → `AvalDashboard`
  - Desktop views are internal state within `dashboard-client.tsx`: Overview, Setup, Aval Tasks, Review Center, Inbox, Properties, Leasing, Maintenance, Accounting, Infrastructure, Connections, Documents, and Settings.
  - The requested Intelligence surface is the Settings view; its standalone component is `app/components/intelligence-settings.tsx`.
- `/[locale]/mobile` → `app/[locale]/mobile/page.tsx`
- `/[locale]?signin=1` → `SignInScreen`

## API route groups

- `/api/integrations/*`: catalog, connect, verification, reset, model discovery/selection, subscription OAuth/device flow
- `/api/assistant/*`: Ask Aval, document drafting, template filling
- `/api/agents/*`: personas and preference memory
- `/api/auth/*`: optional account login/logout/signup/session
- `/api/billing/*`, `/api/documents/*`, `/api/infrastructure/*`, `/api/audit`, `/api/automations`, `/api/conversations`, `/api/sync`, `/api/workspace`

## `middleware.ts`

```ts
import createMiddleware from "next-intl/middleware";
import { routing } from "./app/[locale]/routing";

export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next.js internals, and files with an extension (assets).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
```

## `app/[locale]/routing.ts`

```ts
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "es-mx"],
  defaultLocale: "en",
});
```
