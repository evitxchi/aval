import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { createMeter, listMeters } from "@/lib/infrastructure/meters";
import type { UnitOfMeasure, UtilityType } from "@/lib/infrastructure/types";

const UTILITY_TYPES: UtilityType[] = ["electricity", "water", "gas"];
const UNITS_OF_MEASURE: UnitOfMeasure[] = ["kWh", "gal", "ccf", "therm", "m3"];

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const utilityTypeParam = new URL(request.url).searchParams.get("utilityType");
  const utilityType = UTILITY_TYPES.includes(utilityTypeParam as UtilityType) ? (utilityTypeParam as UtilityType) : undefined;

  const meters = await listMeters(identity.organizationId, utilityType);
  return Response.json({ meters });
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  const body = (await request.json().catch(() => ({}))) as {
    utilityType?: string;
    propertyLabel?: string;
    unitLabel?: string;
    meterNumber?: string;
    provider?: string;
    unitOfMeasure?: string;
  };

  if (!UTILITY_TYPES.includes(body.utilityType as UtilityType)) {
    return Response.json({ error: "utilityType must be one of: electricity, water, gas" }, { status: 400 });
  }
  const propertyLabel = typeof body.propertyLabel === "string" ? body.propertyLabel.trim() : "";
  if (!propertyLabel) return Response.json({ error: "propertyLabel is required" }, { status: 400 });
  if (!UNITS_OF_MEASURE.includes(body.unitOfMeasure as UnitOfMeasure)) {
    return Response.json({ error: `unitOfMeasure must be one of: ${UNITS_OF_MEASURE.join(", ")}` }, { status: 400 });
  }

  const meter = await createMeter(identity.organizationId, {
    utilityType: body.utilityType as UtilityType,
    propertyLabel,
    unitLabel: body.unitLabel?.trim() || undefined,
    meterNumber: body.meterNumber?.trim() || undefined,
    provider: body.provider?.trim() || undefined,
    unitOfMeasure: body.unitOfMeasure as UnitOfMeasure,
  });
  return Response.json({ meter }, { status: 201 });
}
