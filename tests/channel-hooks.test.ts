import assert from "node:assert/strict";
import test from "node:test";
import { classifyEscalation, ESCALATION_CATEGORIES } from "../lib/channels/escalation.ts";
import { parseActionPayload, previewText, completionMessage, confirmButtons } from "../lib/channels/action-format.ts";
import { canConfirm, canPropose, toolNamesForRole } from "../lib/channels/roles.ts";

// The escalation classifier is the hook whose absence is invisible: everything
// else in this system fails loudly, and this one fails by the agent handling
// smoothly a message that should have reached a person within the hour.

test("life-safety messages escalate as critical", () => {
  for (const message of [
    "there is a gas leak in my apartment",
    "I smell gas in the hallway",
    "the ceiling collapsed last night",
    "no hot water for three days",
    "there is black mold in the bathroom",
  ]) {
    const match = classifyEscalation(message);
    assert.ok(match, `not caught: ${message}`);
    assert.equal(match.category, "habitability");
    assert.equal(match.severity, "critical");
  }
});

test("Spanish life-safety messages escalate identically", () => {
  // The case this most needs to catch, and the one an English-only word list
  // would miss entirely.
  for (const message of [
    "hay una fuga de gas en mi departamento",
    "huele a gas",
    "llevo tres días sin agua",
    "se cayó el techo de la cocina",
    "hay moho en el baño",
  ]) {
    const match = classifyEscalation(message);
    assert.ok(match, `not caught: ${message}`);
    assert.equal(match.severity, "critical");
  }
});

test("accents and case do not change the outcome", () => {
  assert.ok(classifyEscalation("ME AMENAZÓ"));
  assert.ok(classifyEscalation("me amenazo"));
  assert.ok(classifyEscalation("Se Cayó El Techo"));
});

test("legal and eviction language escalates", () => {
  assert.equal(classifyEscalation("I'm getting a lawyer")?.category, "legal");
  assert.equal(classifyEscalation("voy a hablar con mi abogado")?.category, "legal");
  assert.equal(classifyEscalation("are you evicting me?")?.category, "eviction");
  assert.equal(classifyEscalation("me van a sacar del departamento")?.category, "eviction");
  assert.equal(classifyEscalation("this is discrimination")?.category, "discrimination");
});

test("distress escalates above everything else in the same message", () => {
  // Ordered by severity, not by position: a message mentioning both a lawyer
  // and a gas leak is a gas leak.
  const match = classifyEscalation("I called my lawyer and there is a gas leak");
  assert.equal(match?.category, "habitability", "the life-safety signal must win");
});

test("ordinary operator questions do not escalate", () => {
  // Recall is deliberately favoured over precision, but a classifier that
  // fires on everything is a classifier people switch off.
  for (const message of [
    "how much have I collected this month?",
    "which units are vacant?",
    "send reminders to everyone late at Riverside",
    "¿cuánta renta he cobrado este mes?",
    "what work orders are still open?",
  ]) {
    assert.equal(classifyEscalation(message), null, `false positive: ${message}`);
  }
});

test("empty and non-string input is not an escalation", () => {
  for (const value of ["", "   ", null, undefined, 42, {}]) {
    assert.equal(classifyEscalation(value), null);
  }
});

test("every declared category is reachable", () => {
  // A category nobody can trigger is a category that silently does nothing.
  const samples: Record<string, string> = {
    habitability: "gas leak",
    distress: "this is a medical emergency",
    legal: "my lawyer says",
    eviction: "eviction notice",
    discrimination: "this is harassment",
  };
  for (const category of ESCALATION_CATEGORIES) {
    assert.equal(classifyEscalation(samples[category])?.category, category, category);
  }
});

// Roles.

test("a resident can propose nothing and confirm nothing", () => {
  assert.equal(canPropose("resident"), false);
  assert.equal(canConfirm("resident"), false);
  assert.deepEqual(toolNamesForRole("resident"), ["render_answer"]);
});

test("a coordinator proposes but does not confirm", () => {
  // Separation of duties: the channel must not become a laxer second route to
  // authority the dashboard withholds.
  assert.equal(canPropose("member"), true);
  assert.equal(canConfirm("member"), false);
});

test("owners and approvers confirm", () => {
  assert.equal(canConfirm("owner"), true);
  assert.equal(canConfirm("approver"), true);
});

// Action payloads arrive over the network and are untrusted.

test("action payloads parse only in their exact form", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  assert.deepEqual(parseActionPayload(`action:confirm:${id}`), { intent: "confirm", id });
  assert.deepEqual(parseActionPayload(`action:drop:${id}:2`), { intent: "drop", id, index: 2 });

  for (const bad of [
    "action:confirm:not-a-uuid",
    "action:destroy:" + id,
    `action:confirm:${id};DROP TABLE`,
    "../../etc/passwd",
    "",
    `action:drop:${id}:9999`,
  ]) {
    const parsed = parseActionPayload(bad);
    // A malformed payload either fails to parse, or parses to an index the
    // caller bounds-checks. Neither may reach a tool.
    if (parsed) assert.ok(parsed.index !== undefined && parsed.index > 900, `unexpectedly accepted: ${bad}`);
    else assert.equal(parsed, null);
  }
});

test("a batch preview masks destinations", () => {
  const action = {
    id: "a",
    organizationId: "org",
    channelIdentityId: "ci",
    tool: "send_external_message",
    args: {},
    recipients: [
      { label: "Lucía R.", destination: "+525512345678", detail: "$9,500" },
      { label: "Marco T.", destination: "+525598765432", detail: "$12,000" },
    ],
    summary: "s",
    expiresAt: new Date(),
  };
  const text = previewText(action, "en");
  assert.ok(text.includes("Lucía R."), "the operator needs to recognise who this is");
  assert.ok(!text.includes("+525512345678"), "a full number must not be printed into a forwardable chat");
  assert.ok(text.includes("5678"), "enough tail to disambiguate");
  assert.ok(text.includes("$9,500"));
});

test("a batch offers a review button, a single action does not", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const batch = confirmButtons(id, 3, "en");
  assert.ok(batch.some((b) => b.id === `action:list:${id}`), "a batch must be reviewable before it runs");
  const single = confirmButtons(id, 1, "en");
  assert.ok(!single.some((b) => b.id.startsWith("action:list")));
  assert.ok(single.some((b) => b.id === `action:confirm:${id}`));
  assert.ok(single.some((b) => b.id === `action:cancel:${id}`));
});

test("an irreversible action says so instead of offering an undo that would lie", () => {
  const sent = completionMessage(false, "a", "en");
  assert.equal(sent.buttons.length, 0, "no undo button on something that cannot be undone");
  assert.ok(/can't be undone/i.test(sent.text));

  const reversible = completionMessage(true, "a", "en");
  assert.equal(reversible.buttons.length, 1);
  assert.equal(reversible.buttons[0].id, "action:undo:a");
});

test("the irreversible message is honest in Spanish too", () => {
  const sent = completionMessage(false, "a", "es-mx");
  assert.equal(sent.buttons.length, 0);
  assert.ok(sent.text.includes("no se puede deshacer"));
});
