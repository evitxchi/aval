/**
 * Server-side validation of model-authored tool arguments.
 *
 * The schema shown to the model is a usability hint; this is where it becomes
 * a rule. Without this step every handler defends itself by its own
 * convention, so a call with a required field missing, a number where a string
 * enum belongs, and an undeclared extra field reaches the executor and is
 * reported as a successful tool call — indistinguishable in the audit trail
 * from one that actually did the work.
 *
 * Deliberately validated against the *same* `input_schema` the model is shown
 * rather than a second copy on the registry descriptor. Two schemas for one
 * tool drift, and the one that drifts is always the one nobody reads.
 *
 * Pure and storage-free so it can be tested directly: a validator nobody can
 * run tests against is a validator nobody can trust.
 */

export interface SchemaLike {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export type SchemaVerdict = { ok: true } | { ok: false; problems: string[] };

/** Cap on reported problems, so one badly-shaped call cannot fill the transcript. */
const MAX_PROBLEMS = 6;

export function validateToolArguments(schema: SchemaLike | undefined, args: unknown): SchemaVerdict {
  // An unregistered schema is not permission to skip the check. Policy has
  // already refused unknown tools, so reaching here without one means the
  // registry and the model-facing catalog disagree, which is not a state to
  // execute in.
  if (!schema) return { ok: false, problems: ["No argument schema is declared for this tool."] };
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, problems: ["Arguments must be a JSON object."] };
  }

  const value = args as Record<string, unknown>;
  const problems: string[] = [];

  for (const name of schema.required ?? []) {
    if (value[name] === undefined) problems.push(`Missing required argument "${name}".`);
  }

  for (const [name, supplied] of Object.entries(value)) {
    if (supplied === undefined) continue;
    const rule = schema.properties[name];
    // Undeclared fields are refused rather than ignored. A model that invents
    // an argument has misunderstood the tool, and silently dropping it hides
    // that; retrieved text that smuggles one gets no quiet path through.
    if (!isRule(rule)) { problems.push(`Unknown argument "${name}".`); continue; }
    const problem = checkValue(name, supplied, rule);
    if (problem) problems.push(problem);
  }

  if (problems.length === 0) return { ok: true };
  const shown = problems.slice(0, MAX_PROBLEMS);
  if (problems.length > shown.length) shown.push(`…and ${problems.length - shown.length} more.`);
  return { ok: false, problems: shown };
}

interface Rule { type?: unknown; enum?: unknown; items?: unknown }

function isRule(rule: unknown): rule is Rule {
  return typeof rule === "object" && rule !== null && !Array.isArray(rule);
}

function checkValue(name: string, supplied: unknown, rule: Rule): string | null {
  if (Array.isArray(rule.enum)) {
    if (!rule.enum.includes(supplied as never)) {
      return `Argument "${name}" is not one of the permitted values.`;
    }
    // An enum already fixes the value exactly; a redundant type check on top
    // could only ever disagree with it.
    return null;
  }

  const expected = typeof rule.type === "string" ? rule.type : null;
  if (!expected) return null;
  if (!matchesType(supplied, expected)) {
    return `Argument "${name}" must be ${expected}, not ${describe(supplied)}.`;
  }

  if (expected === "array" && isRule(rule.items) && Array.isArray(supplied)) {
    for (let index = 0; index < supplied.length; index++) {
      const problem = checkValue(`${name}[${index}]`, supplied[index], rule.items);
      if (problem) return problem;
    }
  }
  return null;
}

function matchesType(supplied: unknown, expected: string): boolean {
  switch (expected) {
    case "string": return typeof supplied === "string";
    // JSON has one number type, so an integer is a number with a constraint —
    // and a float silently truncated into a cent amount is exactly the kind of
    // rounding nobody notices until it is money.
    case "integer": return typeof supplied === "number" && Number.isSafeInteger(supplied);
    case "number": return typeof supplied === "number" && Number.isFinite(supplied);
    case "boolean": return typeof supplied === "boolean";
    case "array": return Array.isArray(supplied);
    case "object": return typeof supplied === "object" && supplied !== null && !Array.isArray(supplied);
    case "null": return supplied === null;
    default: return true;
  }
}

function describe(supplied: unknown): string {
  if (supplied === null) return "null";
  if (Array.isArray(supplied)) return "an array";
  return `a ${typeof supplied}`;
}
