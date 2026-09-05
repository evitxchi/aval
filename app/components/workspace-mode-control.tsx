"use client";
import { useTranslations } from "next-intl";
import { Database, NavArrowRight } from "iconoir-react";
import { workspaceModeUrl } from "@/lib/workspace-mode";

export function changeWorkspaceMode(demo: boolean, isGuest = false) {
  // A full navigation discards component state, pending work, and cached
  // previews. Returning to live always remounts the authenticated data layer.
  window.location.assign(
    workspaceModeUrl(window.location.href, demo ? "demo" : "live", isGuest),
  );
}

export function WorkspaceModeControl({
  demo = false,
  isGuest = false,
}: {
  demo?: boolean;
  isGuest?: boolean;
}) {
  const t = useTranslations("DemoMode");
  return (
    <section className="workspace-mode-control">
      <span className="workspace-mode-icon">
        <Database width={21} height={21} />
      </span>
      <div>
        <h2>{t(demo ? "activeTitle" : "settingsTitle")}</h2>
        <p>{t(demo ? "activeDescription" : "settingsDescription")}</p>
      </div>
      <button
        className="soft-button"
        type="button"
        onClick={() => changeWorkspaceMode(!demo, isGuest)}
      >
        {t(demo ? "exit" : "enable")}
        <NavArrowRight width={16} height={16} />
      </button>
    </section>
  );
}

export function DemoBanner({ isGuest }: { isGuest: boolean }) {
  const t = useTranslations("DemoMode");
  return (
    <div className="demo-mode-banner" role="status" data-workspace-mode="demo">
      <span>
        <strong>{t("badge")}</strong>
        <span>{t("banner")}</span>
      </span>
      <button type="button" onClick={() => changeWorkspaceMode(false, isGuest)}>
        {t("exit")}
        <NavArrowRight width={16} height={16} />
      </button>
    </div>
  );
}
