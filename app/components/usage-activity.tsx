"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
/** Records a minute only while Aval is visible, focused, and recently interacted with. */
export function UsageRecorder({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let lastInteraction = Date.now(),
      lastMinute = -1,
      busy = false;
    const abort = new AbortController();
    const record = async () => {
      const now = Date.now(),
        minute = Math.floor(now / 60000);
      if (
        busy ||
        minute === lastMinute ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        now - lastInteraction > 60000
      )
        return;
      busy = true;
      try {
        const response = await fetch("/api/workspace/activity", {
          method: "POST",
          signal: abort.signal,
        });
        if (response.ok) {
          lastMinute = minute;
          window.dispatchEvent(new Event("aval:activity"));
        }
      } catch {
        /* Failed requests are retried after the next interaction. */
      } finally {
        busy = false;
      }
    };
    const interact = () => {
      lastInteraction = Date.now();
      void record();
    };
    const focus = () => {
      if (document.visibilityState === "visible") interact();
    };
    for (const event of [
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
    ] as const)
      window.addEventListener(event, interact, { passive: true });
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const timer = window.setInterval(() => void record(), 15000);
    void record();
    return () => {
      abort.abort();
      window.clearInterval(timer);
      for (const event of [
        "pointerdown",
        "keydown",
        "wheel",
        "touchstart",
      ] as const)
        window.removeEventListener(event, interact);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [enabled]);
  return null;
}
interface Activity {
  today: string;
  since: string;
  days: { date: string; minutes: number }[];
}
export function UsageGrid() {
  const t = useTranslations("UsageActivity"),
    locale = useLocale();
  const [data, setData] = useState<Activity | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/workspace/activity", {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!response.ok) throw Error();
        const body = (await response.json()) as Activity;
        if (!abort.signal.aborted) {
          setData(body);
          setError(false);
        }
      } catch {
        if (!abort.signal.aborted) setError(true);
      }
    };
    void refresh();
    window.addEventListener("aval:activity", refresh);
    return () => {
      abort.abort();
      window.removeEventListener("aval:activity", refresh);
    };
  }, []);
  const lookup = new Map(data?.days.map((day) => [day.date, day.minutes]));
  const since = data ? new Date(`${data.since}T00:00:00Z`) : null;
  const days = since
    ? Array.from({ length: 365 }, (_, i) => new Date(+since + i * 86400000))
    : [];
  const total = data?.days.reduce((sum, d) => sum + d.minutes, 0) ?? 0;
  const dayFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const monthFormat = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  });
  return (
    <section className="usage-card" aria-labelledby="aval-usage-title">
      <div className="usage-heading">
        <div>
          <p className="eyebrow" id="aval-usage-title">
            {t("title")}
          </p>
          <p>{t("description")}</p>
        </div>
        <strong>
          {data
            ? t("total", { minutes: total, days: data.days.length })
            : t(error ? "unavailable" : "loading")}
        </strong>
      </div>
      {data && (
        <div className="usage-scroll">
          <div className="usage-months" aria-hidden="true">
            {Array.from(
              { length: Math.ceil(((since?.getUTCDay() ?? 0) + 365) / 7) },
              (_, week) => {
                const d = new Date(
                  +since! + (week * 7 - since!.getUTCDay()) * 86400000,
                );
                return (
                  <span key={week}>
                    {d.getUTCDate() <= 7 ? monthFormat.format(d) : ""}
                  </span>
                );
              },
            )}
          </div>
          <div className="usage-grid" aria-label={t("title")}>
            {Array.from({ length: since?.getUTCDay() ?? 0 }, (_, i) => (
              <span key={`blank-${i}`} className="usage-cell is-padding" />
            ))}
            {days.map((date) => {
              const key = date.toISOString().slice(0, 10),
                minutes = lookup.get(key) ?? 0;
              return (
                <button
                  type="button"
                  className="usage-cell"
                  data-level={
                    minutes === 0
                      ? 0
                      : minutes < 5
                        ? 1
                        : minutes < 20
                          ? 2
                          : minutes < 60
                            ? 3
                            : 4
                  }
                  key={key}
                  title={t("day", { date: dayFormat.format(date), minutes })}
                  aria-label={t("day", {
                    date: dayFormat.format(date),
                    minutes,
                  })}
                >
                  <span className="usage-tooltip">
                    {t("day", { date: dayFormat.format(date), minutes })}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="usage-footer">
        <span>{t("note")}</span>
        <span>
          {t("less")}
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className="usage-cell" data-level={level} />
          ))}
          {t("more")}
        </span>
      </div>
    </section>
  );
}
