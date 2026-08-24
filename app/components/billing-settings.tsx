"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface PlanInfo { id: string; name: string; priceUsdCents: number; monthlyTokenAllowance: number }
interface PackInfo { id: string; name: string; priceUsdCents: number; tokens: number }
interface UsageData {
  plan: PlanInfo;
  subscriptionStatus: string | null;
  tokensGranted: number;
  tokensConsumed: number;
  tokensRemaining: number;
  plans: PlanInfo[];
  tokenPacks: PackInfo[];
}

/** Usage meter and plan/top-up purchase card for the Settings page. Every purchase button redirects to a real Stripe Checkout session; nothing here fakes a charge. */
export function BillingSettings() {
  const t = useTranslations();
  const [data, setData] = useState<UsageData | null>(null);
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/billing/usage");
        const json = (await response.json()) as UsageData;
        setData(json);
      } catch {
        setData(null);
      }
    })();
  }, []);

  const checkout = async (kind: "plan" | "topup", id: string) => {
    setRedirecting(id);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id }),
      });
      const json = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !json.url) {
        setError(json.error ?? t("BillingSettings.checkoutFailed"));
        setRedirecting(null);
        return;
      }
      window.location.assign(json.url);
    } catch {
      setError(t("BillingSettings.checkoutFailed"));
      setRedirecting(null);
    }
  };

  if (!data) return null;

  const usagePct = data.tokensGranted > 0 ? Math.min(100, Math.round((data.tokensConsumed / data.tokensGranted) * 100)) : 0;
  const paidPlans = data.plans.filter((plan) => plan.priceUsdCents > 0);

  return (
    <article className="settings-card billing-card" data-reveal>
      <p className="eyebrow">{t("BillingSettings.eyebrow")}</p>
      <h2>{t("BillingSettings.title")}</h2>

      <div className="billing-usage">
        <div className="billing-usage-row">
          <span>{t("BillingSettings.currentPlan", { plan: data.plan.name })}</span>
          <strong>{t("BillingSettings.tokensRemaining", { count: data.tokensRemaining.toLocaleString() })}</strong>
        </div>
        <div className="billing-usage-bar"><div className="billing-usage-bar-fill" style={{ width: `${usagePct}%` }} /></div>
        <p className="billing-usage-detail">{t("BillingSettings.usageDetail", { used: data.tokensConsumed.toLocaleString(), granted: data.tokensGranted.toLocaleString() })}</p>
      </div>

      {error && <p className="auth-gate-error">{error}</p>}

      <div className="billing-plans">
        {paidPlans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            className="billing-plan-card"
            disabled={redirecting !== null || data.plan.id === plan.id}
            onClick={() => checkout("plan", plan.id)}
          >
            <strong>{plan.name}</strong>
            <span>{t("BillingSettings.pricePerMonth", { price: (plan.priceUsdCents / 100).toFixed(0) })}</span>
            <small>{t("BillingSettings.tokensPerMonth", { count: plan.monthlyTokenAllowance.toLocaleString() })}</small>
            <span className="billing-plan-cta">
              {data.plan.id === plan.id ? t("BillingSettings.currentPlanLabel") : redirecting === plan.id ? t("BillingSettings.redirecting") : t("BillingSettings.upgrade")}
            </span>
          </button>
        ))}
      </div>

      <p className="billing-topup-label">{t("BillingSettings.outOfTokens")}</p>
      <div className="billing-packs">
        {data.tokenPacks.map((pack) => (
          <button key={pack.id} type="button" className="soft-button" disabled={redirecting !== null} onClick={() => checkout("topup", pack.id)}>
            {redirecting === pack.id ? t("BillingSettings.redirecting") : t("BillingSettings.buyPack", { tokens: pack.tokens.toLocaleString(), price: (pack.priceUsdCents / 100).toFixed(0) })}
          </button>
        ))}
      </div>
    </article>
  );
}
