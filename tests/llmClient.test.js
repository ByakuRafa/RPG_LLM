import { describe, it, expect } from './runner.js';
import { createGeminiAdapter, LLMError } from '../src/llm/llmClient.js';
import { createGameMaster } from '../src/llm/gameMaster.js';
import { createStore, createInitialState } from '../src/engine/gameState.js';
import { createActionQueue } from '../src/engine/actionQueue.js';
import { createEventBus } from '../src/core/eventBus.js';

describe('LLM / Client and Timeout Handling', () => {
  it('respects custom timeoutSeconds setting and defaults Gemma to 120s', () => {
    const adapterGemma = createGeminiAdapter({
      getSettings: () => ({ apiKey: 'fake-key', model: 'gemma-4-26b-a4b-it' }),
    });
    expect(adapterGemma.getTimeoutSeconds()).toBe(120);

    const adapterCustom = createGeminiAdapter({
      getSettings: () => ({ apiKey: 'fake-key', model: 'gemma-4-26b-a4b-it', timeoutSeconds: 180 }),
    });
    expect(adapterCustom.getTimeoutSeconds()).toBe(180);

    const adapterFlash = createGeminiAdapter({
      getSettings: () => ({ apiKey: 'fake-key', model: 'gemini-3.8-flash' }),
    });
    expect(adapterFlash.getTimeoutSeconds()).toBe(60);
  });

  it('formats friendly timeout error with actionable guidance on request timeout', async () => {
    // Fake fetch that aborts due to timeout
    const fakeFetch = (url, opts) =>
      new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const adapter = createGeminiAdapter({
      getSettings: () => ({ apiKey: 'fake-key', model: 'gemma-4-26b-a4b-it', timeoutSeconds: 0.05 }), // 50ms timeout
      fetchImpl: fakeFetch,
    });

    let thrown = null;
    try {
      await adapter.send({ system: 'sys', contents: [{ role: 'user', text: 'hi' }] });
    } catch (err) {
      thrown = err;
    }

    expect(thrown instanceof LLMError).toBe(true);
    expect(thrown.kind).toBe('timeout');
    expect(thrown.message).toContain('Tempo limite esgotado');
    expect(thrown.message).toContain('Configuracoes');
  });

  it('supports cancellation cleanly without unhandled error', async () => {
    const fakeFetch = (url, opts) =>
      new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const adapter = createGeminiAdapter({
      getSettings: () => ({ apiKey: 'fake-key', model: 'gemma-4-26b-a4b-it', timeoutSeconds: 60 }),
      fetchImpl: fakeFetch,
    });

    const abortCtrl = new AbortController();
    setTimeout(() => abortCtrl.abort('canceled'), 10);

    let thrown = null;
    try {
      await adapter.send({ system: 'sys', contents: [{ role: 'user', text: 'hi' }] }, { signal: abortCtrl.signal });
    } catch (err) {
      thrown = err;
    }

    expect(thrown instanceof LLMError).toBe(true);
    expect(thrown.kind).toBe('canceled');
  });

  it('allows canceling gameMaster turns via gameMaster.cancel()', async () => {
    const bus = createEventBus();
    const store = createStore(createInitialState(), bus);
    const queue = createActionQueue({ store, bus });

    let receivedSignal = null;
    const fakeAdapter = {
      name: 'gemini',
      async send(req, { signal }) {
        receivedSignal = signal;
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new LLMError('Requisicao cancelada.', { kind: 'canceled' }));
          });
        });
      },
    };

    const gm = createGameMaster({
      store,
      queue,
      bus,
      getAdapter: () => fakeAdapter,
    });

    const turnPromise = gm.handlePlayerInput('andar norte');
    expect(gm.busy).toBe(true);

    // Cancel in-flight
    gm.cancel();

    const res = await turnPromise;
    expect(res.status).toBe('canceled');
    expect(gm.busy).toBe(false);
  });
});
