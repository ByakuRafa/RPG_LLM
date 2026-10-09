/**
 * Single entry point used by BOTH command sources (LLM pipeline and Human GM
 * panel). Guarantees that anything validated via GM Mode behaves identically
 * when the LLM emits it.
 */
import { parseLLMResponse } from '../llm/responseParser.js';

/**
 * Pushes a parse result into the queue. Structurally invalid commands are
 * reported as rejected (stage "schema") and dropped; valid ones are enqueued.
 * @returns {Promise<{applied: Array, rejected: Array, source: string} | null>}
 *          null when the envelope itself is unusable.
 */
export async function submitParsed(parsed, { queue, bus, source, animate = true, meta } = {}) {
  if (!parsed.payload) {
    bus?.emit('payload:invalid', { errors: parsed.errors, raw: parsed.raw, source, stage: parsed.stage });
    return null;
  }
  const schemaRejected = parsed.commandErrors.map(({ command, errors }) => {
    const reason = errors.join('; ');
    bus?.emit('command:rejected', { cmd: command, reason, source, stage: 'schema' });
    return { cmd: command, reason };
  });
  const result = await queue.enqueue(parsed.payload, { source, animate, meta });
  return { ...result, rejected: [...schemaRejected, ...result.rejected] };
}

/** Raw text (or object) → parse → validate → queue. Used by the GM panel and replays. */
export function submitRaw(input, opts) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return submitParsed(parseLLMResponse(text), opts);
}
