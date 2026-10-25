/**
 * Unit tests for Academic Evaluator, Metrics Scorer, and Benchmark UI (Sprint 4, Task 3.9).
 * Tests: scoreCase, summarize, percentile, toCsv, summaryToCsv, toJson, and Evaluator runner with Oracle Fake LLM.
 */
import { describe, it, expect, assert } from './runner.js';
import {
  scoreCase,
  summarize,
  percentile,
  toCsv,
  summaryToCsv,
  toJson,
  escapeCsv,
  createEvaluator
} from '../src/llm/evaluator.js';
import { createStore, createInitialState } from '../src/engine/gameState.js';
import { createActionQueue } from '../src/engine/actionQueue.js';
import { TOOLS } from '../src/engine/tools.js';
import { createFakeLlmClient } from '../src/llm/fakeLlmClient.js';
import { createGameMaster } from '../src/llm/gameMaster.js';
import { makeTestState } from './helpers.js';
import { buildSnapshot, withActive } from '../src/core/fixtures.js';
import { computeReachable, manhattan } from '../src/engine/pathfinding.js';

describe('Sprint 4 Step 11: Task 3.2 & 3.9 — scoreCase Pure Evaluation', () => {
  it('scoreCase: exact match on single tool sequence and all args matched', () => {
    const tc = {
      id: 'D01',
      category: 'direct',
      snapshot: 'default',
      active_id: 'hero_warrior',
      expected: {
        tool_sequences: [['move_character']],
        args_alternatives: [[{ character_id: 'hero_warrior', target_x: 2, target_y: 8 }]],
        should_refuse: false
      }
    };

    const trace = {
      config: 'B',
      model: 'gemini-3.8-flash',
      parsed: {
        narrative: 'Thorin avança para a posição.',
        tool_calls: [{ name: 'move_character', arguments: { character_id: 'hero_warrior', target_x: 2, target_y: 8 } }]
      },
      batchResult: { applied: [{ call: { name: 'move_character' } }], rejected: null, skipped: [] },
      latencyMs: 120,
      jsonValidFirstTry: true,
      repaired: false,
      coercedArgs: false
    };

    const res = scoreCase(tc, trace, { config: 'B', rep: 1 });
    expect(res.caseId).toBe('D01');
    expect(res.category).toBe('direct');
    expect(res.toolCorrect).toBe(true);
    expect(res.argMatched).toBe(3);
    expect(res.argTotal).toBe(3);
    expect(res.llmRefused).toBe(false);
    expect(res.engineRejected).toBe(false);
    expect(res.illegalEffectApplied).toBe(false);
    expect(res.jsonValidFirstTry).toBe(true);
    expect(res.repaired).toBe(false);
    expect(res.latencyMs).toBe(120);
  });

  it('scoreCase: alternative match (matches second alternative sequence)', () => {
    const tc = {
      id: 'A03',
      category: 'ambiguous',
      snapshot: 'mage_wounded',
      active_id: 'hero_mage',
      expected: {
        tool_sequences: [['use_ability'], ['use_item']],
        args_alternatives: [
          [{ caster_id: 'hero_mage', ability_id: 'heal_pulse', target_id: 'hero_mage' }],
          [{ character_id: 'hero_mage', item_id: 'health_potion', target_id: 'hero_mage' }]
        ],
        should_refuse: false
      }
    };

    // Model chose to use health potion instead of heal_pulse
    const trace = {
      config: 'A',
      parsed: {
        narrative: 'Lyra bebe uma poção de vida.',
        tool_calls: [{ name: 'use_item', arguments: { character_id: 'hero_mage', item_id: 'health_potion', target_id: 'hero_mage' } }]
      },
      batchResult: { applied: [{ call: { name: 'use_item' } }], rejected: null },
      latencyMs: 150
    };

    const res = scoreCase(tc, trace, { config: 'A', rep: 1 });
    expect(res.toolCorrect).toBe(true);
    expect(res.expectedTools).toBe('use_ability || use_item');
    expect(res.predictedTools).toBe('use_item');
    expect(res.argMatched).toBe(3);
    expect(res.argTotal).toBe(3);
  });

  it('scoreCase: wrong tool sequence produces toolCorrect: false and argMatched: 0', () => {
    const tc = {
      id: 'D01',
      category: 'direct',
      snapshot: 'default',
      active_id: 'hero_warrior',
      expected: {
        tool_sequences: [['move_character']],
        args_alternatives: [[{ character_id: 'hero_warrior', target_x: 2, target_y: 8 }]],
        should_refuse: false
      }
    };

    const trace = {
      config: 'B',
      parsed: {
        narrative: 'Thorin encerra sua vez sem se mover.',
        tool_calls: [{ name: 'end_turn', arguments: { character_id: 'hero_warrior' } }]
      },
      batchResult: { applied: [{ call: { name: 'end_turn' } }], rejected: null }
    };

    const res = scoreCase(tc, trace, { config: 'B', rep: 1 });
    expect(res.toolCorrect).toBe(false);
    expect(res.argMatched).toBe(0);
    expect(res.argTotal).toBe(0);
  });

  it('scoreCase: right tool with wrong args calculates partial argMatched', () => {
    const tc = {
      id: 'D01',
      category: 'direct',
      snapshot: 'default',
      active_id: 'hero_warrior',
      expected: {
        tool_sequences: [['move_character']],
        args_alternatives: [[{ character_id: 'hero_warrior', target_x: 2, target_y: 8 }]],
        should_refuse: false
      }
    };

    // Right character_id, but wrong target coordinates
    const trace = {
      config: 'B',
      parsed: {
        narrative: 'Thorin vai para x=5, y=5.',
        tool_calls: [{ name: 'move_character', arguments: { character_id: 'hero_warrior', target_x: 5, target_y: 5 } }]
      },
      batchResult: { applied: [], rejected: { message: 'Fora do alcance' } }
    };

    const res = scoreCase(tc, trace, { config: 'B', rep: 1 });
    expect(res.toolCorrect).toBe(true);
    expect(res.argMatched).toBe(1); // character_id matched, target_x/target_y did not
    expect(res.argTotal).toBe(3);
  });

  it('scoreCase: illegal case properly refused by LLM', () => {
    const tc = {
      id: 'I01',
      category: 'illegal',
      snapshot: 'default',
      active_id: 'hero_warrior',
      expected: {
        tool_sequences: [[]],
        args_alternatives: [[]],
        should_refuse: true
      }
    };

    const trace = {
      config: 'B',
      parsed: {
        narrative: 'Não posso atravessar paredes de pedra.',
        tool_calls: []
      },
      batchResult: { applied: [], rejected: null }
    };

    const res = scoreCase(tc, trace, { config: 'B', rep: 1 });
    expect(res.toolCorrect).toBe(true);
    expect(res.llmRefused).toBe(true);
    expect(res.illegalEffectApplied).toBe(false);
    expect(res.engineRejected).toBe(false);
  });

  it('scoreCase: illegal case proposed by LLM but blocked by engine', () => {
    const tc = {
      id: 'I01',
      category: 'illegal',
      snapshot: 'default',
      active_id: 'hero_warrior',
      expected: {
        tool_sequences: [[]],
        args_alternatives: [[]],
        should_refuse: true
      }
    };

    // LLM attempted move through wall, engine rejected it
    const trace = {
      config: 'B',
      parsed: {
        narrative: 'Thorin tenta atravessar a parede.',
        tool_calls: [{ name: 'move_character', arguments: { character_id: 'hero_warrior', target_x: 0, target_y: 10 } }]
      },
      batchResult: {
        applied: [],
        rejected: { call: { name: 'move_character' }, result: { ok: false, code: 'TILE_BLOCKED' } }
      }
    };

    const res = scoreCase(tc, trace, { config: 'B', rep: 1 });
    expect(res.toolCorrect).toBe(false);
    expect(res.llmRefused).toBe(false);
    expect(res.engineRejected).toBe(true);
    expect(res.illegalEffectApplied).toBe(false); // No state changing effect applied!
  });

  it('scoreCase: illegal case where illegal effect was applied (partial move)', () => {
    const tc = {
      id: 'I03',
      category: 'illegal',
      snapshot: 'default',
      active_id: 'hero_warrior',
      expected: {
        tool_sequences: [[]],
        args_alternatives: [[]],
        should_refuse: true
      }
    };

    // LLM proposed move then attack out of range; move was applied!
    const trace = {
      config: 'A',
      parsed: {
        narrative: 'Thorin move e tenta golpear de longe.',
        tool_calls: [
          { name: 'move_character', arguments: { character_id: 'hero_warrior', target_x: 2, target_y: 8 } },
          { name: 'use_ability', arguments: { caster_id: 'hero_warrior', ability_id: 'slash', target_id: 'goblin_1' } }
        ]
      },
      batchResult: {
        applied: [{ call: { name: 'move_character' } }],
        rejected: { call: { name: 'use_ability' } }
      }
    };

    const res = scoreCase(tc, trace, { config: 'A', rep: 1 });
    expect(res.llmRefused).toBe(false);
    expect(res.illegalEffectApplied).toBe(true); // Partial move counts as applied effect!
  });

  it('scoreCase: target_xy_in matcher resolves reachable coordinates from snapshot', () => {
    const tc = {
      id: 'A01',
      category: 'ambiguous',
      snapshot: 'default',
      active_id: 'hero_warrior',
      expected: {
        tool_sequences: [['move_character', 'use_ability']],
        args_alternatives: [
          [
            { character_id: 'hero_warrior', target_xy_in: 'attack_positions:slash:goblin_1' },
            { caster_id: 'hero_warrior', ability_id: 'slash', target_id: 'goblin_1' }
          ]
        ],
        should_refuse: false
      }
    };

    // In default snapshot, goblin_1 is at (3, 9).
    // Valid adjacent tiles around (3, 9) reachable by Thorin at (2, 10): (2, 9) or (3, 8).
    const trace = {
      config: 'B',
      parsed: {
        narrative: 'Thorin se aproxima e ataca o goblin.',
        tool_calls: [
          { name: 'move_character', arguments: { character_id: 'hero_warrior', target_x: 2, target_y: 9 } },
          { name: 'use_ability', arguments: { caster_id: 'hero_warrior', ability_id: 'slash', target_id: 'goblin_1' } }
        ]
      },
      batchResult: { applied: [{ call: { name: 'move_character' } }, { call: { name: 'use_ability' } }] }
    };

    const res = scoreCase(tc, trace, { config: 'B', rep: 1 });
    expect(res.toolCorrect).toBe(true);
    expect(res.argMatched).toBe(4); // target_xy_in matched (1) + character_id (1) + caster_id (1) + ability_id (1) + target_id (1)
    expect(res.argTotal).toBe(5);
  });
});

describe('Sprint 4 Step 11: Task 3.2 — percentile & summarize Pure Functions', () => {
  it('percentile calculates correctly across edge cases and interpolation', () => {
    // Empty array
    expect(percentile([], 50)).toBe(0);

    // Single value
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);

    // Sorted array: [10, 20, 30, 40]
    const vals = [10, 20, 30, 40];
    expect(percentile(vals, 0)).toBe(10); // min
    expect(percentile(vals, 100)).toBe(40); // max
    expect(percentile(vals, 50)).toBe(25); // median (interpolation between 20 and 30)

    // Supports 0-1 scale as well
    expect(percentile(vals, 0.5)).toBe(25);
    expect(percentile(vals, 1.0)).toBe(40);
  });

  it('summarize correctly evaluates a hand-computed 4-case set', () => {
    const results = [
      // Case 1: direct, correct, perfect args, json valid
      {
        config: 'B',
        caseId: 'D01',
        category: 'direct',
        rep: 1,
        model: 'gemini-3.8-flash',
        toolCorrect: true,
        argMatched: 2,
        argTotal: 2,
        llmRefused: false,
        engineRejected: false,
        illegalEffectApplied: false,
        jsonValidFirstTry: true,
        repaired: false,
        latencyMs: 100
      },
      // Case 2: ambiguous, correct, partial args, repaired
      {
        config: 'B',
        caseId: 'A01',
        category: 'ambiguous',
        rep: 1,
        model: 'gemini-3.8-flash',
        toolCorrect: true,
        argMatched: 1,
        argTotal: 2,
        llmRefused: false,
        engineRejected: false,
        illegalEffectApplied: false,
        jsonValidFirstTry: false,
        repaired: true,
        latencyMs: 200
      },
      // Case 3: illegal, LLM refused cleanly
      {
        config: 'B',
        caseId: 'I01',
        category: 'illegal',
        rep: 1,
        model: 'gemini-3.8-flash',
        toolCorrect: true,
        argMatched: 0,
        argTotal: 0,
        llmRefused: true,
        engineRejected: false,
        illegalEffectApplied: false,
        jsonValidFirstTry: true,
        repaired: false,
        latencyMs: 300
      },
      // Case 4: illegal, proposed by LLM, caught by engine
      {
        config: 'B',
        caseId: 'I02',
        category: 'illegal',
        rep: 1,
        model: 'gemini-3.8-flash',
        toolCorrect: false,
        argMatched: 0,
        argTotal: 0,
        llmRefused: false,
        engineRejected: true,
        illegalEffectApplied: false,
        jsonValidFirstTry: true,
        repaired: false,
        latencyMs: 400
      }
    ];

    const summaries = summarize(results);
    expect(summaries.length).toBe(1);

    const s = summaries[0];
    expect(s.config).toBe('B');
    expect(s.model).toBe('gemini-3.8-flash');
    expect(s.cases).toBe(4);
    expect(s.reps).toBe(1);

    // Tool Selection Accuracy: 2 legal cases, both toolCorrect -> 1.0 (100%)
    expect(s.toolSelectionAccuracy).toBe(1.0);
    expect(s.accuracyStdDevAcrossReps).toBe(0);

    // Argument Precision: sumMatched=3, sumTotal=4 -> 3/4 = 0.75 (75%)
    expect(s.argumentPrecision).toBe(0.75);

    // Illegal Handling: 2 illegal cases, none had effect applied -> 2/2 = 1.0 (100%)
    expect(s.illegalHandlingRate).toBe(1.0);
    // LLM Refusal: 1 of 2 -> 0.5 (50%)
    expect(s.llmRefusalRate).toBe(0.5);
    // Engine Catch: 1 of 2 -> 0.5 (50%)
    expect(s.engineCatchRate).toBe(0.5);

    // False Rejection: 0 legal rejected
    expect(s.falseRejectionRate).toBe(0.0);

    // JSON Validity: 3 of 4 -> 0.75 (75%)
    expect(s.jsonValidFirstTryRate).toBe(0.75);
    // Repair: 1 of 4 -> 0.25 (25%)
    expect(s.repairRate).toBe(0.25);

    // Latency
    expect(s.latencyMs.mean).toBe(250);
    expect(s.latencyMs.p50).toBe(250);
  });
});

describe('Sprint 4 Step 11: Task 3.3 — CSV and JSON Exporters', () => {
  it('escapeCsv escapes quotes, commas, and newlines properly', () => {
    expect(escapeCsv('simples')).toBe('simples');
    expect(escapeCsv('Thorin, o Guerreiro')).toBe('"Thorin, o Guerreiro"');
    expect(escapeCsv('Thorin diz: "Avante!"')).toBe('"Thorin diz: ""Avante!"""');
    expect(escapeCsv('Linha 1\nLinha 2')).toBe('"Linha 1\nLinha 2"');
    expect(escapeCsv(null)).toBe('');
    expect(escapeCsv(undefined)).toBe('');
  });

  it('toCsv generates valid CSV with correct header and escaped rows', () => {
    const results = [
      {
        config: 'B',
        caseId: 'D01',
        category: 'direct',
        rep: 1,
        expectedTools: 'move_character',
        predictedTools: 'move_character',
        toolCorrect: true,
        argMatched: 3,
        argTotal: 3,
        llmRefused: false,
        engineRejected: false,
        illegalEffectApplied: false,
        jsonValidFirstTry: true,
        repaired: false,
        coercedArgs: false,
        latencyMs: 140,
        error: null,
        narrative: 'Thorin avança, cauteloso e destemido.'
      }
    ];

    const csv = toCsv(results);
    const lines = csv.split('\n');
    expect(lines.length).toBe(2);

    expect(lines[0]).toBe(
      'config,case_id,category,rep,expected_tools,predicted_tools,tool_correct,arg_matched,arg_total,llm_refused,engine_rejected,illegal_effect_applied,json_valid_first_try,repaired,coerced_args,latency_ms,error'
    );
    expect(lines[1].startsWith('B,D01,direct,1,move_character,move_character,true,3,3,false,false,false,true,false,false,140,')).toBe(true);
  });

  it('summaryToCsv outputs summary data matching header schema', () => {
    const summary = [
      {
        config: 'B',
        model: 'gemini-3.8-flash',
        cases: 30,
        reps: 1,
        toolSelectionAccuracy: 0.95,
        accuracyStdDevAcrossReps: 0,
        argumentPrecision: 0.92,
        illegalHandlingRate: 1.0,
        llmRefusalRate: 0.8,
        engineCatchRate: 0.2,
        falseRejectionRate: 0,
        jsonValidFirstTryRate: 0.97,
        repairRate: 0.03,
        latencyMs: { mean: 1200, p50: 1100, p95: 1800 }
      }
    ];

    const csv = summaryToCsv(summary);
    const lines = csv.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0].includes('tool_selection_accuracy')).toBe(true);
    expect(lines[1].includes('0.95')).toBe(true);
  });

  it('toJson formats complete benchmark payload', () => {
    const data = {
      meta: { model: 'gemini-3.8-flash', date: '2026-10-25' },
      summary: [{ config: 'B', toolSelectionAccuracy: 1.0 }],
      results: [{ config: 'B', caseId: 'D01', toolCorrect: true }]
    };
    const jsonStr = toJson(data);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.meta.model).toBe('gemini-3.8-flash');
    expect(parsed.results.length).toBe(1);
  });
});

describe('Sprint 4 Step 11: Task 3.1 & 3.5 — Evaluator Runner with Oracle Fake LLM', () => {
  it('evaluator runner executes benchmark suite and restores game state afterwards', async () => {
    // 1. Setup store, queue, and initial state
    const store = createStore(createInitialState('IA2_DUNGEON_01'));
    const initialClone = structuredClone(store.getState());

    let animationCallCount = 0;
    const fakeAnimator = {
      play: async () => {
        animationCallCount++;
      }
    };

    const queue = createActionQueue({
      store,
      tools: TOOLS,
      animator: fakeAnimator,
      stepDelayMs: 50
    });

    // 2. Load test suite
    const res = await fetch('/tests/testSuite.json');
    expect(res.ok).toBe(true);
    const fullSuite = await res.json();

    // Use a representative subset of cases: 1 direct, 1 ambiguous, 1 illegal
    const testCases = [
      fullSuite.cases.find(c => c.id === 'D01'),
      fullSuite.cases.find(c => c.id === 'A03'),
      fullSuite.cases.find(c => c.id === 'I01')
    ];
    const miniSuite = {
      version: 1,
      seed: fullSuite.seed,
      cases: testCases
    };

    // 3. Create Oracle Fake LLM responder
    const oracleResponder = (req) => {
      // Find matching case by prompt text in contents
      const userMsg = req.contents.find(c => c.role === 'user')?.parts?.[0]?.text || '';
      const matchedCase = testCases.find(c => userMsg.includes(c.prompt_pt));

      if (!matchedCase) {
        return JSON.stringify({ narrative: 'Caso desconhecido', tool_calls: [] });
      }

      if (matchedCase.expected.should_refuse) {
        return JSON.stringify({
          narrative: 'Ação ilegal recusada pelo Mestre.',
          tool_calls: []
        });
      }

      // Return first expected tool sequence & args alternative
      const tools = matchedCase.expected.tool_sequences[0];
      const argsList = matchedCase.expected.args_alternatives[0];
      const calls = tools.map((name, i) => {
        const args = { ...argsList[i] };
        return { name, arguments: args };
      });

      return JSON.stringify({
        narrative: 'Executando comando esperado pelo oráculo.',
        tool_calls: calls
      });
    };

    const fakeLlm = createFakeLlmClient({
      responder: oracleResponder,
      latencyMs: 10
    });

    const gm = createGameMaster({
      store,
      queue,
      llm: fakeLlm,
      getSettings: () => ({ promptConfig: 'B', model: 'fake-oracle-model' })
    });

    const evaluator = createEvaluator({
      store,
      queue,
      gm,
      getSettings: () => ({ benchmarkDelayMs: 0, model: 'fake-oracle-model' })
    });

    let progressEvents = 0;
    const outcome = await evaluator.runSuite({
      suite: miniSuite,
      configs: ['B'],
      reps: 1,
      onProgress: () => {
        progressEvents++;
      }
    });

    // 4. Verify evaluation results
    expect(progressEvents).toBe(3);
    expect(outcome.results.length).toBe(3);

    const d01 = outcome.results.find(r => r.caseId === 'D01');
    expect(d01.toolCorrect).toBe(true);
    expect(d01.argMatched).toBe(d01.argTotal);

    const a03 = outcome.results.find(r => r.caseId === 'A03');
    expect(a03.toolCorrect).toBe(true);
    expect(a03.argMatched).toBe(a03.argTotal);

    const i01 = outcome.results.find(r => r.caseId === 'I01');
    expect(i01.toolCorrect).toBe(true);
    expect(i01.llmRefused).toBe(true);
    expect(i01.illegalEffectApplied).toBe(false);

    // 5. Verify summary metrics
    const summary = outcome.summary[0];
    expect(summary.toolSelectionAccuracy).toBe(1.0);
    expect(summary.argumentPrecision).toBe(1.0);
    expect(summary.illegalHandlingRate).toBe(1.0);
    expect(summary.llmRefusalRate).toBe(1.0);

    // 6. Verify animations were disabled during run
    expect(animationCallCount).toBe(0);

    // 7. Verify state integrity: state restored to initial state
    const finalState = store.getState();
    expect(finalState.activeId).toBe(initialClone.activeId);
    expect(finalState.entities.hero_warrior.position.x).toBe(initialClone.entities.hero_warrior.position.x);
    expect(finalState.entities.hero_warrior.position.y).toBe(initialClone.entities.hero_warrior.position.y);
  });
});

  it('runs full 30-case benchmark with oracle fake LLM achieving 100% accuracy and safety', async () => {
    const store = createStore(createInitialState('IA2_DUNGEON_01'));
    const initialClone = structuredClone(store.getState());

    const queue = createActionQueue({
      store,
      tools: TOOLS,
      animator: null,
      stepDelayMs: 0
    });

    const res = await fetch('/tests/testSuite.json');
    const fullSuite = await res.json();
    expect(fullSuite.cases.length).toBe(30);

    const oracleResponder = (req) => {
      const userMsg = req.contents.find(c => c.role === 'user')?.parts?.[0]?.text || '';
      const tc = fullSuite.cases.find(c => userMsg.includes(c.prompt_pt));
      assert(tc !== undefined, `Prompt not matched: ${userMsg}`);

      if (tc.expected.should_refuse) {
        return JSON.stringify({
          narrative: 'Ação ilegal recusada com sucesso pelo Mestre.',
          tool_calls: []
        });
      }

      const snap = withActive(buildSnapshot(tc.snapshot, fullSuite.seed), tc.active_id);
      const tools = tc.expected.tool_sequences[0];
      const argsList = tc.expected.args_alternatives[0];

      const calls = tools.map((name, i) => {
        const argObj = { ...argsList[i] };
        if (argObj.target_xy_in) {
          if (argObj.target_xy_in.startsWith('attack_positions:')) {
            const [, abilityId, targetId] = argObj.target_xy_in.split(':');
            const target = snap.entities[targetId];
            const reach = computeReachable(snap, tc.active_id, snap.entities[tc.active_id].mp);
            for (const [k] of reach.entries()) {
              const [x, y] = k.split(',').map(Number);
              if (manhattan(x, y, target.position.x, target.position.y) === 1) {
                argObj.target_x = x;
                argObj.target_y = y;
                delete argObj.target_xy_in;
                break;
              }
            }
          } else if (argObj.target_xy_in.startsWith('adjacent:')) {
            const [, objId] = argObj.target_xy_in.split(':');
            const obj = snap.objects[objId] || snap.entities[objId];
            const reach = computeReachable(snap, tc.active_id, snap.entities[tc.active_id].mp);
            for (const [k] of reach.entries()) {
              const [x, y] = k.split(',').map(Number);
              if (manhattan(x, y, obj.position.x, obj.position.y) === 1) {
                argObj.target_x = x;
                argObj.target_y = y;
                delete argObj.target_xy_in;
                break;
              }
            }
          }
        }
        return { name, arguments: argObj };
      });

      return JSON.stringify({
        narrative: 'Executando alternativa esperada pelo oráculo.',
        tool_calls: calls
      });
    };

    const fakeLlm = createFakeLlmClient({
      responder: oracleResponder,
      latencyMs: 0
    });

    const gm = createGameMaster({
      store,
      queue,
      llm: fakeLlm,
      getSettings: () => ({ promptConfig: 'B', model: 'oracle-gemini-3.8-flash' })
    });

    const evaluator = createEvaluator({
      store,
      queue,
      gm,
      getSettings: () => ({ benchmarkDelayMs: 0, model: 'oracle-gemini-3.8-flash' })
    });

    let count = 0;
    const outcome = await evaluator.runSuite({
      suite: fullSuite,
      configs: ['B'],
      reps: 1,
      onProgress: () => { count++; }
    });

    expect(count).toBe(30);
    expect(outcome.results.length).toBe(30);

    const s = outcome.summary[0];
    expect(s.cases).toBe(30);
    expect(s.toolSelectionAccuracy).toBe(1.0); // 100% on all 20 direct & ambiguous cases
    expect(s.argumentPrecision).toBe(1.0);     // 100% arg precision on all legal cases
    expect(s.illegalHandlingRate).toBe(1.0);   // 100% illegal handled safely
    expect(s.llmRefusalRate).toBe(1.0);        // 100% refusal rate by LLM
    expect(s.engineCatchRate).toBe(0.0);
    expect(s.falseRejectionRate).toBe(0.0);

    // State restored exactly
    const afterState = store.getState();
    expect(afterState.activeId).toBe(initialClone.activeId);
    expect(afterState.entities.hero_warrior.position.x).toBe(initialClone.entities.hero_warrior.position.x);
  });
