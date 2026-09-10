import test from 'node:test';
import assert from 'node:assert/strict';
import { fitPanel, dockPanel, resizePanel, dragDestination } from '../lib/ask-aval/panel-geometry.ts';
import { readAskStream, streamAsk } from '../lib/ask-aval/progress.ts';

test('dragging and resizing keep panels reachable across small and changing viewports', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 650 }]) {
    const rect = fitPanel({ x: 2000, y: -80, width: 500, height: 720 }, viewport);
    assert.ok(rect.x >= 8 && rect.y >= 8);
    assert.ok(rect.x + rect.width <= viewport.width - 8);
    assert.ok(rect.y + rect.height <= viewport.height - 8);
    const dock = dockPanel(rect, viewport);
    assert.equal(dock.x + dock.width, viewport.width - 8);
    assert.equal(dock.height, viewport.height - 16);
    const resized = resizePanel(rect, 'nw', -9000, -9000, viewport);
    assert.equal(resized.x, 8); assert.equal(resized.y, 8);
    assert.equal(resized.x + resized.width, rect.x + rect.width);
    assert.equal(fitPanel(rect, viewport, true).height, 64);
  }
  assert.equal(dragDestination(1410, 300, { width: 1440, height: 900 }), 'dock');
  assert.equal(dragDestination(1480, 300, { width: 1440, height: 900 }), 'window');
  assert.equal(dragDestination(600, 300, { width: 1440, height: 900 }), 'float');
});

test('public progress precedes the final result without exposing reasoning or altering failures', async () => {
  const stages: unknown[] = [];
  const response = streamAsk(async progress => {
    progress({ phase: 'tool', tool: 'get_maintenance_performance' });
    progress({ phase: 'checking' });
    return Response.json({ error: 'Answer withheld' }, { status: 502 });
  });
  const result = await readAskStream(response, stage => stages.push(stage));
  assert.deepEqual(result, { error: 'Answer withheld' });
  assert.deepEqual(stages, [{ phase: 'tool', tool: 'get_maintenance_performance' }, { phase: 'checking' }]);
});

test('stream parsing tolerates split UTF-8 and refuses an interrupted final answer', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: 'result', data: { headline: 'Revisión', narrative: 'Verificado' } }) + '\n');
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  assert.equal((await readAskStream(new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }), () => {})).headline, 'Revisión');
  await assert.rejects(readAskStream(new Response('{"type":"progress","phase":"thinking"}\n', { headers: { 'content-type': 'application/x-ndjson' } }), () => {}), /before a verified answer/);
});
