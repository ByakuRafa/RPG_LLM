/**
 * Sprint 2 Full Rules Engine & Reducer Tests (Step 5).
 * Tests all 6 tools, rejection codes, combat mechanics, and reducers.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { describe, it, assert, assertEqual, assertDeepEqual } from './runner.js';
import { makeTestState } from './helpers.js';
import { PHASE } from '../src/core/config.js';
import {
  validateMove,
  validateUseAbility,
  validateUseItem,
  validateInteract,
  validateCheckInventory,
  validateEndTurn,
  explain
} from '../src/engine/rules.js';
import {
  applyDamage,
  applyHeal,
  applyAbility,
  applyUseItem,
  applyInteract,
  applyCheckInventory,
  evaluateGameOver,
  stateHash,
  createStore,
  createEntity
} from '../src/engine/gameState.js';
import { getBlockerAt } from '../src/engine/pathfinding.js';
import { createActionQueue } from '../src/engine/actionQueue.js';
import { createEnemyController, HeuristicEnemyStrategy } from '../src/engine/enemyController.js';
import { TOOLS, TOOL_NAMES } from '../src/engine/tools.js';
import { normalizeBatch, validateBatch } from '../src/core/schema.js';
import { describeEvent } from '../src/core/messages.js';

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

  it('detecta bloqueio de empurrão por borda do mapa (edge)', () => {
    const sEdge = makeTestState([
      '####',
      '#WG#',
      '####',
    ]);
    // Coloca o goblin na borda leste do mapa (x = width - 1)
    sEdge.entities.goblin_1.position = { x: sEdge.map.width - 1, y: 1 };
    sEdge.entities.hero_warrior.position = { x: sEdge.map.width - 2, y: 1 };
    const resEdge = validateUseAbility(sEdge, {
      caster_id: 'hero_warrior',
      ability_id: 'shield_bash',
      target_id: 'goblin_1'
    });
    assertEqual(resEdge.ok, true);
    assertEqual(resEdge.resolved.pushTo, null);
    assertEqual(resEdge.resolved.pushBlockedReason, 'edge');
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

  it('rejeita uso de item em aliado morto (TARGET_DEAD) ou alvo desconhecido (UNKNOWN_TARGET)', () => {
    const s = makeTestState([
      '#####',
      '#WM.#',
      '#####',
    ]);
    s.entities.hero_mage.alive = false;
    s.entities.hero_mage.hp = 0;
    const resDead = validateUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'health_potion',
      target_id: 'hero_mage'
    });
    assertEqual(resDead.ok, false);
    assertEqual(resDead.code, 'TARGET_DEAD');

    const resUnknown = validateUseItem(s, {
      character_id: 'hero_warrior',
      item_id: 'health_potion',
      target_id: 'fantasma'
    });
    assertEqual(resUnknown.ok, false);
    assertEqual(resUnknown.code, 'UNKNOWN_TARGET');
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

  it('rejeita interação com objeto inexistente (UNKNOWN_OBJECT) ou sem AP (NO_AP)', () => {
    const s = makeTestState([
      '#####',
      '#WC.#',
      '#####',
    ]);
    const resUnknown = validateInteract(s, {
      character_id: 'hero_warrior',
      object_id: 'bau_inexistente'
    });
    assertEqual(resUnknown.ok, false);
    assertEqual(resUnknown.code, 'UNKNOWN_OBJECT');

    s.entities.hero_warrior.ap = 0;
    const resNoAp = validateInteract(s, {
      character_id: 'hero_warrior',
      object_id: 'chest_1'
    });
    assertEqual(resNoAp.ok, false);
    assertEqual(resNoAp.code, 'NO_AP');
  });
});

describe('Validação de Consulta de Inventário (validateCheckInventory)', () => {
  it('valida consulta pelo personagem ativo e rejeita se não for a vez ou jogo encerrado', () => {
    const s = makeTestState([
      '#####',
      '#WM.#',
      '#####',
    ]);
    // Personagem ativo (Thorin)
    const resOk = validateCheckInventory(s, { character_id: 'hero_warrior' });
    assertEqual(resOk.ok, true);

    // Mago não ativo tentando consultar
    const resNotTurn = validateCheckInventory(s, { character_id: 'hero_mage' });
    assertEqual(resNotTurn.ok, false);
    assertEqual(resNotTurn.code, 'NOT_YOUR_TURN');

    // Jogo encerrado
    s.phase = PHASE.GAME_OVER;
    const resGameOver = validateCheckInventory(s, { character_id: 'hero_warrior' });
    assertEqual(resGameOver.ok, false);
    assertEqual(resGameOver.code, 'GAME_OVER');
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

  it('applyAbility com shield_bash quando bloqueado emite evento push_blocked', () => {
    const s = makeTestState([
      '#####',
      '#WG##',
      '#####',
    ]);
    const { state: next, events } = applyAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'shield_bash',
      target_id: 'goblin_1'
    }, {
      ability: { effect: { type: 'damage', amount: 4, push: 1 } },
      pushTo: null,
      pushBlockedReason: 'wall'
    });

    assertEqual(next.entities.goblin_1.position.x, 2, 'Posição do goblin não muda quando bloqueado');
    assert(events.some(e => e.type === 'push_blocked' && e.reason === 'wall'));
  });

  it('applyAbility com heal_pulse recupera HP e emite evento heal', () => {
    const s = makeTestState([
      '#####',
      '#WM.#',
      '#####',
    ]);
    s.entities.hero_warrior.hp = 10;
    const { state: next, events } = applyAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'heal_pulse',
      target_id: 'hero_warrior'
    }, {
      ability: { effect: { type: 'heal', amount: 8 } }
    });

    assertEqual(next.entities.hero_warrior.hp, 18);
    const healEvent = events.find(e => e.type === 'heal');
    assert(healEvent !== undefined);
    assertEqual(healEvent.amount, 8);
    assertEqual(healEvent.via, 'heal_pulse');
  });

  it('applyAbility com lockpick destranca o objeto e emite evento unlocked', () => {
    const s = makeTestState([
      '#####',
      '#RL.#',
      '#####',
    ]);
    const { state: next, events } = applyAbility(s, {
      caster_id: 'hero_rogue',
      ability_id: 'lockpick',
      target_id: 'chest_1'
    }, {
      ability: { effect: { type: 'unlock' } }
    });

    assertEqual(next.objects.chest_1.locked, false);
    const unlockEvent = events.find(e => e.type === 'unlocked');
    assert(unlockEvent !== undefined);
    assertEqual(unlockEvent.objectId, 'chest_1');
    assertEqual(unlockEvent.byId, 'hero_rogue');
  });

  it('applyDamage em herói causa derrota (lost) quando todos os heróis morrem', () => {
    const s = makeTestState([
      '#####',
      '#W.G#',
      '#####',
    ]);
    const { state: next, events } = applyDamage(s, 'hero_warrior', 100);
    assertEqual(next.entities.hero_warrior.hp, 0);
    assertEqual(next.entities.hero_warrior.alive, false);
    assertEqual(next.status, 'lost');
    assertEqual(next.phase, PHASE.GAME_OVER);
    assert(events.some(e => e.type === 'game_over' && e.status === 'lost'));
  });
});

describe('Integração de Schema e Mensagens (Sprint 2)', () => {
  it('normalizeBatch preenche target_id padrão = character_id em use_item', () => {
    const raw = {
      source: 'TEST',
      tool_calls: [
        { name: 'use_item', arguments: { character_id: 'hero_warrior', item_id: 'health_potion' } }
      ]
    };
    const norm = normalizeBatch(raw);
    assertEqual(norm.tool_calls[0].arguments.target_id, 'hero_warrior');
    const val = validateBatch(norm);
    assertEqual(val.ok, true);
  });

  it('validateBatch valida e rejeita argumentos ausentes para todas as 6 ferramentas', () => {
    const invalidBatch = {
      tool_calls: [
        { name: 'use_item', arguments: { character_id: 'hero_warrior' } }, // missing item_id
        { name: 'interact_object', arguments: { character_id: 'hero_warrior' } }, // missing object_id
        { name: 'check_inventory', arguments: {} } // missing character_id
      ]
    };
    const val = validateBatch(invalidBatch);
    assertEqual(val.ok, false);
    assertEqual(val.errors.length, 3);
  });

  it('describeEvent gera descrições amigáveis em PT-BR para todos os novos eventos visuais', () => {
    const s = makeTestState(['#####', '#WC.#', '#####']);
    const evItem = describeEvent({ type: 'item_used', itemId: 'health_potion', byId: 'hero_warrior', targetId: 'hero_warrior' }, s);
    assertEqual(evItem.level, 'SUCCESS');
    assert(evItem.text.includes('Poção de Vida'));

    const evChest = describeEvent({ type: 'chest_opened', objectId: 'chest_1', byId: 'hero_warrior', loot: [{ id: 'health_potion', qty: 2 }] }, s);
    assertEqual(evChest.level, 'SUCCESS');
    assert(evChest.text.includes('2x Poção de Vida'));

    const evInv = describeEvent({ type: 'inventory', byId: 'hero_warrior', items: [{ id: 'gold_coins', qty: 10 }] }, s);
    assertEqual(evInv.level, 'INFO');
    assert(evInv.text.includes('10x Moedas de Ouro'));

    const evUnlock = describeEvent({ type: 'unlocked', objectId: 'chest_1', byId: 'hero_rogue' }, s);
    assertEqual(evUnlock.level, 'SUCCESS');
    assert(evUnlock.text.includes('destrancou'));

    const evPushBlocked = describeEvent({ type: 'push_blocked', id: 'goblin_1', reason: 'wall' }, s);
    assertEqual(evPushBlocked.level, 'INFO');
    assert(evPushBlocked.text.includes('parede no caminho'));
  });
});


describe('Validação de Movimentação e Fim de Turno (validateMove, validateEndTurn) e Códigos Universais', () => {
  it('valida movimento legal para tile adjacente livre', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    const res = validateMove(s, { character_id: 'hero_warrior', target_x: 2, target_y: 1 });
    assertEqual(res.ok, true);
    assertEqual(res.resolved.cost, 1);
  });

  it('rejeita movimento para fora dos limites do mapa (OUT_OF_BOUNDS)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    const res = validateMove(s, { character_id: 'hero_warrior', target_x: -1, target_y: 1 });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'OUT_OF_BOUNDS');
  });

  it('rejeita movimento para o mesmo tile em que o ator está (SAME_TILE)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    const res = validateMove(s, { character_id: 'hero_warrior', target_x: 1, target_y: 1 });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'SAME_TILE');
  });

  it('rejeita movimento para parede (TARGET_IS_WALL)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    const res = validateMove(s, { character_id: 'hero_warrior', target_x: 0, target_y: 1 });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'TARGET_IS_WALL');
  });

  it('rejeita movimento para destino ocupado por entidade ou objeto (TARGET_OCCUPIED)', () => {
    const s = makeTestState([
      '#####',
      '#WGC#',
      '#####',
    ]);
    const resGoblin = validateMove(s, { character_id: 'hero_warrior', target_x: 2, target_y: 1 });
    assertEqual(resGoblin.ok, false);
    assertEqual(resGoblin.code, 'TARGET_OCCUPIED');

    const resChest = validateMove(s, { character_id: 'hero_warrior', target_x: 3, target_y: 1 });
    assertEqual(resChest.ok, false);
    assertEqual(resChest.code, 'TARGET_OCCUPIED');
  });

  it('rejeita movimento quando o personagem não tem pontos de movimento (NO_MP)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    s.entities.hero_warrior.mp = 0;
    const res = validateMove(s, { character_id: 'hero_warrior', target_x: 2, target_y: 1 });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'NO_MP');
  });

  it('rejeita movimento além do alcance máximo de MP (TOO_FAR)', () => {
    const s = makeTestState([
      '########',
      '#W.....#',
      '########',
    ]);
    // Thorin tem maxMp = 4. Distância até x=6 é 5.
    const res = validateMove(s, { character_id: 'hero_warrior', target_x: 6, target_y: 1 });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'TOO_FAR');
  });

  it('rejeita movimento inacessível por obstáculos mesmo que distância Manhattan seja <= MP (UNREACHABLE)', () => {
    const s = makeTestState([
      '#####',
      '#W#.#',
      '#####',
    ]);
    // Destino (3, 1) tem Manhattan = 2 <= MP, mas parede bloqueia caminho BFS
    const res = validateMove(s, { character_id: 'hero_warrior', target_x: 3, target_y: 1 });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'UNREACHABLE');
  });

  it('valida passagem de turno legal (validateEndTurn)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    const res = validateEndTurn(s, { character_id: 'hero_warrior' });
    assertEqual(res.ok, true);
  });

  it('rejeita ação para entidade desconhecida (UNKNOWN_ENTITY)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    const res = validateMove(s, { character_id: 'hero_ghost', target_x: 2, target_y: 1 });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'UNKNOWN_ENTITY');
  });

  it('rejeita ação quando a entidade ativa está morta (ENTITY_DEAD)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    s.entities.hero_warrior.alive = false;
    s.entities.hero_warrior.hp = 0;
    const res = validateMove(s, { character_id: 'hero_warrior', target_x: 2, target_y: 1 });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'ENTITY_DEAD');
  });

  it('rejeita ação quando a fase do jogo é inválida (WRONG_PHASE)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ], { phase: 'UNKNOWN_PHASE' });
    const res = validateMove(s, { character_id: 'hero_warrior', target_x: 2, target_y: 1 });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'WRONG_PHASE');
  });

  it('rejeita uso de item inexistente no catálogo (UNKNOWN_ITEM)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    const res = validateUseItem(s, { character_id: 'hero_warrior', item_id: 'mega_elixir' });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'UNKNOWN_ITEM');
  });
});

describe('Invariantes de Estado e Reducers (Task 3.10)', () => {
  it('chamadas rejeitadas deixam stateHash rigorosamente inalterado', () => {
    const s = makeTestState([
      '#####',
      '#W.G#',
      '#####',
    ]);
    const initialHash = stateHash(s);

    const moveRes = validateMove(s, { character_id: 'hero_warrior', target_x: 0, target_y: 1 });
    assertEqual(moveRes.ok, false);
    assertEqual(stateHash(s), initialHash);

    const abRes = validateUseAbility(s, { caster_id: 'hero_warrior', ability_id: 'slash', target_id: 'goblin_1' });
    assertEqual(abRes.ok, false);
    assertEqual(stateHash(s), initialHash);
  });

  it('uso de habilidade consome AP e zera o AP do personagem ativo', () => {
    const s = makeTestState([
      '#####',
      '#WG.#',
      '#####',
    ]);
    assertEqual(s.entities.hero_warrior.ap, 1);
    const { state: next } = applyAbility(s, { caster_id: 'hero_warrior', ability_id: 'slash', target_id: 'goblin_1' });
    assertEqual(next.entities.hero_warrior.ap, 0);
  });

  it('cura por poção limita-se rigorosamente ao maxHp (clamping)', () => {
    const s = makeTestState([
      '#####',
      '#W..#',
      '#####',
    ]);
    s.entities.hero_warrior.hp = 23;
    s.entities.hero_warrior.maxHp = 25;
    const { state: next, events } = applyHeal(s, 'hero_warrior', 10);
    assertEqual(next.entities.hero_warrior.hp, 25);
    assertEqual(events[0].amount, 2);
  });

  it('mesclagem de pilhas de loot acumula itens existentes no inventário compartilhado', () => {
    const s = makeTestState([
      '#####',
      '#WC.#',
      '#####',
    ], {
      inventory: [{ id: 'health_potion', qty: 2 }]
    });
    // chest_1 possui 1 health_potion no loot
    const { state: next } = applyInteract(s, { character_id: 'hero_warrior', object_id: 'chest_1' });
    const potionSlot = next.inventory.find(i => i.id === 'health_potion');
    assertEqual(potionSlot.qty, 3);
  });

  it('morte define alive = false e libera o tile ocupado pela unidade', () => {
    const s = makeTestState([
      '#####',
      '#WG.#',
      '#####',
    ]);
    const { state: next } = applyDamage(s, 'goblin_1', 12);
    assertEqual(next.entities.goblin_1.alive, false);
    assertEqual(next.entities.goblin_1.hp, 0);
    const blocker = getBlockerAt(next, 2, 1);
    assertEqual(blocker, null);
  });

  it('derrotar o último goblin define status = won e emite game_over', () => {
    const s = makeTestState([
      '#####',
      '#WG.#',
      '#####',
    ]);
    const { state: next, events } = applyDamage(s, 'goblin_1', 12);
    assertEqual(next.status, 'won');
    assertEqual(next.phase, PHASE.GAME_OVER);
    const goEvent = events.find(e => e.type === 'game_over');
    assert(Boolean(goEvent));
    assertEqual(goEvent.status, 'won');
  });
});

describe('Fila de Ações - Interrupção na Primeira Falha (Task 3.10)', () => {
  it('[legal move, illegal attack, end_turn] -> applied.length === 1, rejected.index === 1, skipped.length === 1', async () => {
    const s = makeTestState([
      '######',
      '#W..G#',
      '######',
    ]);
    const store = createStore(s);
    const queue = createActionQueue({ store, tools: TOOLS });

    const batch = {
      source: 'HUMAN_GM',
      tool_calls: [
        { name: 'move_character', arguments: { character_id: 'hero_warrior', target_x: 2, target_y: 1 } },
        { name: 'use_ability', arguments: { caster_id: 'hero_warrior', ability_id: 'slash', target_id: 'goblin_1' } }, // distância é 2 > 1 (OUT_OF_RANGE)
        { name: 'end_turn', arguments: { character_id: 'hero_warrior' } }
      ]
    };

    const res = await queue.enqueue(batch);
    assertEqual(res.applied.length, 1);
    assertEqual(res.applied[0].call.name, 'move_character');
    assertEqual(res.rejected.index, 1);
    assertEqual(res.rejected.call.name, 'use_ability');
    assertEqual(res.rejected.result.code, 'OUT_OF_RANGE');
    assertEqual(res.skipped.length, 1);
    assertEqual(res.skipped[0].name, 'end_turn');

    assertEqual(store.getState().entities.hero_warrior.position.x, 2);
  });
});

describe('IA Inimiga Determinística (Task 3.4 & Task 3.10)', () => {
  it('mesmo estado produz plano estritamente idêntico (determinismo)', () => {
    const ai = new HeuristicEnemyStrategy();
    const s = makeTestState([
      '#######',
      '#W...G#',
      '#######',
    ]);
    const plan1 = ai.planForEnemy(s, 'goblin_1');
    const plan2 = ai.planForEnemy(s, 'goblin_1');
    assertDeepEqual(plan1, plan2);
  });

  it('goblin se aproxima do herói reduzindo a distância (e ataca se alcançar adjacência)', () => {
    const ai = new HeuristicEnemyStrategy();
    // Caso 1: Thorin em (1, 1), Goblin em (5, 1). MP = 3 leva goblin até (2, 1), adjacente a Thorin -> move + ataca
    const s = makeTestState([
      '#######',
      '#W...G#',
      '#######',
    ]);
    const plan = ai.planForEnemy(s, 'goblin_1');
    assertEqual(plan.length, 2);
    assertEqual(plan[0].name, 'move_character');
    assertEqual(plan[0].arguments.character_id, 'goblin_1');
    assertEqual(plan[0].arguments.target_x, 2);
    assertEqual(plan[0].arguments.target_y, 1);
    assertEqual(plan[1].name, 'use_ability');
    assertEqual(plan[1].arguments.ability_id, 'goblin_strike');
    assertEqual(plan[1].arguments.target_id, 'hero_warrior');

    // Caso 2: Thorin em (1, 1), Goblin em (6, 1). MP = 3 leva até (3, 1), não adjacente -> somente move
    const sFar = makeTestState([
      '########',
      '#W....G#',
      '########',
    ]);
    const planFar = ai.planForEnemy(sFar, 'goblin_1');
    assertEqual(planFar.length, 1);
    assertEqual(planFar[0].name, 'move_character');
    assertEqual(planFar[0].arguments.target_x, 3);
    assertEqual(planFar[0].arguments.target_y, 1);
  });

  it('goblin adjacente ataca o herói com menor HP e desempata por ordem de turno', () => {
    const ai = new HeuristicEnemyStrategy();
    const s = makeTestState([
      '#####',
      '#W.M#',
      '#####',
    ], {
      entities: {
        hero_warrior: {
          ...createEntity({ id: 'hero_warrior', classId: 'warrior', player: 1, position: { x: 1, y: 1 } }),
          hp: 20
        },
        goblin_1: {
          ...createEntity({ id: 'goblin_1', classId: 'goblin', role: 'enemy', position: { x: 2, y: 1 } }),
          ap: 1,
          mp: 3
        },
        hero_mage: {
          ...createEntity({ id: 'hero_mage', classId: 'mage', player: 2, position: { x: 3, y: 1 } }),
          hp: 6
        }
      }
    });

    const plan = ai.planForEnemy(s, 'goblin_1');
    assertEqual(plan.length, 1);
    assertEqual(plan[0].name, 'use_ability');
    assertEqual(plan[0].arguments.ability_id, 'goblin_strike');
    assertEqual(plan[0].arguments.target_id, 'hero_mage');
  });

  it('goblin atrás de parede contorna pelo caminho real (campo de distância, não Manhattan)', () => {
    const ai = new HeuristicEnemyStrategy();
    const s = makeTestState([
      '#####',
      '#W#G#',
      '#.#.#',
      '#...#',
      '#####',
    ]);
    // Com MP = 3, o caminho de menor custo BFS contorna o canto até (2, 3) (distância BFS 3 < 6; Manhattan 3 > 2)
    const plan = ai.planForEnemy(s, 'goblin_1');
    assertEqual(plan.length, 1);
    assertEqual(plan[0].name, 'move_character');
    assertEqual(plan[0].arguments.target_x, 2);
    assertEqual(plan[0].arguments.target_y, 3);

    // Com MP = 1, o primeiro passo BFS para contornar a parede é (3, 2)
    s.entities.goblin_1.mp = 1;
    const planStep = ai.planForEnemy(s, 'goblin_1');
    assertEqual(planStep.length, 1);
    assertEqual(planStep[0].name, 'move_character');
    assertEqual(planStep[0].arguments.target_x, 3);
    assertEqual(planStep[0].arguments.target_y, 2);
  });

  it('createEnemyController.executeTurn executa turno completo na fila para todos os inimigos vivos em ordem de ID', async () => {
    const ctrl = createEnemyController();
    const s = makeTestState([
      '#######',
      '#W..GG#',
      '#######',
    ], { phase: PHASE.ENEMY });
    const store = createStore(s);
    const queue = createActionQueue({ store, tools: TOOLS });

    await ctrl.executeTurn({ store, queue });

    const finalState = store.getState();
    assert(finalState.entities.goblin_1.position.x < 4);
    assert(finalState.entities.goblin_2.position.x < 5);
  });
});

describe('Fase 4: Testes de Unidade Abrangentes (Regras, Habilidades AoE, Poções e Empurrão)', () => {
  // 1. Using health_potion on self and on an adjacent ally, plus alias resolution (pocao_de_cura -> health_potion)
  it('Uso de health_potion em si mesmo e em aliado adjacente, com resolução de alias "pocao_de_cura"', () => {
    const s = makeTestState([
      '.......',
      '..WM...',
      '.......'
    ]);
    s.activeId = 'hero_warrior';
    s.entities.hero_warrior.hp = 15; // max 30
    s.entities.hero_warrior.ap = 1;
    s.entities.hero_mage.hp = 8;    // max 18
    s.inventory = [{ id: 'health_potion', qty: 2 }];

    // 1a. Alias resolution & auto-target self
    const rawBatchSelf = {
      tool_calls: [{ name: 'use_item', arguments: { character_id: 'hero_warrior', item_id: 'pocao_de_cura' } }]
    };
    const normSelf = normalizeBatch(rawBatchSelf, s);
    assertEqual(normSelf.tool_calls[0].arguments.item_id, 'health_potion');
    assertEqual(normSelf.tool_calls[0].arguments.target_id, 'hero_warrior');

    const valSelf = validateUseItem(s, normSelf.tool_calls[0].arguments);
    assertEqual(valSelf.ok, true);

    const resSelf = applyUseItem(s, normSelf.tool_calls[0].arguments);
    assertEqual(resSelf.state.entities.hero_warrior.hp, 25); // +10
    assertEqual(resSelf.state.inventory[0].qty, 1);

    // 1b. Use on adjacent ally (Lyra)
    resSelf.state.entities.hero_warrior.ap = 1; // restore AP for second action
    const rawBatchAlly = {
      tool_calls: [{ name: 'use_item', arguments: { character_id: 'hero_warrior', item_id: 'health_potion', target_id: 'hero_mage' } }]
    };
    const normAlly = normalizeBatch(rawBatchAlly, resSelf.state);
    const valAlly = validateUseItem(resSelf.state, normAlly.tool_calls[0].arguments);
    assertEqual(valAlly.ok, true);

    const resAlly = applyUseItem(resSelf.state, normAlly.tool_calls[0].arguments);
    assertEqual(resAlly.state.entities.hero_mage.hp, 18); // +10 (capped at max 18)
    assertEqual(resAlly.state.inventory.length, 0); // consumed
  });

  // 2. Casting heal_pulse on self (omitted target_id or "self"/"mim") and on an ally by character name ("Thorin" -> hero_warrior)
  it('Conjuração de heal_pulse em si mesmo e em aliado por nome de personagem ("Thorin")', () => {
    const s = makeTestState([
      '.......',
      '..WM...',
      '.......'
    ]);
    s.activeId = 'hero_mage';
    s.entities.hero_mage.hp = 10;
    s.entities.hero_mage.ap = 1;
    s.entities.hero_warrior.hp = 20;

    // 2a. heal_pulse com "mim" ou omitido
    const rawSelf = {
      tool_calls: [{ name: 'use_ability', arguments: { caster_id: 'hero_mage', ability_id: 'heal_pulse', target_id: 'mim' } }]
    };
    const normSelf = normalizeBatch(rawSelf, s);
    assertEqual(normSelf.tool_calls[0].arguments.target_id, 'hero_mage');

    const valSelf = validateUseAbility(s, normSelf.tool_calls[0].arguments);
    assertEqual(valSelf.ok, true);

    const resSelf = applyAbility(s, normSelf.tool_calls[0].arguments, valSelf.resolved);
    assertEqual(resSelf.state.entities.hero_mage.hp, 18); // +8

    // 2b. heal_pulse em aliado por nome "Thorin"
    const rawAlly = {
      tool_calls: [{ name: 'use_ability', arguments: { caster_id: 'hero_mage', ability_id: 'heal_pulse', target_id: 'Thorin' } }]
    };
    const normAlly = normalizeBatch(rawAlly, s);
    assertEqual(normAlly.tool_calls[0].arguments.target_id, 'hero_warrior');

    const valAlly = validateUseAbility(s, normAlly.tool_calls[0].arguments);
    assertEqual(valAlly.ok, true);

    const resAlly = applyAbility(s, normAlly.tool_calls[0].arguments, valAlly.resolved);
    assertEqual(resAlly.state.entities.hero_warrior.hp, 28); // +8
  });

  // 3. Executing shield_bash via tool/ability aliases ("push", "empurrar") and verifying deterministic 1-tile displacement and wall collision (push_blocked)
  it('Execução de shield_bash com aliases ("push", "empurrar"), deslocamento determinístico de 1 casa e colisão com parede', () => {
    // 3a. Empurrão com sucesso em corredor livre
    const s1 = makeTestState([
      '.......',
      '..WG...',
      '.......'
    ]);
    s1.activeId = 'hero_warrior';
    s1.entities.hero_warrior.ap = 1;
    s1.entities.goblin_1.hp = 12;

    const rawPush = {
      tool_calls: [{ name: 'empurrar', arguments: { character_id: 'hero_warrior', target_id: 'goblin_1' } }]
    };
    const normPush = normalizeBatch(rawPush, s1);
    assertEqual(normPush.tool_calls[0].name, 'use_ability');
    assertEqual(normPush.tool_calls[0].arguments.ability_id, 'shield_bash');
    assertEqual(normPush.tool_calls[0].arguments.target_id, 'goblin_1');

    const valPush = validateUseAbility(s1, normPush.tool_calls[0].arguments);
    assertEqual(valPush.ok, true);
    assertEqual(valPush.resolved.pushTo.x, 4); // W em (2,1), G em (3,1) -> empurrado para (4,1)

    const resPush = applyAbility(s1, normPush.tool_calls[0].arguments, valPush.resolved);
    assertEqual(resPush.state.entities.goblin_1.position.x, 4);
    assertEqual(resPush.state.entities.goblin_1.hp, 8); // 12 - 4

    const pushEv = resPush.events.find(e => e.type === 'push');
    assert(Boolean(pushEv), 'Deve emitir evento de push');
    assertEqual(pushEv.to.x, 4);

    // 3b. Colisão com parede bloqueia empurrão (push_blocked)
    const s2 = makeTestState([
      '#######',
      '#..WG##',
      '#######'
    ]);
    s2.activeId = 'hero_warrior';
    s2.entities.hero_warrior.ap = 1;

    const valBlocked = validateUseAbility(s2, {
      caster_id: 'hero_warrior',
      ability_id: 'shield_bash',
      target_id: 'goblin_1'
    });
    assertEqual(valBlocked.ok, true);
    assertEqual(valBlocked.resolved.pushTo, null);
    assertEqual(valBlocked.resolved.pushBlockedReason, 'wall');

    const resBlocked = applyAbility(s2, {
      caster_id: 'hero_warrior',
      ability_id: 'shield_bash',
      target_id: 'goblin_1'
    }, valBlocked.resolved);

    // Goblin não mudou de posição
    assertEqual(resBlocked.state.entities.goblin_1.position.x, 4);
    const blockedEv = resBlocked.events.find(e => e.type === 'push_blocked');
    assert(Boolean(blockedEv), 'Deve emitir evento push_blocked');
    assertEqual(blockedEv.reason, 'wall');
  });

  // 4. Executing whirlwind hitting 2 adjacent goblins simultaneously and pushing both
  it('Execução de whirlwind atingindo 2 goblins adjacentes simultaneamente e empurrando ambos', () => {
    const s = makeTestState([
      '.........',
      '...GWG...',
      '.........'
    ]);
    s.activeId = 'hero_warrior';
    s.entities.hero_warrior.ap = 1;
    s.entities.goblin_1.hp = 12;
    s.entities.goblin_2.hp = 12;

    const rawBatch = {
      tool_calls: [{ name: 'use_ability', arguments: { caster_id: 'hero_warrior', ability_id: 'whirlwind' } }]
    };
    const norm = normalizeBatch(rawBatch, s);
    assertEqual(norm.tool_calls[0].arguments.target_id, 'hero_warrior');

    const val = validateUseAbility(s, norm.tool_calls[0].arguments);
    assertEqual(val.ok, true);
    assert(val.resolved.isAoE, 'isAoE deve ser true');
    assertEqual(val.resolved.targets.length, 2);

    const res = applyAbility(s, norm.tool_calls[0].arguments, val.resolved);
    assertEqual(res.state.entities.hero_warrior.ap, 0);

    // Ambos os goblins sofreram 5 de dano
    assertEqual(res.state.entities.goblin_1.hp, 7);
    assertEqual(res.state.entities.goblin_2.hp, 7);

    // Ambos foram empurrados para direções opostas
    assertEqual(res.state.entities.goblin_1.position.x, 2); // de (3,1) para (2,1)
    assertEqual(res.state.entities.goblin_2.position.x, 6); // de (5,1) para (6,1)

    const blastEv = res.events.find(e => e.type === 'aoe_blast');
    assert(Boolean(blastEv), 'Deve emitir evento aoe_blast');
    assertEqual(blastEv.abilityId, 'whirlwind');
  });

  // 5. Executing fireball targeting a ground coordinate (target_x, target_y) hitting multiple enemies in radius 1, and rejecting with NO_TARGETS_IN_AOE when cast on an empty area
  it('Execução de fireball visando coordenadas de solo atingindo múltiplos inimigos no raio 1 e rejeição por NO_TARGETS_IN_AOE em solo vazio', () => {
    const s = makeTestState([
      '..........',
      '..M..GG...',
      '..........'
    ]);
    s.activeId = 'hero_mage';
    s.entities.hero_mage.ap = 1;
    s.entities.goblin_1.hp = 12;
    s.entities.goblin_2.hp = 12;

    // 5a. Fireball em solo vazio (0, 0) longe dos goblins
    const valEmpty = validateUseAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'fireball',
      target_x: 0,
      target_y: 0
    });
    assertEqual(valEmpty.ok, false);
    assertEqual(valEmpty.code, 'NO_TARGETS_IN_AOE');

    // 5b. Fireball no centro (5, 1) atingindo ambos os goblins em (5,1) e (6,1)
    const valHit = validateUseAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'fireball',
      target_x: 5,
      target_y: 1
    });
    assertEqual(valHit.ok, true);
    assert(valHit.resolved.isAoE, 'isAoE deve ser true');
    assertEqual(valHit.resolved.targets.length, 2);

    const resHit = applyAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'fireball',
      target_x: 5,
      target_y: 1
    }, valHit.resolved);

    assertEqual(resHit.state.entities.hero_mage.ap, 0);
    // Dano 8 em cada goblin (12 - 8 = 4)
    assertEqual(resHit.state.entities.goblin_1.hp, 4);
    assertEqual(resHit.state.entities.goblin_2.hp, 4);

    const blastEv = resHit.events.find(e => e.type === 'aoe_blast');
    assert(Boolean(blastEv), 'Deve emitir evento aoe_blast');
    assertEqual(blastEv.center.x, 5);
    assertEqual(blastEv.center.y, 1);
  });
});
