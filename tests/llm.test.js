import {
  buildSystemPrompt,
  buildStateSnapshot,
  buildUserTurn,
  buildRequest
} from '../src/llm/promptBuilder.js';
import { createGameMaster } from '../src/llm/gameMaster.js';
import { createStore, createInitialState } from '../src/engine/gameState.js';
import { createActionQueue } from '../src/engine/actionQueue.js';
import { TOOLS } from '../src/engine/tools.js';
import { createEventBus } from '../src/core/eventBus.js';
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

describe('Sprint 3: Prompt Builder & State Snapshot (Task 3.4)', () => {
  const seed = 'test-prompt-seed';
  const state = createInitialState(seed);

  it('generates system prompts distinguishing Config A from B', () => {
    const promptA = buildSystemPrompt('A');
    const promptB = buildSystemPrompt('B');

    // Both contain core role, contract, and tools
    expect(promptA.includes('Mestre de Jogo')).toBe(true);
    expect(promptA.includes('move_character')).toBe(true);
    expect(promptB.includes('Mestre de Jogo')).toBe(true);
    expect(promptB.includes('move_character')).toBe(true);

    // Config A must NOT have spatial guidance or few-shot examples
    expect(promptA.includes('reachable_tiles')).toBe(false);
    expect(promptA.includes('Ando até o goblin')).toBe(false);

    // Config B MUST have spatial guidance and 3 PT-BR few-shot examples
    expect(promptB.includes('ORIENTAÇÃO ESPACIAL E TÁTICA (CONFIG B)')).toBe(true);
    expect(promptB.includes('reachable_tiles')).toBe(true);
    expect(promptB.includes('attack_positions')).toBe(true);
    expect(promptB.includes('Ando até o goblin e corto ele')).toBe(true);
    expect(promptB.includes('Estou ferido, quero me curar')).toBe(true);
    expect(promptB.includes('Atravesso a parede e mato todos os goblins')).toBe(true);
  });

  it('builds state snapshot with reachable_tiles only in Config B', () => {
    const snapA = buildStateSnapshot(state, 'A');
    const snapB = buildStateSnapshot(state, 'B');

    // Config A checks
    expect(snapA.round).toBe(1);
    expect(snapA.active_character.id).toBe('hero_warrior');
    expect(snapA.reachable_tiles).toBe(undefined);
    expect(snapA.enemy_distances).toBe(undefined);
    expect(snapA.attack_positions).toBe(undefined);
    expect(snapA.adjacent_objects).toBe(undefined);

    // Config B checks
    expect(Array.isArray(snapB.reachable_tiles)).toBe(true);
    expect(snapB.reachable_tiles.length > 0).toBe(true);
    const activeHero = state.entities[state.activeId];

    // Every reachable tile in B must have cost <= activeHero.mp
    for (const [x, y, cost] of snapB.reachable_tiles) {
      expect(cost <= activeHero.mp).toBe(true);
      expect(typeof x).toBe('number');
      expect(typeof y).toBe('number');
    }

    expect(Array.isArray(snapB.enemy_distances)).toBe(true);
    expect(typeof snapB.attack_positions).toBe('object');
    expect(Array.isArray(snapB.adjacent_objects)).toBe(true);
  });

  it('guarantees deterministic state snapshot output for identical states', () => {
    const snap1 = buildStateSnapshot(state, 'B');
    const snap2 = buildStateSnapshot(state, 'B');

    expect(JSON.stringify(snap1)).toBe(JSON.stringify(snap2));
  });

  it('builds structured Gemini request via buildRequest', () => {
    const req = buildRequest({
      state,
      text: 'Avanço com espada',
      tag: 'slash',
      config: 'B',
      memory: [{ role: 'user', text: 'Turno anterior' }]
    });

    expect(typeof req.system).toBe('string');
    expect(Array.isArray(req.contents)).toBe(true);
    expect(req.contents.length).toBe(2);
    expect(req.contents[0].role).toBe('user');
    expect(req.contents[0].parts[0].text).toBe('Turno anterior');
    expect(req.contents[1].role).toBe('user');
    expect(req.contents[1].parts[0].text.includes('Avanço com espada')).toBe(true);
    expect(req.contents[1].parts[0].text.includes('[Tag Ativa: slash]')).toBe(true);
  });
});

describe('Sprint 3: Game Master Orchestrator (Task 3.6)', () => {
  function setupTestEnv() {
    const bus = createEventBus();
    const store = createStore(createInitialState('gm-test-seed'), bus);
    const queue = createActionQueue({
      store,
      bus,
      tools: TOOLS,
      stepDelayMs: 0
    });
    return { bus, store, queue };
  }

  it('successfully executes valid move + attack via fake LLM', async () => {
    const { bus, store, queue } = setupTestEnv();

    // Place goblin_1 adjacent to Thorin's destination (2, 9)
    const init = store.getState();
    init.entities.goblin_1.position = { x: 3, y: 9 };

    const fakePayload = JSON.stringify({
      narrative: 'Thorin avança em linha reta e golpeia o goblin com força.',
      tool_calls: [
        {
          name: 'move_character',
          arguments: { character_id: 'hero_warrior', target_x: 2, target_y: 9 }
        },
        {
          name: 'use_ability',
          arguments: { caster_id: 'hero_warrior', ability_id: 'slash', target_id: 'goblin_1' }
        }
      ]
    });

    const llm = createFakeLlmClient({ responder: fakePayload, latencyMs: 0 });
    const gm = createGameMaster({ store, queue, bus, llm });

    const trace = await gm.handleInput({ text: 'Avanço e corto o goblin' });

    expect(trace.jsonValidFirstTry).toBe(true);
    expect(trace.repaired).toBe(false);
    expect(trace.batchResult.applied.length).toBe(2);
    expect(trace.batchResult.rejected).toBe(null);

    // Verify state was altered by actionQueue
    const afterState = store.getState();
    expect(afterState.entities.hero_warrior.position.x).toBe(2);
    expect(afterState.entities.hero_warrior.position.y).toBe(9);
  });

  it('performs 1-shot repair when first attempt returns broken JSON', async () => {
    const { bus, store, queue } = setupTestEnv();

    const responses = [
      'Resposta quebrada sem JSON: Olá aventureiro { "narrative": ',
      JSON.stringify({
        narrative: 'Thorin se reposiciona taticamente.',
        tool_calls: [
          {
            name: 'move_character',
            arguments: { character_id: 'hero_warrior', target_x: 2, target_y: 9 }
          }
        ]
      })
    ];

    const llm = createFakeLlmClient({ responder: responses, latencyMs: 0 });
    const gm = createGameMaster({ store, queue, bus, llm });

    const trace = await gm.handleInput({ text: 'Movo para cima' });

    expect(trace.jsonValidFirstTry).toBe(false);
    expect(trace.repaired).toBe(true);
    expect(trace.batchResult.applied.length).toBe(1);
    expect(store.getState().entities.hero_warrior.position.y).toBe(9);
  });

  it('stops and logs error without altering state when repair fails twice', async () => {
    const { bus, store, queue } = setupTestEnv();
    const beforeState = JSON.stringify(store.getState());

    const responses = [
      'Primeiro texto inválido sem JSON',
      'Segundo texto inválido sem JSON'
    ];

    let errorLogged = false;
    bus.on('log:entry', (entry) => {
      if (entry.level === 'ERROR') errorLogged = true;
    });

    const llm = createFakeLlmClient({ responder: responses, latencyMs: 0 });
    const gm = createGameMaster({ store, queue, bus, llm });

    const trace = await gm.handleInput({ text: 'Ação com erro duplo' });

    expect(trace.repaired).toBe(false);
    expect(trace.schemaErrors.length > 0).toBe(true);
    expect(errorLogged).toBe(true);

    // Engine state remains 100% untouched
    expect(JSON.stringify(store.getState())).toBe(beforeState);
  });

  it('handles engine rejection for illegal action (walk 10 tiles) and emits chat:system', async () => {
    const { bus, store, queue } = setupTestEnv();
    const beforePos = { ...store.getState().entities.hero_warrior.position };

    let systemMsg = null;
    bus.on('chat:system', (msg) => {
      systemMsg = msg;
    });

    const fakePayload = JSON.stringify({
      narrative: 'Thorin tenta correr 10 casas pelo corredor.',
      tool_calls: [
        {
          name: 'move_character',
          arguments: { character_id: 'hero_warrior', target_x: 2, target_y: 1 }
        }
      ]
    });

    const llm = createFakeLlmClient({ responder: fakePayload, latencyMs: 0 });
    const gm = createGameMaster({ store, queue, bus, llm });

    const trace = await gm.handleInput({ text: 'Corro 10 casas' });

    expect(trace.batchResult.rejected !== null).toBe(true);
    expect(trace.batchResult.rejected.result.code).toBe('TOO_FAR');
    expect(systemMsg !== null).toBe(true);
    expect(systemMsg.level).toBe('error');
    expect(systemMsg.text.includes('Ação bloqueada')).toBe(true);

    // Hero position unchanged
    const afterPos = store.getState().entities.hero_warrior.position;
    expect(afterPos.x).toBe(beforePos.x);
    expect(afterPos.y).toBe(beforePos.y);

    // Memory contains [MOTOR] REJEITADO
    const mem = gm.getMemory();
    const hasRejMem = mem.some((m) => m.text && m.text.includes('[MOTOR] REJEITADO'));
    expect(hasRejMem).toBe(true);
  });

  it('handles refusal (tool_calls: []) without mutating state', async () => {
    const { bus, store, queue } = setupTestEnv();
    const beforeState = JSON.stringify(store.getState());

    const fakePayload = JSON.stringify({
      narrative: 'Não é possível voar por cima das muralhas de pedra.',
      tool_calls: []
    });

    let refusalLogged = false;
    bus.on('log:entry', (entry) => {
      if (entry.text.includes('Nenhuma ação proposta')) refusalLogged = true;
    });

    const llm = createFakeLlmClient({ responder: fakePayload, latencyMs: 0 });
    const gm = createGameMaster({ store, queue, bus, llm });

    const trace = await gm.handleInput({ text: 'Eu tento voar' });

    expect(trace.batchResult.applied.length).toBe(0);
    expect(refusalLogged).toBe(true);
    expect(JSON.stringify(store.getState())).toBe(beforeState);
  });
});
