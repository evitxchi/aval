import assert from "node:assert/strict";
import test from "node:test";
import { PERSONAS, type PersonaId } from "../lib/ask-aval/personas.ts";
import { DATA_SOURCE_NODES, PERSONA_IDS, PERSONA_TOOL_ACCESS } from "../app/components/agent-avatar/personas.ts";

// The client mirrors the server registry's tool subsets by hand so the Setup
// view can show an agent's real reach without dragging server-only Ask Aval
// code into the client bundle. These tests are what make that duplication
// safe: a drift here would misrepresent what an agent can actually see.

test("every persona id exists on both sides of the mirror", () => {
  assert.deepEqual([...PERSONA_IDS].sort(), Object.keys(PERSONAS).sort());
});

test("each persona's client-side tool access matches the server registry exactly", () => {
  for (const id of PERSONA_IDS) {
    assert.deepEqual(PERSONA_TOOL_ACCESS[id], PERSONAS[id as PersonaId].toolNames, `tool access drifted for persona "${id}"`);
  }
});

test("every tool a persona is granted is a node the Setup diagram can actually draw", () => {
  const drawable = new Set(DATA_SOURCE_NODES.map((node) => node.tool));
  for (const id of PERSONA_IDS) {
    for (const tool of PERSONA_TOOL_ACCESS[id] ?? []) {
      assert.equal(drawable.has(tool), true, `persona "${id}" may call "${tool}" but the Setup diagram has no node for it`);
    }
  }
});

test("every drawn source node is a real tool some persona can reach", () => {
  const granted = new Set(PERSONA_IDS.flatMap((id) => PERSONA_TOOL_ACCESS[id] ?? []));
  for (const node of DATA_SOURCE_NODES) {
    assert.equal(granted.has(node.tool), true, `Setup diagram draws "${node.tool}" but no persona is granted it`);
  }
});
