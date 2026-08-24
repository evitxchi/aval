"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Flash } from "iconoir-react";
import { BrandMark } from "@/app/components/brand-mark";

interface AutomationStep {
  id: string;
  kind: string;
  actorLabel: string;
  summary: string;
  payloadJson: string;
  createdAt: number;
}
interface AutomationRun {
  id: string;
  status: string;
}
interface AutomationTrigger {
  insightId: string;
  titleKey: string;
  moneyAtStake: number;
  channel: string;
  run: AutomationRun | null;
  steps: AutomationStep[];
}

function stepChannel(step: AutomationStep, fallback: string): string {
  try {
    const parsed = JSON.parse(step.payloadJson) as { channel?: string };
    return parsed.channel ?? fallback;
  } catch {
    return fallback;
  }
}

/** Real, wired automations for every actionable insight: each triaged and drafted, vendor outreach, tenant reminders, or an internal review memo, gated on human approval before anything is considered sent. */
export function AutomationTimeline() {
  const t = useTranslations();
  const [triggers, setTriggers] = useState<AutomationTrigger[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const response = await fetch("/api/automations");
      const data = (await response.json().catch(() => ({}))) as { triggers?: AutomationTrigger[] };
      setTriggers(data.triggers ?? []);
    })();
  }, []);

  const start = async (insightId: string) => {
    setBusyId(insightId);
    try {
      const response = await fetch("/api/automations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", insightId }) });
      const data = (await response.json().catch(() => ({}))) as { triggers?: AutomationTrigger[] };
      setTriggers(data.triggers ?? []);
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (insightId: string, runId: string) => {
    setBusyId(insightId);
    try {
      const response = await fetch("/api/automations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", runId }) });
      const data = (await response.json().catch(() => ({}))) as { triggers?: AutomationTrigger[] };
      setTriggers(data.triggers ?? []);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="ask-aval-tasks automation-timeline-card" data-reveal>
      <div className="ask-aval-tasks-heading">
        <div><h2>{t("AutomationTimeline.title")}</h2><p>{t("AutomationTimeline.subtitle")}</p></div>
      </div>
      {triggers.length === 0 ? (
        <div className="empty-column">{t("AutomationTimeline.empty")}</div>
      ) : (
        <div className="automation-trigger-list">
          {triggers.map((trigger) => (
            <div className="automation-trigger" key={trigger.insightId}>
              <div className="automation-trigger-heading">
                <span className="automation-trigger-title"><BrandMark provider={trigger.channel} small/><strong>{t(trigger.titleKey)}</strong></span>
                {!trigger.run && <button type="button" className="soft-button" onClick={() => start(trigger.insightId)} disabled={busyId === trigger.insightId}><Flash width={16} height={16}/>{t("AutomationTimeline.runTrigger")}</button>}
              </div>
              {trigger.steps.length > 0 && (
                <div className="automation-timeline-steps">
                  {trigger.steps.map((step) => (
                    <div className="automation-step" key={step.id}>
                      <BrandMark provider={stepChannel(step, trigger.channel)} small/>
                      <div><strong>{step.actorLabel}</strong><p>{step.summary}</p></div>
                    </div>
                  ))}
                </div>
              )}
              {trigger.run?.status === "running" && (
                <button type="button" className="primary-button" onClick={() => approve(trigger.insightId, trigger.run!.id)} disabled={busyId === trigger.insightId}><Check width={17} height={17}/>{t("AutomationTimeline.approve")}</button>
              )}
              {trigger.run?.status === "resolved" && <p className="draft-task-sent"><Check width={14} height={14}/>{t("AutomationTimeline.resolved")}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
