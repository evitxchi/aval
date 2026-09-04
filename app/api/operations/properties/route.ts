/**
 * GET  /api/operations/properties — the property list, with the portfolio rollup.
 * POST /api/operations/properties — add a property by hand.
 */

import { ensureOrganization } from "@/lib/integrations/organizations";
import { getApiIdentity } from "@/lib/integrations/session";
import { operationsErrorResponse } from "@/lib/operations/errors";
import { createProperty, listProperties, summarizePortfolio } from "@/lib/operations/portfolio";
import { PROPERTY_TYPES } from "@/lib/operations/types";
import {
  optionalCents,
  optionalEnum,
  optionalInt,
  optionalString,
  readJsonBody,
  requireString,
} from "@/lib/operations/validation";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const [properties, summary] = await Promise.all([
    listProperties(identity.organizationId),
    summarizePortfolio(identity.organizationId),
  ]);
  return Response.json({ properties, summary });
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  try {
    const body = await readJsonBody(request);
    const property = await createProperty(identity.organizationId, {
      name: requireString(body, "name"),
      addressLine1: optionalString(body, "addressLine1"),
      city: optionalString(body, "city"),
      region: optionalString(body, "region"),
      postalCode: optionalString(body, "postalCode", 20),
      country: optionalString(body, "country", 2) ?? "US",
      propertyType: optionalEnum(body, "propertyType", PROPERTY_TYPES),
      reportedUnitCount: optionalInt(body, "reportedUnitCount", 0, 100_000),
      yearBuilt: optionalInt(body, "yearBuilt", 1600, 2200),
      squareFeet: optionalInt(body, "squareFeet", 0),
      acquisitionCostCents: optionalCents(body, "acquisitionCostCents"),
      currentValueCents: optionalCents(body, "currentValueCents"),
    });
    return Response.json({ property }, { status: 201 });
  } catch (error) {
    return operationsErrorResponse(error);
  }
}
