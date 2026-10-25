/**
 * LLM Enemy Strategy with automatic heuristic fallback (Sprint 4, Task 3.7).
 * Pure LLM layer. Proposes tool calls via Gemini API for monster turns,
 * filters actor to enemyId, validates against rules engine, and on any error,
 * timeout (8s), or empty/rejected output, falls back gracefully to HeuristicEnemyStrategy.
 */
import { HeuristicEnemyStrategy } from '../engine/enemyController.js';
import { validateBatch } from '../core/schema.js';
import { TOOLS } from '../engine/tools.js';
import { buildMonsterRequest } from './promptBuilder.js';
import { parseAndValidate } from './responseParser.js';

export class LlmEnemyStrategy {
  /**
   * @param {object} [options]
   * @param {object} options.llm LLM client (with generate(request, { signal, overrides }))
   * @param {object} [options.bus] Event bus for logging
   * @param {object} [options.fallbackStrategy] Fallback strategy (default: HeuristicEnemyStrategy)
   * @param {number} [options.timeoutMs=8000] Timeout in milliseconds
   * @param {Function} [options.buildRequest=buildMonsterRequest]
   * @param {Function} [options.parseResponse=parseAndValidate]
   * @param {object} [options.tools=TOOLS] Tools dictionary
   */
  constructor({
    llm,
    bus = null,
    fallbackStrategy = new HeuristicEnemyStrategy(),
    timeoutMs = 8000,
    buildRequest = buildMonsterRequest,
    parseResponse = parseAndValidate,
    tools = TOOLS
  } = {}) {
    this.llm = llm;
    this.bus = bus;
    this.fallback = fallbackStrategy || new HeuristicEnemyStrategy();
    this.timeoutMs = timeoutMs;
    this.buildRequest = buildRequest;
    this.parseResponse = parseResponse;
    this.tools = tools;
  }

  /**
   * Plans actions for a single enemy entity using the LLM with automatic fallback to heuristic on failure/timeout.
   *
   * @param {object} state GameState
   * @param {string} enemyId
   * @returns {Promise<Array<{ name: string, arguments: object }>>}
   */
  async planForEnemy(state, enemyId) {
    const enemy = state?.entities?.[enemyId];
    if (!enemy || !enemy.alive || !enemy.position) {
      return [];
    }

    // If no living heroes, no action
    const heroes = Object.values(state?.entities || {}).filter(e => e && e.role === 'player' && e.alive);
    if (heroes.length === 0) {
      return [];
    }

    // If no LLM client provided, use fallback immediately
    if (!this.llm || typeof this.llm.generate !== 'function') {
      return this.fallback.planForEnemy(state, enemyId);
    }

    let controller = null;
    let timeoutId = null;

    try {
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      }

      const req = this.buildRequest(state, enemyId);
      const res = await this.llm.generate(req, {
        signal: controller?.signal,
        overrides: { temperature: 0.2 }
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!res || !res.text || typeof res.text !== 'string') {
        throw new Error('Resposta vazia da LLM');
      }

      const parsed = this.parseResponse(res.text);
      if (!parsed || !parsed.valid || !Array.isArray(parsed.tool_calls)) {
        throw new Error('Falha no parser de JSON ou schema inválido');
      }

      // Filter: keep only calls whose actor is enemyId
      const filteredCalls = parsed.tool_calls.filter(call => {
        if (!call || !call.name || !call.arguments) return false;
        if (call.name === 'move_character') {
          return call.arguments.character_id === enemyId;
        }
        if (call.name === 'use_ability') {
          return call.arguments.caster_id === enemyId;
        }
        return false;
      });

      if (filteredCalls.length === 0) {
        throw new Error('Nenhuma chamada válida proposta para o monstro');
      }

      // Validate schema and structural constraints
      const batchValidation = validateBatch({ tool_calls: filteredCalls }, this.tools);
      if (!batchValidation.valid) {
        throw new Error(`Schema rejeitou chamadas do monstro: ${batchValidation.error}`);
      }

      // Validate engine rules for each call
      for (const call of filteredCalls) {
        const tool = this.tools?.[call.name];
        if (tool && typeof tool.validate === 'function') {
          const ruleCheck = tool.validate(state, call.arguments);
          if (!ruleCheck.valid) {
            throw new Error(`Regras rejeitaram ${call.name}: ${ruleCheck.error?.code || 'INVALID'}`);
          }
        }
      }

      return filteredCalls;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      const msg = '[INFO] IA inimiga LLM falhou; usando heurística';
      console.info(`${msg} (${err.message || err})`);
      if (this.bus && typeof this.bus.emit === 'function') {
        this.bus.emit('log:entry', {
          level: 'INFO',
          text: msg,
          source: 'ENEMY_AI',
          ts: Date.now()
        });
      }
      return this.fallback.planForEnemy(state, enemyId);
    }
  }
}
