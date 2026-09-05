import { getPageIdentity } from "@/lib/integrations/session";
import { SignInScreen } from "@/app/components/auth-gate";
import { AvalDashboard } from "./dashboard-client";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.signin !== undefined) return <SignInScreen />;

  const identity = await getPageIdentity();
  if (!identity || identity.source === "guest") return <SignInScreen />;
  // The workspace's creation date (for "day N with Aval") is deliberately NOT
  // resolved here: it would put a D1 round-trip on every dashboard load for a
  // secondary figure, and pull the database binding into a page that otherwise
  // server-renders without one. The hero fetches it from /api/workspace after
  // paint instead — the greeting and typed line render immediately either way.
  return <AvalDashboard requestedView={typeof params.view === "string" ? params.view : undefined} authMode={identity.source} displayName={identity.displayName} email={identity.email} />;
}
