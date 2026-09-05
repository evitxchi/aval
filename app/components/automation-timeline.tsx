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
  title: string;
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
  const [error, setError] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/automations", {
          signal: abort.signal,
          cache: "no-store",
        });
        if (!response.ok) throw Error();
        const data = (await response.json()) as {
          triggers?: AutomationTrigger[];
        };
        if (!abort.signal.aborted) setTriggers(data.triggers ?? []);
      } catch {
        if (!abort.signal.aborted) setError(true);
      }
    })();
    return () => abort.abort();
  }, []);

  const start = async (insightId: string) => {
    setBusyId(insightId);
    setError(false);
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", insightId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        triggers?: AutomationTrigger[];
      };
      if (data.triggers) setTriggers(data.triggers);
      if (!response.ok) setError(true);
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (insightId: string, runId: string) => {
    setBusyId(insightId);
    setError(false);
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", runId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        triggers?: AutomationTrigger[];
      };
      if (data.triggers) setTriggers(data.triggers);
      if (!response.ok) setError(true);
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="ask-aval-tasks automation-timeline-card" data-reveal>
      <div className="ask-aval-tasks-heading">
        <div>
          <h2>{t("AutomationTimeline.title")}</h2>
          <p>{t("AutomationTimeline.subtitle")}</p>
        </div>
      </div>
      {error && (
        <p className="enterprise-error" role="alert">
          {t("Enterprise.loadError")}
        </p>
      )}
      {triggers.length === 0 ? (
        <div className="empty-column">{t("AutomationTimeline.empty")}</div>
      ) : (
        <div className="automation-trigger-list">
          {triggers.map((trigger) => (
            <div className="automation-trigger" key={trigger.insightId}>
              <div className="automation-trigger-heading">
                <span className="automation-trigger-title">
                  <BrandMark provider={trigger.channel} small />
                  <strong>{trigger.title}</strong>
                </span>
                {(!trigger.run || trigger.run.status === "failed") && (
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => start(trigger.insightId)}
                    disabled={busyId === trigger.insightId}
                  >
                    <Flash width={16} height={16} />
                    {t("AutomationTimeline.runTrigger")}
                  </button>
                )}
              </div>
              {trigger.steps.length > 0 && (
                <div className="automation-timeline-steps">
                  {trigger.steps.map((step) => (
                    <div className="automation-step" key={step.id}>
                      <BrandMark
                        provider={stepChannel(step, trigger.channel)}
                        small
                      />
                      <div>
                        <strong>{step.actorLabel}</strong>
                        <p>{step.summary}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {trigger.run?.status === "awaiting_approval" && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => approve(trigger.insightId, trigger.run!.id)}
                  disabled={busyId === trigger.insightId}
                >
                  <Check width={17} height={17} />
                  {t("AutomationTimeline.approve")}
                </button>
              )}
              {trigger.run?.status === "resolved" && (
                <p className="draft-task-sent">
                  <Check width={14} height={14} />
                  {t("AutomationTimeline.resolved")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
