/** User choices are context, never credentials or an authorization policy. */
export const ONBOARDING_OPTIONS = {
  pms: ["appfolio", "yardi", "yardi_breeze", "reapit", "buildium", "sme_professional", "10ninety", "arthur", "joblogic", "rentvine", "asana", "buildingstack", "gohighlevel", "igloohome", "peach", "propstack", "quickbooks", "resharmonics", "realpad", "rentvision", "rm_cloud", "showmojo", "tenantcloud", "street", "yardi_kube", "other"],
  focus: ["all", "maintenance", "leasing", "delinquency", "move_out", "accounting", "reporting", "rent_increase", "compliance"],
  chat: ["slack", "google_chat", "microsoft_teams", "whatsapp", "imessage", "gmail", "outlook", "other"],
  documents: ["google_drive", "google_sheets", "onedrive", "box", "other"],
  calls: ["yes", "later"],
  marketing: ["rightmove", "zoopla", "onthemarket", "meta", "other"],
  autonomy: ["supervised", "assisted", "autonomous"],
} as const;
export const ONBOARDING_STEPS = Object.keys(ONBOARDING_OPTIONS) as (keyof typeof ONBOARDING_OPTIONS)[];
export type OnboardingStep = keyof typeof ONBOARDING_OPTIONS;
export type UserPreferences = { [K in OnboardingStep]: string[] };
export type OnboardingState = { preferences: UserPreferences; step: number; completed: boolean; revision: number };
export const DEFAULT_PREFERENCES: UserPreferences = { pms: [], focus: [], chat: [], documents: [], calls: [], marketing: [], autonomy: ["assisted"] };
export const DEFAULT_ONBOARDING: OnboardingState = { preferences: DEFAULT_PREFERENCES, step: 0, completed: false, revision: 0 };

export function parseOnboarding(value: unknown): OnboardingState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!Number.isInteger(input.step) || Number(input.step) < 0 || Number(input.step) >= ONBOARDING_STEPS.length || typeof input.completed !== "boolean" || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0) return null;
  if (!input.preferences || typeof input.preferences !== "object" || Array.isArray(input.preferences)) return null;
  const raw = input.preferences as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !ONBOARDING_STEPS.includes(key as OnboardingStep))) return null;
  const preferences = {} as UserPreferences;
  for (const key of ONBOARDING_STEPS) {
    const values = raw[key];
    const allowed: readonly string[] = ONBOARDING_OPTIONS[key];
    if (!Array.isArray(values) || values.length > allowed.length || values.some((v) => typeof v !== "string" || !allowed.includes(v)) || new Set(values).size !== values.length) return null;
    if ((key === "calls" || key === "autonomy") && values.length > 1) return null;
    if (key === "autonomy" && values.length !== 1) return null;
    if (key === "focus" && values.includes("all") && values.length > 1) return null;
    preferences[key] = [...values];
  }
  return { preferences, step: Number(input.step), completed: input.completed, revision: Number(input.revision) };
}

export function togglePreference(preferences: UserPreferences, key: OnboardingStep, value: string): UserPreferences {
  const previous = preferences[key];
  const next = key === "autonomy" || key === "calls" ? [value]
    : previous.includes(value) ? previous.filter((item) => item !== value)
    : key === "focus" && value === "all" ? [value]
    : [...previous.filter((item) => key !== "focus" || item !== "all"), value];
  return { ...preferences, [key]: next };
}
