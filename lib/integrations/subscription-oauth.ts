/**
 * Real OAuth 2.0 Authorization Code + PKCE for a user's own Claude Pro/Max
 * or ChatGPT Plus/Pro subscription, so an org can call models against that
 * subscription instead of pasting a separate API key. Modeled directly on
 * a real, working reference implementation (a separate local project,
 * mentari2.0) rather than reverse-engineered from scratch.
 *
 * This presents Aval to Anthropic's/OpenAI's OAuth servers using the same
 * public client ID their own Claude Code / Codex CLI tools use — not a
 * distinct, Aval-registered OAuth application. That is a deliberate,
 * informed choice, not an oversight: neither provider publishes a
 * client-registration path for an arbitrary third-party app to place
 * general chat calls against a personal subscription, so this borrows the
 * one public client ID each already ships to its own official CLI. It is a
 * real, accepted risk specifically because Aval is a hosted, multi-tenant
 * service — unusual traffic patterns under either client ID are far more
 * visible to the provider than from any single hobbyist's local install,
 * and a client-ID action from either provider would affect every org that
 * connected this way at once. See docs/DECISIONS.md for the full tradeoff
 * as presented to, and accepted by, the person directing this work.
 *
 * Neither flow redirects back to a server Aval controls, unlike this app's
 * other OAuth providers (Slack, Notion, etc. — see app/api/oauth/callback):
 *  - Claude's redirect_uri is Anthropic's own platform.claude.com page,
 *    which hands the user an authorization code to copy.
 *  - ChatGPT's redirect_uri is a fixed http://localhost:1455 loopback
 *    address meant for a locally-running CLI to listen on — from a
 *    browser, that page simply fails to load, but the code/state remain
 *    visible in the browser's address bar for the user to copy.
 * Both end the same way: the user pastes what they see back into Aval —
 * the exact fallback flow the reference implementation itself ships,
 * since it hits this same structural limit for any non-local caller.
 */

export const SUBSCRIPTION_PROVIDER_IDS = ["claude", "chatgpt"] as const;
export type SubscriptionProviderId = (typeof SUBSCRIPTION_PROVIDER_IDS)[number];

export function isSubscriptionProviderId(id: string): id is SubscriptionProviderId {
  return (SUBSCRIPTION_PROVIDER_IDS as readonly string[]).includes(id);
}

const CLAUDE = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://platform.claude.com/v1/oauth/token",
  redirectUri: "https://platform.claude.com/oauth/code/callback",
  // Matches Claude Code's own authorize-time scopes.
  scope: "user:profile user:inference user:sessions:claude_code user:mcp_servers",
} as const;

const CHATGPT = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  redirectUri: "http://localhost:1455/auth/callback",
  scope: "openid profile email offline_access",
} as const;

export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

export const CLAUDE_OAUTH_HEADERS = {
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
  "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,claude-code-20250219",
  "x-app": "cli",
  "user-agent": "claude-cli/2.1.81 (external, cli)",
} as const;

export const CHATGPT_CODEX_HEADERS = {
  originator: "codex_cli_rs",
  "OpenAI-Beta": "responses=experimental",
  "User-Agent": "codex_cli_rs",
} as const;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64Url(digest) };
}

function randomState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

function authorizeQuery(params: [string, string][]): string {
  return params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}

export interface SubscriptionAuthorizeSession {
  authorizeUrl: string;
  verifier: string;
  state: string;
}

export async function startSubscriptionAuthorize(provider: SubscriptionProviderId): Promise<SubscriptionAuthorizeSession> {
  const pkce = await createPkce();
  const state = randomState();
  if (provider === "claude") {
    const authorizeUrl = `${CLAUDE.authorizeUrl}?${authorizeQuery([
      ["code", "true"],
      ["client_id", CLAUDE.clientId],
      ["response_type", "code"],
      ["redirect_uri", CLAUDE.redirectUri],
      ["scope", CLAUDE.scope],
      ["code_challenge", pkce.challenge],
      ["code_challenge_method", "S256"],
      ["state", state],
    ])}`;
    return { authorizeUrl, verifier: pkce.verifier, state };
  }
  const authorizeUrl = `${CHATGPT.authorizeUrl}?${authorizeQuery([
    ["response_type", "code"],
    ["client_id", CHATGPT.clientId],
    ["redirect_uri", CHATGPT.redirectUri],
    ["scope", CHATGPT.scope],
    ["code_challenge", pkce.challenge],
    ["code_challenge_method", "S256"],
    ["state", state],
    ["id_token_add_organizations", "true"],
    ["codex_cli_simplified_flow", "true"],
    ["originator", "codex_cli_rs"],
  ])}`;
  return { authorizeUrl, verifier: pkce.verifier, state };
}

/**
 * The user pastes either the full URL their browser landed on (which
 * carries `?code=...&state=...` even on Claude's own page or ChatGPT's
 * failed localhost redirect) or a bare `code` / `code#state` pair.
 */
export function parsePastedAuthorization(input: string): { code: string; state?: string } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Paste the code or redirect URL to continue.");
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code")?.trim();
    if (code) return { code, state: url.searchParams.get("state")?.trim() || undefined };
  } catch {
    // Not a URL — fall through to bare code[#state].
  }
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex >= 0) {
    const code = trimmed.slice(0, hashIndex).trim();
    const state = trimmed.slice(hashIndex + 1).trim();
    if (!code) throw new Error("Paste the code or redirect URL to continue.");
    return { code, state: state || undefined };
  }
  return { code: trimmed };
}

export interface SubscriptionCredential {
  access: string;
  refresh: string;
  expiresAt: Date;
  accountId?: string;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function chatgptAccountIdFromJwt(jwt?: string): string | undefined {
  if (!jwt) return undefined;
  const payload = decodeJwtPayload(jwt);
  const auth = payload?.["https://api.openai.com/auth"];
  const nested = auth && typeof auth === "object" ? (auth as Record<string, unknown>).chatgpt_account_id : undefined;
  return typeof nested === "string" && nested.length > 0 ? nested : undefined;
}

async function tokenRequest(url: string, body: Record<string, string>, asJson: boolean): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(url, asJson
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, json };
}

function credentialFromTokenResponse(json: Record<string, unknown>, status: number, fallback: string, previousRefresh?: string): SubscriptionCredential {
  const access = typeof json.access_token === "string" ? json.access_token : undefined;
  if (status >= 400 || !access) {
    const detail = typeof json.error_description === "string" ? json.error_description : typeof json.error === "string" ? json.error : undefined;
    throw new Error(detail ?? fallback);
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const refresh = typeof json.refresh_token === "string" ? json.refresh_token : previousRefresh ?? access;
  const idToken = typeof json.id_token === "string" ? json.id_token : undefined;
  return { access, refresh, expiresAt: new Date(Date.now() + expiresIn * 1000), accountId: chatgptAccountIdFromJwt(idToken) ?? chatgptAccountIdFromJwt(access) };
}

export async function exchangeSubscriptionCode(provider: SubscriptionProviderId, input: { code: string; state: string; verifier: string }): Promise<SubscriptionCredential> {
  if (provider === "claude") {
    const { status, json } = await tokenRequest(CLAUDE.tokenUrl, {
      grant_type: "authorization_code",
      client_id: CLAUDE.clientId,
      code: input.code,
      state: input.state,
      redirect_uri: CLAUDE.redirectUri,
      code_verifier: input.verifier,
    }, true);
    return credentialFromTokenResponse(json, status, "Could not connect the Claude subscription.");
  }
  const { status, json } = await tokenRequest(CHATGPT.tokenUrl, {
    grant_type: "authorization_code",
    client_id: CHATGPT.clientId,
    code: input.code,
    redirect_uri: CHATGPT.redirectUri,
    code_verifier: input.verifier,
  }, false);
  return credentialFromTokenResponse(json, status, "Could not connect the ChatGPT subscription.");
}

export async function refreshSubscriptionCredential(provider: SubscriptionProviderId, refreshToken: string): Promise<SubscriptionCredential> {
  if (provider === "claude") {
    const { status, json } = await tokenRequest(CLAUDE.tokenUrl, { grant_type: "refresh_token", client_id: CLAUDE.clientId, refresh_token: refreshToken }, true);
    return credentialFromTokenResponse(json, status, "Could not refresh the Claude subscription.", refreshToken);
  }
  const { status, json } = await tokenRequest(CHATGPT.tokenUrl, { grant_type: "refresh_token", client_id: CHATGPT.clientId, refresh_token: refreshToken }, false);
  return credentialFromTokenResponse(json, status, "Could not refresh the ChatGPT subscription.", refreshToken);
}

const REFRESH_SKEW_MS = 2 * 60 * 1000;

export function isCredentialFresh(expiresAt: Date, now = Date.now()): boolean {
  return expiresAt.getTime() - REFRESH_SKEW_MS > now;
}

/** Rewrites a Claude Messages API URL to request the OAuth-only response shape, mirroring Claude Code's own client. */
export function claudeOAuthMessagesUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/messages") && !parsed.searchParams.has("beta")) {
      parsed.searchParams.set("beta", "true");
      return parsed.toString();
    }
  } catch {
    return url;
  }
  return url;
}

/* ── ChatGPT device-code login ──────────────────────────────────────────────
 *
 * The authorization-code flow above pins `redirect_uri` to
 * http://localhost:1455, which only a desktop process can listen on. A hosted
 * app therefore always dead-ends on a browser error with the code stranded in
 * the address bar, leaving the user to copy it back by hand.
 *
 * OpenAI's auth service also exposes a device-code flow (the same one the
 * Codex CLI uses on headless machines, found via RayBytes/ChatMock — see
 * docs/DECISIONS.md). There is no redirect at all: the app asks for a short
 * user code, the person types it on OpenAI's own page, and the app polls until
 * it is approved. Nothing to paste, nothing to listen on, no error page.
 */

const CHATGPT_DEVICE = {
  userCodeUrl: "https://auth.openai.com/api/accounts/deviceauth/usercode",
  tokenUrl: "https://auth.openai.com/api/accounts/deviceauth/token",
  /** Where the user enters the code. Shown to them, and opened for them. */
  verificationUrl: "https://auth.openai.com/codex/device",
  /** The redirect_uri the device flow's authorization code is bound to. */
  callbackUrl: "https://auth.openai.com/deviceauth/callback",
} as const;

export interface DeviceCodeStart {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  /** Seconds the server asks us to wait between polls. */
  intervalSeconds: number;
  expiresAt: Date;
}

/** Begins a device login and returns the code for the user to enter. */
export async function startChatgptDeviceLogin(): Promise<DeviceCodeStart> {
  const response = await fetch(CHATGPT_DEVICE.userCodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "codex_cli_rs/device-login" },
    body: JSON.stringify({ client_id: CHATGPT.clientId }),
  });
  if (!response.ok) throw new Error(`Device login could not be started (${response.status}).`);

  const body = await response.json() as { device_auth_id?: string; user_code?: string; usercode?: string; interval?: string | number; expires_at?: string };
  const deviceAuthId = body.device_auth_id;
  // The field has shipped under both spellings; accept either rather than
  // break on whichever the service is answering with today.
  const userCode = body.user_code ?? body.usercode;
  if (!deviceAuthId || !userCode) throw new Error("Device login response was missing its code.");

  const interval = Number(body.interval ?? 5);
  const expires = body.expires_at ? new Date(body.expires_at) : new Date(Date.now() + 15 * 60 * 1000);
  return {
    deviceAuthId,
    userCode,
    verificationUrl: CHATGPT_DEVICE.verificationUrl,
    intervalSeconds: Number.isFinite(interval) && interval > 0 ? Math.min(interval, 30) : 5,
    expiresAt: Number.isNaN(expires.getTime()) ? new Date(Date.now() + 15 * 60 * 1000) : expires,
  };
}

export type DevicePollResult =
  | { status: "pending" }
  /** The account has device-code authorization turned off — a one-time setting the user must enable. */
  | { status: "needs_device_auth_enabled" }
  | { status: "complete"; credential: SubscriptionCredential }
  | { status: "failed"; detail: string };

/**
 * Checks once whether the user has approved the code yet.
 *
 * A single check rather than a blocking loop: a Worker request cannot sit
 * open for the fifteen minutes this flow allows, so the client polls this and
 * the server stays stateless. 403/404 mean "not approved yet" in this API —
 * distinguishing that from a real failure is what keeps a waiting user from
 * seeing a spurious error.
 */
export async function pollChatgptDeviceLogin(deviceAuthId: string, userCode: string): Promise<DevicePollResult> {
  const response = await fetch(CHATGPT_DEVICE.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "codex_cli_rs/device-login" },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  });

  // Device-code authorization is off by default on a ChatGPT account, and the
  // approval page reports that as a 400 rather than as part of the pending
  // 403/404 pattern. Surfacing it as a generic failure would leave the user
  // decoding OpenAI's own message, which tells them to run a CLI command that
  // has no equivalent here — so it is detected and named explicitly.
  if (response.status === 400) {
    const detail = await response.text().catch(() => "");
    if (/device[_ ]?code|device auth|not enabled|disabled/i.test(detail)) {
      return { status: "needs_device_auth_enabled" };
    }
    return { status: "failed", detail: `Device login failed (400).` };
  }
  if (response.status === 403 || response.status === 404) return { status: "pending" };
  if (!response.ok) return { status: "failed", detail: `Device login failed (${response.status}).` };

  // Approval does NOT return tokens. It returns an authorization code plus the
  // PKCE verifier the service generated on our behalf, which must then be
  // exchanged at the ordinary /oauth/token endpoint against the device
  // callback's own redirect_uri. Checking for `access_token` here would leave
  // an approved login reporting "pending" forever.
  const body = await response.json().catch(() => null) as { authorization_code?: string; code_verifier?: string } | null;
  if (!body?.authorization_code || !body.code_verifier) return { status: "pending" };

  const exchange = await fetch(CHATGPT.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: body.authorization_code,
      // The device flow's own callback, not the loopback address the
      // browser-based flow uses — the code was issued against this one.
      redirect_uri: CHATGPT_DEVICE.callbackUrl,
      client_id: CHATGPT.clientId,
      code_verifier: body.code_verifier,
    }).toString(),
  });
  if (!exchange.ok) {
    return { status: "failed", detail: `Approved, but the token exchange failed (${exchange.status}).` };
  }

  const tokens = await exchange.json().catch(() => null) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number } | null;
  if (!tokens?.access_token) return { status: "failed", detail: "Approved, but no access token was returned." };

  const expiresIn = Number(tokens.expires_in ?? 3600);
  return {
    status: "complete",
    credential: {
      access: tokens.access_token,
      refresh: tokens.refresh_token ?? "",
      expiresAt: new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000),
      accountId: chatgptAccountIdFromJwt(tokens.id_token) ?? chatgptAccountIdFromJwt(tokens.access_token),
    },
  };
}
