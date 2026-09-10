import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalFormat, parseProposal } from '../scripts/lib/codex-inference.mjs';
import { SEMANTIC_REVIEW_TOOL } from '../lib/agents/semantic-review.ts';

test('review output preserves the verdict schema without escaped arguments', () => {
  const original = JSON.stringify(SEMANTIC_REVIEW_TOOL);
  const format = proposalFormat([SEMANTIC_REVIEW_TOOL]);
  assert.equal(format.direct, true);
  assert.equal(format.schema.additionalProperties, false);
  assert.equal(format.schema.properties.claims.items.properties.citations.items.additionalProperties, false);
  assert.deepEqual(format.schema.required, ['passed', 'requirements', 'claims', 'issues']);
  assert.equal(JSON.stringify(SEMANTIC_REVIEW_TOOL), original);
  const verdict = { passed: false, requirements: [], claims: [], issues: ['Missing evidence'] };
  const [call] = parseProposal(JSON.stringify(verdict), [SEMANTIC_REVIEW_TOOL], true);
  assert.equal(call.name, 'semantic_verdict');
  assert.deepEqual(call.input, verdict); // Semantic validation remains the runtime's job.
});

test('actor proposal diagnostics distinguish missing, empty, oversized and malformed calls', () => {
  const allowed = [{ name: 'read_evidence', input_schema: { type: 'object' } }];
  const format = proposalFormat(allowed);
  assert.equal(format.direct, false);
  assert.equal(format.schema.properties.calls.minItems, 1);
  assert.equal(format.schema.properties.calls.maxItems, 4);
  const call = { name: 'read_evidence', argumentsJson: '{}' };
  for (const [value, error] of [
    [{}, /missing the calls array/], [{ calls: [] }, /0 calls/],
    [{ calls: Array(5).fill(call) }, /5 calls/],
    [{ calls: [{ ...call, name: 'send_message' }] }, /unoffered/],
    [{ calls: [{ ...call, argumentsJson: 'invalid' }] }, /arguments.*not valid JSON/],
    [{ calls: [{ ...call, argumentsJson: '[]' }] }, /must be an object/],
  ]) assert.throws(() => parseProposal(JSON.stringify(value), allowed, false), error);
  assert.throws(() => parseProposal('invalid', allowed, false), /proposal is not valid JSON/);
  assert.deepEqual(parseProposal(JSON.stringify({ calls: [call] }), allowed, false)[0].input, {});
});
