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
