"use client";
import { createContext, useContext } from "react";
import type { OnboardingState } from "@/lib/onboarding/preferences";
import type { AutonomyMode } from "@/lib/agents/autonomy";
export const PreferenceContext = createContext<{
  state: OnboardingState;
  edit: () => void;
  setMode: (mode: AutonomyMode) => Promise<void>;
  busy: boolean;
  error: string;
  help: () => void;
} | null>(null);
export const useOnboarding = () => useContext(PreferenceContext);
