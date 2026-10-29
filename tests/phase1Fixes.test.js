/**
 * Testes para as correções da Fase 1:
 * - Inventário e Poções de Cura (state.inventory e aliases)
 * - Magia de Cura (heal_pulse em si mesmo e aliados sem erro de alvo inimigo)
 * - Empurrão do Guerreiro (shield_bash, aliases e fallback de cálculo de empurrão)
 */
import { describe, it, assert, assertEqual } from './runner.js';
import { makeTestState } from './helpers.js';
import { normalizeBatch, resolveSemanticTarget } from '../src/core/schema.js';
import { validateUseAbility, validateUseItem, resolveTarget } from '../src/engine/rules.js';
import { applyAbility, applyUseItem } from '../src/engine/gameState.js';
import { buildStateSnapshot } from '../src/llm/promptBuilder.js';

describe('Fase 1: Correções de Poções, Cura e Empurrão', () => {

  it('Lê inventário compartilhado de state.inventory no snapshot do prompt', () => {
    const s = makeTestState(['#####', '#W..#', '#####']);
    s.inventory = [{ id: 'health_potion', qty: 2 }];
    const snap = buildStateSnapshot(s, 'A');
    assert(Array.isArray(snap.inventory));
    assertEqual(snap.inventory.length, 1);
    assertEqual(snap.inventory[0].id, 'health_potion');
    assertEqual(snap.inventory[0].qty, 2);
    assertEqual(snap.inventory[0].usable, true);
  });

  it('Normaliza nomes semânticos de alvos e pronomes (Thorin, Lyra, self, mim)', () => {
    const s = makeTestState(['#####', '#W.M#', '#####']);
    assertEqual(resolveSemanticTarget('Thorin', s, 'hero_mage'), 'hero_warrior');
    assertEqual(resolveSemanticTarget('guerreiro', s, 'hero_mage'), 'hero_warrior');
    assertEqual(resolveSemanticTarget('Lyra', s, 'hero_warrior'), 'hero_mage');
    assertEqual(resolveSemanticTarget('maga', s, 'hero_warrior'), 'hero_mage');
    assertEqual(resolveSemanticTarget('self', s, 'hero_mage'), 'hero_mage');
    assertEqual(resolveSemanticTarget('mim', s, 'hero_warrior'), 'hero_warrior');
    assertEqual(resolveSemanticTarget('eu', s, 'hero_warrior'), 'hero_warrior');
  });

  it('Normaliza alias de poção e alvo para use_item', () => {
    const s = makeTestState(['#####', '#W.M#', '#####']);
    s.inventory = [{ id: 'health_potion', qty: 2 }];
    const rawBatch = {
      tool_calls: [
        { name: 'potion', arguments: { target: 'Thorin' } }
      ]
    };
    const norm = normalizeBatch(rawBatch, s);
    assertEqual(norm.tool_calls[0].name, 'use_item');
    assertEqual(norm.tool_calls[0].arguments.item_id, 'health_potion');
    assertEqual(norm.tool_calls[0].arguments.target_id, 'hero_warrior');
  });

  it('Permite usar poção de cura e consome do inventário da equipe', () => {
    const s = makeTestState(['#####', '#W..#', '#####']);
    s.inventory = [{ id: 'health_potion', qty: 2 }];
    s.entities.hero_warrior.hp = 10;
    s.entities.hero_warrior.maxHp = 30;

    const val = validateUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'potion',
      target_id: 'Thorin'
    });
    assertEqual(val.ok, true);

    const { state: next, events } = applyUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'potion',
      target_id: 'Thorin'
    }, val.resolved);

    assertEqual(next.entities.hero_warrior.hp, 20);
    assertEqual(next.inventory[0].qty, 1);
    assert(events.some(e => e.type === 'heal' && e.amount === 10));
  });

  it('heal_pulse sem target_id mira no próprio conjurador ferido em vez de inimigo', () => {
    const s = makeTestState(['#####', '#MG.#', '#####']);
    s.activeId = 'hero_mage';
    s.entities.hero_mage.hp = 5;
    s.entities.hero_mage.maxHp = 18;

    const rawBatch = {
      tool_calls: [
        { name: 'use_ability', arguments: { ability_id: 'heal_pulse' } }
      ]
    };
    const norm = normalizeBatch(rawBatch, s);
    // Deve mirar na maga ferida, NUNCA no goblin
    assertEqual(norm.tool_calls[0].arguments.target_id, 'hero_mage');

    const val = validateUseAbility(s, norm.tool_calls[0].arguments);
    assertEqual(val.ok, true);
  });

  it('heal_pulse com target_id semântico ("Thorin") cura o guerreiro aliado', () => {
    const s = makeTestState(['#####', '#WM.#', '#####']);
    s.activeId = 'hero_mage';
    s.entities.hero_warrior.hp = 10;
    s.entities.hero_warrior.maxHp = 30;

    const rawBatch = {
      tool_calls: [
        { name: 'heal', arguments: { target: 'Thorin' } }
      ]
    };
    const norm = normalizeBatch(rawBatch, s);
    assertEqual(norm.tool_calls[0].name, 'use_ability');
    assertEqual(norm.tool_calls[0].arguments.ability_id, 'heal_pulse');
    assertEqual(norm.tool_calls[0].arguments.target_id, 'hero_warrior');

    const val = validateUseAbility(s, norm.tool_calls[0].arguments);
    assertEqual(val.ok, true);

    const { state: next, events } = applyAbility(s, norm.tool_calls[0].arguments, val.resolved);
    assertEqual(next.entities.hero_warrior.hp, 18);
    assert(events.some(e => e.type === 'heal' && e.id === 'hero_warrior' && e.amount === 8));
  });

  it('Normaliza tool "push" / "empurrar" para use_ability shield_bash', () => {
    const s = makeTestState(['######', '#WG..#', '######']);
    const rawBatch = {
      tool_calls: [
        { name: 'empurrar', arguments: { target: 'goblin_1' } }
      ]
    };
    const norm = normalizeBatch(rawBatch, s);
    assertEqual(norm.tool_calls[0].name, 'use_ability');
    assertEqual(norm.tool_calls[0].arguments.ability_id, 'shield_bash');
    assertEqual(norm.tool_calls[0].arguments.target_id, 'goblin_1');

    const val = validateUseAbility(s, norm.tool_calls[0].arguments);
    assertEqual(val.ok, true);
    assertEqual(val.resolved.pushTo.x, 3);
    assertEqual(val.resolved.pushTo.y, 1);
  });

  it('Calcula empurrão como fallback em applyAbility mesmo sem resolved.pushTo', () => {
    const s = makeTestState(['######', '#WG..#', '######']);
    // Chamada direta do reducer sem resolved preenchido
    const { state: next, events } = applyAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'shield_bash',
      target_id: 'goblin_1'
    });

    assertEqual(next.entities.goblin_1.position.x, 3);
    assertEqual(next.entities.goblin_1.position.y, 1);
    assert(events.some(e => e.type === 'push' && e.to.x === 3));
  });

  it('resolveTarget aceita nomes de personagens (Thorin, Lyra, Vex)', () => {
    const s = makeTestState(['#####', '#WM.#', '#####']);
    const res = resolveTarget(s, 'Thorin');
    assert(res !== null);
    assertEqual(res.kind, 'entity');
    assertEqual(res.ref.id, 'hero_warrior');
  });
});
