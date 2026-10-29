/**
 * Phase 3 (Part A) Test Suite: Area of Effect (AoE) Engine, Catalog, Schema & LLM Context.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { describe, it, assert, assertEqual } from './runner.js';
import { makeTestState } from './helpers.js';
import { computeAoETiles } from '../src/engine/pathfinding.js';
import { ABILITIES, CLASSES } from '../src/engine/catalog.js';
import { normalizeBatch, validateBatch, TOOL_SPECS } from '../src/core/schema.js';
import { REJECT } from '../src/core/messages.js';
import { validateUseAbility } from '../src/engine/rules.js';
import { applyAbility } from '../src/engine/gameState.js';
import { buildStateSnapshot } from '../src/llm/promptBuilder.js';

describe('Fase 3 (Parte A): Área de Efeito (AoE) - Catálogo e Pathfinding', () => {
  it('Catálogo contém habilidades whirlwind, fireball e divine_prayer com definições AoE válidas', () => {
    // Whirlwind (Warrior)
    assert(CLASSES.warrior.abilities.includes('whirlwind'), 'Warrior deve possuir whirlwind');
    const ww = ABILITIES.whirlwind;
    assert(Boolean(ww), 'whirlwind deve existir no catálogo ABILITIES');
    assertEqual(ww.target, 'self');
    assertEqual(ww.range, 0);
    assertEqual(ww.aoe?.shape, 'adjacent');
    assertEqual(ww.aoe?.radius, 1);
    assertEqual(ww.aoe?.targetFilter, 'enemy');
    assertEqual(ww.effect?.push, 1);

    // Fireball (Mage)
    assert(CLASSES.mage.abilities.includes('fireball'), 'Mage deve possuir fireball');
    const fb = ABILITIES.fireball;
    assert(Boolean(fb), 'fireball deve existir no catálogo ABILITIES');
    assertEqual(fb.target, 'tile');
    assertEqual(fb.range, 4);
    assertEqual(fb.aoe?.shape, 'circle');
    assertEqual(fb.aoe?.radius, 1);
    assertEqual(fb.aoe?.targetFilter, 'enemy');

    // Divine Prayer (Mage)
    assert(CLASSES.mage.abilities.includes('divine_prayer'), 'Mage deve possuir divine_prayer');
    const dp = ABILITIES.divine_prayer;
    assert(Boolean(dp), 'divine_prayer deve existir no catálogo ABILITIES');
    assertEqual(dp.target, 'self');
    assertEqual(dp.range, 0);
    assertEqual(dp.aoe?.shape, 'circle');
    assertEqual(dp.aoe?.radius, 2);
    assertEqual(dp.aoe?.targetFilter, 'ally');
  });

  it('computeAoETiles calcula shape "circle" respeitando raio Manhattan e limites de paredes', () => {
    const map = {
      width: 5,
      height: 5,
      tiles: [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0]
      ]
    };
    const center = { x: 2, y: 2 };
    const aoeCircle = { shape: 'circle', radius: 1 };
    const tiles = computeAoETiles(map, center, aoeCircle);

    // Raio 1 Manhattan em torno de (2,2): (2,2) [dist 0], (1,2), (3,2), (2,1), (2,3) [dist 1] -> 5 casas
    assertEqual(tiles.length, 5);
    const keys = new Set(tiles.map(t => `${t.x},${t.y}`));
    assert(keys.has('2,2'), 'Centro deve ser incluído em circle');
    assert(keys.has('1,2'), '(1,2) deve ser incluído');
    assert(keys.has('3,2'), '(3,2) deve ser incluído');
    assert(keys.has('2,1'), '(2,1) deve ser incluído');
    assert(keys.has('2,3'), '(2,3) deve ser incluído');
  });

  it('computeAoETiles calcula shape "adjacent" excluindo o próprio centro', () => {
    const map = {
      width: 3,
      height: 3,
      tiles: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ]
    };
    const center = { x: 1, y: 1 };
    const aoeAdjacent = { shape: 'adjacent', radius: 1 };
    const tiles = computeAoETiles(map, center, aoeAdjacent);

    // 4 casas ortogonais adjacentes (raio Manhattan === 1, >= 1)
    assertEqual(tiles.length, 4);
    const keys = new Set(tiles.map(t => `${t.x},${t.y}`));
    assert(!keys.has('1,1'), 'O centro (1,1) NÃO deve estar em adjacent');
    assert(keys.has('0,1'), '(0,1) deve ser adjacente');
    assert(keys.has('2,1'), '(2,1) deve ser adjacente');
    assert(keys.has('1,0'), '(1,0) deve ser adjacente');
    assert(keys.has('1,2'), '(1,2) deve ser adjacente');
  });

  it('computeAoETiles calcula shape "line" parando em paredes', () => {
    const map = {
      width: 5,
      height: 1,
      tiles: [
        [0, 0, 0, 1, 0]
      ]
    };
    const casterPos = { x: 0, y: 0 };
    const center = { x: 4, y: 0 };
    const aoeLine = { shape: 'line', radius: 4 };
    const tiles = computeAoETiles(map, center, aoeLine, casterPos);

    // Deve avançar passo 1 (1,0) e passo 2 (2,0), mas parar na parede (3,0)
    assertEqual(tiles.length, 2);
    assertEqual(tiles[0].x, 1);
    assertEqual(tiles[1].x, 2);
  });
});

describe('Fase 3 (Parte A): Normalização de Esquema e Aliases PT-BR', () => {
  it('Normaliza aliases de novas habilidades (whirlwind, fireball, divine_prayer)', () => {
    const rawBatch = {
      tool_calls: [
        { name: 'redemoinho', arguments: { caster_id: 'hero_warrior' } },
        { name: 'bola_de_fogo', arguments: { caster_id: 'hero_mage', target_x: 5, target_y: 5 } },
        { name: 'prece_sagrada', arguments: { caster_id: 'hero_mage' } }
      ]
    };

    const norm = normalizeBatch(rawBatch, null);
    assertEqual(norm.tool_calls[0].name, 'use_ability');
    assertEqual(norm.tool_calls[0].arguments.ability_id, 'whirlwind');
    assertEqual(norm.tool_calls[0].arguments.target_id, 'hero_warrior'); // Auto-fill target_id = caster_id

    assertEqual(norm.tool_calls[1].name, 'use_ability');
    assertEqual(norm.tool_calls[1].arguments.ability_id, 'fireball');
    assertEqual(norm.tool_calls[1].arguments.target_x, 5);
    assertEqual(norm.tool_calls[1].arguments.target_y, 5);

    assertEqual(norm.tool_calls[2].name, 'use_ability');
    assertEqual(norm.tool_calls[2].arguments.ability_id, 'divine_prayer');
    assertEqual(norm.tool_calls[2].arguments.target_id, 'hero_mage'); // Auto-fill target_id = caster_id
  });

  it('Para fireball com target_id fornecido, resolve coordenadas target_x e target_y a partir da entidade', () => {
    const state = {
      entities: {
        goblin_1: { id: 'goblin_1', alive: true, position: { x: 4, y: 6 } }
      }
    };
    const rawBatch = {
      tool_calls: [
        { name: 'use_ability', arguments: { caster_id: 'hero_mage', ability_id: 'fireball', target_id: 'goblin_1' } }
      ]
    };

    const norm = normalizeBatch(rawBatch, state);
    assertEqual(norm.tool_calls[0].arguments.ability_id, 'fireball');
    assertEqual(norm.tool_calls[0].arguments.target_x, 4);
    assertEqual(norm.tool_calls[0].arguments.target_y, 6);
  });
});

describe('Fase 3 (Parte A): Validação de Regras e Proteção de AoE Vazio', () => {
  it('Empty AoE Protection: Rejeita com NO_TARGETS_IN_AOE se não houver alvos válidos na área', () => {
    const s = makeTestState([
      '..........',
      '..........',
      '.....W....',
      '..........',
      'G.........'
    ]);
    s.activeId = 'hero_warrior';
    s.entities.hero_warrior.ap = 1;

    // Warrior tenta whirlwind em (5,2), mas o goblin está longe em (0,4)
    const resWw = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'whirlwind'
    });
    assertEqual(resWw.ok, false);
    assertEqual(resWw.code, 'NO_TARGETS_IN_AOE');
    assertEqual(resWw.message, REJECT.NO_TARGETS_IN_AOE());

    // Mage tenta fireball em área vazia (7,2)
    s.activeId = 'hero_mage';
    s.entities.hero_mage = {
      ...s.entities.hero_warrior,
      id: 'hero_mage',
      name: 'Lyra',
      classId: 'mage',
      abilities: ['fireball', 'divine_prayer'],
      ap: 1,
      position: { x: 5, y: 2 }
    };
    const resFb = validateUseAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'fireball',
      target_x: 7,
      target_y: 2
    });
    assertEqual(resFb.ok, false);
    assertEqual(resFb.code, 'NO_TARGETS_IN_AOE');
    assertEqual(resFb.message, REJECT.NO_TARGETS_IN_AOE());
  });

  it('Rejeita se o centro da área de efeito estiver fora de alcance (OUT_OF_RANGE)', () => {
    const s = makeTestState([
      '..........',
      '..........',
      '.....M....',
      '..........',
      '..........'
    ]);
    s.activeId = 'hero_mage';
    s.entities.hero_mage.ap = 1;

    // Mage em (5,2) tenta fireball em (0,2) -> dist = 5 > range 4 (e dentro do mapa 10x5)
    const res = validateUseAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'fireball',
      target_x: 0,
      target_y: 2
    });
    assertEqual(res.ok, false);
    assertEqual(res.code, 'OUT_OF_RANGE');
  });

  it('Validação de Whirlwind retorna alvos múltiplos com cálculo de empurrão radial', () => {
    const s = makeTestState([
      '..........',
      '....GWG...',
      '..........'
    ]);
    s.activeId = 'hero_warrior';
    s.entities.hero_warrior.ap = 1;

    // W em (5,1), goblin_1 em (4,1), goblin_2 em (6,1)
    const res = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'whirlwind'
    });

    assertEqual(res.ok, true);
    assert(res.resolved.isAoE, 'isAoE deve ser true');
    assertEqual(res.resolved.targets.length, 2);

    // goblin_1 deve ser empurrado para (3,1)
    const t1 = res.resolved.targets.find(t => t.id === 'goblin_1');
    assert(Boolean(t1), 'goblin_1 deve estar nos alvos');
    assertEqual(t1.pushTo?.x, 3);
    assertEqual(t1.pushTo?.y, 1);

    // goblin_2 deve ser empurrado para (7,1)
    const t2 = res.resolved.targets.find(t => t.id === 'goblin_2');
    assert(Boolean(t2), 'goblin_2 deve estar nos alvos');
    assertEqual(t2.pushTo?.x, 7);
    assertEqual(t2.pushTo?.y, 1);
  });
});

describe('Fase 3 (Parte A): Redutor de Estado e Execução Multi-Alvo (gameState.js)', () => {
  it('Whirlwind aplica dano em múltiplos inimigos, empurra ambos e emite evento aoe_blast', () => {
    const s = makeTestState([
      '..........',
      '....GWG...',
      '..........'
    ]);
    s.activeId = 'hero_warrior';
    s.entities.hero_warrior.ap = 1;
    s.entities.goblin_1.hp = 12;
    s.entities.goblin_2.hp = 12;

    const val = validateUseAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'whirlwind'
    });
    assertEqual(val.ok, true);

    const { state: next, events } = applyAbility(s, {
      caster_id: 'hero_warrior',
      ability_id: 'whirlwind'
    }, val.resolved);

    // Warrior gastou 1 AP
    assertEqual(next.entities.hero_warrior.ap, 0);

    // Ambos os goblins sofreram 5 de dano (12 - 5 = 7)
    assertEqual(next.entities.goblin_1.hp, 7);
    assertEqual(next.entities.goblin_2.hp, 7);

    // Ambos foram empurrados
    assertEqual(next.entities.goblin_1.position.x, 3);
    assertEqual(next.entities.goblin_2.position.x, 7);

    // Eventos emitidos
    const blastEvent = events.find(e => e.type === 'aoe_blast');
    assert(Boolean(blastEvent), 'Deve emitir evento aoe_blast');
    assertEqual(blastEvent.abilityId, 'whirlwind');

    const damageEvents = events.filter(e => e.type === 'damage');
    assertEqual(damageEvents.length, 2);

    const pushEvents = events.filter(e => e.type === 'push');
    assertEqual(pushEvents.length, 2);
  });

  it('Fireball em coordenadas causa dano de área a múltiplos inimigos no raio 1', () => {
    const s = makeTestState([
      '..........',
      '..M..GG...',
      '..........'
    ]);
    s.activeId = 'hero_mage';
    s.entities.hero_mage.ap = 1;
    s.entities.goblin_1.hp = 12;
    s.entities.goblin_2.hp = 12;

    // Mage em (2,1), goblin_1 em (5,1), goblin_2 em (6,1)
    // Fireball mirado em (5,1): centro (5,1) raio 1 cobre (5,1) [dist 0] e (6,1) [dist 1]
    const val = validateUseAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'fireball',
      target_x: 5,
      target_y: 1
    });
    assertEqual(val.ok, true);

    const { state: next, events } = applyAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'fireball',
      target_x: 5,
      target_y: 1
    }, val.resolved);

    // Ambos sofreram 8 de dano (12 - 8 = 4)
    assertEqual(next.entities.goblin_1.hp, 4);
    assertEqual(next.entities.goblin_2.hp, 4);

    const blastEvent = events.find(e => e.type === 'aoe_blast');
    assert(Boolean(blastEvent), 'Deve emitir evento aoe_blast');
    assertEqual(blastEvent.center.x, 5);
    assertEqual(blastEvent.center.y, 1);
  });

  it('Divine Prayer cura múltiplos aliados feridos na área de efeito e emite heal', () => {
    const s = makeTestState([
      '..........',
      '..W.M.R...',
      '..........'
    ]);
    s.activeId = 'hero_mage';
    s.entities.hero_mage.ap = 1;
    s.entities.hero_mage.hp = 10; // max 18

    s.entities.hero_warrior.position = { x: 2, y: 1 };
    s.entities.hero_warrior.hp = 20; // max 30

    s.entities.hero_rogue.position = { x: 6, y: 1 };
    s.entities.hero_rogue.hp = 15; // max 22

    const val = validateUseAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'divine_prayer'
    });
    assertEqual(val.ok, true);

    const { state: next, events } = applyAbility(s, {
      caster_id: 'hero_mage',
      ability_id: 'divine_prayer'
    }, val.resolved);

    // Cura de 6 para todos os 3 heróis
    assertEqual(next.entities.hero_mage.hp, 16);
    assertEqual(next.entities.hero_warrior.hp, 26);
    assertEqual(next.entities.hero_rogue.hp, 21);

    const healEvents = events.filter(e => e.type === 'heal');
    assertEqual(healEvents.length, 3);
  });
});

describe('Fase 3 (Parte A): Snapshot de Habilidades para LLM (promptBuilder.js)', () => {
  it('buildStateSnapshot inclui metadados aoe (shape, radius, targetFilter) nas habilidades do herói ativo', () => {
    const s = makeTestState([
      '..........',
      '..W.M.R...',
      '..........'
    ]);
    s.activeId = 'hero_warrior';

    const snapWarrior = buildStateSnapshot(s, 'B');
    const wwAbility = snapWarrior.active_character.abilities.find(a => a.id === 'whirlwind');
    assert(Boolean(wwAbility), 'whirlwind deve estar nas habilidades do guerreiro');
    assertEqual(wwAbility.aoe?.shape, 'adjacent');
    assertEqual(wwAbility.aoe?.radius, 1);
    assertEqual(wwAbility.aoe?.targetFilter, 'enemy');
    assert(wwAbility.effect.includes('em área'), 'Descrição amigável do efeito deve mencionar em área');

    s.activeId = 'hero_mage';
    const snapMage = buildStateSnapshot(s, 'B');
    const fbAbility = snapMage.active_character.abilities.find(a => a.id === 'fireball');
    assert(Boolean(fbAbility), 'fireball deve estar nas habilidades do mago');
    assertEqual(fbAbility.aoe?.shape, 'circle');
    assertEqual(fbAbility.aoe?.radius, 1);
    assertEqual(fbAbility.aoe?.targetFilter, 'enemy');

    const dpAbility = snapMage.active_character.abilities.find(a => a.id === 'divine_prayer');
    assert(Boolean(dpAbility), 'divine_prayer deve estar nas habilidades do mago');
    assertEqual(dpAbility.aoe?.shape, 'circle');
    assertEqual(dpAbility.aoe?.radius, 2);
    assertEqual(dpAbility.aoe?.targetFilter, 'ally');
  });
});
