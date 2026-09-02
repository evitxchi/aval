"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { NavArrowDown, Search, ShieldCheck } from "iconoir-react";
import { BrandMark } from "@/app/components/brand-mark";
import { Foldout } from "@/app/components/foldout";
import type { Provider } from "@/app/components/connection-dialog";

type SubscriptionSession = { state: string; authorizeUrl: string };

/**
 * One "Configure Providers" accordion row. An API-key form is always
 * available; a row whose provider has a subscription `twin` (anthropic ↔
 * claude, openai ↔ chatgpt — lib/integrations/catalog.ts's `subscriptionOf`)
 * also offers "or connect your subscription" beneath a divider, folding the
 * twin's own connect state into this same row rather than listing it
 * separately — mentari2.0's pattern, this app's actual reference for this
 * page's layout.
 */
function ProviderAccordionRow({ provider, twin, isOpen, onToggle, isActive, switching, onSetActive, onRefresh }: {
  provider: Provider;
  twin: Provider | null;
  isOpen: boolean;
  onToggle: () => void;
  isActive: boolean;
  switching: boolean;
  onSetActive: (providerId: string) => void;
  onRefresh: () => void;
}) {
  const t = useTranslations();
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const [subscriptionSession, setSubscriptionSession] = useState<SubscriptionSession | null>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState<"idle" | "working" | "error">("idle");
  const [subscriptionError, setSubscriptionError] = useState("");

  const connected = provider.connection?.status === "connected";
  const twinConnected = twin?.connection?.status === "connected";

  const connectApiKey = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("working");
    setMessage("");
    try {
      const response = await fetch("/api/integrations/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: provider.id, credentials: model ? { apiKey, model } : { apiKey } }),
      });
      const data = await response.json() as { error?: string; connection?: { id: string } };
      if (!response.ok || !data.connection?.id) throw new Error(data.error ?? t("IntelligenceSettings.connectFailed"));
      const verification = await fetch("/api/integrations/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: data.connection.id }) });
      const verified = await verification.json().catch(() => ({})) as { error?: string };
      if (!verification.ok) throw new Error(verified.error ?? t("IntelligenceSettings.connectFailed"));
      setApiKey("");
      onRefresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t("IntelligenceSettings.connectFailed"));
      return;
    }
    setStatus("idle");
  };

  const reset = async (targetProviderId: string) => {
    await fetch("/api/integrations/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: targetProviderId }) });
    onRefresh();
  };

  const startSubscription = async () => {
    if (!twin) return;
    setSubscriptionStatus("working");
    setSubscriptionError("");
    try {
      const response = await fetch("/api/integrations/subscription/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: twin.id }) });
      const data = await response.json() as { authorizeUrl?: string; state?: string; error?: string };
      if (!response.ok || !data.authorizeUrl || !data.state) throw new Error(data.error ?? t("IntelligenceSettings.connectFailed"));
      window.open(data.authorizeUrl, "_blank", "noopener,noreferrer");
      setSubscriptionSession({ state: data.state, authorizeUrl: data.authorizeUrl });
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : t("IntelligenceSettings.connectFailed"));
    }
    setSubscriptionStatus("idle");
  };

  const completeSubscription = async (event: FormEvent) => {
    event.preventDefault();
    if (!twin || !subscriptionSession) return;
    setSubscriptionStatus("working");
    setSubscriptionError("");
    try {
      const response = await fetch("/api/integrations/subscription/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: twin.id, state: subscriptionSession.state, pastedInput: pasteValue }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? t("IntelligenceSettings.connectFailed"));
      setSubscriptionSession(null);
      setPasteValue("");
      onRefresh();
    } catch (error) {
      setSubscriptionStatus("error");
      setSubscriptionError(error instanceof Error ? error.message : t("IntelligenceSettings.connectFailed"));
      return;
    }
    setSubscriptionStatus("idle");
  };

  return (
    <div className={`provider-row ${isOpen ? "is-open" : ""} ${isActive ? "active" : ""}`}>
      <button type="button" className="provider-row-summary" aria-expanded={isOpen} onClick={onToggle}>
        <BrandMark provider={provider.id} small />
        <span>{provider.title}</span>
        {isActive && <span className="connection-status connected">{t("IntelligenceSettings.inUse")}</span>}
        <NavArrowDown width={14} height={14} className={isOpen ? "provider-row-chevron open" : "provider-row-chevron"} />
      </button>
      <div className="provider-row-body" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
        <div className="provider-row-body-inner">
          <p className="provider-row-description">{twin ? t("IntelligenceSettings.pasteOrConnect", { provider: twin.title }) : provider.description}</p>

          {!connected ? (
            <form className="credential-form" onSubmit={connectApiKey}>
              <label>
                {t("IntelligenceSettings.apiKeyLabel")}
                <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" required />
              </label>
              <button className="soft-button" type="submit" disabled={status === "working" || !apiKey}>
                {status === "working" ? t("IntelligenceSettings.connecting") : t("IntelligenceSettings.connect")}
              </button>
            </form>
          ) : (
            <div className="provider-connected-row">
              <span className="connection-status connected"><ShieldCheck width={13} height={13} />{t("IntelligenceSettings.connectedWithKey")}</span>
              <button type="button" className="text-button" onClick={() => void reset(provider.id)}>{t("IntelligenceSettings.resetConnection")}</button>
            </div>
          )}
          {status === "error" && <p className="auth-gate-error">{message}</p>}

          {twin && (
            <>
              <div className="provider-row-divider"><span>{t("IntelligenceSettings.or")}</span></div>
              {twinConnected ? (
                <div className="provider-connected-row">
                  <span className="connection-status connected"><ShieldCheck width={13} height={13} />{t("IntelligenceSettings.connectedWithSubscription", { provider: twin.title })}</span>
                  <button type="button" className="text-button" onClick={() => void reset(twin.id)}>{t("IntelligenceSettings.resetConnection")}</button>
                </div>
              ) : subscriptionSession ? (
                <form className="credential-form" onSubmit={completeSubscription}>
                  <label>
                    {t("IntelligenceSettings.pasteRedirectLabel")}
                    <input type="text" value={pasteValue} onChange={(event) => setPasteValue(event.target.value)} autoComplete="off" required />
                  </label>
                  <button className="soft-button" type="submit" disabled={subscriptionStatus === "working" || !pasteValue}>
                    {subscriptionStatus === "working" ? t("IntelligenceSettings.connecting") : t("IntelligenceSettings.finishConnecting")}
                  </button>
                </form>
              ) : (
                <button type="button" className="soft-button" onClick={() => void startSubscription()} disabled={subscriptionStatus === "working"}>
                  {t("IntelligenceSettings.connectSubscription", { provider: twin.title })}
                </button>
              )}
              {subscriptionStatus === "error" && <p className="auth-gate-error">{subscriptionError}</p>}
            </>
          )}

          {provider.defaultModel && (
            <Foldout summary={t("ConnectionDialog.advanced")}>
              <label>
                {t("ConnectionDialog.modelOverrideLabel")}
                <input type="text" value={model} placeholder={provider.defaultModel} onChange={(event) => setModel(event.target.value)} autoComplete="off" />
              </label>
              <p className="foldout-hint">{t("ConnectionDialog.modelOverrideHint")}</p>
            </Foldout>
          )}

          {(connected || twinConnected) && !isActive && (
            <button type="button" className="wide-button" disabled={switching} onClick={() => onSetActive(connected ? provider.id : (twin as Provider).id)}>
              {t("IntelligenceSettings.useThis")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Settings → Intelligence: which model powers agents and Ask Aval for this
 * org. Reuses the exact same /api/integrations catalog, connect/verify
 * flow, and encrypted-credential storage as every other provider on the
 * Connections page — a model provider is just an IntegrationProvider with
 * category "Model" (lib/integrations/catalog.ts). Laid out to match a
 * separate local reference implementation the person directing this work
 * pointed to (mentari2.0): a "Model being used" summary row above a
 * searchable, accordion-style "Configure Providers" list, each row
 * expanding inline rather than opening a modal.
 */
export function IntelligenceSettings() {
  const t = useTranslations();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

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
  const modelProviders = providers.filter((provider) => provider.category === "Model" && !provider.subscriptionOf);
  const twinByProvider = new Map(providers.filter((provider) => provider.subscriptionOf).map((provider) => [provider.subscriptionOf as string, provider]));
  const filtered = modelProviders.filter((provider) => provider.title.toLowerCase().includes(search.trim().toLowerCase()));
  const activeEntry = modelProviders.find((provider) => provider.id === activeProvider) ?? [...twinByProvider.values()].find((provider) => provider.id === activeProvider);
  const modelLabel = !activeProvider
    ? t("IntelligenceSettings.avalOwnModel")
    : activeEntry?.defaultModel ?? t("IntelligenceSettings.subscriptionDefaultModel");

  return (
    <article className="settings-card intelligence-card" data-reveal>
      <p className="eyebrow">{t("IntelligenceSettings.eyebrow")}</p>
      <h2>{t("IntelligenceSettings.title")}</h2>

      <section className="intelligence-model-row">
        <p className="intelligence-model-row-label">{t("IntelligenceSettings.modelBeingUsed")}</p>
        <div className="intelligence-model-row-value">
          <BrandMark provider={activeProvider ?? "aval"} small />
          <span>{activeProvider ? (activeEntry?.title ?? activeProvider) : t("IntelligenceSettings.avalDefault")}</span>
          <span className="intelligence-model-row-divider">/</span>
          <span className="intelligence-model-row-model">{modelLabel}</span>
        </div>
      </section>

      {error && <p className="auth-gate-error">{error}</p>}

      <section className="intelligence-configure">
        <div className="intelligence-configure-header">
          <h3>{t("IntelligenceSettings.configureProviders")}</h3>
          <label className="search-field intelligence-search">
            <Search width={15} height={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("IntelligenceSettings.searchProviders")} />
          </label>
        </div>
        <div className="provider-row-list">
          <div className={`provider-row ${expanded === "aval" ? "is-open" : ""} ${!activeProvider ? "active" : ""}`}>
            <button type="button" className="provider-row-summary" aria-expanded={expanded === "aval"} onClick={() => setExpanded((current) => (current === "aval" ? null : "aval"))}>
              <BrandMark provider="aval" small />
              <span>{t("IntelligenceSettings.avalDefault")}</span>
              {!activeProvider && <span className="connection-status connected">{t("IntelligenceSettings.inUse")}</span>}
              <NavArrowDown width={14} height={14} className={expanded === "aval" ? "provider-row-chevron open" : "provider-row-chevron"} />
            </button>
            <div className="provider-row-body" style={{ gridTemplateRows: expanded === "aval" ? "1fr" : "0fr" }}>
              <div className="provider-row-body-inner">
                <p className="provider-row-description">{t("IntelligenceSettings.avalDefaultDescription")}</p>
                {activeProvider && (
                  <button type="button" className="wide-button" disabled={switching !== null} onClick={() => void setActive(null)}>
                    {switching === "aval" ? t("IntelligenceSettings.switching") : t("IntelligenceSettings.useThis")}
                  </button>
                )}
              </div>
            </div>
          </div>
          {filtered.map((provider) => {
            const twin = twinByProvider.get(provider.id) ?? null;
            const isActive = activeProvider === provider.id || (twin ? activeProvider === twin.id : false);
            return (
              <ProviderAccordionRow
                key={provider.id}
                provider={provider}
                twin={twin}
                isOpen={expanded === provider.id}
                onToggle={() => setExpanded((current) => (current === provider.id ? null : provider.id))}
                isActive={isActive}
                switching={switching !== null}
                onSetActive={(id) => void setActive(id)}
                onRefresh={load}
              />
            );
          })}
        </div>
      </section>
    </article>
  );
}
