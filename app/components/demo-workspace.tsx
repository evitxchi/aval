"use client";

// Deliberately separate from DesktopApp: no authenticated hooks, credentials,
// uploads, agent runs, or external sends are mounted in the demo workspace.
import { useState, type ComponentType, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  Database,
  NavArrowRight,
  Page,
  ViewColumns3,
} from "iconoir-react";
import type { PlanningData } from "@/lib/planning/types";
import { sampleData } from "@/app/data/sample";
import { PlanningWorkspace } from "./planning-workspace";
import { OperationsWorkspace } from "./operations-workspace";
import { IntegrationsCatalog } from "./integrations-catalog";
import {
  AskAvalTasksSection,
  type CreateDraftInput,
  type DraftJob,
} from "./ask-aval-tasks";
import type { Provider } from "./connection-dialog";
import {
  DemoBanner,
  WorkspaceModeControl,
  changeWorkspaceMode,
} from "./workspace-mode-control";

type Navigation = {
  labelKey: string;
  items: {
    id: string;
    labelKey: string;
    icon: ComponentType<{
      width?: number;
      height?: number;
      className?: string;
    }>;
  }[];
}[];
export function DemoWorkspace({
  navigation,
  providers: catalog,
  initialView,
  isGuest,
  setup,
  infrastructure,
}: {
  navigation: Navigation;
  providers: Provider[];
  initialView: string;
  isGuest: boolean;
  setup: (openConnections: () => void) => ReactNode;
  infrastructure: (onAdd: () => void) => ReactNode;
}) {
  const t = useTranslations(),
    d = useTranslations("DemoMode");
  const [view, setView] = useState(initialView),
    [collapsed, setCollapsed] = useState(false);
  const [notice, setNotice] = useState("");
  const navigate = (next: string) => {
    setView(next);
    setNotice("");
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [planning, setPlanning] = useState<PlanningData>(() => {
    const day = new Date();
    day.setHours(9, 0, 0, 0);
    const today = day.getTime();
    return {
      projects: [0, 1, 2].map((i) => ({
        id: `demo-project-${i}`,
        title: d(`project${i}`),
        description: d("sampleRecord"),
        color: (["blue", "green", "violet"] as const)[i],
        createdAt: today,
      })),
      members: ["Alex Morgan", "Sam Rivera", "Jordan Chen"].map((name, i) => ({
        userId: `demo-member-${i}`,
        displayName: name,
        email: `demo${i + 1}@example.invalid`,
        role: i ? "member" : "owner",
      })),
      items: Array.from({ length: 9 }, (_, i) => ({
        id: `demo-item-${i}`,
        title: d(`task${i % 6}`),
        description: d("sampleRecord"),
        kind: i % 3 === 0 ? "event" : "task",
        status: (["planned", "in_progress", "blocked", "completed"] as const)[
          i % 4
        ],
        projectId: `demo-project-${i % 3}`,
        assigneeId: `demo-member-${i % 3}`,
        startsAt: today + (i - 3) * 86400000,
        endsAt: today + (i - 3) * 86400000 + 7200000,
        version: 1,
      })),
    };
  });
  const demoDraft = (input: CreateDraftInput): DraftJob => ({
    id: `demo-${crypto.randomUUID()}`,
    input: { ...input, title: `${d("badge")} · ${input.title}` },
    status: "done",
    content: d("draftBody"),
    fullText: d("draftBody"),
    progress: 100,
    createdAt: Date.now(),
  });
  const [jobs, setJobs] = useState<DraftJob[]>(() =>
    [0, 1, 2].map((i) => ({
      id: `demo-draft-${i}`,
      input: {
        title: `${d("badge")} · ${d(`draft${i}`)}`,
        instructions: d("sampleRecord"),
        format: (["docx", "xlsx", "pptx"] as const)[i],
      },
      status: "done",
      content: d("draftBody"),
      fullText: d("draftBody"),
      progress: 100,
      createdAt: 0,
    })),
  );
  const [providers, setProviders] = useState(() =>
    catalog
      .filter((p) =>
        [
          "quickbooks",
          "appfolio",
          "slack",
          "notion",
          "outlook",
          "gmail",
        ].includes(p.id),
      )
      .map((p) => ({
        ...p,
        connection: {
          status: "connected",
          externalAccountName: d("workspace"),
        },
      })),
  );
  const [reviewed, setReviewed] = useState<string[]>([]),
    [thread, setThread] = useState(0),
    [reply, setReply] = useState("");
  const [messages, setMessages] = useState<Record<number, string[]>>({});
  const [document, setDocument] = useState<string | null>(null);
  const label =
    navigation.flatMap((g) => g.items).find((i) => i.id === view)?.labelKey ??
    "Nav.portfolioOverview";
  const header = (
    <header className="app-header">
      <div>
        <p className="eyebrow">{d("workspace")}</p>
        <h1>{t(label)}</h1>
        <p className="header-subtitle">{d("sampleRecord")}</p>
      </div>
    </header>
  );
  const openConnections = () => navigate("connections");
  return (
    <main
      className={`app-shell demo-workspace ${collapsed ? "sidebar-is-collapsed" : ""}`}
      data-workspace-mode="demo"
    >
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-symbol">a</span>
          <div>
            <strong>aval</strong>
            <small>{d("workspace")}</small>
          </div>
          <button
            type="button"
            className="icon-button sidebar-collapse"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={t(
              collapsed
                ? "DesktopApp.expandSidebar"
                : "DesktopApp.collapseSidebar",
            )}
            aria-expanded={!collapsed}
          >
            <ViewColumns3 width={18} height={18} />
          </button>
        </div>
        <nav>
          {navigation.map((group) => (
            <div className="nav-group" key={group.labelKey}>
              <p>{t(group.labelKey)}</p>
              {group.items.map(({ id, labelKey, icon: Icon }) => (
                <button
                  type="button"
                  className={view === id ? "active" : ""}
                  key={id}
                  onClick={() => navigate(id)}
                  title={t(labelKey)}
                >
                  <Icon width={20} height={20} />
                  <span>{t(labelKey)}</span>
                  {view === id && <NavArrowRight width={16} height={16} />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button
          type="button"
          className="workspace-card"
          onClick={() => changeWorkspaceMode(false, isGuest)}
        >
          <Database width={28} height={28} />
          <span>
            <strong>{d("workspace")}</strong>
            <small>{d("exit")}</small>
          </span>
        </button>
      </aside>
      <section className="content-shell" aria-label={t(label)}>
        <DemoBanner isGuest={isGuest} />
        {notice && (
          <div className="demo-notice" role="status">
            {notice}
          </div>
        )}
        {view === "settings" && (
          <div className="view-wrap">
            {header}
            <WorkspaceModeControl demo isGuest={isGuest} />
            <section className="panel">
              <h2>{d("howItWorks")}</h2>
              <p>{d("isolationDescription")}</p>
              <button
                className="soft-button"
                onClick={() => {
                  setJobs([
                    demoDraft({
                      title: d("draft0"),
                      instructions: d("sampleRecord"),
                      format: "docx",
                    }),
                  ]);
                  setNotice(d("resetNotice"));
                }}
              >
                {d("resetDrafts")}
              </button>
            </section>
          </div>
        )}
        {(view === "overview" ||
          ["properties", "leasing", "maintenance", "accounting"].includes(
            view,
          )) && (
          <>
            {view === "overview" && (
              <div className="view-wrap demo-intro">
                {header}
                <div className="demo-shortcuts">
                  {["calendar", "projects", "tasks"].map((id) => (
                    <button
                      className="soft-button"
                      key={id}
                      onClick={() => navigate(id)}
                    >
                      {t(
                        navigation
                          .flatMap((g) => g.items)
                          .find((i) => i.id === id)!.labelKey,
                      )}
                      <NavArrowRight width={16} height={16} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <OperationsWorkspace
              key={view}
              view={
                (view === "overview" ? "properties" : view) as
                  "properties" | "leasing" | "maintenance" | "accounting"
              }
              sample
              openConnections={openConnections}
            />
          </>
        )}
        {["calendar", "projects", "teams"].includes(view) && (
          <PlanningWorkspace
            key={view}
            view={view as "calendar" | "projects" | "teams"}
            isGuest={false}
            demoData={planning}
            onDemoChange={setPlanning}
          />
        )}

        {view === "tasks" && (
          <div className="view-wrap">
            {header}
            <p className="demo-note">{d("draftSafety")}</p>
            <AskAvalTasksSection
              demo
              jobs={jobs}
              onCreate={(input) =>
                setJobs((current) => [demoDraft(input), ...current])
              }
              onPause={() => {}}
              onResume={() => {}}
              onRetry={() => {}}
              onSend={() => {}}
              onRemove={async (ids) =>
                setJobs((current) =>
                  current.filter((job) => !ids.includes(job.id)),
                )
              }
            />
          </div>
        )}
        {view === "connections" && (
          <>
            <p className="demo-note">{d("connectionSafety")}</p>
            <IntegrationsCatalog
              providers={providers}
              loading={false}
              onOpen={(id) => {
                setProviders((current) =>
                  current.map((p) =>
                    p.id === id
                      ? {
                          ...p,
                          connection: {
                            ...p.connection,
                            status:
                              p.connection.status === "connected"
                                ? "disconnected"
                                : "connected",
                          },
                        }
                      : p,
                  ),
                );
                setNotice(d("connectionNotice"));
              }}
            />
          </>
        )}
        {view === "setup" && setup(openConnections)}
        {view === "infrastructure" &&
          infrastructure(() => setNotice(d("meterNotice")))}
        {view === "reviewCenter" && (
          <div className="view-wrap">
            {header}
            <div className="demo-record-grid">
              {sampleData.insights.candidates
                .filter((c) => c.actionable)
                .map((c) => (
                  <article className="panel" key={c.id}>
                    <span className="eyebrow">{d("badge")}</span>
                    <h2>{t(c.titleKey)}</h2>
                    <p>{d("reviewDescription")}</p>
                    <button
                      className="soft-button"
                      disabled={reviewed.includes(c.id)}
                      onClick={() => setReviewed((r) => [...r, c.id])}
                    >
                      <Check width={16} height={16} />
                      {d(reviewed.includes(c.id) ? "reviewed" : "review")}
                    </button>
                  </article>
                ))}
            </div>
          </div>
        )}
        {view === "documents" && (
          <div className="view-wrap">
            {header}
            <div className="demo-record-grid">
              {[0, 1, 2].map((i) => (
                <button
                  className="panel demo-document"
                  key={i}
                  onClick={() => setDocument(d(`draft${i}`))}
                >
                  <Page width={25} height={25} />
                  <strong>{d(`draft${i}`)}</strong>
                  <span>{d("sampleRecord")}</span>
                </button>
              ))}
            </div>
            {document && (
              <section className="panel">
                <h2>{document}</h2>
                <p>{d("draftBody")}</p>
              </section>
            )}
          </div>
        )}
        {view === "inbox" && (
          <div className="view-wrap">
            {header}
            <div className="inbox-window">
              <aside className="conversation-list">
                {["Alex Morgan", "Sam Rivera", "Jordan Chen"].map((name, i) => (
                  <button
                    className={`conversation-row ${thread === i ? "active" : ""}`}
                    key={name}
                    onClick={() => {
                      setThread(i);
                      setReply("");
                    }}
                  >
                    <span>
                      <strong>{name}</strong>
                      <small>{d("badge")}</small>
                      <em>{d(`task${i}`)}</em>
                    </span>
                  </button>
                ))}
              </aside>
              <section className="message-thread">
                <div className="message-canvas">
                  <div className="message received">
                    <p>{d(`task${thread}`)}</p>
                    <span>{d("sampleRecord")}</span>
                  </div>
                  {(messages[thread] ?? []).map((body, i) => (
                    <div className="message sent" key={i}>
                      <p>{body}</p>
                      <span>{d("localOnly")}</span>
                    </div>
                  ))}
                </div>
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!reply.trim()) return;
                    setMessages((current) => ({
                      ...current,
                      [thread]: [...(current[thread] ?? []), reply.trim()],
                    }));
                    setReply("");
                  }}
                >
                  <input
                    value={reply}
                    aria-label={d("sampleReply")}
                    placeholder={d("sampleReply")}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <button className="soft-button" disabled={!reply.trim()}>
                    {d("previewReply")}
                  </button>
                </form>
              </section>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
