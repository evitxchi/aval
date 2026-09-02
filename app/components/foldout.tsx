"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { NavArrowDown } from "iconoir-react";

/**
 * A controlled foldout (native `<details>` can't smoothly animate height
 * across all browsers) — 0fr/1fr grid-row trick, same easing as the rest of
 * this app's floating UI. Shared by connection-dialog.tsx's "Advanced"
 * disclosure and intelligence-settings.tsx's provider-row accordion.
 */
export function Foldout({ summary, children, className }: { summary: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={["foldout", className].filter(Boolean).join(" ")}>
      <button type="button" className="foldout-summary" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {summary}
        <NavArrowDown width={12} height={12} className={open ? "foldout-chevron open" : "foldout-chevron"} />
      </button>
      <div className="foldout-body" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div className="foldout-body-inner">{children}</div>
      </div>
    </div>
  );
}
