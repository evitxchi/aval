/**
 * Every fixed string the channel sends, in both locales.
 *
 * These live here rather than in `messages/*.json` because they are sent by a
 * Worker, not rendered by React: pulling the UI catalogue into the messaging
 * bundle to reach a dozen strings would be a poor trade. The parity guarantee
 * the UI gets from `scripts/check-i18n-parity.mjs` is reproduced here in a
 * stronger form — `CopyTable` is a concrete type, so a locale missing a key
 * fails `tsc`, not a test run.
 *
 * The register is deliberately the one `terms.es-mx.json` documents: *renta*
 * not *alquiler*, *unidad* not *departamento*, *residente* not *inquilino*.
 * Regional vocabulary a particular customer prefers is applied on top of this
 * per organization (`lib/channels/vocabulary.ts`); the model never picks the
 * variant.
 */

export type ChannelLocale = "en" | "es-mx";

export const CHANNEL_LOCALES: readonly ChannelLocale[] = ["en", "es-mx"] as const;

/** Narrow an arbitrary stored locale to one we have copy for. */
export function asChannelLocale(value: unknown): ChannelLocale {
  return value === "es-mx" ? "es-mx" : "en";
}

interface CopyTable {
  /** Sent to a number with no verified identity. The only thing an unlinked number ever receives. */
  unlinked: string;
  linkExpired: string;
  linkConsumed: string;
  linkUnknown: string;
  linkElsewhere: string;
  /** `{org}` and `{role}` are substituted. */
  linkConfirmed: string;
  /** The first message after linking. `{examples}` is substituted with a numbered list. */
  welcome: string;
  helpHeader: string;
  roleOwner: string;
  roleApprover: string;
  roleMember: string;
  roleResident: string;
  /** Appended when a reply was cut at the character cap. */
  truncated: string;
  /** `{n}` more evidence rows exist than were shown. */
  moreEvidence: string;
  /** The agent could not answer. Never a fabricated figure. */
  unavailable: string;
  /** A resident's message, which no model answers. */
  residentHandoff: string;
  buttonMore: string;
  buttonSend: string;
  buttonNotNow: string;
  buttonSeeAll: string;
  buttonUndo: string;
  /** `{summary}` is the composed action description. */
  confirmPrompt: string;
  confirmExpired: string;
  confirmNotPermitted: string;
  actionCancelled: string;
  actionDone: string;
  /** Said instead of offering an undo that would lie. */
  actionIrreversible: string;
  undoDone: string;
  undoExpired: string;
  /** An escalation classifier fired. A human has been notified. */
  escalated: string;
  /** The org's spend ceiling was reached and the answer is degraded. */
  degraded: string;
  budgetExhausted: string;
}

const EN: CopyTable = {
  unlinked:
    "This number isn't linked to an Aval workspace. Ask your administrator to send you a link code from Settings → Channels.",
  linkExpired: "That code has expired. Generate a new one from Settings → Channels.",
  linkConsumed: "That code has already been used. Generate a new one from Settings → Channels.",
  linkUnknown: "That code isn't valid. Check it and try again.",
  linkElsewhere: "This number is already linked to a different workspace. Contact your administrator.",
  linkConfirmed: "Linked. You're connected to *{org}* as *{role}*.",
  welcome: "You can ask me about your portfolio from here. Try:\n\n{examples}\n\nSend *help* any time.",
  helpHeader: "What you can ask me:",
  roleOwner: "owner",
  roleApprover: "manager",
  roleMember: "coordinator",
  roleResident: "resident",
  truncated: "\n\n_Reply MORE for the rest._",
  moreEvidence: "and {n} more",
  unavailable:
    "I couldn't answer that from the connected data. Nothing was estimated. Tell me what you need and I'll say what would have to be connected.",
  residentHandoff: "Thanks — I've passed this to the property team. Someone will reply here.",
  buttonMore: "More",
  buttonSend: "Send",
  buttonNotNow: "Not now",
  buttonSeeAll: "See all",
  buttonUndo: "Undo",
  confirmPrompt: "{summary}",
  confirmExpired: "That request expired. Ask again and I'll rebuild it.",
  confirmNotPermitted: "Your role can propose this but not approve it. An owner or manager has to confirm.",
  actionCancelled: "Cancelled. Nothing was sent.",
  actionDone: "Done.",
  actionIrreversible: "Done. This one can't be undone — the messages have already left.",
  undoDone: "Reverted.",
  undoExpired: "That's past the undo window.",
  escalated:
    "This needs a person, not me. I've flagged it to the team and haven't taken any action on it.",
  degraded: "_Your workspace is near its monthly limit, so this answer is shorter than usual._",
  budgetExhausted:
    "Your workspace has reached its monthly spend limit. Raise it in Settings → Billing and I'll pick straight back up.",
};

const ES_MX: CopyTable = {
  unlinked:
    "Este número no está vinculado a un espacio de trabajo de Aval. Pide a tu administrador un código de vinculación en Configuración → Canales.",
  linkExpired: "Ese código expiró. Genera uno nuevo en Configuración → Canales.",
  linkConsumed: "Ese código ya se usó. Genera uno nuevo en Configuración → Canales.",
  linkUnknown: "Ese código no es válido. Revísalo e inténtalo de nuevo.",
  linkElsewhere: "Este número ya está vinculado a otro espacio de trabajo. Contacta a tu administrador.",
  linkConfirmed: "Listo. Estás conectado a *{org}* como *{role}*.",
  welcome: "Desde aquí puedes preguntarme sobre tu portafolio. Prueba:\n\n{examples}\n\nEnvía *ayuda* cuando quieras.",
  helpHeader: "Lo que puedes preguntarme:",
  roleOwner: "propietario",
  roleApprover: "gerente",
  roleMember: "coordinador",
  roleResident: "residente",
  truncated: "\n\n_Responde MÁS para ver el resto._",
  moreEvidence: "y {n} más",
  unavailable:
    "No pude responder eso con los datos conectados. No estimé nada. Dime qué necesitas y te digo qué habría que conectar.",
  residentHandoff: "Gracias. Ya lo pasé al equipo de la propiedad. Alguien te responderá por aquí.",
  buttonMore: "Más",
  buttonSend: "Enviar",
  buttonNotNow: "Ahora no",
  buttonSeeAll: "Ver todos",
  buttonUndo: "Deshacer",
  confirmPrompt: "{summary}",
  confirmExpired: "Esa solicitud expiró. Pídemelo de nuevo y la vuelvo a armar.",
  confirmNotPermitted: "Tu rol puede proponer esto pero no aprobarlo. Lo tiene que confirmar un propietario o gerente.",
  actionCancelled: "Cancelado. No se envió nada.",
  actionDone: "Hecho.",
  actionIrreversible: "Hecho. Esto no se puede deshacer: los mensajes ya salieron.",
  undoDone: "Revertido.",
  undoExpired: "Ya pasó el plazo para deshacerlo.",
  escalated:
    "Esto necesita a una persona, no a mí. Lo marqué para el equipo y no tomé ninguna acción.",
  degraded: "_Tu espacio de trabajo está cerca de su límite mensual, por eso esta respuesta es más breve._",
  budgetExhausted:
    "Tu espacio de trabajo alcanzó su límite de gasto mensual. Súbelo en Configuración → Facturación y sigo de inmediato.",
};

const TABLES: Record<ChannelLocale, CopyTable> = { en: EN, "es-mx": ES_MX };

export type CopyKey = keyof CopyTable;

/**
 * One string, in one locale, with `{placeholders}` substituted.
 *
 * Substitution is literal and total: an unmatched placeholder is left as-is
 * rather than blanked, so a missing value shows up as visibly wrong text in a
 * test instead of a sentence that reads fine while saying nothing.
 */
export function copy(locale: ChannelLocale, key: CopyKey, values: Record<string, string | number> = {}): string {
  let text = TABLES[locale][key];
  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** The operator-facing name of a role, in locale. */
export function roleLabel(locale: ChannelLocale, role: string): string {
  const key = (
    { owner: "roleOwner", approver: "roleApprover", member: "roleMember", resident: "roleResident" } as const
  )[role as "owner" | "approver" | "member" | "resident"];
  return key ? copy(locale, key) : role;
}

/**
 * The five example commands a newly linked operator sees, filtered by role.
 *
 * The brief is specific that these are listed verbatim on first contact and
 * repeated by `help`, because they are how the command set is discovered — a
 * messaging agent with no visible surface is one people ask two questions and
 * then abandon.
 */
export function exampleCommands(locale: ChannelLocale, role: string): string[] {
  const en: Record<string, string[]> = {
    wide: [
      "How much have I collected this month?",
      "Which units are vacant?",
      "Who is 30+ days late?",
      "What work orders are still open?",
      "How did occupancy move this quarter?",
    ],
    narrow: [
      "Which units are vacant?",
      "What work orders are still open?",
      "How many showings did we hold this week?",
      "How did occupancy move this quarter?",
      "Show me the leasing funnel.",
    ],
  };
  const es: Record<string, string[]> = {
    wide: [
      "¿Cuánta renta he cobrado este mes?",
      "¿Qué unidades están vacías?",
      "¿Quién tiene 30+ días de atraso?",
      "¿Qué órdenes de trabajo siguen abiertas?",
      "¿Cómo se movió la ocupación este trimestre?",
    ],
    narrow: [
      "¿Qué unidades están vacías?",
      "¿Qué órdenes de trabajo siguen abiertas?",
      "¿Cuántas visitas tuvimos esta semana?",
      "¿Cómo se movió la ocupación este trimestre?",
      "Muéstrame el embudo de arrendamiento.",
    ],
  };
  const width = role === "owner" || role === "approver" ? "wide" : "narrow";
  return (locale === "es-mx" ? es : en)[width];
}

/**
 * Whether a message is a request for help, in either locale.
 *
 * Matched before identity-specific work and before any model call, so `help`
 * costs nothing.
 */
export function isHelpRequest(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const normalised = body.trim().toLowerCase().replace(/[¿?¡!.]/g, "");
  return ["help", "ayuda", "menu", "menú", "comandos", "commands"].includes(normalised);
}

/** Whether a message is asking for the rest of a truncated answer. */
export function isMoreRequest(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const normalised = body.trim().toLowerCase().replace(/[¿?¡!.]/g, "");
  return normalised === "more" || normalised === "más" || normalised === "mas";
}
