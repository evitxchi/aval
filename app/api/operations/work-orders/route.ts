/**
 * GET   /api/operations/work-orders — the maintenance queue.
 * POST  /api/operations/work-orders — report work.
 * PATCH /api/operations/work-orders — assign, start, complete, or link a callback.
 *
 * Each PATCH action stamps its own timestamp rather than only moving a status,
 * because every maintenance metric is a difference between two of those stamps
 * (see `lib/operations/metrics/maintenance.ts`).
 */

import { ensureOrganization } from "@/lib/integrations/organizations";
import { getApiIdentity } from "@/lib/integrations/session";
import { operationsErrorResponse } from "@/lib/operations/errors";
import {
  assignWorkOrder,
  completeWorkOrder,
  createWorkOrder,
  linkCallback,
  listWorkOrders,
  startWorkOrder,
} from "@/lib/operations/maintenance";
import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES } from "@/lib/operations/types";
import {
  optionalCents,
  optionalDate,
  optionalEnum,
  optionalString,
  readJsonBody,
  requireEnum,
  requireString,
  MAX_SUMMARY_CHARS,
} from "@/lib/operations/validation";

const WORK_ORDER_ACTIONS = ["assign", "start", "complete", "link_callback"] as const;

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const workOrders = await listWorkOrders(identity.organizationId, {
    status: WORK_ORDER_STATUSES.includes(statusParam as (typeof WORK_ORDER_STATUSES)[number])
      ? (statusParam as (typeof WORK_ORDER_STATUSES)[number])
      : undefined,
    openOnly: url.searchParams.get("open") === "true",
    propertyId: url.searchParams.get("propertyId") ?? undefined,
    vendorId: url.searchParams.get("vendorId") ?? undefined,
  });
  return Response.json({ workOrders });
}

export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);

  try {
    const body = await readJsonBody(request);
    const workOrder = await createWorkOrder(identity.organizationId, {
      propertyId: requireString(body, "propertyId", 64),
      unitId: optionalString(body, "unitId", 64),
      leaseId: optionalString(body, "leaseId", 64),
      category: optionalEnum(body, "category", WORK_ORDER_CATEGORIES),
      priority: optionalEnum(body, "priority", WORK_ORDER_PRIORITIES),
      summary: requireString(body, "summary", MAX_SUMMARY_CHARS),
      reportedAt: optionalDate(body, "reportedAt") ?? undefined,
      vendorId: optionalString(body, "vendorId", 64),
      estimateCents: optionalCents(body, "estimateCents"),
      callbackOfWorkOrderId: optionalString(body, "callbackOfWorkOrderId", 64),
    });
    return Response.json({ workOrder }, { status: 201 });
  } catch (error) {
    return operationsErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const body = await readJsonBody(request);
    const workOrderId = requireString(body, "workOrderId", 64);
    const action = requireEnum(body, "action", WORK_ORDER_ACTIONS);
    const at = optionalDate(body, "at") ?? new Date();

    switch (action) {
      case "assign":
        return Response.json({
          workOrder: await assignWorkOrder(identity.organizationId, workOrderId, requireString(body, "vendorId", 64), at),
        });
      case "start":
        return Response.json({ workOrder: await startWorkOrder(identity.organizationId, workOrderId, at) });
      case "complete":
        return Response.json({
          workOrder: await completeWorkOrder(identity.organizationId, workOrderId, {
            at,
            actualCostCents: optionalCents(body, "actualCostCents"),
          }),
        });
      case "link_callback":
        // Only ever on a person's say-so. Nothing links a callback
        // automatically — first-time-fix feeds vendor renewals, and an
        // inferred callback is a guess with a contract attached to it.
        return Response.json({
          workOrder: await linkCallback(
            identity.organizationId,
            workOrderId,
            requireString(body, "originalWorkOrderId", 64),
          ),
        });
    }
  } catch (error) {
    return operationsErrorResponse(error);
  }
}
