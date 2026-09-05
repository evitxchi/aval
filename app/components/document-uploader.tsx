"use client";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, Page, Refresh, Upload, Xmark } from "iconoir-react";
import { MAX_DOCUMENT_CHARS } from "@/lib/documents/types";
export interface UploadedDocument {
  id: string;
  title: string;
  kind: string;
  charCount: number;
  createdAt: string;
}
type UploadState =
  "reading" | "uploading" | "processing" | "complete" | "error" | "cancelled";
type UploadRow = {
  id: string;
  file: File;
  state: UploadState;
  progress: number;
  message?: string;
  truncated?: boolean;
};
const accepted = /\.(txt|md|csv|json|xml|log)$/i;
export function DocumentUploader({
  disabled,
  onUploaded,
}: {
  disabled: boolean;
  onUploaded: (row: UploadedDocument) => void;
}) {
  const t = useTranslations("Uploads");
  const [rows, setRows] = useState<UploadRow[]>([]),
    [dragging, setDragging] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const requests = useRef(new Map<string, XMLHttpRequest>()),
    cancelled = useRef(new Set<string>()),
    live = useRef(true),
    onSave = useRef(onUploaded);
  useEffect(() => {
    onSave.current = onUploaded;
  }, [onUploaded]);
  useEffect(() => {
    live.current = true;
    const active = requests.current;
    return () => {
      live.current = false;
      for (const r of active.values()) r.abort();
      active.clear();
    };
  }, []);
  const update = (id: string, patch: Partial<UploadRow>) => {
    if (live.current)
      setRows((old) => old.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  async function send(row: UploadRow) {
    cancelled.current.delete(row.id);
    update(row.id, { state: "reading", progress: 0, message: undefined });
    try {
      const text = (await row.file.text()).trim();
      if (!live.current || cancelled.current.has(row.id)) return;
      if (!text) throw Error(t("emptyFile"));
      if (text.includes("\u0000")) throw Error(t("textOnly"));
      const request = new XMLHttpRequest();
      requests.current.set(row.id, request);
      request.open("POST", "/api/documents");
      request.setRequestHeader("content-type", "application/json");
      request.timeout = 60000;
      update(row.id, {
        state: "uploading",
        truncated: text.length > MAX_DOCUMENT_CHARS,
      });
      request.upload.onprogress = (event) => {
        if (!cancelled.current.has(row.id) && event.lengthComputable)
          update(row.id, {
            progress: Math.min(
              99,
              Math.round((event.loaded / event.total) * 100),
            ),
          });
      };
      request.upload.onload = () => {
        if (!cancelled.current.has(row.id))
          update(row.id, { state: "processing", progress: 99 });
      };
      request.onload = () => {
        requests.current.delete(row.id);
        if (!live.current || cancelled.current.has(row.id)) return;
        try {
          if (request.status < 200 || request.status >= 300) throw Error();
          const body = JSON.parse(request.responseText) as {
            document: UploadedDocument & { truncated: boolean };
          };
          if (!body.document?.id) throw Error();
          onSave.current(body.document);
          update(row.id, {
            state: "complete",
            progress: 100,
            truncated:
              text.length > MAX_DOCUMENT_CHARS || body.document.truncated,
          });
        } catch {
          update(row.id, { state: "error", message: t("failed") });
        }
      };
      request.onerror = request.ontimeout = () => {
        requests.current.delete(row.id);
        update(row.id, { state: "error", message: t("failed") });
      };
      request.onabort = () => {
        requests.current.delete(row.id);
        update(row.id, { state: "cancelled" });
      };
      // A stable request ID makes a retry safe if the first response was lost.
      request.send(
        JSON.stringify({
          requestId: row.id,
          title: row.file.name,
          kind: "other",
          contentText: text.slice(0, MAX_DOCUMENT_CHARS),
        }),
      );
    } catch (cause) {
      update(row.id, {
        state: "error",
        message: cause instanceof Error ? cause.message : t("failed"),
      });
    }
  }
  const add = (files: FileList | File[]) => {
    if (disabled) return;
    setError("");
    const selected = Array.from(files);
    if (selected.length > 10) {
      setError(t("tooMany"));
      return;
    }
    const valid = selected.filter(
      (f) => accepted.test(f.name) && f.size <= 2 * 1024 * 1024,
    );
    if (valid.length !== selected.length) setError(t("limits"));
    const next = valid.map((file) => ({
      id: crypto.randomUUID(),
      file,
      state: "reading" as const,
      progress: 0,
    }));
    setRows((old) => [...old, ...next]);
    next.forEach((row) => void send(row));
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  };
  return (
    <section className="document-upload-panel" aria-label={t("title")}>
      <div className="document-upload-heading">
        <span className="upload-heading-icon">
          <Upload width={22} height={22} />
        </span>
        <div>
          <h2>{t("title")}</h2>
          <p>{t("description")}</p>
        </div>
      </div>
      <div
        className={`document-dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <Upload width={25} height={25} />
        <div>
          <p>
            {t("drop")}{" "}
            <button
              type="button"
              disabled={disabled}
              onClick={() => input.current?.click()}
            >
              {t("choose")}
            </button>
          </p>
          <small>{t(disabled ? "signIn" : "limits")}</small>
        </div>
        <input
          ref={input}
          type="file"
          accept=".txt,.md,.csv,.json,.xml,.log"
          multiple
          hidden
          disabled={disabled}
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      <div className="upload-queue" aria-live="polite">
        {rows.map((row) => (
          <div key={row.id} className={`upload-file ${row.state}`}>
            <span className="upload-file-icon">
              <Page width={20} height={20} />
              <small>{row.file.name.split(".").pop()?.toUpperCase()}</small>
            </span>
            <div className="upload-file-main">
              <strong>{row.file.name}</strong>
              <span>
                {row.state === "complete" && (
                  <CheckCircle width={13} height={13} />
                )}{" "}
                {t(row.state)} · {Math.ceil(row.file.size / 1024)} KB{" "}
                {row.state === "uploading" && `· ${row.progress}%`}
              </span>
              {row.message && (
                <small className="settings-error">{row.message}</small>
              )}
              {row.truncated && row.state === "complete" && (
                <small>{t("truncated", { count: MAX_DOCUMENT_CHARS })}</small>
              )}
            </div>
            {row.state === "error" || row.state === "cancelled" ? (
              <button
                type="button"
                className="icon-button"
                aria-label={t("retryFile", { name: row.file.name })}
                onClick={() => void send(row)}
              >
                <Refresh width={16} height={16} />
              </button>
            ) : row.state !== "complete" ? (
              <button
                type="button"
                className="icon-button"
                aria-label={t("cancelFile", { name: row.file.name })}
                onClick={() => {
                  cancelled.current.add(row.id);
                  requests.current.get(row.id)?.abort();
                  update(row.id, { state: "cancelled" });
                }}
              >
                <Xmark width={16} height={16} />
              </button>
            ) : (
              <button
                type="button"
                className="icon-button"
                aria-label={t("dismissFile", { name: row.file.name })}
                onClick={() =>
                  setRows((old) => old.filter((r) => r.id !== row.id))
                }
              >
                <Xmark width={16} height={16} />
              </button>
            )}
            {["reading", "uploading", "processing"].includes(row.state) && (
              <progress
                max={100}
                value={row.state === "reading" ? undefined : row.progress}
                aria-label={t("progressFor", { name: row.file.name })}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
