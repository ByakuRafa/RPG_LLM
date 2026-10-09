import { describe, it, expect } from './runner.js';
import { parseLLMResponse } from '../src/llm/responseParser.js';
import { SCRIPTED_SCENARIO, COMBO_FROM_START } from '../src/core/fixtures.js';

describe('Regression / Golden Fixtures Suite', () => {
  it('validates every step in the 8-turn scripted demo scenario', () => {
    for (let i = 0; i < SCRIPTED_SCENARIO.length; i++) {
      const step = SCRIPTED_SCENARIO[i];
      const parsed = parseLLMResponse(JSON.stringify(step));
      expect(parsed.ok).toBe(true);
      expect(parsed.payload.commands.length).toBeGreaterThan(0);
      expect(parsed.payload.narrative.length).toBeGreaterThan(0);
    }
  });

  it('validates the 6-command combo fixture', () => {
    const parsed = parseLLMResponse(JSON.stringify(COMBO_FROM_START));
    expect(parsed.ok).toBe(true);
    expect(parsed.payload.commands.length).toBe(6);
  });

  it('validates mock responses for core mechanic keywords', () => {
    const samples = [
      '{"narrative": "Você caminha para o norte.", "commands": [{"type": "MOVE", "id": "player", "to": {"x": 2, "y": 1}}]}',
      '{"narrative": "Você abre a porta rangendo as dobradiças.", "commands": [{"type": "INTERACT", "actor": "player", "target": "door_1"}]}',
      '{"narrative": "Você ataca o goblin com ferocidade!", "commands": [{"type": "ATTACK", "attacker": "player", "target": "goblin_1"}]}',
      '{"narrative": "Você recolhe as moedas espalhadas.", "commands": [{"type": "LOOT", "actor": "player", "from": "bag_goblin_1"}]}',
    ];
    for (const raw of samples) {
      const parsed = parseLLMResponse(raw);
      expect(parsed.ok).toBe(true);
    }
  });
});
