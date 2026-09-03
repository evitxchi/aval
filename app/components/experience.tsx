"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useLocale } from "next-intl";

export type Market = "us" | "latam";
type Theme = "light" | "dark";
type SoundName = "tap" | "reveal" | "notify" | "success";
type Toast = { id: number; title: string; detail?: string };

type ExperienceValue = {
  market: Market;
  setMarket: (market: Market) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  sounds: boolean;
  setSounds: (enabled: boolean) => void;
  play: (sound: SoundName) => void;
  notify: (title: string, detail?: string) => void;
  celebrate: (title: string, detail?: string) => void;
};

const ExperienceContext = createContext<ExperienceValue | null>(null);

function readPreference<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const legacyKey = key.replace(/^aval\./, "portero.");
  return (window.localStorage.getItem(key) as T | null) ?? (window.localStorage.getItem(legacyKey) as T | null) ?? fallback;
}

export function ExperienceProvider({ children }: { children: ReactNode }) {
  const [market, setMarketState] = useState<Market>("us");
  const [theme, setThemeState] = useState<Theme>("light");
  const [sounds, setSoundsState] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confetti, setConfetti] = useState(0);
  const audioContext = useRef<AudioContext | null>(null);
  const toastId = useRef(0);

  const play = useCallback((sound: SoundName) => {
    if (!sounds || typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = audioContext.current ?? new AudioContextClass();
    audioContext.current = context;
    const now = context.currentTime;
    const notes = sound === "success" ? [520, 690, 920] : sound === "notify" ? [620, 820] : sound === "reveal" ? [330] : [480];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = sound === "tap" ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.055);
      gain.gain.setValueAtTime(0.0001, now + index * 0.055);
      gain.gain.exponentialRampToValueAtTime(sound === "tap" ? 0.018 : 0.025, now + index * 0.055 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.055 + 0.075);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + index * 0.055);
      oscillator.stop(now + index * 0.055 + 0.085);
    });
  }, [sounds]);

  const notify = useCallback((title: string, detail?: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-2), { id, title, detail }]);
    play("notify");
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  }, [play]);

  const celebrate = useCallback((title: string, detail?: string) => {
    setConfetti((value) => value + 1);
    notify(title, detail);
    play("success");
  }, [notify, play]);

  const setMarket = useCallback((next: Market) => {
    setMarketState(next);
    window.localStorage.setItem("aval.market", next);
  }, []);
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem("aval.theme", next);
  }, []);
  const setSounds = useCallback((enabled: boolean) => {
    setSoundsState(enabled);
    window.localStorage.setItem("aval.sounds", enabled ? "on" : "off");
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setMarketState(readPreference<Market>("aval.market", "us"));
      setThemeState(readPreference<Theme>("aval.theme", "light"));
      setSoundsState(readPreference<string>("aval.sounds", "off") === "on");
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest("button, a, summary, [role='button']")) play("tap");
    };
    document.addEventListener("pointerdown", onPointer, { passive: true });
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [play]);

  useEffect(() => {
    const seen = new WeakSet<Element>();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        if (!seen.has(entry.target)) {
          seen.add(entry.target);
          if (!reduced && entry.target.hasAttribute("data-sound-reveal")) play("reveal");
        }
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -7%", threshold: 0.12 });
    const observe = () => document.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
    observe();
    const mutations = new MutationObserver(observe);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => { mutations.disconnect(); observer.disconnect(); };
  }, [play]);

  const value = useMemo<ExperienceValue>(() => ({
    market,
    setMarket,
    theme,
    setTheme,
    sounds,
    setSounds,
    play,
    notify,
    celebrate,
  }), [celebrate, market, notify, play, setMarket, setSounds, setTheme, sounds, theme]);

  return <ExperienceContext.Provider value={value}>{children}<div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className="app-toast" key={toast.id}><span/><div><strong>{toast.title}</strong>{toast.detail && <p>{toast.detail}</p>}</div></div>)}</div>{confetti > 0 && <Confetti key={confetti}/>}</ExperienceContext.Provider>;
}

export function useExperience() {
  const value = useContext(ExperienceContext);
  if (!value) throw new Error("useExperience must be used within ExperienceProvider");
  return value;
}

export function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 0 }: { value: number; prefix?: string; suffix?: string; decimals?: number }) {
  const locale = useLocale();
  const [display, setDisplay] = useState(0);
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    let animation = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      const start = performance.now();
      const duration = 1050;
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 4);
        setDisplay(value * eased);
        if (progress < 1) animation = requestAnimationFrame(tick);
      };
      animation = requestAnimationFrame(tick);
      observer.disconnect();
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(animation); };
  }, [value]);
  const formatted = display.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span ref={element}>{prefix}{formatted}{suffix}</span>;
}

function Confetti() {
  return <div className="confetti" aria-hidden="true">{Array.from({ length: 34 }, (_, index) => <i key={index} style={{ "--x": `${(index * 37) % 100}vw`, "--delay": `${(index % 8) * 28}ms`, "--spin": `${180 + (index % 5) * 90}deg` } as CSSProperties}/>)}</div>;
}

/**
 * Tracks the OS "reduce motion" setting, live — a user who changes it while
 * the dashboard is open shouldn't have to reload to be taken seriously.
 *
 * `useSyncExternalStore` rather than an effect writing state: matchMedia is
 * an external store, and this is the hook built for subscribing to one. It
 * also gives a correct server snapshot (`false`) for free, so SSR markup
 * matches the client's first paint instead of hydrating a mismatch.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}
