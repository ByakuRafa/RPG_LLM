/**
 * Game Master Orchestrator (Sprint 3, Task 3.6).
 * Manages player input -> LLM -> 1-shot repair -> actionQueue -> engine feedback loop.
 * Pure JS, zero DOM, zero Canvas, strictly coordinates state/queue/llm.
 */
import { buildRequest } from './promptBuilder.js';
import { parseAndValidate, buildRepairTurn } from './responseParser.js';
import { loadSettings } from '../core/settings.js';

/**
 * Creates the LLM Game Master orchestrator.
 *
 * @param {object} params
 * @param {object} params.store GameState store
 * @param {object} params.queue ActionQueue
 * @param {object} [params.bus] EventBus
 * @param {object} params.llm LLM client (real or fake)
 * @param {Function} [params.getSettings] Settings getter
 * @returns {object} GM controller
 */
export function createGameMaster({ store, queue, bus = null, llm, getSettings = loadSettings }) {
  let memory = [];
  let controller = null;
  let lastPrompt = null;
  let lastRawResponse = null;

  bus?.on('intent:reset', () => {
    resetMemory();
  });

  bus?.on('gm:cancel', () => {
    cancel();
  });

  function cancel() {
    if (controller) {
      controller.abort();
      controller = null;
    }
  }

  function resetMemory() {
    memory = [];
  }

  /**
   * Records engine feedback into conversation memory and emits system events.
   * @param {object} trace
   * @param {string} text
   * @param {object|string|null} tag
   */
  function feedback(trace, text, tag) {
    const s = store.getState();
    const active = s.entities?.[trace.input.activeId];
    const playerNum = active?.player || 1;
    const heroName = active?.name || 'Herói';
    const tagPart = tag ? ` [Tag Ativa: ${tag.id || tag}]` : '';

    // 1. Player turn
    memory.push({
      role: 'user',
      text: `[Jogador ${playerNum} · ${heroName}] ${text}${tagPart}`
    });

    // 2. Model response
    if (trace.parsed) {
      memory.push({
        role: 'model',
        text: JSON.stringify(trace.parsed)
      });
    }

    // 3. Engine feedback
    if (trace.batchResult?.rejected) {
      const rej = trace.batchResult.rejected;
      const rejTool = rej.call?.name || 'ação';
      const rejReason = rej.result?.reason || rej.message || 'Ação inválida pelas regras';
      if (trace.source !== 'BENCHMARK') {
        bus?.emit('chat:system', {
          level: 'error',
          text: `Ação bloqueada pelo motor: ${rejReason}`
        });
      }
      memory.push({
        role: 'user',
        text: `[MOTOR] REJEITADO ${rejTool}: ${rejReason}. Nenhuma ação posterior foi executada.`
      });
    } else if (trace.batchResult?.applied?.length > 0) {
      const appliedNames = trace.batchResult.applied.map((a) => a.call?.name || 'ação').join(', ');
      memory.push({
        role: 'user',
        text: `[MOTOR] OK: ${appliedNames}`
      });
    } else if (trace.parsed && (!trace.parsed.tool_calls || trace.parsed.tool_calls.length === 0)) {
      memory.push({
        role: 'user',
        text: '[MOTOR] Nenhuma ação solicitada.'
      });
    }

    // Keep last 6 entries
    if (memory.length > 6) {
      memory = memory.slice(-6);
    }
  }

  /**
   * Handles natural language player input through the LLM pipeline.
   *
   * @param {object} params
   * @param {string} params.text
   * @param {object|string|null} [params.tag]
   * @param {boolean} [params.recordPrompt=false]
   * @returns {Promise<object>} Trace object
   */
  async function handleInput({
    text = '',
    tag = null,
    source = 'PLAYER',
    configOverride = null,
    recordPrompt = false
  } = {}) {
    const rawText = String(text ?? '').trim();
    const state = store.getState();
    const activeId = state?.activeId;
    const activeHero = state?.entities?.[activeId];

    const settings = typeof getSettings === 'function' ? getSettings() : loadSettings();
    const config = configOverride || settings?.promptConfig || 'B';
    const model = settings?.model || 'gemini-3.8-flash';

    const trace = {
      config,
      model,
      source,
      input: {
        text: rawText,
        tag: tag?.id || (typeof tag === 'string' ? tag : null),
        activeId: activeId ?? null
      },
      prompt: null,
      rawFirst: null,
      rawRepair: null,
      parsed: null,
      jsonValidFirstTry: false,
      repaired: false,
      coercedArgs: false,
      schemaErrors: [],
      batchResult: { applied: [], rejected: null, skipped: [] },
      latencyMs: 0,
      usage: { promptTokens: 0, outputTokens: 0 },
      error: null
    };

    if (!rawText) {
      trace.error = { kind: 'empty_input', message: 'Texto de comando vazio.' };
      return trace;
    }

    if (state?.status !== 'playing') {
      trace.error = { kind: 'game_over', message: 'A partida não está em andamento.' };
      return trace;
    }

    if (!activeHero || !activeHero.alive) {
      trace.error = { kind: 'no_active_hero', message: 'Não há herói ativo disponível para agir.' };
      return trace;
    }

    // Cancel any previous pending request
    cancel();
    controller = new AbortController();
    bus?.emit('llm:thinking', true);

    try {
      const req = buildRequest({
        state,
        text: rawText,
        tag,
        config,
        memory
      });

      lastPrompt = req;
      if (recordPrompt) {
        trace.prompt = { system: req.system, contents: req.contents };
      }

      // Attempt 1: Initial generation
      const overrides = source === 'BENCHMARK' ? { temperature: 0 } : {};
      const res1 = await llm.generate({
        system: req.system,
        contents: req.contents,
        schema: req.schema,
        signal: controller.signal,
        overrides
      });

      trace.latencyMs += res1.latencyMs;
      trace.usage.promptTokens += res1.usage?.promptTokens || 0;
      trace.usage.outputTokens += res1.usage?.outputTokens || 0;
      trace.rawFirst = res1.text;
      lastRawResponse = res1.text;

      let out = parseAndValidate(res1.text);

      if (out.ok) {
        trace.jsonValidFirstTry = true;
      } else {
        // Attempt 2: 1-shot repair retry
        const repairTurn = buildRepairTurn(out.error || out.errors?.[0] || 'JSON inválido');
        const repairContents = [
          ...req.contents,
          { role: 'model', parts: [{ text: res1.text }] },
          repairTurn
        ];

        const resRepair = await llm.generate({
          system: req.system,
          contents: repairContents,
          schema: req.schema,
          signal: controller.signal,
          overrides
        });

        trace.latencyMs += resRepair.latencyMs;
        trace.usage.promptTokens += resRepair.usage?.promptTokens || 0;
        trace.usage.outputTokens += resRepair.usage?.outputTokens || 0;
        trace.rawRepair = resRepair.text;
        lastRawResponse = resRepair.text;

        out = parseAndValidate(resRepair.text);
        if (out.ok) {
          trace.repaired = true;
          bus?.emit('log:entry', {
            level: 'INFO',
            text: '[LLM] Resposta reparada (1 tentativa)',
            source: 'LLM',
            ts: Date.now()
          });
        }
      }

      if (!out.ok) {
        trace.schemaErrors = out.errors || [out.error || 'Erro de esquema JSON'];
        bus?.emit('log:entry', {
          level: 'ERROR',
          text: '[ERROR] O Mestre respondeu em formato inválido.',
          source: 'LLM',
          ts: Date.now()
        });
        if (source !== 'BENCHMARK') {
          bus?.emit('chat:system', {
            level: 'error',
            text: 'O Mestre respondeu em formato inválido e não pôde agir.'
          });
        }
        return trace;
      }

      trace.parsed = out.envelope;
      trace.coercedArgs = Boolean(out.flags?.coerced);

      // Emit narrative to chat (skipped during benchmark)
      if (source !== 'BENCHMARK' && out.envelope?.narrative) {
        bus?.emit('chat:gm', { narrative: out.envelope.narrative });
      }

      // Check if any tool calls proposed
      if (!out.calls || out.calls.length === 0) {
        bus?.emit('log:entry', {
          level: 'INFO',
          text: '[LLM] Nenhuma ação proposta.',
          source: 'LLM',
          ts: Date.now()
        });
        feedback(trace, rawText, tag);
        return trace;
      }

      // Enqueue batch to authoritative ActionQueue
      const batchResult = await queue.enqueue({
        source: source || 'LLM',
        narrative: out.envelope.narrative,
        tool_calls: out.calls
      });
      trace.batchResult = batchResult;

      feedback(trace, rawText, tag);
    } catch (err) {
      trace.error = { kind: err.kind ?? 'unknown', message: err.message };
      bus?.emit('log:entry', {
        level: 'ERROR',
        text: `[ERROR] ${err.message}`,
        source: 'LLM',
        ts: Date.now()
      });
      if (source !== 'BENCHMARK') {
        if (err.kind === 'canceled') {
          bus?.emit('chat:system', { level: 'info', text: 'Requisição ao Mestre cancelada.' });
        } else {
          bus?.emit('chat:system', { level: 'error', text: `Erro: ${err.message}` });
        }
      }
    } finally {
      controller = null;
      bus?.emit('llm:thinking', false);
    }

    return trace;
  }

  return {
    handleInput,
    cancel,
    resetMemory,
    getMemory: () => [...memory],
    getLastPrompt: () => lastPrompt,
    getLastRawResponse: () => lastRawResponse
  };
}
