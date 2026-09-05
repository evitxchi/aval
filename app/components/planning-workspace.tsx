"use client";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Calendar,
  Check,
  NavArrowLeft,
  NavArrowRight,
  Plus,
  Refresh,
  Search,
  Xmark,
} from "iconoir-react";
import {
  ITEM_STATUSES,
  PROJECT_COLORS,
  overlapsWindow,
  type ItemInput,
  type PlanningData,
  type PlanningItem,
  type ProjectColor,
  type Project,
} from "@/lib/planning/types";
import { WorkspaceMembers } from "./workspace-members";
const colors: Record<ProjectColor, string> = {
  blue: "var(--viz-blue)",
  green: "var(--viz-green)",
  amber: "var(--viz-amber)",
  violet: "var(--viz-violet)",
  rose: "var(--viz-pink)",
};
const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());
const nextDay = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const localInput = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
function initialItem(day = new Date()): ItemInput {
  const date = startOfDay(day);
  date.setHours(9);
  return {
    title: "",
    description: "",
    kind: "task",
    status: "planned",
    projectId: null,
    assigneeId: null,
    startsAt: date.getTime(),
    endsAt: date.getTime() + 3600000,
  };
}
export function PlanningWorkspace({
  view,
  isGuest,
  activity,
  demoData,
  onDemoChange,
}: {
  view: "calendar" | "projects" | "teams" | "tasks";
  isGuest: boolean;
  activity?: ReactNode;
  demoData?: PlanningData;
  onDemoChange?: (data: PlanningData) => void;
}) {
  const t = useTranslations("Planning"),
    e = useTranslations("Enterprise"),
    locale = useLocale();
  const [storedData, setStoredData] = useState<PlanningData>({
      projects: [],
      items: [],
      members: [],
    }),
    [loading, setLoading] = useState(!isGuest && !demoData),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const data = demoData ?? storedData;
  const setData = (update: SetStateAction<PlanningData>) => {
    if (demoData && onDemoChange)
      onDemoChange(typeof update === "function" ? update(demoData) : update);
    else setStoredData(update);
  };
  const [anchor, setAnchor] = useState(() => startOfDay(new Date())),
    [layout, setLayout] = useState<"calendar" | "timeline" | "list" | "board">(
      view === "tasks"
        ? "board"
        : view === "calendar"
          ? "calendar"
          : "timeline",
    );
  const [query, setQuery] = useState(""),
    [projectFilter, setProjectFilter] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [assigneeFilter, setAssigneeFilter] = useState("");
  const [editor, setEditor] = useState<"item" | "project" | null>(null),
    [editing, setEditing] = useState<PlanningItem | null>(null),
    [form, setForm] = useState<ItemInput>(() => initialItem()),
    [projectForm, setProjectForm] = useState({
      title: "",
      description: "",
      color: "blue" as ProjectColor,
    }),
    [saving, setSaving] = useState(false),
    [formError, setFormError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (isGuest || demoData) return;
    const abort = new AbortController();
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const r = await fetch("/api/planning", {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!r.ok) throw Error();
        const body = (await r.json()) as PlanningData;
        if (!abort.signal.aborted) setStoredData(body);
      } catch {
        if (!abort.signal.aborted) setError(t("loadError"));
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [revision, isGuest, t, demoData]);
  const filtered = useMemo(
    () =>
      data.items.filter(
        (i) =>
          (view !== "tasks" || i.kind === "task") &&
          (!projectFilter || i.projectId === projectFilter) &&
          (!statusFilter || i.status === statusFilter) &&
          (!assigneeFilter || i.assigneeId === assigneeFilter) &&
          (!query ||
            `${i.title} ${i.description}`
              .toLocaleLowerCase(locale)
              .includes(query.toLocaleLowerCase(locale))),
      ),
    [
      view,
      data.items,
      projectFilter,
      statusFilter,
      assigneeFilter,
      query,
      locale,
    ],
  );
  const fmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(anchor);
  const weekStart = nextDay(anchor, -((anchor.getDay() + 6) % 7));
  const weekEnd = nextDay(weekStart, 7);
  const weekItems = filtered.filter((i) =>
    overlapsWindow(i, weekStart.getTime(), weekEnd.getTime() - 1),
  );
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = nextDay(monthStart, -((monthStart.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => nextDay(gridStart, i));
  const completed = filtered.filter((i) => i.status === "completed").length,
    blocked = filtered.filter((i) => i.status === "blocked").length;
  const itemColor = (i: PlanningItem) =>
    colors[data.projects.find((p) => p.id === i.projectId)?.color ?? "blue"];
  const memberName = (id: string | null) =>
    data.members.find((m) => m.userId === id)?.displayName ?? t("unassigned");
  const openItem = (item?: PlanningItem, date?: Date) => {
    setEditing(item ?? null);
    setForm(item ?? { ...initialItem(date), projectId: projectFilter || null });
    setFormError("");
    setConfirmDelete(false);
    setEditor("item");
  };
  const openProject = () => {
    setProjectForm({ title: "", description: "", color: "blue" });
    setFormError("");
    setEditor("project");
  };
  const reload = () => setRevision((n) => n + 1);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError("");
    try {
      const body =
        editor === "project"
          ? { entity: "project", ...projectForm }
          : {
              ...form,
              ...(editing ? { id: editing.id, version: editing.version } : {}),
            };
      if (demoData) {
        if (editor === "project") {
          const project = {
            ...projectForm,
            id: `demo-${crypto.randomUUID()}`,
            createdAt: Date.now(),
          };
          setData((d) => ({ ...d, projects: [project, ...d.projects] }));
          setProjectFilter(project.id);
        } else {
          const item = {
            ...form,
            id: editing?.id ?? `demo-${crypto.randomUUID()}`,
            version: (editing?.version ?? 0) + 1,
          };
          setData((d) => ({
            ...d,
            items: [...d.items.filter((i) => i.id !== item.id), item],
          }));
        }
        setEditor(null);
        return;
      }
      const response = await fetch("/api/planning", {
        method: editor === "item" && editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setFormError(t(response.status === 409 ? "conflict" : "saveError"));
        return;
      }
      const result = (await response.json()) as {
        project?: Project;
        item?: PlanningItem;
      };
      if (result.project) {
        const project = result.project;
        setData((d) => ({ ...d, projects: [project, ...d.projects] }));
        setProjectFilter(project.id);
      }
      if (result.item) {
        const item = result.item;
        setData((d) => ({
          ...d,
          items: [...d.items.filter((i) => i.id !== item.id), item].sort(
            (a, b) => a.startsAt - b.startsAt,
          ),
        }));
      }
      setEditor(null);
    } catch {
      setFormError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!editing) return;
    setSaving(true);
    setFormError("");
    try {
      if (demoData) {
        setData((d) => ({
          ...d,
          items: d.items.filter((i) => i.id !== editing.id),
        }));
        setEditor(null);
        return;
      }
      const r = await fetch("/api/planning", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editing.id, version: editing.version }),
      });
      if (!r.ok) {
        setFormError(t(r.status === 409 ? "conflict" : "saveError"));
        return;
      }
      setData((d) => ({
        ...d,
        items: d.items.filter((i) => i.id !== editing.id),
      }));
      setEditor(null);
    } catch {
      setFormError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }
  const move = (direction: number) =>
    setAnchor(
      layout === "calendar"
        ? new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
        : nextDay(anchor, direction * 7),
    );
  return (
    <div className="view-wrap planning-workspace">
      <header className="app-header">
        <div>
          <p className="eyebrow">{t("workspace")}</p>
          <h1>{t(view)}</h1>
          <p className="header-subtitle">{t(`${view}Description`)}</p>
        </div>
        <div className="header-actions">
          {view === "projects" && (
            <button
              className="soft-button"
              disabled={isGuest || loading || Boolean(error)}
              onClick={openProject}
            >
              <Plus width={16} height={16} />
              {t("newProject")}
            </button>
          )}
          {view !== "teams" && (
            <button
              className="primary-button"
              disabled={isGuest || loading || Boolean(error)}
              onClick={() => openItem()}
            >
              <Plus width={16} height={16} />
              {t("newItem")}
            </button>
          )}
        </div>
      </header>
      {activity}
      {isGuest ? (
        <div className="enterprise-empty">
          <Calendar width={30} height={30} />
          <h3>{t("signInTitle")}</h3>
          <p>{t("signInDescription")}</p>
          <a className="primary-button" href="?signin=1">
            {t("signIn")}
          </a>
        </div>
      ) : (
        <>
          {error && (
            <div className="enterprise-error" role="alert">
              {error}
              <button className="soft-button" onClick={reload}>
                {e("retry")}
              </button>
            </div>
          )}
          {loading && (
            <p className="planning-loading" role="status">
              {t("loading")}
            </p>
          )}
          {view === "teams" ? (
            <>
              <section className="team-workload">
                <h2>{t("workload")}</h2>
                <div className="team-workload-grid">
                  {data.members.map((m) => {
                    const items = data.items.filter(
                        (i) => i.assigneeId === m.userId,
                      ),
                      done = items.filter(
                        (i) => i.status === "completed",
                      ).length;
                    return (
                      <article key={m.userId}>
                        <div className="team-workload-person">
                          <span className="initials">
                            {m.displayName.slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <strong>{m.displayName}</strong>
                            <small>{m.email}</small>
                          </div>
                        </div>
                        <div className="team-workload-counts">
                          <span>
                            {t("activeCount", { count: items.length - done })}
                          </span>
                          <span>{t("completedCount", { count: done })}</span>
                        </div>
                        <progress
                          value={done}
                          max={Math.max(items.length, 1)}
                          aria-label={t("completionFor", {
                            name: m.displayName,
                          })}
                        />
                      </article>
                    );
                  })}
                </div>
              </section>
              {!demoData && <WorkspaceMembers />}
            </>
          ) : (
            <>
              {view === "projects" && (
                <div className="project-overview">
                  <button
                    className={`project-tile ${projectFilter === "" ? "is-selected" : ""}`}
                    onClick={() => setProjectFilter("")}
                  >
                    <span>{t("allProjects")}</span>
                    <strong>
                      {data.items.length}
                      <small>{t("items")}</small>
                    </strong>
                  </button>
                  {data.projects.map((p) => {
                    const items = data.items.filter(
                      (i) => i.projectId === p.id,
                    );
                    const done = items.filter(
                      (i) => i.status === "completed",
                    ).length;
                    const selected = projectFilter === p.id;
                    return (
                      <article
                        key={p.id}
                        className={`project-tile project-with-details ${selected ? "is-selected" : ""}`}
                        style={
                          {
                            "--project-color": colors[p.color],
                          } as React.CSSProperties
                        }
                      >
                        <button
                          className="project-summary-toggle"
                          aria-expanded={selected}
                          aria-controls={`project-details-${p.id}`}
                          onClick={() => setProjectFilter(selected ? "" : p.id)}
                        >
                          <span>
                            <i />
                            {p.title}
                            <NavArrowRight
                              className="project-chevron"
                              width={16}
                              height={16}
                            />
                          </span>
                          <strong>
                            {done}
                            <small>
                              / {t("itemCount", { count: items.length })}
                            </small>
                          </strong>
                          <progress
                            value={done}
                            max={Math.max(items.length, 1)}
                            aria-label={t("completionFor", { name: p.title })}
                          />
                        </button>
                        <div
                          className="project-detail-reveal"
                          id={`project-details-${p.id}`}
                          aria-hidden={!selected}
                          inert={!selected}
                        >
                          <div>
                            {p.description && <p>{p.description}</p>}
                            {items.slice(0, 5).map((item) => (
                              <button
                                className="project-detail-item"
                                key={item.id}
                                onClick={() => openItem(item)}
                              >
                                <span
                                  className={`project-item-check ${item.status === "completed" ? "is-complete" : ""}`}
                                >
                                  {item.status === "completed" && (
                                    <Check width={12} height={12} />
                                  )}
                                </span>
                                {item.title}
                              </button>
                            ))}
                            <button
                              className="project-add-item"
                              onClick={() => openItem()}
                            >
                              <Plus width={14} height={14} />
                              {t("newItem")}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <div className="enterprise-toolbar">
                <label className="enterprise-search">
                  <Search width={17} height={17} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("search")}
                    aria-label={t("search")}
                  />
                </label>
                <select
                  className="enterprise-select"
                  aria-label={t("project")}
                  value={projectFilter}
                  onChange={(event) => setProjectFilter(event.target.value)}
                >
                  <option value="">{t("allProjects")}</option>
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
                <select
                  className="enterprise-select"
                  aria-label={t("status")}
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">{t("allStatuses")}</option>
                  {ITEM_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`statuses.${s}`)}
                    </option>
                  ))}
                </select>
                <select
                  className="enterprise-select"
                  aria-label={t("assignee")}
                  value={assigneeFilter}
                  onChange={(event) => setAssigneeFilter(event.target.value)}
                >
                  <option value="">{t("everyone")}</option>
                  {data.members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  disabled={loading}
                  aria-label={e("refresh")}
                  onClick={reload}
                >
                  <Refresh width={17} height={17} />
                </button>
              </div>
              <div className="planning-view-bar">
                <div className="segmented" role="group" aria-label={t("view")}>
                  {(["board", "calendar", "timeline", "list"] as const).map(
                    (v) => (
                      <button
                        key={v}
                        className={layout === v ? "active" : ""}
                        aria-pressed={layout === v}
                        onClick={() => setLayout(v)}
                      >
                        {t(v)}
                      </button>
                    ),
                  )}
                </div>
                {(layout === "calendar" || layout === "timeline") && (
                  <div className="planning-dates">
                    <button
                      className="icon-button"
                      onClick={() => move(-1)}
                      aria-label={t("previous")}
                    >
                      <NavArrowLeft width={16} height={16} />
                    </button>
                    <strong>
                      {layout === "calendar"
                        ? monthLabel
                        : `${fmt.format(weekStart)} – ${fmt.format(nextDay(weekStart, 6))}`}
                    </strong>
                    <button
                      className="icon-button"
                      onClick={() => move(1)}
                      aria-label={t("next")}
                    >
                      <NavArrowRight width={16} height={16} />
                    </button>
                    <button
                      className="soft-button"
                      onClick={() => setAnchor(startOfDay(new Date()))}
                    >
                      {t("today")}
                    </button>
                  </div>
                )}
              </div>
              <div className="planning-summary">
                <span>
                  <i style={{ background: "var(--viz-blue)" }} />
                  {t("activeCount", {
                    count: filtered.length - completed - blocked,
                  })}
                </span>
                <span>
                  <i style={{ background: "var(--viz-amber)" }} />
                  {t("blockedCount", { count: blocked })}
                </span>
                <span>
                  <i style={{ background: "var(--viz-green)" }} />
                  {t("completedCount", { count: completed })}
                </span>
                <small>{t("localTime")}</small>
              </div>
              {layout === "board" && (
                <div className="planning-board">
                  {ITEM_STATUSES.map((status) => {
                    const items = filtered.filter(
                      (item) => item.status === status,
                    );
                    return (
                      <section className="planning-board-column" key={status}>
                        <header>
                          <span className={`enterprise-status ${status}`}>
                            {t(`statuses.${status}`)}
                          </span>
                          <span>{items.length}</span>
                        </header>
                        {items.map((item) => (
                          <button
                            className="planning-board-card"
                            key={item.id}
                            onClick={() => openItem(item)}
                          >
                            <span className="planning-board-project">
                              <i style={{ background: itemColor(item) }} />
                              {data.projects.find(
                                (p) => p.id === item.projectId,
                              )?.title ?? t("noProject")}
                            </span>
                            <strong>{item.title}</strong>
                            {item.description && <p>{item.description}</p>}
                            <footer>
                              <span>{memberName(item.assigneeId)}</span>
                              <time
                                dateTime={new Date(item.endsAt).toISOString()}
                              >
                                {fmt.format(item.endsAt)}
                              </time>
                            </footer>
                          </button>
                        ))}
                        {!items.length && (
                          <p className="planning-board-empty">{t("noItems")}</p>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
              {layout === "calendar" && (
                <div className="calendar-scroll">
                  <div className="planning-calendar">
                    <div className="calendar-weekdays">
                      {days.slice(0, 7).map((d) => (
                        <span key={d.getTime()}>
                          {new Intl.DateTimeFormat(locale, {
                            weekday: "short",
                          }).format(d)}
                        </span>
                      ))}
                    </div>
                    <div className="calendar-days">
                      {days.map((day) => {
                        const dayItems = filtered.filter((i) =>
                          overlapsWindow(
                            i,
                            day.getTime(),
                            nextDay(day, 1).getTime() - 1,
                          ),
                        );
                        return (
                          <div
                            className={`calendar-day ${day.getMonth() !== anchor.getMonth() ? "outside" : ""} ${day.getTime() === startOfDay(new Date()).getTime() ? "today" : ""}`}
                            key={day.getTime()}
                          >
                            <button
                              className="calendar-day-number"
                              aria-label={t("addOnDate", {
                                date: fmt.format(day),
                              })}
                              disabled={loading || Boolean(error)}
                              onClick={() => openItem(undefined, day)}
                            >
                              <time
                                dateTime={`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`}
                              >
                                {day.getDate()}
                              </time>
                              <Plus width={12} height={12} />
                            </button>
                            {dayItems.map((item) => (
                              <button
                                key={item.id}
                                className={`calendar-event ${item.status}`}
                                style={
                                  {
                                    "--event-color": itemColor(item),
                                  } as React.CSSProperties
                                }
                                onClick={() => openItem(item)}
                              >
                                <span>
                                  {item.kind === "event" ? (
                                    new Intl.DateTimeFormat(locale, {
                                      hour: "numeric",
                                      minute: "2-digit",
                                    }).format(item.startsAt)
                                  ) : item.status === "completed" ? (
                                    <Check width={12} height={12} />
                                  ) : null}
                                </span>
                                <strong>{item.title}</strong>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {layout === "timeline" && (
                <div className="timeline-scroll">
                  <div className="planning-timeline">
                    <div className="timeline-heading">
                      <span>{t("scheduledWork")}</span>
                      <div>
                        {Array.from({ length: 7 }, (_, i) =>
                          nextDay(weekStart, i),
                        ).map((d) => (
                          <span key={d.getTime()}>
                            {new Intl.DateTimeFormat(locale, {
                              weekday: "short",
                              day: "numeric",
                            }).format(d)}
                          </span>
                        ))}
                      </div>
                    </div>
                    {weekItems.map((item) => {
                      const start = Math.max(
                          0,
                          ((item.startsAt - weekStart.getTime()) /
                            (weekEnd.getTime() - weekStart.getTime())) *
                            100,
                        ),
                        end = Math.min(
                          100,
                          ((item.endsAt - weekStart.getTime()) /
                            (weekEnd.getTime() - weekStart.getTime())) *
                            100,
                        );
                      return (
                        <div className="timeline-row" key={item.id}>
                          <button
                            className="timeline-label"
                            onClick={() => openItem(item)}
                          >
                            <strong>{item.title}</strong>
                            <small>{memberName(item.assigneeId)}</small>
                          </button>
                          <div className="timeline-track">
                            <button
                              className={`timeline-event ${item.status}`}
                              aria-label={`${item.title}, ${fmt.format(item.startsAt)} – ${fmt.format(item.endsAt)}`}
                              style={
                                {
                                  left: `${start}%`,
                                  width: `${Math.max(1.3, end - start)}%`,
                                  "--event-color": itemColor(item),
                                } as React.CSSProperties
                              }
                              onClick={() => openItem(item)}
                            >
                              <span>{item.title}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {!weekItems.length && (
                      <p className="timeline-empty">{t("nothingThisWeek")}</p>
                    )}
                  </div>
                </div>
              )}
              {layout === "list" && (
                <div className="enterprise-table-wrap">
                  <table className="enterprise-table">
                    <thead>
                      <tr>
                        {[
                          "title",
                          "project",
                          "assignee",
                          "schedule",
                          "status",
                        ].map((k) => (
                          <th key={k} scope="col">
                            {t(k)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <button
                              className="planning-item-link"
                              onClick={() => openItem(item)}
                            >
                              {item.title}
                            </button>
                          </td>
                          <td>
                            {data.projects.find((p) => p.id === item.projectId)
                              ?.title ?? "—"}
                          </td>
                          <td>{memberName(item.assigneeId)}</td>
                          <td>
                            {fmt.format(item.startsAt)} –{" "}
                            {fmt.format(item.endsAt)}
                          </td>
                          <td>
                            <span
                              className={`enterprise-status ${item.status}`}
                            >
                              {t(`statuses.${item.status}`)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filtered.length && (
                    <p className="timeline-empty">{t("noItems")}</p>
                  )}
                </div>
              )}
              {!data.items.length && !loading && !error && (
                <p className="planning-hint">{t("startPlanning")}</p>
              )}
            </>
          )}
        </>
      )}
      <Dialog.Root
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setEditor(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="small-dialog planning-dialog"
            onOpenAutoFocus={() => setConfirmDelete(false)}
          >
            <div className="dialog-top">
              <Dialog.Title>
                {t(
                  editor === "project"
                    ? "newProject"
                    : editing
                      ? "editItem"
                      : "newItem",
                )}
              </Dialog.Title>
              <Dialog.Close
                className="icon-button"
                disabled={saving}
                aria-label={e("close")}
              >
                <Xmark width={18} height={18} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="planning-dialog-description">
              {t(editor === "project" ? "projectHelp" : "itemHelp")}
            </Dialog.Description>
            <form onSubmit={submit}>
              <fieldset disabled={saving} className="planning-form">
                {editor === "project" ? (
                  <>
                    <label>
                      {t("title")}
                      <input
                        required
                        maxLength={160}
                        value={projectForm.title}
                        onChange={(event) =>
                          setProjectForm((f) => ({
                            ...f,
                            title: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      {t("description")}
                      <textarea
                        maxLength={5000}
                        value={projectForm.description}
                        onChange={(event) =>
                          setProjectForm((f) => ({
                            ...f,
                            description: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      {t("color")}
                      <select
                        value={projectForm.color}
                        onChange={(event) =>
                          setProjectForm((f) => ({
                            ...f,
                            color: event.target.value as ProjectColor,
                          }))
                        }
                      >
                        {PROJECT_COLORS.map((c) => (
                          <option key={c} value={c}>
                            {t(`colors.${c}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      {t("title")}
                      <input
                        required
                        maxLength={160}
                        value={form.title}
                        onChange={(event) =>
                          setForm((f) => ({ ...f, title: event.target.value }))
                        }
                      />
                    </label>
                    <div className="planning-form-pair">
                      <label>
                        {t("type")}
                        <select
                          value={form.kind}
                          onChange={(event) =>
                            setForm((f) => ({
                              ...f,
                              kind: event.target.value as ItemInput["kind"],
                            }))
                          }
                        >
                          <option value="task">{t("task")}</option>
                          <option value="event">{t("event")}</option>
                        </select>
                      </label>
                      <label>
                        {t("status")}
                        <select
                          value={form.status}
                          onChange={(event) =>
                            setForm((f) => ({
                              ...f,
                              status: event.target.value as ItemInput["status"],
                            }))
                          }
                        >
                          {ITEM_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t(`statuses.${s}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="planning-form-pair">
                      <label>
                        {t("starts")}
                        <input
                          type="datetime-local"
                          required
                          value={localInput(form.startsAt)}
                          onChange={(event) => {
                            const n = new Date(event.target.value).getTime();
                            if (Number.isFinite(n))
                              setForm((f) => ({
                                ...f,
                                startsAt: n,
                                endsAt: Math.max(n, f.endsAt),
                              }));
                          }}
                        />
                      </label>
                      <label>
                        {t("ends")}
                        <input
                          type="datetime-local"
                          required
                          min={localInput(form.startsAt)}
                          value={localInput(form.endsAt)}
                          onChange={(event) => {
                            const n = new Date(event.target.value).getTime();
                            if (Number.isFinite(n))
                              setForm((f) => ({ ...f, endsAt: n }));
                          }}
                        />
                      </label>
                    </div>
                    <div className="planning-form-pair">
                      <label>
                        {t("project")}
                        <select
                          value={form.projectId ?? ""}
                          onChange={(event) =>
                            setForm((f) => ({
                              ...f,
                              projectId: event.target.value || null,
                            }))
                          }
                        >
                          <option value="">{t("noProject")}</option>
                          {data.projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t("assignee")}
                        <select
                          value={form.assigneeId ?? ""}
                          onChange={(event) =>
                            setForm((f) => ({
                              ...f,
                              assigneeId: event.target.value || null,
                            }))
                          }
                        >
                          <option value="">{t("unassigned")}</option>
                          {data.members.map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      {t("description")}
                      <textarea
                        maxLength={5000}
                        rows={3}
                        value={form.description}
                        onChange={(event) =>
                          setForm((f) => ({
                            ...f,
                            description: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </>
                )}
                {formError && (
                  <p className="settings-error" role="alert">
                    {formError}
                  </p>
                )}
                {confirmDelete && (
                  <div className="planning-delete-confirm">
                    <p>{t("deleteConfirm")}</p>
                    <button
                      type="button"
                      className="soft-button"
                      onClick={() => void remove()}
                    >
                      {t("confirmDelete")}
                    </button>
                    <button
                      type="button"
                      className="soft-button"
                      onClick={() => setConfirmDelete(false)}
                    >
                      {t("keepItem")}
                    </button>
                  </div>
                )}
                <div className="dialog-actions">
                  {editing && editor === "item" && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setConfirmDelete(true)}
                    >
                      {t("delete")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => setEditor(null)}
                  >
                    {t("cancel")}
                  </button>
                  <button className="primary-button" type="submit">
                    {t(saving ? "saving" : "save")}
                  </button>
                </div>
              </fieldset>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
