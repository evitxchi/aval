export type TeamRoute = { id: string; label: string; phone: string; keywords: string[] };
export type CommunicationsConfig = { enabled: boolean; fromNumber: string; greeting: string; fallbackNumber: string; routes: TeamRoute[] };
export const DEFAULT_COMMUNICATIONS: CommunicationsConfig = { enabled: false, fromNumber: "", greeting: "Hello, this is Aval, the automated assistant. Tell me briefly whether you need maintenance, leasing, or your property team. You can also press a team number.", fallbackNumber: "", routes: [] };
export const isPhone = (value: unknown): value is string => typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
export function parseCommunicationsConfig(value: unknown): CommunicationsConfig {
  if (!value || typeof value !== "object") throw new Error("Enter a valid call configuration.");
  const c = value as CommunicationsConfig;
  if (typeof c.enabled !== "boolean" || typeof c.greeting !== "string" || !c.greeting.trim() || c.greeting.length > 600 || !Array.isArray(c.routes) || c.routes.length > 9) throw new Error("A greeting and at most nine team routes are required.");
  if ((c.fromNumber !== "" && !isPhone(c.fromNumber)) || (c.fallbackNumber !== "" && !isPhone(c.fallbackNumber))) throw new Error("Use international phone numbers, such as +14155550100.");
  const ids = new Set<string>();
  const routes = c.routes.map((r) => {
    if (!r || !/^[a-z0-9_-]{1,40}$/.test(r.id) || ids.has(r.id) || typeof r.label !== "string" || !r.label.trim() || r.label.length > 80 || !isPhone(r.phone) || !Array.isArray(r.keywords) || r.keywords.length > 20 || r.keywords.some(k => typeof k !== "string" || !k.trim() || k.length > 50)) throw new Error("Each route needs a unique ID, a team name, a phone number, and short matching phrases.");
    ids.add(r.id); return { id: r.id, label: r.label.trim(), phone: r.phone, keywords: r.keywords.map(k => k.trim().toLowerCase()) };
  });
  if (c.enabled && (!isPhone(c.fromNumber) || !isPhone(c.fallbackNumber))) throw new Error("Add your Twilio number and a fallback team number before enabling calls.");
  if ([c.fallbackNumber, ...routes.map(r => r.phone)].filter(Boolean).includes(c.fromNumber)) throw new Error("A call route cannot point back to Aval's own number.");
  return { enabled: c.enabled, fromNumber: c.fromNumber, fallbackNumber: c.fallbackNumber, greeting: c.greeting.trim(), routes };
}
export const xml = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
export function selectTeam(config: CommunicationsConfig, speech: string, digit: string): TeamRoute | undefined {
  if (/^[1-9]$/.test(digit)) return config.routes[Number(digit) - 1];
  const text = speech.toLowerCase();
  return config.routes.map(route => ({ route, score: route.keywords.filter(k => new RegExp(`(^|\\W)${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`, "i").test(text)).length })).filter(r => r.score > 0).sort((a,b) => b.score-a.score)[0]?.route;
}
export function voiceResponse(config: CommunicationsConfig, actionUrl: string, speech = "", digit = "", dialStatus = "", stage = "entry"): string {
  const response = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
  if (!config.enabled) return response('<Say>Call handling is currently unavailable. Please contact your property team directly.</Say><Hangup/>');
  if (dialStatus === "completed") return response('<Hangup/>');
  if (stage === "fallback" && dialStatus) return response('<Say>The team is unavailable. Please contact your property office again during business hours.</Say><Hangup/>');
  if (speech || digit || stage === "route" || dialStatus) {
    const route = dialStatus ? undefined : selectTeam(config, speech, digit);
    const destination = route?.phone ?? config.fallbackNumber;
    if (!destination) return response('<Say>No team is available. Please contact your property office.</Say><Hangup/>');
    const callback = new URL(actionUrl); callback.searchParams.set("stage", route ? "dial" : "fallback");
    return response(`<Say>${xml(route ? `Connecting you to ${route.label}.` : 'Connecting you to the property team.')}</Say><Dial timeout="25" timeLimit="1800" answerOnBridge="true" action="${xml(callback.href)}" method="POST"><Number>${xml(destination)}</Number></Dial>`);
  }
  const callback = new URL(actionUrl); callback.searchParams.set("stage", "route");
  const menu = config.routes.map((r,i) => `Press ${i+1} for ${r.label}.`).join(' ');
  return response(`<Gather input="speech dtmf" numDigits="1" timeout="5" speechTimeout="auto" actionOnEmptyResult="true" action="${xml(callback.href)}" method="POST"><Say>${xml(config.greeting + ' ' + menu)}</Say></Gather>`);
}
