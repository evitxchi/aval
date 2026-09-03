# Layouts

## `app/[locale]/layout.tsx` — localized root layout

Loads Inter Variable, global CSS, localized messages, metadata, and viewport settings for every page.

```tsx
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import "../globals.css";
import { routing } from "./routing";

// Inter's variable font — one file covers the full 100-900 weight range
// this app already relies on across headings/buttons/labels, rather than
// loading several static weight files.
const inter = localFont({
  src: "../fonts/InterVariable.woff2",
  variable: "--font-inter",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const incomingHeaders = await headers();
  const host = incomingHeaders.get("x-forwarded-host") ?? incomingHeaders.get("host") ?? "localhost:3000";
  const protocol = incomingHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Aval: Property operations, connected";
  const description = "One calm workspace for leasing, accounting, resident conversations, maintenance, and the systems behind them.";

  return {
    title,
    description,
    icons: {
      icon: [{ url: "/favicon.png", type: "image/png", sizes: "64x64" }],
      shortcut: "/favicon.png",
      apple: "/icon-192.png",
    },
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "Aval", statusBarStyle: "black-translucent" },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "en_US",
      url: origin,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0a" },
  ],
};

export default async function RootLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) notFound();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className={inter.variable}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

## `app/[locale]/page.tsx` — dashboard entry boundary

The desktop shell itself is embedded in `app/[locale]/dashboard-client.tsx`; this server boundary resolves guest/account identity and mounts it.

```tsx
import { getPageIdentity } from "@/lib/integrations/session";
import { SignInScreen } from "@/app/components/auth-gate";
import { AvalDashboard } from "./dashboard-client";

/**
 * Open access: every visitor gets the dashboard. A signed-in account resolves
 * to its own workspace; everyone else shares the guest workspace
 * (PUBLIC_DEMO_ORGANIZATION_ID), which by construction can never be a real
 * account's org — see lib/integrations/session.ts.
 *
 * The sign-in screen is still reachable at `?signin=1`, because removing the
 * gate must not lock existing account holders out of their own data. Guests
 * are shown a link to it in the profile menu.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.signin !== undefined) return <SignInScreen />;

  const identity = await getPageIdentity();
  if (!identity) return <SignInScreen />;
  // The workspace's creation date (for "day N with Aval") is deliberately NOT
  // resolved here: it would put a D1 round-trip on every dashboard load for a
  // secondary figure, and pull the database binding into a page that otherwise
  // server-renders without one. The hero fetches it from /api/workspace after
  // paint instead — the greeting and typed line render immediately either way.
  return <AvalDashboard authMode={identity.source} displayName={identity.displayName} email={identity.email} />;
}
```

## Embedded application shell

`DesktopApp` in `app/[locale]/dashboard-client.tsx` owns the sticky sidebar and rounded content shell. It is not a separate reusable layout component. For design context, use the real render branch at lines 1970–1976 plus the target view component rather than passing the entire 1,978-line multi-view file.
