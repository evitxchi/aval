/**
 * Lighting/color themes for AvalAgentAvatar — deliberately separate from
 * shape geometry (shapes.tsx) so any shape can carry any theme. Each theme
 * is 2-3 closely related hues: a primary light (the dominant, brighter
 * source), a secondary light (a cooler/complementary accent, positioned
 * opposite the primary for asymmetric lighting), and a rim color for the
 * edge highlight. `base` is the shape's unlit color in near-total shadow —
 * never pure black, so the silhouette still reads as material rather than
 * a hole.
 */

export type ThemeId = "avalBlue" | "violet" | "aqua" | "ember" | "aurora" | "orchid";

export interface AgentTheme {
  id: ThemeId;
  label: string;
  base: string;
  primary: string;
  secondary: string;
  rim: string;
}

export const THEMES: Record<ThemeId, AgentTheme> = {
  avalBlue: { id: "avalBlue", label: "Aval Blue", base: "#0a1220", primary: "#38bdf8", secondary: "#312e81", rim: "#7dd3fc" },
  violet: { id: "violet", label: "Violet", base: "#140f22", primary: "#a78bfa", secondary: "#4c1d95", rim: "#ddd6fe" },
  aqua: { id: "aqua", label: "Aqua", base: "#08161a", primary: "#34d399", secondary: "#155e75", rim: "#67e8f9" },
  ember: { id: "ember", label: "Ember", base: "#1a0a0e", primary: "#fb7185", secondary: "#7f1d1d", rim: "#fecdd3" },
  aurora: { id: "aurora", label: "Aurora", base: "#081a1c", primary: "#2dd4bf", secondary: "#3730a3", rim: "#a5b4fc" },
  orchid: { id: "orchid", label: "Orchid", base: "#150c1e", primary: "#e879f9", secondary: "#581c87", rim: "#f0abfc" },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
