/**
 * GET  /api/operations/accounting/accounts — the chart of accounts.
 * POST /api/operations/accounting/accounts — add an account, or seed a default chart.
 *
 * `isTrustAccount` is only ever set by the caller, never inferred from an
 * account's name. Guessing "is this client money" from a label is how deposits
 * end up reported as operating income.
 */

import { ensureOrganization } from "@/lib/integrations/organizations";
import { getApiIdentity } from "@/lib/integrations/session";
import { createGlAccount, listGlAccounts, seedDefaultChartOfAccounts } from "@/lib/operations/accounting";
import { operationsErrorResponse } from "@/lib/operations/errors";
import { GL_ACCOUNT_TYPES } from "@/lib/operations/types";
import { optionalBoolean, readJsonBody, requireEnum, requireString } from "@/lib/operations/validation";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  return Response.json({ accounts: await listGlAccounts(identity.organizationId) });
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  try {
    const body = await readJsonBody(request);
    if (body.seedDefaults === true) {
      // No-ops when a chart already exists, so calling this twice cannot
      // duplicate a workspace's accounts or overwrite a synced chart.
      return Response.json({ accounts: await seedDefaultChartOfAccounts(identity.organizationId) }, { status: 201 });
    }

    const account = await createGlAccount(identity.organizationId, {
      code: requireString(body, "code", 20),
      name: requireString(body, "name", 120),
      accountType: requireEnum(body, "accountType", GL_ACCOUNT_TYPES),
      isTrustAccount: optionalBoolean(body, "isTrustAccount"),
    });
    return Response.json({ account }, { status: 201 });
  } catch (error) {
    return operationsErrorResponse(error);
  }
}
