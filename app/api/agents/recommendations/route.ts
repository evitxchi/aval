import { getApiIdentity } from '@/lib/integrations/session';
import { routeToPersona, describeRoute } from '@/lib/ask-aval/agent-router';
import { readOnboarding } from '@/lib/onboarding/storage';
import { autonomyMode } from '@/lib/agents/autonomy';
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({error:'Authentication required'},{status:401});
  const goal = (new URL(request.url).searchParams.get('goal') ?? '').slice(0,1200);
  const route = routeToPersona(goal), state = await readOnboarding(identity.userId,identity.organizationId);
  return Response.json({agentId:route.personaId,reason:describeRoute(route),matched:route.matched,mode:autonomyMode(state.preferences.autonomy[0])},{headers:{'cache-control':'no-store'}});
}
