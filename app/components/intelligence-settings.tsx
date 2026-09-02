"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { NavArrowRight } from "iconoir-react";
import { BrandMark } from "@/app/components/brand-mark";
import { ConnectionDialog, type Provider } from "@/app/components/connection-dialog";

/**
 * Settings → Intelligence: which model powers agents and Ask Aval for this
 * org. Reuses the exact same /api/integrations catalog, connect/verify
 * flow, and ConnectionDialog as every other provider on the Connections
 * page — a model provider is just an IntegrationProvider with
 * category "Model" (lib/integrations/catalog.ts) and authMode "api_key",
 * so nothing about credential storage, encryption, or verification is new.
 */
export function IntelligenceSettings() {
  const t = useTranslations();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch("/api/integrations");
      const data = await response.json() as { providers?: Provider[]; activeModelProvider?: string | null };
      setProviders(data.providers ?? []);
      setActiveProvider(data.activeModelProvider ?? null);
    } catch {
      setProviders([]);
    }
  };

  useEffect(() => { (async () => { await load(); })(); }, []);

  const setActive = async (providerId: string | null) => {
    setSwitching(providerId ?? "aval");
    setError(null);
    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      const data = await response.json().catch(() => ({})) as { activeModelProvider?: string | null; error?: string };
      if (!response.ok) { setError(data.error ?? t("IntelligenceSettings.switchFailed")); return; }
      setActiveProvider(data.activeModelProvider ?? null);
    } catch {
      setError(t("IntelligenceSettings.switchFailed"));
    } finally {
      setSwitching(null);
    }
  };

  if (!providers) return null;
  const modelProviders = providers.filter((provider) => provider.category === "Model");
  const activeTitle = modelProviders.find((provider) => provider.id === activeProvider)?.title;

  return (
    <article className="settings-card intelligence-card" data-reveal>
      <p className="eyebrow">{t("IntelligenceSettings.eyebrow")}</p>
      <h2>{t("IntelligenceSettings.title")}</h2>
      <p className="intelligence-current">
        {activeProvider
          ? t("IntelligenceSettings.currentlyUsing", { provider: activeTitle ?? activeProvider })
          : t("IntelligenceSettings.currentlyUsingDefault")}
      </p>

      {error && <p className="auth-gate-error">{error}</p>}

      <div className="intelligence-grid">
        <article className={`intelligence-provider-card ${!activeProvider ? "active" : ""}`}>
          <div className="connection-card-top">
            <BrandMark provider="aval" />
            {!activeProvider && <span className="connection-status connected">{t("IntelligenceSettings.inUse")}</span>}
          </div>
          <h3>{t("IntelligenceSettings.avalDefault")}</h3>
          <p>{t("IntelligenceSettings.avalDefaultDescription")}</p>
          <button className="soft-button" disabled={!activeProvider || switching !== null} onClick={() => void setActive(null)}>
            {switching === "aval" ? t("IntelligenceSettings.switching") : t("IntelligenceSettings.useThis")}
          </button>
        </article>

        {modelProviders.map((provider) => {
          const connected = provider.connection?.status === "connected";
          const isActive = provider.id === activeProvider;
          return (
            <article className={`intelligence-provider-card ${isActive ? "active" : ""}`} key={provider.id}>
              <div className="connection-card-top">
                <BrandMark provider={provider.id} />
                <span className={`connection-status ${provider.connection?.status ?? "not-connected"}`}>
                  {isActive ? t("IntelligenceSettings.inUse") : provider.connection?.status?.replaceAll("_", " ") ?? t("IntelligenceSettings.notConnected")}
                </span>
              </div>
              <h3>{provider.title}</h3>
              <p>{provider.description}</p>
              <div className="intelligence-provider-actions">
                <button className="text-button" onClick={() => setSelected(provider)}>
                  {connected ? t("IntelligenceSettings.manageKey") : t("IntelligenceSettings.connect")}<NavArrowRight width={15} height={15} />
                </button>
                {connected && !isActive && (
                  <button className="soft-button" disabled={switching !== null} onClick={() => void setActive(provider.id)}>
                    {switching === provider.id ? t("IntelligenceSettings.switching") : t("IntelligenceSettings.useThis")}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {selected && <ConnectionDialog provider={selected} onClose={() => setSelected(null)} onRefresh={load} />}
    </article>
  );
}
