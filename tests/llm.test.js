import { describe, it, expect } from './runner.js';
import { RESPONSE_SCHEMA } from '../src/core/schema.js';
import {
  loadSettings,
  saveSettings,
  hasApiKey,
  resetSettings,
  initSettings,
  DEFAULT_SETTINGS
} from '../src/core/settings.js';
import {
  createLlmClient,
  mapHttpError,
  isGemmaModel,
  LLMError
} from '../src/llm/llmClient.js';
import { createFakeLlmClient } from '../src/llm/fakeLlmClient.js';
import {
  extractJson,
  normalizeEnvelope,
  buildRepairTurn,
  parseAndValidate,
  extractJsonBlock
} from '../src/llm/responseParser.js';

describe('Sprint 3: Core Schema & Settings', () => {
  it('exports RESPONSE_SCHEMA with flat nullable arguments', () => {
    expect(RESPONSE_SCHEMA.type).toBe('OBJECT');
    expect(RESPONSE_SCHEMA.required).toEqual(['narrative', 'tool_calls']);

    const items = RESPONSE_SCHEMA.properties.tool_calls.items;
    expect(items.type).toBe('OBJECT');
    expect(items.required).toEqual(['name', 'arguments']);

    const argsProps = items.properties.arguments.properties;
    expect(argsProps.character_id.nullable).toBe(true);
    expect(argsProps.caster_id.nullable).toBe(true);
    expect(argsProps.target_id.nullable).toBe(true);
    expect(argsProps.ability_id.nullable).toBe(true);
    expect(argsProps.item_id.nullable).toBe(true);
    expect(argsProps.object_id.nullable).toBe(true);
    expect(argsProps.target_x.type).toBe('INTEGER');
    expect(argsProps.target_x.nullable).toBe(true);
    expect(argsProps.target_y.type).toBe('INTEGER');
    expect(argsProps.target_y.nullable).toBe(true);
  });

  it('manages localStorage settings with defaults and updates', () => {
    resetSettings();
    const defaults = loadSettings();
    expect(defaults.model).toBe(DEFAULT_SETTINGS.model);
    expect(defaults.promptConfig).toBe('B');
    expect(defaults.apiKey).toBe('');
    expect(hasApiKey()).toBe(false);

    let emitted = null;
    const mockBus = { emit: (ev, val) => { if (ev === 'settings:changed') emitted = val; } };
    initSettings(mockBus);

    const updated = saveSettings({ apiKey: 'test-key-123', promptConfig: 'A', model: 'gemma-4-26b-a4b-it' });
    expect(updated.apiKey).toBe('test-key-123');
    expect(updated.promptConfig).toBe('A');
    expect(updated.model).toBe('gemma-4-26b-a4b-it');
    expect(hasApiKey()).toBe(true);
    expect(emitted?.apiKey).toBe('test-key-123');

    // Clean up
    resetSettings();
    expect(hasApiKey()).toBe(false);
  });
});

describe('Sprint 3: LLM Client & Error Classification', () => {
  it('correctly classifies HTTP error codes into typed LLMErrors', () => {
    const err401 = mapHttpError(401, { error: { message: 'API_KEY_INVALID' } });
    expect(err401.kind).toBe('auth');
    expect(err401.message.includes('Chave de API inválida')).toBe(true);

    const err404 = mapHttpError(404, { error: { message: 'models/unknown not found' } });
    expect(err404.kind).toBe('model');

    const err429 = mapHttpError(429, { error: { message: 'Resource exhausted' } });
    expect(err429.kind).toBe('rate_limit');

    const err503 = mapHttpError(503, { error: { message: 'Overloaded' } });
    expect(err503.kind).toBe('server');
  });

  it('detects Gemma models and applies fallback structure', async () => {
    expect(isGemmaModel('gemma-4-26b-a4b-it')).toBe(true);
    expect(isGemmaModel('gemini-3.8-flash')).toBe(false);

    let capturedUrl = '';
    let capturedBody = null;
    const fakeFetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"narrative":"Gemma ok","tool_calls":[]}' }] } }]
        })
      };
    };

    const client = createLlmClient({
      getSettings: () => ({ apiKey: 'fake-key', model: 'gemma-4-26b-a4b-it' }),
      fetchImpl: fakeFetch
    });

    const res = await client.generate({
      system: 'Você é o Mestre.',
      contents: [{ role: 'user', text: 'Ando 2 casas.' }]
    });

    expect(res.text.includes('Gemma ok')).toBe(true);
    expect(capturedUrl.includes('gemma-4-26b-a4b-it')).toBe(true);
    // Gemma fallback: no systemInstruction, system merged into user text
    expect(capturedBody.systemInstruction).toBe(undefined);
    expect(capturedBody.generationConfig.responseSchema).toBe(undefined);
    expect(capturedBody.contents[0].parts[0].text.includes('Você é o Mestre.')).toBe(true);
  });

  it('automatically retries once on transient HTTP 500 error', async () => {
    let callCount = 0;
    const fakeFetch = async (url, opts) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { message: 'Transient server error' } })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"narrative":"Recuperado","tool_calls":[]}' }] } }]
        })
      };
    };

    const client = createLlmClient({
      getSettings: () => ({ apiKey: 'fake-key', model: 'gemini-3.8-flash' }),
      fetchImpl: fakeFetch
    });

    const res = await client.generate({
      system: 'Sistema',
      contents: [{ role: 'user', text: 'Olá' }]
    });

    expect(callCount).toBe(2);
    expect(res.text.includes('Recuperado')).toBe(true);
  });

  it('supports cancellation cleanly with signal', async () => {
    const fakeFetch = (url, opts) =>
      new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const client = createLlmClient({
      getSettings: () => ({ apiKey: 'fake-key', model: 'gemini-3.8-flash', timeoutMs: 5000 }),
      fetchImpl: fakeFetch
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    let thrown = null;
    try {
      await client.generate({
        contents: [{ role: 'user', text: 'Teste cancel' }],
        signal: controller.signal
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown instanceof LLMError).toBe(true);
    expect(thrown.kind).toBe('canceled');
  });

  it('runs testConnection returning latency on success', async () => {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'pong' }] } }]
      })
    });

    const client = createLlmClient({
      getSettings: () => ({ apiKey: 'fake-key', model: 'gemini-3.8-flash' }),
      fetchImpl: fakeFetch
    });

    const status = await client.testConnection();
    expect(status.ok).toBe(true);
    expect(status.error).toBe(null);
  });
});

describe('Sprint 3: Fake LLM Client', () => {
  it('returns queued responses in sequence', async () => {
    const queue = [
      '{"narrative": "Turno 1", "tool_calls": []}',
      '{"narrative": "Turno 2", "tool_calls": []}'
    ];

    const fakeClient = createFakeLlmClient({ responder: queue, latencyMs: 5 });

    const res1 = await fakeClient.generate({ contents: [{ role: 'user', text: 'Ação 1' }] });
    expect(res1.text).toBe('{"narrative": "Turno 1", "tool_calls": []}');

    const res2 = await fakeClient.generate({ contents: [{ role: 'user', text: 'Ação 2' }] });
    expect(res2.text).toBe('{"narrative": "Turno 2", "tool_calls": []}');
  });

  it('executes responder function and respects abort signal', async () => {
    const fakeClient = createFakeLlmClient({
      responder: (req) => `Eco: ${req.contents[0].text}`,
      latencyMs: 10
    });

    const res = await fakeClient.generate({ contents: [{ role: 'user', text: 'Olá Mestre' }] });
    expect(res.text).toBe('Eco: Olá Mestre');

    // Abort test
    const ctrl = new AbortController();
    ctrl.abort();

    let thrown = null;
    try {
      await fakeClient.generate({ contents: [{ role: 'user', text: 'Abort' }], signal: ctrl.signal });
    } catch (e) {
      thrown = e;
    }
    expect(thrown instanceof LLMError).toBe(true);
    expect(thrown.kind).toBe('canceled');
  });
});

describe('Sprint 3: Response Parser & Sanitization', () => {
  it('extracts pristine JSON', () => {
    const raw = '{"narrative": "O herói avança.", "tool_calls": []}';
    const res = extractJson(raw);
    expect(res.ok).toBe(true);
    expect(res.value.narrative).toBe('O herói avança.');
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n{\n  "narrative": "Cercado por código",\n  "tool_calls": []\n}\n```';
    const res = extractJson(fenced);
    expect(res.ok).toBe(true);
    expect(res.value.narrative).toBe('Cercado por código');
  });

  it('extracts JSON surrounded by prose', () => {
    const mixed = 'Aqui está a ação:\n\n{"narrative": "Thorin brande o machado.", "tool_calls": []}\n\nBoa sorte!';
    const res = extractJson(mixed);
    expect(res.ok).toBe(true);
    expect(res.value.narrative).toBe('Thorin brande o machado.');
  });

  it('handles nested braces inside strings without miscounting', () => {
    const complex = 'Observação: { "narrative": "Você encontra um bilhete que diz: {segredo}.", "tool_calls": [] } Fim.';
    const block = extractJsonBlock(complex);
    expect(block).toBe('{ "narrative": "Você encontra um bilhete que diz: {segredo}.", "tool_calls": [] }');

    const res = extractJson(complex);
    expect(res.ok).toBe(true);
    expect(res.value.narrative).toBe('Você encontra um bilhete que diz: {segredo}.');
  });

  it('reports error on truncated or broken JSON', () => {
    const broken = '{"narrative": "Incompleto...", "tool_calls": [{"name": "move"';
    const res = extractJson(broken);
    expect(res.ok).toBe(false);
    expect(res.error.length > 0).toBe(true);
  });

  it('normalizes envelope aliases and coerces string arguments', () => {
    const raw = {
      narrative: 'Ação com alias e argumentos em string',
      commands: [
        {
          name: 'move_character',
          arguments: '{"character_id": "hero_warrior", "target_x": "3", "target_y": "4"}'
        }
      ]
    };

    const norm = normalizeEnvelope(raw);
    expect(norm.narrative).toBe('Ação com alias e argumentos em string');
    expect(norm.flags.aliasUsed).toBe(true);
    expect(norm.flags.coerced).toBe(true);
    expect(norm.tool_calls.length).toBe(1);

    const call = norm.tool_calls[0];
    expect(call.name).toBe('move_character');
    expect(call.arguments.character_id).toBe('hero_warrior');
    expect(call.arguments.target_x).toBe(3);
    expect(call.arguments.target_y).toBe(4);
  });

  it('drops null and undefined argument values in normalizeEnvelope', () => {
    const raw = {
      narrative: 'Drop nulls',
      tool_calls: [
        {
          name: 'use_ability',
          arguments: {
            caster_id: 'hero_mage',
            ability_id: 'firebolt',
            target_id: 'goblin_1',
            item_id: null,
            target_x: null,
            target_y: undefined
          }
        }
      ]
    };

    const norm = normalizeEnvelope(raw);
    const args = norm.tool_calls[0].arguments;
    expect(args.caster_id).toBe('hero_mage');
    expect(args.ability_id).toBe('firebolt');
    expect(args.target_id).toBe('goblin_1');
    expect(args.item_id).toBe(undefined);
    expect(args.target_x).toBe(undefined);
  });

  it('builds a repair turn prompt', () => {
    const repair = buildRepairTurn('JSON inválido: syntax error');
    expect(repair.role).toBe('user');
    expect(repair.text.includes('Sua resposta anterior não era um JSON válido')).toBe(true);
    expect(repair.text.includes('syntax error')).toBe(true);
  });

  it('executes parseAndValidate successfully on legal tool batch', () => {
    const raw = `
\`\`\`json
{
  "narrative": "Thorin avança e golpeia o goblin com fúria.",
  "tool_calls": [
    {
      "name": "move_character",
      "arguments": { "character_id": "hero_warrior", "target_x": 3, "target_y": 4 }
    },
    {
      "name": "use_ability",
      "arguments": { "caster_id": "hero_warrior", "ability_id": "slash", "target_id": "goblin_1" }
    }
  ]
}
\`\`\`
`;
    const res = parseAndValidate(raw);
    expect(res.ok).toBe(true);
    expect(res.calls.length).toBe(2);
    expect(res.envelope.narrative.includes('Thorin avança')).toBe(true);
  });

  it('rejects unknown tools via parseAndValidate', () => {
    const raw = '{"narrative": "Magia proibida", "tool_calls": [{"name": "cast_supernova", "arguments": {}}]}';
    const res = parseAndValidate(raw);
    expect(res.ok).toBe(false);
    expect(res.error.includes('UNKNOWN_TOOL')).toBe(true);
  });
});
