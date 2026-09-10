/** Public execution stages only: no hidden reasoning or extra model calls. */
export type AskProgress = { phase: 'thinking' | 'tool' | 'checking'; tool?: string };
export async function readAskStream(response: Response, onProgress: (progress: AskProgress) => void): Promise<Record<string, unknown> & { error?: string }> {
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return response.json();
  if (!response.body) throw new Error('The answer stream is unavailable.');
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ''; let answer: (Record<string, unknown> & { error?: string }) | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'progress' && ['thinking', 'tool', 'checking'].includes(event.phase)) onProgress({ phase: event.phase, ...(typeof event.tool === 'string' ? { tool: event.tool } : {}) });
    if (event.type === 'result') answer = event.data;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2_000_000) throw new Error('The answer stream is too large.');
      let end; while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      if (done) break;
    }
    consume(buffer);
    if (!answer || typeof answer !== 'object') throw new Error('The answer stream ended before a verified answer arrived.');
    return answer;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function streamAsk(run: (onProgress: (progress: AskProgress) => void) => Promise<Response>): Response {
  const encoder = new TextEncoder(); let closed = false;
  return new Response(new ReadableStream({
    async start(controller) {
      const emit = (event: unknown) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); };
      try {
        const response = await run(progress => emit({ type: 'progress', ...progress }));
        emit({ type: 'result', status: response.status, data: await response.json() });
      } catch { emit({ type: 'result', status: 500, data: { error: 'The assistant is unavailable right now.' } }); }
      finally { if (!closed) { closed = true; controller.close(); } }
    },
    cancel() { closed = true; },
  }), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
