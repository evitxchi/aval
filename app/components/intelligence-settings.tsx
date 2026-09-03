"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Check, NavArrowDown, Refresh, Search, ShieldCheck } from "iconoir-react";
import { BrandMark } from "@/app/components/brand-mark";
import { Foldout } from "@/app/components/foldout";
import type { Provider } from "@/app/components/connection-dialog";

type SubscriptionSession = { state: string; authorizeUrl: string };
type AuthMode = "apiKey" | "subscription";

/**
 * One "Configure Providers" row: a flat pill, icon+name+badge on one line,
 * expanding to a plain description, a single "connect with" selector when
 * a subscription alternative exists (`twin` — anthropic ↔ claude, openai ↔
 * chatgpt, lib/integrations/catalog.ts's `subscriptionOf`), and exactly one
 * input area below it at a time — never both an API-key form and a
 * subscription button stacked together. Matches a real reference
 * screenshot's pattern (a single provider pill: icon/name/badge, one line
 * of description, one connect action, one footer link) rather than this
 * page's earlier denser layout.
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
  const connected = provider.connection?.status === "connected";
  const twinConnected = twin?.connection?.status === "connected";

  const [authMode, setAuthMode] = useState<AuthMode>(twinConnected ? "subscription" : "apiKey");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const [subscriptionSession, setSubscriptionSession] = useState<SubscriptionSession | null>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState<"idle" | "working" | "error">("idle");
  const [subscriptionError, setSubscriptionError] = useState("");

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
        <span className="provider-row-name">{provider.title}</span>
        {twin && <span className="provider-row-badge">{t("IntelligenceSettings.subscriptionBadge")}</span>}
        {isActive && <span className="connection-status connected">{t("IntelligenceSettings.inUse")}</span>}
        <NavArrowDown width={14} height={14} className={isOpen ? "provider-row-chevron open" : "provider-row-chevron"} />
      </button>
      <div className="provider-row-body" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
        <div className="provider-row-body-inner">
          <p className="provider-row-description">
            {twin ? t("IntelligenceSettings.pasteOrConnect", { provider: twin.title }) : provider.description}
          </p>

          {twin && (
            <label className="provider-row-auth-select">
              {t("IntelligenceSettings.connectWith")}
              <select value={authMode} onChange={(event) => setAuthMode(event.target.value as AuthMode)}>
                <option value="subscription">{twin.title}</option>
                <option value="apiKey">{t("IntelligenceSettings.apiKeyOption")}</option>
              </select>
            </label>
          )}

          {(!twin || authMode === "apiKey") && (
            !connected ? (
              <form className="credential-form" onSubmit={connectApiKey}>
                <label>
                  {t("IntelligenceSettings.apiKeyLabel")}
                  <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" required />
                </label>
                <button className="soft-button" type="submit" disabled={status === "working" || !apiKey}>
                  {status === "working" ? t("IntelligenceSettings.connecting") : t("IntelligenceSettings.connect")}
                </button>
                {status === "error" && <p className="auth-gate-error">{message}</p>}
              </form>
            ) : (
              <div className="provider-connected-row">
                <span className="connection-status connected"><ShieldCheck width={13} height={13} />{t("IntelligenceSettings.connectedWithKey")}</span>
                <button type="button" className="text-button" onClick={() => void reset(provider.id)}>{t("IntelligenceSettings.resetConnection")}</button>
              </div>
            )
          )}

          {twin && authMode === "subscription" && (
            twinConnected ? (
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
                <p className="foldout-hint">{t("IntelligenceSettings.pasteRedirectHint")}</p>
                <button className="soft-button" type="submit" disabled={subscriptionStatus === "working" || !pasteValue}>
                  {subscriptionStatus === "working" ? t("IntelligenceSettings.connecting") : t("IntelligenceSettings.finishConnecting")}
                </button>
                {subscriptionStatus === "error" && <p className="auth-gate-error">{subscriptionError}</p>}
              </form>
            ) : (
              <button type="button" className="soft-button" onClick={() => void startSubscription()} disabled={subscriptionStatus === "working"}>
                {t("IntelligenceSettings.connectSubscription", { provider: twin.title })}
              </button>
            )
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
 * "Model being used": provider on the left, the actual model on the right,
 * separated by a plain "/" — a live, real picker, not a static echo. The
 * model side fetches the connected provider's real, current model list
 * (`GET /api/integrations/models`) rather than a hand-typed guess frozen
 * at whenever this catalog was written. Aval's own bundled default has no
 * live list to fetch (there's nothing to pick between), so it renders as
 * plain text instead of a combobox.
 */
function ModelBeingUsedRow({ providers, activeProvider, activeEntry, onSwitchProvider, onModelChanged }: {
  providers: Provider[];
  activeProvider: string | null;
  activeEntry: Provider | undefined;
  onSwitchProvider: (providerId: string | null) => void;
  onModelChanged: () => void;
}) {
  const t = useTranslations();
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  const connectedProviders = providers.filter((provider) => provider.category === "Model" && provider.connection?.status === "connected");
  const currentModel = activeEntry?.defaultModel ?? (activeProvider ? t("IntelligenceSettings.subscriptionDefaultModelShort") : t("IntelligenceSettings.avalDefault"));

  const loadModels = async () => {
    if (!activeProvider) return;
    setLoadingModels(true);
    setModelsError(null);
    try {
      const response = await fetch(`/api/integrations/models?provider=${encodeURIComponent(activeProvider)}`);
      const data = await response.json() as { models?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? t("IntelligenceSettings.modelListFailed"));
      setModels(data.models ?? []);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : t("IntelligenceSettings.modelListFailed"));
    } finally {
      setLoadingModels(false);
    }
  };

  const openModelMenu = () => {
    if (!activeProvider) return;
    setModelMenuOpen((current) => !current);
    setModelSearch("");
    if (!models) void loadModels();
  };

  const chooseModel = async (modelId: string) => {
    if (!activeProvider) return;
    setSavingModel(true);
    try {
      await fetch("/api/integrations/set-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: activeProvider, model: modelId }) });
      onModelChanged();
    } finally {
      setSavingModel(false);
      setModelMenuOpen(false);
    }
  };

  const filteredModels = (models ?? []).filter((id) => id.toLowerCase().includes(modelSearch.trim().toLowerCase()));

  return (
    <section className="intelligence-model-row">
      <p className="intelligence-model-row-label">{t("IntelligenceSettings.modelBeingUsed")}</p>
      <div className="intelligence-model-row-controls">
        <div className="intelligence-model-picker">
          <button type="button" className="intelligence-model-picker-trigger" onClick={() => setProviderMenuOpen((current) => !current)}>
            <BrandMark provider={activeProvider ?? "aval"} small />
            <span>{activeProvider ? (activeEntry?.title ?? activeProvider) : t("IntelligenceSettings.avalDefault")}</span>
            <NavArrowDown width={13} height={13} className={providerMenuOpen ? "provider-row-chevron open" : "provider-row-chevron"} />
          </button>
          {providerMenuOpen && (
            <div className="menu-popover intelligence-model-menu">
              <button type="button" onClick={() => { onSwitchProvider(null); setProviderMenuOpen(false); }}>
                <BrandMark provider="aval" small />{t("IntelligenceSettings.avalDefault")}
              </button>
              {connectedProviders.map((provider) => (
                <button type="button" key={provider.id} onClick={() => { onSwitchProvider(provider.id); setProviderMenuOpen(false); }}>
                  <BrandMark provider={provider.id} small />{provider.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="intelligence-model-row-divider">/</span>
        <div className="intelligence-model-picker">
          <button type="button" className="intelligence-model-picker-trigger" onClick={openModelMenu} disabled={!activeProvider}>
            <span>{currentModel}</span>
            {activeProvider && <Check width={14} height={14} className="intelligence-model-check" />}
          </button>
          {modelMenuOpen && activeProvider && (
            <div className="menu-popover intelligence-model-menu intelligence-model-search-menu">
              <label className="intelligence-model-search">
                <Search width={13} height={13} />
                <input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder={t("IntelligenceSettings.searchModels")} />
              </label>
              {loadingModels && <p className="intelligence-model-menu-status">{t("IntelligenceSettings.loadingModels")}</p>}
              {modelsError && <p className="intelligence-model-menu-status error">{modelsError}</p>}
              {!loadingModels && !modelsError && filteredModels.map((id) => (
                <button type="button" key={id} disabled={savingModel} onClick={() => void chooseModel(id)}>{id}</button>
              ))}
              {!loadingModels && !modelsError && filteredModels.length === 0 && (
                <p className="intelligence-model-menu-status">{t("IntelligenceSettings.noModelsMatch")}</p>
              )}
              <div className="intelligence-model-menu-footer">
                <button type="button" onClick={() => void loadModels()} disabled={loadingModels} aria-label={t("IntelligenceSettings.refreshModels")}>
                  <Refresh width={13} height={13} className={loadingModels ? "spinning" : ""} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Settings → Intelligence: which model powers agents and Ask Aval for this
 * org. Reuses the exact same /api/integrations catalog, connect/verify
 * flow, and encrypted-credential storage as every other provider on the
 * Connections page — a model provider is just an IntegrationProvider with
 * category "Model" (lib/integrations/catalog.ts). Aval's own bundled
 * default ("Aval Intelligence" — Aval supplies the model, no key or
 * subscription needed) is a plain row in this same list, sharing the exact
 * same summary/chevron/expand shell as every real provider, just simpler
 * expanded content (a description and a "Use this" button, no forms).
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
  const activeEntry = providers.find((provider) => provider.id === activeProvider);

  return (
    <article className="settings-card intelligence-card" data-reveal>
      <p className="eyebrow">{t("IntelligenceSettings.eyebrow")}</p>
      <h2>{t("IntelligenceSettings.title")}</h2>

      <ModelBeingUsedRow providers={providers} activeProvider={activeProvider} activeEntry={activeEntry} onSwitchProvider={(id) => void setActive(id)} onModelChanged={load} />

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
              <span className="provider-row-name">{t("IntelligenceSettings.avalDefault")}</span>
              {!activeProvider && <span className="connection-status connected">{t("IntelligenceSettings.inUse")}</span>}
              <NavArrowDown width={14} height={14} className={expanded === "aval" ? "provider-row-chevron open" : "provider-row-chevron"} />
            </button>
            <div className="provider-row-body" style={{ gridTemplateRows: expanded === "aval" ? "1fr" : "0fr" }}>
              <div className="provider-row-body-inner">
                <p className="provider-row-description">{t("IntelligenceSettings.avalDefaultDescription")}</p>
                {activeProvider && (
                  <button type="button" className="wide-button" disabled={switching !== null} onClick={() => void setActive(null)}>
                    {t("IntelligenceSettings.useThis")}
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
