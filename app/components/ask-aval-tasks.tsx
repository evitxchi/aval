"use client";
/* eslint-disable jsx-a11y/no-autofocus */

/**
 * "Ask Aval Tasks" — drafts (proposals, memos, reports) that Claude is
 * writing, live. Each job is a real call to /api/assistant/draft (the same
 * tool-loop + faithfulness gate as Ask Aval's chat answers); several can run
 * at once since each is just an independent fetch. The progressive reveal
 * you see in the preview plays out client-side once the verified document
 * arrives — pausing/resuming controls that playback, not the model call
 * itself (which has already finished by the time the first words appear).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Check, Clock, Download, NavArrowRight, Page, Pause, Play, RefreshDouble, SendDiagonal, WarningTriangle, Xmark,
} from "iconoir-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useExperience } from "@/app/components/experience";
import { exportDocx, exportPdf, exportPptx, exportXlsx } from "@/lib/ask-aval/export";
import { MarkdownPreview } from "@/app/components/markdown-preview";

export type DraftFormat = "docx" | "xlsx" | "pptx";
export type DraftStatus = "queued" | "streaming" | "paused" | "done" | "error";

export interface CreateDraftInput {
  title: string;
  instructions: string;
  format: DraftFormat;
  moduleLabel?: string;
  moduleSnapshot?: string;
}

interface DraftMetric { label: string; value: number | string; unit?: string }

export interface DraftJob {
  id: string;
  input: CreateDraftInput;
  status: DraftStatus;
  content: string;
  fullText: string;
  headline?: string;
  metrics?: DraftMetric[];
  confidence?: "high" | "medium" | "low";
  error?: string;
  progress: number;
  createdAt: number;
  sentTo?: string;
}

const REVEAL_TICK_MS = 55;
const REVEAL_TICKS = 140;

function wordChunks(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}

export function useDraftJobs(locale: string) {
  const [jobs, setJobs] = useState<DraftJob[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const timers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const wordCache = useRef(new Map<string, string[]>());

  const patchJob = useCallback((id: string, patch: Partial<DraftJob> | ((job: DraftJob) => Partial<DraftJob>)) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...(typeof patch === "function" ? patch(job) : patch) } : job)));
  }, []);

  const stopReveal = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) { clearInterval(timer); timers.current.delete(id); }
  }, []);

  const startReveal = useCallback((id: string, fullText: string, fromChars: number) => {
    stopReveal(id);
    let words = wordCache.current.get(id);
    if (!words) { words = wordChunks(fullText); wordCache.current.set(id, words); }
    const chunkSize = Math.max(1, Math.ceil(words.length / REVEAL_TICKS));
    let revealedChars = fromChars;
    let wordIndex = 0;
    let seen = 0;
    for (const word of words) {
      seen += word.length;
      wordIndex++;
      if (seen >= revealedChars) break;
    }
    const timer = setInterval(() => {
      wordIndex = Math.min(words!.length, wordIndex + chunkSize);
      const text = words!.slice(0, wordIndex).join("");
      revealedChars = text.length;
      const progress = Math.min(100, Math.round((revealedChars / Math.max(1, fullText.length)) * 100));
      patchJob(id, { content: text, progress });
      if (wordIndex >= words!.length) {
        stopReveal(id);
        patchJob(id, { status: "done", content: fullText, progress: 100 });
      }
    }, REVEAL_TICK_MS);
    timers.current.set(id, timer);
  }, [patchJob, stopReveal]);

  const runFetch = useCallback((id: string, input: CreateDraftInput) => {
    const controller = new AbortController();
    controllers.current.set(id, controller);
    patchJob(id, { status: "queued", progress: 0 });

    (async () => {
      try {
        const response = await fetch("/api/assistant/draft", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            title: input.title,
            instructions: input.instructions,
            format: input.format,
            locale,
            moduleLabel: input.moduleLabel,
            moduleSnapshot: input.moduleSnapshot,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
        if (!response.ok || typeof data.headline !== "string" || typeof data.document !== "string") {
          throw new Error(typeof data.error === "string" ? data.error : "The draft could not be generated.");
        }
        controllers.current.delete(id);
        patchJob(id, {
          status: "streaming",
          fullText: data.document as string,
          headline: data.headline as string,
          metrics: Array.isArray(data.metrics) ? (data.metrics as DraftMetric[]) : [],
          confidence: (data.confidence as DraftJob["confidence"]) ?? undefined,
        });
        startReveal(id, data.document as string, 0);
      } catch (err) {
        controllers.current.delete(id);
        if (err instanceof Error && err.name === "AbortError") return; // paused before it arrived — pauseJob already set status
        patchJob(id, { status: "error", error: err instanceof Error ? err.message : "The draft could not be generated." });
      }
    })();
  }, [locale, patchJob, startReveal]);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/assistant/documents");
        const data = (await response.json()) as { documents?: Array<{ id: string; title: string; instructions: string; format: DraftFormat; status: string; headline?: string; document?: string; metrics?: DraftMetric[]; confidence?: DraftJob["confidence"]; error?: string; sentTo?: string; createdAt: number }> };
        const persisted = (data.documents ?? []).map((row): DraftJob => ({
          id: row.id,
          input: { title: row.title, instructions: row.instructions, format: row.format },
          status: row.status === "done" ? "done" : "error",
          content: row.document ?? "",
          fullText: row.document ?? "",
          headline: row.headline,
          metrics: row.metrics,
          confidence: row.confidence,
          error: row.error,
          progress: row.status === "done" ? 100 : 0,
          createdAt: row.createdAt,
          sentTo: row.sentTo,
        }));
        if (persisted.length > 0) setJobs((current) => [...persisted, ...current]);
      } catch { /* not fatal, the section just starts empty */ }
    })();
  }, []);

  const createJob = useCallback((input: CreateDraftInput): string => {
    const id = crypto.randomUUID();
    const job: DraftJob = { id, input, status: "queued", content: "", fullText: "", progress: 0, createdAt: Date.now() };
    setJobs((current) => [job, ...current]);
    runFetch(id, input);
    return id;
  }, [runFetch]);

  const pauseJob = useCallback((id: string) => {
    setJobs((current) => current.map((job) => {
      if (job.id !== id) return job;
      if (job.status === "queued") controllers.current.get(id)?.abort();
      if (job.status === "streaming") stopReveal(id);
      return job.status === "queued" || job.status === "streaming" ? { ...job, status: "paused" } : job;
    }));
  }, [stopReveal]);

  const resumeJob = useCallback((id: string) => {
    setJobs((current) => {
      const job = current.find((j) => j.id === id);
      if (!job || job.status !== "paused") return current;
      if (job.fullText) {
        startReveal(id, job.fullText, job.content.length);
        return current.map((j) => (j.id === id ? { ...j, status: "streaming" } : j));
      }
      runFetch(id, job.input);
      return current;
    });
  }, [runFetch, startReveal]);

  const retryJob = useCallback((id: string) => {
    setJobs((current) => {
      const job = current.find((j) => j.id === id);
      if (!job) return current;
      wordCache.current.delete(id);
      runFetch(id, job.input);
      return current.map((j) => (j.id === id ? { ...j, content: "", fullText: "", error: undefined, progress: 0 } : j));
    });
  }, [runFetch]);

  const sendJob = useCallback((id: string, recipient: string) => {
    patchJob(id, { sentTo: recipient });
    fetch("/api/assistant/documents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, sentTo: recipient }) }).catch(() => {});
  }, [patchJob]);

  useEffect(() => () => {
    timers.current.forEach((timer) => clearInterval(timer));
    controllers.current.forEach((controller) => controller.abort());
  }, []);

  return { jobs, createJob, pauseJob, resumeJob, retryJob, sendJob };
}

const STATUS_META: Record<DraftStatus, { icon: typeof Clock; labelKey: string }> = {
  queued: { icon: Clock, labelKey: "AskAvalTasks.statusQueued" },
  streaming: { icon: RefreshDouble, labelKey: "AskAvalTasks.statusStreaming" },
  paused: { icon: Pause, labelKey: "AskAvalTasks.statusPaused" },
  done: { icon: Check, labelKey: "AskAvalTasks.statusDone" },
  error: { icon: WarningTriangle, labelKey: "AskAvalTasks.statusError" },
};

function DraftJobCard({ job, onPause, onResume, onRetry, onSend }: {
  job: DraftJob;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onSend: (id: string, recipient: string) => void;
}) {
  const t = useTranslations();
  const { notify } = useExperience();
  const [recipient, setRecipient] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  const meta = STATUS_META[job.status];
  const StatusIcon = meta.icon;
  const canControl = job.status === "queued" || job.status === "streaming" || job.status === "paused";
  const done = job.status === "done";

  const runExport = async (kind: "native" | "pdf") => {
    if (!done) return;
    setExporting(kind);
    try {
      const draft = { title: job.input.title, document: job.fullText, metrics: job.metrics };
      if (kind === "pdf") await exportPdf(draft);
      else if (job.input.format === "xlsx") await exportXlsx(draft);
      else if (job.input.format === "pptx") await exportPptx(draft);
      else await exportDocx(draft);
      notify(t("AskAvalTasks.downloadReady"), job.input.title);
    } catch {
      notify(t("AskAvalTasks.exportFailed"));
    } finally {
      setExporting(null);
    }
  };

  const submitSend = () => {
    if (!recipient.trim()) return;
    onSend(job.id, recipient.trim());
    notify(t("AskAvalTasks.sentToInbox", { recipient: recipient.trim() }), job.input.title);
    setRecipient("");
  };

  return (
    <article className={`draft-task-card status-${job.status}`}>
      <div className="draft-task-top">
        <span className={`draft-status-badge ${job.status}`}><StatusIcon width={14} height={14} />{t(meta.labelKey)}</span>
        <span className="draft-task-format">{job.input.format.toUpperCase()}</span>
      </div>
      <h3>{job.headline ?? job.input.title}</h3>
      <div className="draft-task-progress">
        <div className={`draft-task-progress-bar ${job.status === "queued" ? "indeterminate" : ""}`} style={job.status === "queued" ? undefined : { width: `${job.progress}%` }} />
      </div>
      {job.status === "error" ? (
        <p className="draft-task-error">{job.error}</p>
      ) : (
        <div className="draft-task-preview" aria-live="polite">{job.content ? <MarkdownPreview text={job.content} /> : t("AskAvalTasks.waitingOnAval")}</div>
      )}
      <div className="draft-task-actions">
        {canControl && job.status !== "queued" && (
          <button type="button" className="soft-button" onClick={() => (job.status === "paused" ? onResume(job.id) : onPause(job.id))}>
            {job.status === "paused" ? <Play width={16} height={16} /> : <Pause width={16} height={16} />}
            {job.status === "paused" ? t("AskAvalTasks.resume") : t("AskAvalTasks.pause")}
          </button>
        )}
        {job.status === "queued" && <button type="button" className="soft-button" onClick={() => onPause(job.id)}><Pause width={16} height={16} />{t("AskAvalTasks.pause")}</button>}
        {job.status === "error" && <button type="button" className="soft-button" onClick={() => onRetry(job.id)}><RefreshDouble width={16} height={16} />{t("AskAvalTasks.retry")}</button>}
        {done && (
          <>
            <button type="button" className="soft-button" disabled={exporting !== null} onClick={() => runExport("native")}>
              <Download width={16} height={16} />{exporting === "native" ? t("AskAvalTasks.exporting") : t("AskAvalTasks.downloadFormat", { format: job.input.format.toUpperCase() })}
            </button>
            <button type="button" className="soft-button" disabled={exporting !== null} onClick={() => runExport("pdf")}>
              <Page width={16} height={16} />{exporting === "pdf" ? t("AskAvalTasks.exporting") : t("AskAvalTasks.downloadPdf")}
            </button>
          </>
        )}
      </div>
      {done && !job.sentTo && (
        <div className="draft-task-send">
          <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={t("AskAvalTasks.sendToPlaceholder")} onKeyDown={(event) => event.key === "Enter" && submitSend()} />
          <button type="button" onClick={submitSend} disabled={!recipient.trim()} aria-label={t("AskAvalTasks.sendToInboxAction")}><SendDiagonal width={16} height={16} /></button>
        </div>
      )}
      {job.sentTo && <p className="draft-task-sent"><Check width={14} height={14} />{t("AskAvalTasks.sentTo", { recipient: job.sentTo })}</p>}
    </article>
  );
}

export function AskAvalTasksSection({ jobs, onCreate, onPause, onResume, onRetry, onSend }: {
  jobs: DraftJob[];
  onCreate: (input: CreateDraftInput) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onSend: (id: string, recipient: string) => void;
}) {
  const t = useTranslations();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [format, setFormat] = useState<DraftFormat>("docx");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !instructions.trim()) return;
    onCreate({ title: title.trim(), instructions: instructions.trim(), format });
    setTitle(""); setInstructions(""); setFormat("docx"); setCreating(false);
  };

  return (
    <section className="ask-aval-tasks" data-reveal>
      <div className="ask-aval-tasks-heading">
        <div><h2>{t("AskAvalTasks.sectionTitle")}</h2><p>{t("AskAvalTasks.sectionSubtitle")}</p></div>
        <button type="button" className="primary-button" onClick={() => setCreating(true)}><Page width={17} height={17} />{t("AskAvalTasks.newDraft")}</button>
      </div>
      {jobs.length === 0 ? (
        <div className="empty-column">{t("AskAvalTasks.noDraftsYet")}</div>
      ) : (
        <div className="draft-task-grid">
          {jobs.map((job) => <DraftJobCard key={job.id} job={job} onPause={onPause} onResume={onResume} onRetry={onRetry} onSend={onSend} />)}
        </div>
      )}

      <Dialog.Root open={creating} onOpenChange={setCreating}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="small-dialog">
            <div className="dialog-top"><Dialog.Title>{t("AskAvalTasks.newDraft")}</Dialog.Title><Dialog.Close className="icon-button"><Xmark width={20} height={20} /></Dialog.Close></div>
            <form onSubmit={submit}>
              <label>{t("AskAvalTasks.draftTitleLabel")}
                <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("AskAvalTasks.draftTitlePlaceholder")} />
              </label>
              <label>{t("AskAvalTasks.instructionsLabel")}
                <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={t("AskAvalTasks.instructionsPlaceholder")} />
              </label>
              <label>{t("AskAvalTasks.formatLabel")}
                <select value={format} onChange={(event) => setFormat(event.target.value as DraftFormat)}>
                  <option value="docx">{t("AskAvalTasks.formatDocx")}</option>
                  <option value="xlsx">{t("AskAvalTasks.formatXlsx")}</option>
                  <option value="pptx">{t("AskAvalTasks.formatPptx")}</option>
                </select>
              </label>
              <div className="dialog-actions">
                <Dialog.Close className="soft-button">{t("AskAvalTasks.cancel")}</Dialog.Close>
                <button className="primary-button" type="submit" disabled={!title.trim() || !instructions.trim()}>
                  <NavArrowRight width={17} height={17} />{t("AskAvalTasks.startDrafting")}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
