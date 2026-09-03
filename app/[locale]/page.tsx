import { getPageIdentity } from "@/lib/integrations/session";
import { SignInScreen } from "@/app/components/auth-gate";
import { AvalDashboard } from "./dashboard-client";

/**
 * Server-side auth gate: resolves identity before rendering, so an
 * authenticated visit (ChatGPT Sites headers, a real session cookie, or
 * localhost dev) gets the dashboard directly in the server-rendered HTML —
 * no client round trip or loading flash — and an unauthenticated visit
 * (only possible on a non-Sites deployment, where there's no platform
 * identity at all) gets the sign-in screen instead.
 */
export default async function Home() {
  const identity = await getPageIdentity();
  if (!identity) return <SignInScreen />;
  // The workspace's creation date (for "day N with Aval") is deliberately NOT
  // resolved here: it would put a D1 round-trip on every dashboard load for a
  // secondary figure, and pull the database binding into a page that otherwise
  // server-renders without one. The hero fetches it from /api/workspace after
  // paint instead — the greeting and typed line render immediately either way.
  return <AvalDashboard authMode={identity.source} displayName={identity.displayName} email={identity.email} />;
}
