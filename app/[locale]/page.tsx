import { getPageIdentity } from "@/lib/integrations/session";
import { SignInScreen } from "@/app/components/auth-gate";
import { resolveWorkspaceMode } from "@/lib/workspace-mode";
import { AvalDashboard } from "./dashboard-client";

/**
 * Signed-in visitors default to their authenticated workspace. Explicit demo
 * mode and signed-out visitors mount a separate in-memory preview. The mode
 * is resolved here, before any account data providers mount in the browser.
 * Sign-in remains accessible at `?signin=1` and on exiting a guest preview.
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
  return <AvalDashboard mode={resolveWorkspaceMode(identity.source === "guest", params.data)} requestedView={typeof params.view === "string" ? params.view : undefined} authMode={identity.source} displayName={identity.displayName} email={identity.email} />;
}
