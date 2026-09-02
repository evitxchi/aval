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
   * Commissioned artwork (public/personas/*.png) — takes over rendering from
   * the shape+theme silhouette below wherever AvalAgentAvatar is given it
   * (see that component's `icon` prop). Optional: only the six original
   * personas have commissioned art; a persona with no `icon` renders
   * procedurally from its shape/theme instead, the same as any custom,
   * user-created persona.
   */
  icon?: string;
}

export const PERSONA_PRESETS: Record<PersonaId, PersonaPreset> = {
  // Reuses the existing "Ask Aval" label rather than a new key — this is the same default assistant, just addressable by name in the picker.
  general: { id: "general", shape: "fourPoint", theme: "avalBlue", labelKey: "AvalAssistant.askAval", icon: "/personas/general.png" },
  financial: { id: "financial", shape: "arch", theme: "aurora", labelKey: "AgentPersonas.financialLabel", icon: "/personas/financial.png" },
  brokerage: { id: "brokerage", shape: "portal", theme: "violet", labelKey: "AgentPersonas.brokerageLabel", icon: "/personas/brokerage.png" },
  realEstate: { id: "realEstate", shape: "monolith", theme: "aqua", labelKey: "AgentPersonas.realEstateLabel", icon: "/personas/real-estate.png" },
  marketResearch: { id: "marketResearch", shape: "shard", theme: "orchid", labelKey: "AgentPersonas.marketResearchLabel", icon: "/personas/market-research.png" },
  maintenance: { id: "maintenance", shape: "planes", theme: "ember", labelKey: "AgentPersonas.maintenanceLabel", icon: "/personas/maintenance.png" },
  riskAnalyst: { id: "riskAnalyst", shape: "shard", theme: "ember", labelKey: "AgentPersonas.riskAnalystLabel" },
  portfolioOutlook: { id: "portfolioOutlook", shape: "monolith", theme: "aurora", labelKey: "AgentPersonas.portfolioOutlookLabel" },
};

export const PERSONA_IDS = Object.keys(PERSONA_PRESETS) as PersonaId[];
