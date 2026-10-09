/**
 * LLM turn orchestrator:
 *   player text → prompt (state + history + last rejections) → adapter
 *   → parse/validate → [one repair retry] → shared ingest → action queue.
 * Engine rejections from this turn are fed into the next prompt.
 */
import { buildRequest, buildRepairRequest, HISTORY_TURNS } from './promptBuilder.js';
import { parseLLMResponse, describeParseErrors } from './responseParser.js';
import { submitParsed } from '../core/ingest.js';

export const FALLBACK_NARRATIVE = 'O Mestre hesita por um instante, perdido em pensamentos... Nada acontece. Tente descrever sua ação de outra forma.';

export function createGameMaster({ store, queue, bus, getAdapter }) {
  let history = [];
  let lastRejections = [];
  let busy = false;

  async function handlePlayerInput(action) {
    const text = action.trim();
    if (!text || busy) return { status: 'ignored' };
    if (store.get().status !== 'playing') return { status: 'game_over' };

    busy = true;
    bus?.emit('player:input', { text });
    bus?.emit('gm:thinking', true);
    const adapter = getAdapter();

    try {
      const request = buildRequest({ state: store.get(), history, action: text, rejections: lastRejections });
      let attempt = 1;
      bus?.emit('llm:request', { adapter: adapter.name, attempt, request });
      let reply = await adapter.send(request);
      bus?.emit('llm:response', { adapter: adapter.name, attempt, ...reply });
      let parsed = parseLLMResponse(reply.text);
      let repaired = false;

      if (!parsed.ok) {
        const errors = describeParseErrors(parsed);
        bus?.emit('llm:invalid', { attempt, errors, raw: reply.text });
        attempt = 2;
        const repairReq = buildRepairRequest(request, reply.text, errors);
        bus?.emit('llm:request', { adapter: adapter.name, attempt, request: repairReq });
        reply = await adapter.send(repairReq);
        bus?.emit('llm:response', { adapter: adapter.name, attempt, ...reply });
        const second = parseLLMResponse(reply.text);
        if (second.ok) {
          parsed = second;
          repaired = true;
          bus?.emit('llm:repaired', { attempt });
        } else {
          bus?.emit('llm:invalid', { attempt, errors: describeParseErrors(second), raw: reply.text });
          // Degrade gracefully: keep valid commands if the envelope is usable.
          parsed = second.payload ? second : parsed.payload ? parsed : second;
        }
      }

      if (!parsed.payload) {
        bus?.emit('llm:failed', { reason: 'unusable response after repair' });
        bus?.emit('narrative', { text: FALLBACK_NARRATIVE, source: 'system' });
        return { status: 'failed' };
      }

      const result = await submitParsed(parsed, { queue, bus, source: adapter.name === 'mock' ? 'mock' : 'llm', meta: { repaired } });
      lastRejections = result.rejected;
      history = [...history, { action: text, response: JSON.stringify(parsed.payload) }].slice(-HISTORY_TURNS);
      bus?.emit('llm:turn', { applied: result.applied.length, rejected: result.rejected.length, repaired });
      return { status: 'ok', result, repaired };
    } catch (err) {
      bus?.emit('llm:error', { message: err.message, kind: err.kind ?? 'unknown' });
      bus?.emit('narrative', { text: `[Erro] ${err.message}`, source: 'system' });
      return { status: 'error', error: err };
    } finally {
      busy = false;
      bus?.emit('gm:thinking', false);
    }
  }

  function reset() {
    history = [];
    lastRejections = [];
  }

  return {
    handlePlayerInput,
    reset,
    get busy() {
      return busy;
    },
    get lastRejections() {
      return lastRejections;
    },
    get history() {
      return history;
    },
  };
}
