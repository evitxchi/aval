"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "next-intl";

export type AuthMode = "password" | "chatgpt" | "local";

/**
 * Real customer sign-in/sign-up for deployments outside ChatGPT Sites,
 * where there's no platform-injected identity header. Rendered server-side
 * by app/[locale]/page.tsx when no identity resolves — there is no client
 * loading state to manage, since the server already knows the visitor
 * isn't authenticated by the time this renders. On success, reloads so the
 * server re-evaluates identity from the now-set session cookie.
 */
export function SignInScreen() {
  const t = useTranslations();
  const [formMode, setFormMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(formMode === "signin" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        // A duplicate-email signup is a normal outcome, not a failure the
        // user needs to interpret — the useful next step is signing in,
        // not staring at an error (generic or specific) on the signup form.
        if (formMode === "signup" && response.status === 409) {
          setFormMode("signin");
          setError(t("AuthGate.accountExistsSignInInstead"));
          return;
        }
        setError(data.error ?? t("AuthGate.somethingWentWrong"));
        return;
      }
      window.location.reload();
    } catch {
      setError(t("AuthGate.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-gate">
      <div className="auth-gate-card">
        <div className="auth-gate-brand">
          <span className="brand-symbol">a</span>
          <strong>aval</strong>
        </div>
        <h1>{formMode === "signin" ? t("AuthGate.signInTitle") : t("AuthGate.signUpTitle")}</h1>
        <p>{formMode === "signin" ? t("AuthGate.signInSubtitle") : t("AuthGate.signUpSubtitle")}</p>
        <form onSubmit={submit}>
          {formMode === "signup" && (
            <label>
              {t("AuthGate.nameLabel")}
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t("AuthGate.namePlaceholder")} autoComplete="name" />
            </label>
          )}
          <label>
            {t("AuthGate.emailLabel")}
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("AuthGate.emailPlaceholder")} autoComplete="email" />
          </label>
          <label>
            {t("AuthGate.passwordLabel")}
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("AuthGate.passwordPlaceholder")}
              autoComplete={formMode === "signin" ? "current-password" : "new-password"}
            />
          </label>
          {error && <p className="auth-gate-error">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? t("AuthGate.pleaseWait") : formMode === "signin" ? t("AuthGate.signIn") : t("AuthGate.createAccount")}
          </button>
        </form>
        <button
          className="auth-gate-switch"
          type="button"
          onClick={() => {
            setFormMode((current) => (current === "signin" ? "signup" : "signin"));
            setError(null);
          }}
        >
          {formMode === "signin" ? t("AuthGate.needAnAccount") : t("AuthGate.alreadyHaveAnAccount")}
        </button>
      </div>
    </div>
  );
}
