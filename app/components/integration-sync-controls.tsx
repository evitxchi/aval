"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Status = { enabled: boolean; lastSyncAt: string | null; lastRun: { status: string; error: string | null } | null };
export function IntegrationSyncControls({ provider }: { provider: string }) {
  const t = useTranslations("Imports");
  const [state, setState] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/sync?provider=${encodeURIComponent(provider)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw new Error();
        const result = await response.json() as Status;
        if (!controller.signal.aborted) { setState(result); setError(""); }
      } catch { if (!controller.signal.aborted) setError(t("loadError")); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [provider, refresh, t]);
  const schedule = async (enabled: boolean) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, enabled }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      setState(current => current ? { ...current, enabled } : null);
      setRefresh(value => value + 1);
    } catch { setError(t("saveError")); }
    finally { setBusy(false); }
  };
  return <section className="permission-box" aria-busy={busy}>
    <strong>{t("title")}</strong><p>{t("scope")}</p>
    <p role="status">{!state ? t("loading") : state.enabled ? t("enabled") : t("paused")}</p>
    {state?.lastRun && <p>{t.has(`status.${state.lastRun.status}`) ? t(`status.${state.lastRun.status}`) : t("status.needs_review")}</p>}
    {state?.lastRun?.error && <p role="alert">{state.lastRun.error}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button className="soft-button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{t("refresh")}</button><button className="primary-button" disabled={busy || !state} onClick={() => void schedule(!state?.enabled)}>{busy ? t("saving") : state?.enabled ? t("pause") : t("enable")}</button></div>
  </section>;
}
