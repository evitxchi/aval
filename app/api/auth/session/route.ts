import { getApiIdentity } from "@/lib/integrations/session";

/** Tells the client how (if at all) the current visitor is authenticated. */
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ authenticated: false });
  return Response.json({ authenticated: true, mode: identity.source, email: identity.email, displayName: identity.displayName });
}
