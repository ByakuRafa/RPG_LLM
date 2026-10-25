/**
 * Sprint 2 Full Rules Engine & Reducer Tests (Step 5).
 * Tests all 6 tools, rejection codes, combat mechanics, and reducers.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { describe, it, assert, assertEqual, assertDeepEqual } from './runner.js';
import { makeTestState } from './helpers.js';
import { PHASE } from '../src/core/config.js';
import {
  validateUseAbility,
  validateUseItem,
  validateInteract,
  validateCheckInventory,
  explain
} from '../src/engine/rules.js';
import {
  applyDamage,
  applyHeal,
  applyAbility,
  applyUseItem,
  applyInteract,
  applyCheckInventory,
  evaluateGameOver
} from '../src/engine/gameState.js';
import { TOOLS, TOOL_NAMES } from '../src/engine/tools.js';

describe('Validação de Habilidades (validateUseAbility)', () => {
  it('valida uso de habilidade corpo a corpo (slash) com sucesso', () => {
    const s = makeTestState([
      '#####',
      '#W.G#',
      '#####',
    ]);
    // Move Thorin adjacent to goblin
    s.entities.hero_warrior.position = { x: 2, y: 1 };
    const res = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'slash',
      target_id: 'goblin_1'
    });
    assertEqual(res.ok, true);
    assertEqual(res.resolved.ability.id, 'slash');
    assertEqual(res.resolved.distance, 1);
  });

  it('rejeita habilidade desconhecida (UNKNOWN_ABILITY)', () => {
    const s = makeTestState([
      '#####',
      '#WG.#',
      '#####',
    ]);
    const res = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'super_saiyan',
      target_id: 'goblin_1'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'UNKNOWN_ABILITY');
  });

  it('rejeita habilidade não possuída pelo ator (ABILITY_NOT_OWNED)', () => {
    const s = makeTestState([
      '#####',
      '#WG.#',
      '#####',
    ]);
    // Guerreiro tentando usar firebolt (do mago)
    const res = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'firebolt',
      target_id: 'goblin_1'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'ABILITY_NOT_OWNED');
  });

  it('rejeita habilidade quando AP insuficiente (NO_AP)', () => {
    const s = makeTestState([
      '#####',
      '#WG.#',
      '#####',
    ]);
    s.entities.hero_warrior.ap = 0;
    const res = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'slash',
      target_id: 'goblin_1'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'NO_AP');
  });

  it('rejeita habilidade com alvo desconhecido (UNKNOWN_TARGET)', () => {
    const s = makeTestState([
      '#####',
      '#WG.#',
      '#####',
    ]);
    const res = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'slash',
      target_id: 'non_existent_target'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'UNKNOWN_TARGET');
  });

  it('rejeita tipo de alvo inválido (INVALID_TARGET_TYPE)', () => {
    const s = makeTestState([
      '#####',
      '#WMG#',
      '#####',
    ]);
    // Guerreiro usando slash (target: enemy) em aliado (Lyra)
    const resAlly = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'slash',
      target_id: 'hero_mage'
    });
    assertEqual(resAlly.ok, false);
    assertEqual(resAlly.code, 'INVALID_TARGET_TYPE');

    // Mago ativo usando heal_pulse (target: ally) no goblin
    s.activeId = 'hero_mage';
    const resEnemyHeal = validateUseAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'heal_pulse',
      target_id: 'goblin_1'
    });
    assertEqual(resEnemyHeal.ok, false);
    assertEqual(resEnemyHeal.code, 'INVALID_TARGET_TYPE');
  });

  it('rejeita habilidade se o alvo estiver morto (TARGET_DEAD)', () => {
    const s = makeTestState([
      '#####',
      '#WG.#',
      '#####',
    ]);
    s.entities.goblin_1.alive = false;
    s.entities.goblin_1.hp = 0;
    const res = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'slash',
      target_id: 'goblin_1'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'TARGET_DEAD');
  });

  it('rejeita habilidade fora de alcance (OUT_OF_RANGE)', () => {
    const s = makeTestState([
      '#######',
      '#W...G#',
      '#######',
    ]);
    // Thorin em (1,1), Goblin em (5,1) -> dist 4, slash alcance 1
    const res = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'slash',
      target_id: 'goblin_1'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'OUT_OF_RANGE');
  });

  it('valida lockpick em baú trancado e rejeita se não estiver trancado (NOT_LOCKED)', () => {
    const s = makeTestState([
      '#####',
      '#RLC#',
      '#####',
    ]);
    s.activeId = 'hero_rogue';
    // Vex em (1,1), chest_1 (L - trancado) em (2,1), chest_2 (C - destrancado) em (3,1)
    const resLocked = validateUseAbility(s, {
      caster_id: 'hero_rogue',
      ability_id: 'lockpick',
      target_id: 'chest_1'
    });
    assertEqual(resLocked.ok, true);

    // Tentando arrombar baú já destrancado
    s.entities.hero_rogue.position = { x: 3, y: 1 };
    s.objects.chest_2.position = { x: 4, y: 1 }; // adjust to make adjacent
    const resUnlocked = validateUseAbility(s, {
      caster_id: 'hero_rogue',
      ability_id: 'lockpick',
      target_id: 'chest_2'
    });
    assertEqual(resUnlocked.ok, false);
    assertEqual(resUnlocked.code, 'NOT_LOCKED');
  });

  it('calcula empurrão (push) com sucesso para tile livre', () => {
    const s = makeTestState([
      '######',
      '#WG..#',
      '######',
    ]);
    // Thorin em (1,1), Goblin em (2,1), (3,1) é chão livre
    const res = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'shield_bash',
      target_id: 'goblin_1'
    });
    assertEqual(res.ok, true);
    assert(res.resolved.pushTo !== null);
    assertEqual(res.resolved.pushTo.x, 3);
    assertEqual(res.resolved.pushTo.y, 1);
    assertEqual(res.resolved.pushBlockedReason, null);
  });

  it('detecta bloqueio de empurrão por parede (wall) e por ocupação (occupied)', () => {
    const sWall = makeTestState([
      '#####',
      '#WG##',
      '#####',
    ]);
    // Goblin em (2,1), atrás dele (3,1) é parede #
    const resWall = validateUseAbility(sWall, {
      caster_id: 'hero_warrior',
      ability_id: 'shield_bash',
      target_id: 'goblin_1'
    });
    assertEqual(resWall.ok, true);
    assertEqual(resWall.resolved.pushTo, null);
    assertEqual(resWall.resolved.pushBlockedReason, 'wall');

    const sOcc = makeTestState([
      '######',
      '#WGG.#',
      '######',
    ]);
    // Thorin (1,1) -> Goblin 1 (2,1) -> Goblin 2 (3,1)
    const resOcc = validateUseAbility(sOcc, {
      caster_id: 'hero_warrior',
      ability_id: 'shield_bash',
      target_id: 'goblin_1'
    });
    assertEqual(resOcc.ok, true);
    assertEqual(resOcc.resolved.pushTo, null);
    assertEqual(resOcc.resolved.pushBlockedReason, 'occupied');
  });
});

describe('Validação de Itens (validateUseItem)', () => {
  it('valida uso de poção em si mesmo (padrão target_id = character_id)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    s.inventory = [{ id: 'health_potion', qty: 2 }];
    const res = validateUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'health_potion'
    });
    assertEqual(res.ok, true);
    assertEqual(res.resolved.item.id, 'health_potion');
    assertEqual(res.resolved.target.id, 'hero_warrior');
  });

  it('rejeita item que não está no inventário (ITEM_NOT_IN_INVENTORY)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    s.inventory = [];
    const res = validateUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'health_potion'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'ITEM_NOT_IN_INVENTORY');
  });

  it('rejeita item não utilizável (ITEM_NOT_USABLE)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    s.inventory = [{ id: 'gold_coins', qty: 50 }];
    const res = validateUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'gold_coins'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'ITEM_NOT_USABLE');
  });

  it('rejeita uso de item quando sem AP (NO_AP)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    s.entities.hero_warrior.ap = 0;
    const res = validateUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'health_potion'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'NO_AP');
  });

  it('rejeita uso de poção em inimigo (INVALID_TARGET_TYPE) ou aliado fora de alcance (OUT_OF_RANGE)', () => {
    const s = makeTestState([
      '#######',
      '#W.M.G#',
      '#######',
    ]);
    // Poção no goblin
    const resHostile = validateUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'health_potion',
      target_id: 'goblin_1'
    });
    assertEqual(resHostile.ok, false);
    assertEqual(resHostile.code, 'INVALID_TARGET_TYPE');

    // Poção em Lyra que está a 2 de distância (alcance da poção é 1)
    const resTooFar = validateUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'health_potion',
      target_id: 'hero_mage'
    });
    assertEqual(resTooFar.ok, false);
    assertEqual(resTooFar.code, 'OUT_OF_RANGE');
  });
});

describe('Validação de Interação com Objetos (validateInteract)', () => {
  it('valida interação com baú adjacente e destrancado', () => {
    const s = makeTestState([
      '#####',
      '#WC.#',
      '#####',
    ]);
    const res = validateInteract(s, {
      character_id: 'hero_warrior',
      object_id: 'chest_1'
    });
    assertEqual(res.ok, true);
    assertEqual(res.resolved.object.id, 'chest_1');
  });

  it('rejeita interação se não estiver adjacente (NOT_ADJACENT)', () => {
    const s = makeTestState([
      '######',
      '#W.C.#',
      '######',
    ]);
    const res = validateInteract(s, {
      character_id: 'hero_warrior',
      object_id: 'chest_1'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'NOT_ADJACENT');
  });

  it('rejeita interação se objeto estiver trancado (OBJECT_LOCKED)', () => {
    const s = makeTestState([
      '#####',
      '#WL.#',
      '#####',
    ]);
    const res = validateInteract(s, {
      character_id: 'hero_warrior',
      object_id: 'chest_1'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'OBJECT_LOCKED');
  });

  it('rejeita interação se objeto já estiver aberto (ALREADY_OPENED)', () => {
    const s = makeTestState([
      '#####',
      '#WC.#',
      '#####',
    ]);
    s.objects.chest_1.opened = true;
    const res = validateInteract(s, {
      character_id: 'hero_warrior',
      object_id: 'chest_1'
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'ALREADY_OPENED');
  });
});

describe('Função explain()', () => {
  it('retorna explicações amigáveis em PT-BR para sucessos e códigos de rejeição', () => {
    assertEqual(explain({ ok: true }), 'Ação válida.');
    const expNoAp = explain({ ok: false, code: 'NO_AP', message: 'Personagem não tem AP suficiente.' });
    assert(expNoAp.includes('AP suficiente'));
  });
});

describe('Reducers do Jogo (applyDamage, applyHeal, applyAbility, applyUseItem, applyInteract)', () => {
  it('applyDamage reduz HP, causa morte em 0 HP e avalia vitória quando todos inimigos morrem', () => {
    const s = makeTestState([
      '#####',
      '#W.G#',
      '#####',
    ]);
    const { state: s1, events: ev1 } = applyDamage(s, 'goblin_1', 5);
    assertEqual(s1.entities.goblin_1.hp, 7);
    assertEqual(ev1[0].type, 'damage');
    assertEqual(ev1[0].amount, 5);

    // Dano fatal
    const { state: s2, events: ev2 } = applyDamage(s1, 'goblin_1', 10);
    assertEqual(s2.entities.goblin_1.hp, 0);
    assertEqual(s2.entities.goblin_1.alive, false);
    assert(ev2.some(e => e.type === 'death'));
    assert(ev2.some(e => e.type === 'game_over' && e.status === 'won'));
    assertEqual(s2.status, 'won');
    assertEqual(s2.phase, PHASE.GAME_OVER);
  });

  it('applyHeal recupera HP respeitando o limite maxHp', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    s.entities.hero_warrior.hp = 25; // maxHp is 30
    const { state: sHealed, events } = applyHeal(s, 'hero_warrior', 10);
    assertEqual(sHealed.entities.hero_warrior.hp, 30);
    assertEqual(events[0].type, 'heal');
    assertEqual(events[0].amount, 5, 'Valor efetivo curado deve ser 5');
  });

  it('applyAbility com shield_bash aplica dano e move posição (push)', () => {
    const s = makeTestState([
      '######',
      '#WG..#',
      '######',
    ]);
    const { state: next, events } = applyAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'shield_bash',
      target_id: 'goblin_1'
    }, {
      ability: { effect: { type: 'damage', amount: 4, push: 1 } },
      pushTo: { x: 3, y: 1 }
    });

    assertEqual(next.entities.goblin_1.hp, 8);
    assertEqual(next.entities.goblin_1.position.x, 3);
    assertEqual(next.entities.hero_warrior.ap, 0);
    assert(events.some(e => e.type === 'damage'));
    assert(events.some(e => e.type === 'push' && e.to.x === 3));
  });

  it('applyUseItem decrementa inventário e cura o alvo', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    s.entities.hero_warrior.hp = 10;
    s.inventory = [{ id: 'health_potion', qty: 1 }];

    const { state: next, events } = applyUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'health_potion',
      target_id: 'hero_warrior'
    });

    assertEqual(next.entities.hero_warrior.hp, 20);
    assertEqual(next.entities.hero_warrior.ap, 0);
    assertEqual(next.inventory.length, 0, 'Pilha zerada deve ser removida do inventário');
    assert(events.some(e => e.type === 'item_used'));
    assert(events.some(e => e.type === 'heal'));
  });

  it('applyInteract abre baú e move o loot para o inventário compartilhado', () => {
    const s = makeTestState([
      '#####',
      '#WC.#',
      '#####',
    ]);
    s.inventory = [{ id: 'health_potion', qty: 1 }];

    const { state: next, events } = applyInteract(s, {
      character_id: 'hero_warrior',
      object_id: 'chest_1'
    });

    assertEqual(next.objects.chest_1.opened, true);
    assertEqual(next.objects.chest_1.loot.length, 0);
    const potion = next.inventory.find(i => i.id === 'health_potion');
    assertEqual(potion.qty, 2, 'Poção do baú deve ter sido somada ao inventário');
    assert(events.some(e => e.type === 'chest_opened'));
  });

  it('applyCheckInventory emite evento inventory sem alterar o estado', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    s.inventory = [{ id: 'health_potion', qty: 2 }];
    const { state: next, events } = applyCheckInventory(s, { character_id: 'hero_warrior' });
    assertEqual(events[0].type, 'inventory');
    assertEqual(events[0].items.length, 1);
    assertEqual(JSON.stringify(s.inventory), JSON.stringify(next.inventory));
  });

  it('TOOLS registra todas as 6 ferramentas e TOOL_NAMES exporta a lista completa', () => {
    assertEqual(TOOL_NAMES.length, 6);
    assert(TOOL_NAMES.includes('move_character'));
    assert(TOOL_NAMES.includes('use_ability'));
    assert(TOOL_NAMES.includes('use_item'));
    assert(TOOL_NAMES.includes('interact_object'));
    assert(TOOL_NAMES.includes('check_inventory'));
    assert(TOOL_NAMES.includes('end_turn'));
    for (const name of TOOL_NAMES) {
      assert(typeof TOOLS[name].validate === 'function');
      assert(typeof TOOLS[name].apply === 'function');
    }
  });
});
