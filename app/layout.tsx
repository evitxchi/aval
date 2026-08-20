import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";

const monument = localFont({
  src: "./fonts/ABCMonumentGroteskTrial-Regular.otf",
  variable: "--font-monument",
  weight: "400",
  style: "normal",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const incomingHeaders = await headers();
  const host = incomingHeaders.get("x-forwarded-host") ?? incomingHeaders.get("host") ?? "localhost:3000";
  const protocol = incomingHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Aval — Property operations, connected";
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
    { media: "(prefers-color-scheme: light)", color: "#efeeeb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0a" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={monument.variable}>
        {children}
      </body>
    </html>
  );
}
