import type { ShapeId } from "./shapes";
import type { ThemeId } from "./themes";

/**
 * Client-side persona presets (shape + theme + i18n keys) for the picker in
 * aval-assistant.tsx. `PersonaId` intentionally mirrors, rather than
 * imports, lib/ask-aval/personas.ts's server-only registry — see that
 * file's doc comment for why. Keep the id strings identical by hand.
 */
export type PersonaId = "general" | "financial" | "brokerage" | "realEstate" | "marketResearch" | "maintenance" | "riskAnalyst" | "portfolioOutlook";

export interface PersonaPreset {
  id: PersonaId;
  shape: ShapeId;
  theme: ThemeId;
  labelKey: string;
  /**
   * A commissioned, animated blob-character avatar (public/personas/*.webp —
   * a looping WEBP, animates natively as a plain <img>) — takes over
   * rendering from the shape+theme silhouette below wherever AvalAgentAvatar
   * is given it (see that component's `icon` prop). All eight built-in
   * personas have one, each hand-picked to loosely match its `theme` color
   * (e.g. `violet` theme -> the purple blob) so the two systems read as one
   * coherent identity per persona rather than two unrelated color choices.
   * A custom, user-created persona has no commissioned blob and keeps the
   * procedural shape/theme silhouette.
   */
  icon?: string;
}

export const PERSONA_PRESETS: Record<PersonaId, PersonaPreset> = {
  // Reuses the existing "Ask Aval" label rather than a new key — this is the same default assistant, just addressable by name in the picker.
  general: { id: "general", shape: "fourPoint", theme: "avalBlue", labelKey: "AvalAssistant.askAval", icon: "/personas/general.webp" },
  financial: { id: "financial", shape: "arch", theme: "aurora", labelKey: "AgentPersonas.financialLabel", icon: "/personas/financial.webp" },
  brokerage: { id: "brokerage", shape: "portal", theme: "violet", labelKey: "AgentPersonas.brokerageLabel", icon: "/personas/brokerage.webp" },
  realEstate: { id: "realEstate", shape: "monolith", theme: "aqua", labelKey: "AgentPersonas.realEstateLabel", icon: "/personas/real-estate.webp" },
  marketResearch: { id: "marketResearch", shape: "shard", theme: "orchid", labelKey: "AgentPersonas.marketResearchLabel", icon: "/personas/market-research.webp" },
  maintenance: { id: "maintenance", shape: "planes", theme: "ember", labelKey: "AgentPersonas.maintenanceLabel", icon: "/personas/maintenance.webp" },
  riskAnalyst: { id: "riskAnalyst", shape: "shard", theme: "ember", labelKey: "AgentPersonas.riskAnalystLabel", icon: "/personas/risk-analyst.webp" },
  portfolioOutlook: { id: "portfolioOutlook", shape: "monolith", theme: "aurora", labelKey: "AgentPersonas.portfolioOutlookLabel", icon: "/personas/portfolio-outlook.webp" },
};

export const PERSONA_IDS = Object.keys(PERSONA_PRESETS) as PersonaId[];
