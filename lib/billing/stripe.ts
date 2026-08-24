/**
 * Minimal Stripe client via raw fetch, no SDK, matching this app's existing
 * Anthropic client: the official Stripe Node SDK has had edge-runtime rough
 * edges, and this needs only two calls (create a Checkout Session, verify a
 * webhook signature).
 */

export interface BillingEnv {
  STRIPE_SECRET_KEY: string | undefined;
  STRIPE_WEBHOOK_SECRET: string | undefined;
}

const API_URL = "https://api.stripe.com/v1";

export class StripeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "StripeError";
  }
}

/** Stripe's form-encoding convention for nested objects/arrays: line_items[0][price_data][currency]=usd. */
function flattenToFormEntries(value: unknown, prefix: string, out: [string, string][]) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenToFormEntries(item, `${prefix}[${index}]`, out));
  } else if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) flattenToFormEntries(entry, prefix ? `${prefix}[${key}]` : key, out);
  } else {
    out.push([prefix, String(value)]);
  }
}

async function stripeRequest(env: BillingEnv, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!env.STRIPE_SECRET_KEY) throw new StripeError("STRIPE_SECRET_KEY is not configured", 500);
  const entries: [string, string][] = [];
  flattenToFormEntries(body, "", entries);
  const form = new URLSearchParams();
  for (const [key, value] of entries) form.append(key, value);

  const res = await fetch(`${API_URL}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const message = (json.error as { message?: string } | undefined)?.message ?? `Stripe request failed (${res.status})`;
    throw new StripeError(message, res.status);
  }
  return json;
}

export interface CreateCheckoutSessionParams {
  mode: "subscription" | "payment";
  customerEmail: string;
  clientReferenceId: string;
  successUrl: string;
  cancelUrl: string;
  lineItem: { name: string; unitAmountCents: number; recurringMonthly?: boolean };
  metadata: Record<string, string>;
}

export async function createCheckoutSession(env: BillingEnv, params: CreateCheckoutSessionParams): Promise<{ url: string; id: string }> {
  const priceData: Record<string, unknown> = {
    currency: "usd",
    unit_amount: params.lineItem.unitAmountCents,
    product_data: { name: params.lineItem.name },
  };
  if (params.lineItem.recurringMonthly) priceData.recurring = { interval: "month" };

  const session = await stripeRequest(env, "checkout/sessions", {
    mode: params.mode,
    customer_email: params.customerEmail,
    client_reference_id: params.clientReferenceId,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    line_items: [{ quantity: 1, price_data: priceData }],
    metadata: params.metadata,
  });

  return { url: session.url as string, id: session.id as string };
}

/** Verifies Stripe's webhook signature (HMAC-SHA256 over "timestamp.payload"), Web Crypto only, no SDK. */
export async function verifyStripeWebhook(payload: string, signatureHeader: string | null, secret: string | undefined, toleranceSeconds = 300): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(signatureBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => signature === expected);
}
