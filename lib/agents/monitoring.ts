export interface AgentMonitoringEnv {
  AGENT_ALERT_WEBHOOK_URL?: string;
  AGENT_ALERT_WEBHOOK_TOKEN?: string;
}

export interface AgentOperationalAlert {
  severity: "warning" | "critical";
  code: "worker_failed" | "task_failed" | "reconciliation_discrepancy";
  runId?: string;
  taskId?: string;
  count?: number;
  occurredAt: string;
}

/**
 * Payload-free operational alerting. A webhook is optional, but when present
 * it must be HTTPS and return success. No task goal, arguments, result, tenant
 * name, financial value, or provider response can enter this shape.
 */
export async function emitAgentOperationalAlert(env: AgentMonitoringEnv, alert: AgentOperationalAlert): Promise<void> {
  if (!env.AGENT_ALERT_WEBHOOK_URL) return;
  let url: URL;
  try { url = new URL(env.AGENT_ALERT_WEBHOOK_URL); } catch { throw new Error("AGENT_ALERT_WEBHOOK_URL is invalid."); }
  if (url.protocol !== "https:") throw new Error("AGENT_ALERT_WEBHOOK_URL must use HTTPS.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.AGENT_ALERT_WEBHOOK_TOKEN ? { authorization: `Bearer ${env.AGENT_ALERT_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify({ source: "aval-agent-runtime", ...alert }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Agent alert webhook returned ${response.status}.`);
  } finally {
    clearTimeout(timer);
  }
}
