/**
 * Fake LLM Client for offline gameplay (?fakeLlm=1), benchmark replay,
 * and deterministic unit tests.
 * Interface mirrors createLlmClient: { generate, testConnection }.
 */
import { LLMError } from './llmClient.js';

/**
 * Creates an offline stub LLM client.
 * @param {object} options
 * @param {Function|Array|string} [options.responder] Responder function, queue of strings, or single string.
 * @param {number} [options.latencyMs=300] Simulated network latency.
 * @returns {{ generate: Function, testConnection: Function }}
 */
export function createFakeLlmClient({ responder = null, latencyMs = 300 } = {}) {
  /**
   * Generates a fake LLM response.
   * @param {object} params
   * @returns {Promise<{ text: string, finishReason: string, usage: object, latencyMs: number }>}
   */
  async function generate({ system = '', contents = [], schema = null, signal = null, overrides = {} } = {}) {
    if (signal?.aborted) {
      throw new LLMError('Requisição cancelada.', { kind: 'canceled' });
    }

    const waitMs = overrides.latencyMs !== undefined ? Number(overrides.latencyMs) : latencyMs;

    if (waitMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs);
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new LLMError('Requisição cancelada.', { kind: 'canceled' }));
            },
            { once: true }
          );
        }
      });
    }

    if (signal?.aborted) {
      throw new LLMError('Requisição cancelada.', { kind: 'canceled' });
    }

    let result;
    const req = { system, contents, schema, overrides, signal };

    if (typeof responder === 'function') {
      result = responder(req);
    } else if (Array.isArray(responder)) {
      result = responder.shift();
    } else if (typeof responder === 'string') {
      result = responder;
    } else {
      result = JSON.stringify({
        narrative: 'O Mestre de Jogo avalia a masmorra silenciosamente.',
        tool_calls: []
      });
    }

    if (result && typeof result.then === 'function') {
      result = await result;
    }

    if (result instanceof Error) {
      throw result;
    }

    if (typeof result === 'string') {
      return {
        text: result,
        finishReason: 'STOP',
        usage: { promptTokens: 20, outputTokens: 30 },
        latencyMs: waitMs
      };
    }

    if (result && typeof result === 'object') {
      return {
        text: result.text ?? JSON.stringify(result),
        finishReason: result.finishReason ?? 'STOP',
        usage: result.usage ?? { promptTokens: 20, outputTokens: 30 },
        latencyMs: result.latencyMs ?? waitMs
      };
    }

    return {
      text: String(result ?? ''),
      finishReason: 'STOP',
      usage: { promptTokens: 20, outputTokens: 30 },
      latencyMs: waitMs
    };
  }

  /**
   * Simulates a successful connection test.
   * @returns {Promise<{ ok: boolean, latencyMs: number, error: null }>}
   */
  async function testConnection() {
    return {
      ok: true,
      latencyMs: 50,
      error: null
    };
  }

  return {
    generate,
    testConnection
  };
}
