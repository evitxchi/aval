"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Flash, Phone, SendDiagonal, Tools } from "iconoir-react";

interface AutomationStep {
  id: string;
  kind: string;
  actorLabel: string;
  summary: string;
  createdAt: number;
}
interface AutomationRun {
  id: string;
  status: string;
}

const STEP_ICON: Record<string, typeof Flash> = {
  reported: SendDiagonal,
  acknowledged: Check,
  vendor_draft: Tools,
  awaiting_approval: Phone,
  resolved: Check,
};

/** One real, wired automation: a maintenance issue triaged and drafted into vendor outreach, gated on human approval before anything is considered sent. */
export function AutomationTimeline() {
  const t = useTranslations();
  const [run, setRun] = useState<AutomationRun | null>(null);
  const [steps, setSteps] = useState<AutomationStep[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const response = await fetch("/api/automations");
      const data = (await response.json().catch(() => ({}))) as { run?: AutomationRun | null; steps?: AutomationStep[] };
      setRun(data.run ?? null);
      setSteps(data.steps ?? []);
    })();
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/automations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) });
      const data = (await response.json().catch(() => ({}))) as { run?: AutomationRun | null; steps?: AutomationStep[] };
      setRun(data.run ?? null);
      setSteps(data.steps ?? []);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const response = await fetch("/api/automations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", runId: run.id }) });
      const data = (await response.json().catch(() => ({}))) as { run?: AutomationRun | null; steps?: AutomationStep[] };
      setRun(data.run ?? null);
      setSteps(data.steps ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ask-aval-tasks automation-timeline-card" data-reveal>
      <div className="ask-aval-tasks-heading">
        <div><h2>{t("AutomationTimeline.title")}</h2><p>{t("AutomationTimeline.subtitle")}</p></div>
        {!run && <button type="button" className="primary-button" onClick={start} disabled={busy}><Flash width={17} height={17} />{t("AutomationTimeline.start")}</button>}
      </div>
      {steps.length === 0 ? (
        <div className="empty-column">{t("AutomationTimeline.empty")}</div>
      ) : (
        <div className="automation-timeline-steps">
          {steps.map((step) => {
            const Icon = STEP_ICON[step.kind] ?? Flash;
            return (
              <div className="automation-step" key={step.id}>
                <span className="automation-step-icon"><Icon width={16} height={16} /></span>
                <div><strong>{step.actorLabel}</strong><p>{step.summary}</p></div>
              </div>
            );
          })}
        </div>
      )}
      {run?.status === "running" && (
        <button type="button" className="primary-button" onClick={approve} disabled={busy}><Check width={17} height={17} />{t("AutomationTimeline.approve")}</button>
      )}
      {run?.status === "resolved" && <p className="draft-task-sent"><Check width={14} height={14} />{t("AutomationTimeline.resolved")}</p>}
    </section>
  );
}
