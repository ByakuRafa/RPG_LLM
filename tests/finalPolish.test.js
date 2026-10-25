/**
 * Unit Tests for Sprint 4 Final Polish & VTT Sprites (Step 12).
 * Verifies LlmEnemyStrategy, Heuristic Fallback, buildMonsterRequest, and loadSprites graceful fallback.
 */
import { describe, it, expect } from './runner.js';
import { createInitialState } from '../src/engine/gameState.js';
import { buildMonsterRequest, buildMonsterSnapshot } from '../src/llm/promptBuilder.js';
import { LlmEnemyStrategy } from '../src/llm/llmEnemyStrategy.js';
import { HeuristicEnemyStrategy } from '../src/engine/enemyController.js';
import { createGridRenderer } from '../src/render/gridRenderer.js';
import { createEventBus } from '../src/core/eventBus.js';

describe('Sprint 4 Step 12: Tactical Monster Request Builder (buildMonsterRequest)', () => {
  it('builds a valid monster request with system prompt, schema, and monster snapshot', () => {
    const state = createInitialState('TEST_SEED');
    const req = buildMonsterRequest(state, 'goblin_1');

    expect(Boolean(req)).toBe(true);
    expect(typeof req.system).toBe('string');
    expect(req.system.includes('goblin_strike')).toBe(true);
    expect(Array.isArray(req.contents)).toBe(true);
    expect(req.contents[0].parts[0].text.includes('ESTADO DO MONSTRO:')).toBe(true);
    expect(Boolean(req.schema)).toBe(true);

    const snapshot = buildMonsterSnapshot(state, 'goblin_1');
    expect(snapshot.monster_id).toBe('goblin_1');
    expect(Array.isArray(snapshot.reachable_tiles)).toBe(true);
    expect(Array.isArray(snapshot.living_heroes)).toBe(true);
    expect(snapshot.living_heroes.length).toBe(3);
  });
});

describe('Sprint 4 Step 12: LlmEnemyStrategy & Heuristic Fallback', () => {
  it('returns valid tool calls when LLM produces valid JSON for the enemy', async () => {
    const state = createInitialState('TEST_SEED');
    const fakeLlm = {
      async generate() {
        return {
          text: JSON.stringify({
            narrative: 'O goblin rosna e avança furtivamente.',
            tool_calls: [
              {
                name: 'move_character',
                arguments: { character_id: 'goblin_1', target_x: 9, target_y: 3 }
              }
            ]
          })
        };
      }
    };

    const strategy = new LlmEnemyStrategy({ llm: fakeLlm });
    const calls = await strategy.planForEnemy(state, 'goblin_1');

    expect(Array.isArray(calls)).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('move_character');
    expect(calls[0].arguments.character_id).toBe('goblin_1');
  });

  it('filters out tool calls belonging to other actors and falls back to heuristic', async () => {
    const state = createInitialState('TEST_SEED');
    const bus = createEventBus();
    const logs = [];
    bus.on('log:entry', ev => logs.push(ev));

    const fakeLlm = {
      async generate() {
        return {
          text: JSON.stringify({
            narrative: 'Ataque forçado de outro personagem',
            tool_calls: [
              {
                name: 'move_character',
                arguments: { character_id: 'hero_warrior', target_x: 2, target_y: 2 }
              }
            ]
          })
        };
      }
    };

    const strategy = new LlmEnemyStrategy({ llm: fakeLlm, bus });
    const calls = await strategy.planForEnemy(state, 'goblin_1');

    // Filter discards hero_warrior, resulting in 0 enemy calls -> triggers heuristic fallback
    expect(Array.isArray(calls)).toBe(true);
    expect(logs.some(l => l.text.includes('IA inimiga LLM falhou; usando heurística'))).toBe(true);
  });

  it('falls back to heuristic strategy when LLM fails or times out', async () => {
    const state = createInitialState('TEST_SEED');
    const bus = createEventBus();
    const logs = [];
    bus.on('log:entry', ev => logs.push(ev));

    const failingLlm = {
      async generate() {
        throw new Error('Network timeout');
      }
    };

    const strategy = new LlmEnemyStrategy({ llm: failingLlm, bus });
    const calls = await strategy.planForEnemy(state, 'goblin_1');

    expect(Array.isArray(calls)).toBe(true);
    const heuristic = new HeuristicEnemyStrategy();
    const expected = heuristic.planForEnemy(state, 'goblin_1');
    expect(JSON.stringify(calls)).toBe(JSON.stringify(expected));
    expect(logs.some(l => l.text.includes('IA inimiga LLM falhou; usando heurística'))).toBe(true);
  });

  it('falls back to heuristic strategy when LLM proposes an illegal move rejected by rules', async () => {
    const state = createInitialState('TEST_SEED');
    const bus = createEventBus();
    const logs = [];
    bus.on('log:entry', ev => logs.push(ev));

    const illegalLlm = {
      async generate() {
        return {
          text: JSON.stringify({
            narrative: 'O goblin tenta atravessar a parede de pedra.',
            tool_calls: [
              {
                name: 'move_character',
                arguments: { character_id: 'goblin_1', target_x: 0, target_y: 0 } // (0,0) is a stone wall
              }
            ]
          })
        };
      }
    };

    const strategy = new LlmEnemyStrategy({ llm: illegalLlm, bus });
    const calls = await strategy.planForEnemy(state, 'goblin_1');

    expect(Array.isArray(calls)).toBe(true);
    expect(logs.some(l => l.text.includes('IA inimiga LLM falhou; usando heurística'))).toBe(true);
  });
});

describe('Sprint 4 Step 12: GridRenderer VTT Sprites Fallback (loadSprites)', () => {
  it('loadSprites caches successfully loaded images and handles missing images gracefully', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 768;

    const bus = createEventBus();
    const logs = [];
    bus.on('log:entry', ev => logs.push(ev));

    const renderer = createGridRenderer(canvas, bus);
    expect(typeof renderer.loadSprites).toBe('function');

    // Attempt loading a missing URL (handled gracefully without throwing)
    await renderer.loadSprites(['./assets/tokens/missing_non_existent.png']);

    // Attempt loading the same missing URL again (ensures it is not re-logged)
    await renderer.loadSprites(['./assets/tokens/missing_non_existent.png']);

    const missingLogs = logs.filter(l => l.text.includes('Sprite ausente: ./assets/tokens/missing_non_existent.png'));
    expect(missingLogs.length).toBe(1);

    renderer.destroy();
  });
});
