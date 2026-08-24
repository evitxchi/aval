import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { subscriptions, tokenTopUps } from "@/db/schema";
import { verifyStripeWebhook, type BillingEnv } from "@/lib/billing/stripe";
import { getTokenPack } from "@/lib/billing/plans";

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

export async function POST(request: Request) {
  const billingEnv = env as unknown as BillingEnv;
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  const verified = await verifyStripeWebhook(payload, signature, billingEnv.STRIPE_WEBHOOK_SECRET);
  if (!verified) return Response.json({ error: "Invalid signature" }, { status: 400 });

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return Response.json({ error: "Malformed payload" }, { status: 400 });
  }

  const db = getDb();

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        id: string;
        client_reference_id?: string;
        customer?: string;
        subscription?: string;
        metadata?: Record<string, string>;
      };
      const organizationId = session.metadata?.organizationId ?? session.client_reference_id;
      if (!organizationId) return Response.json({ received: true });

      if (session.metadata?.kind === "topup") {
        const pack = getTokenPack(session.metadata.packId ?? "");
        if (pack) {
          await db.insert(tokenTopUps).values({
            id: crypto.randomUUID(),
            organizationId,
            stripeSessionId: session.id,
            packId: pack.id,
            tokensGranted: pack.tokens,
            createdAt: new Date(),
          }).onConflictDoNothing();
        }
      } else if (session.metadata?.kind === "plan" && session.metadata.planId) {
        const now = new Date();
        const existing = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
        const record = {
          planId: session.metadata.planId,
          status: "active",
          stripeCustomerId: session.customer ?? null,
          stripeSubscriptionId: session.subscription ?? null,
          currentPeriodStart: now,
          updatedAt: now,
        };
        if (existing.length > 0) {
          await db.update(subscriptions).set(record).where(eq(subscriptions.organizationId, organizationId));
        } else {
          await db.insert(subscriptions).values({ id: crypto.randomUUID(), organizationId, createdAt: now, ...record });
        }
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as { id: string; status: string; current_period_end?: number };
      await db
        .update(subscriptions)
        .set({
          status: event.type === "customer.subscription.deleted" ? "canceled" : subscription.status,
          currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
    }
  } catch (err) {
    console.error("billing_webhook_failed", event.type, err);
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  return Response.json({ received: true });
}
