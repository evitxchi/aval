import type { ShapeId } from "./shapes";
import type { ThemeId } from "./themes";

/**
 * Client-side persona presets (shape + theme + i18n keys) for the picker in
 * aval-assistant.tsx. `PersonaId` intentionally mirrors, rather than
 * imports, lib/ask-aval/personas.ts's server-only registry — see that
 * file's doc comment for why. Keep the id strings identical by hand.
 */
export type PersonaId = "general" | "financial" | "brokerage" | "realEstate" | "marketResearch" | "maintenance";

export interface PersonaPreset {
  id: PersonaId;
  shape: ShapeId;
  theme: ThemeId;
  labelKey: string;
}

export const PERSONA_PRESETS: Record<PersonaId, PersonaPreset> = {
  // Reuses the existing "Ask Aval" label rather than a new key — this is the same default assistant, just addressable by name in the picker.
  general: { id: "general", shape: "fourPoint", theme: "avalBlue", labelKey: "AvalAssistant.askAval" },
  financial: { id: "financial", shape: "arch", theme: "aurora", labelKey: "AgentPersonas.financialLabel" },
  brokerage: { id: "brokerage", shape: "portal", theme: "violet", labelKey: "AgentPersonas.brokerageLabel" },
  realEstate: { id: "realEstate", shape: "monolith", theme: "aqua", labelKey: "AgentPersonas.realEstateLabel" },
  marketResearch: { id: "marketResearch", shape: "shard", theme: "orchid", labelKey: "AgentPersonas.marketResearchLabel" },
  maintenance: { id: "maintenance", shape: "planes", theme: "ember", labelKey: "AgentPersonas.maintenanceLabel" },
};

export const PERSONA_IDS = Object.keys(PERSONA_PRESETS) as PersonaId[];
