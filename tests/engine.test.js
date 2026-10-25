/**
 * Sprint 1 Pure Engine Core & Rules Unit Tests.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { describe, it, assert, assertEqual, assertDeepEqual } from './runner.js';
import { makeTestState } from './helpers.js';
import { CONFIG, TILE, PHASE, ENEMY_PHASE_ID } from '../src/core/config.js';
import { createRng } from '../src/core/prng.js';
import { manhattan, computeReachable, computeDistanceField, key } from '../src/engine/pathfinding.js';
import { generateDungeon, SPAWNS } from '../src/engine/mapGenerator.js';
import { advanceTurn } from '../src/engine/turnTracker.js';
import { validateMove } from '../src/engine/rules.js';
import { createActionQueue } from '../src/engine/actionQueue.js';
import { normalizeBatch, validateBatch } from '../src/core/schema.js';

describe('PRNG & Determinismo', () => {
  it('createRng("X") gera sequências idênticas para a mesma seed e diferentes para "Y"', () => {
    const rng1 = createRng('X');
    const seq1 = Array.from({ length: 10 }, () => rng1.next());

    const rng2 = createRng('X');
    const seq2 = Array.from({ length: 10 }, () => rng2.next());

    const rng3 = createRng('Y');
    const seq3 = Array.from({ length: 10 }, () => rng3.next());

    assertDeepEqual(seq1, seq2, 'RNG com mesma seed deve produzir números idênticos');
    assert(JSON.stringify(seq1) !== JSON.stringify(seq3), 'RNG com seeds diferentes deve produzir sequências diferentes');
  });
});

describe('Geração de Masmorra e Spawns', () => {
  it('generateDungeon produz hash estável, bordas cercadas por paredes e spawns conectados', () => {
    const d1 = generateDungeon(CONFIG.DEFAULT_SEED);
    const d2 = generateDungeon(CONFIG.DEFAULT_SEED);

    assertEqual(d1.map.hash, d2.map.hash, 'Hash do mapa gerado deve ser idêntico para a mesma seed');

    // Verifica que toda a borda externa é composta por paredes
    for (let y = 0; y < CONFIG.GRID_H; y++) {
      for (let x = 0; x < CONFIG.GRID_W; x++) {
        if (x === 0 || x === CONFIG.GRID_W - 1 || y === 0 || y === CONFIG.GRID_H - 1) {
          assertEqual(d1.map.tiles[y][x], TILE.WALL, `Borda em (${x},${y}) deve ser parede`);
        }
      }
    }

    // Verifica que todos os spawns de heróis e inimigos são chão e alcançáveis
    const warriorSpawn = SPAWNS.heroes.hero_warrior;
    assertEqual(d1.map.tiles[warriorSpawn.y][warriorSpawn.x], TILE.FLOOR, 'Spawn do guerreiro deve ser chão');

    const distField = computeDistanceField({ map: d1.map, objects: d1.objects }, warriorSpawn, { ignoreUnits: true });

    for (const [id, spawn] of Object.entries(SPAWNS.heroes)) {
      assertEqual(d1.map.tiles[spawn.y][spawn.x], TILE.FLOOR, `Spawn de ${id} deve ser chão`);
      assert(distField.has(key(spawn.x, spawn.y)), `Spawn de ${id} deve ser alcançável a partir do guerreiro`);
    }

    for (const enemy of SPAWNS.enemies) {
      assertEqual(d1.map.tiles[enemy.y][enemy.x], TILE.FLOOR, `Spawn do inimigo ${enemy.id} deve ser chão`);
      assert(distField.has(key(enemy.x, enemy.y)), `Spawn de ${enemy.id} deve ser alcançável`);
    }
  });
});

describe('Métricas Espaciais e Pathfinding', () => {
  it('manhattan(0, 0, 3, 4) === 7', () => {
    assertEqual(manhattan(0, 0, 3, 4), 7, 'Distância manhattan deve ser |0-3| + |0-4| = 7');
  });

  it('computeReachable em sala aberta com maxSteps = 2 retorna exatamente 12 tiles e parede bloqueia visão/passagem', () => {
    // Sala 7x7 com Thorin centralizado em (3,3)
    const openState = makeTestState([
      '#######',
      '#.....#',
      '#.....#',
      '#..W..#',
      '#.....#',
      '#.....#',
      '#######'
    ]);

    const reachableOpen = computeReachable(openState, 'hero_warrior', 2);
    assertEqual(reachableOpen.size, 12, 'Em mapa aberto, alcance de 2 passos deve conter exatamente 12 tiles');

    // Sala com parede imediatamente ao Norte de Thorin (em 3,2)
    const blockedState = makeTestState([
      '#######',
      '#.....#',
      '#..#..#',
      '#..W..#',
      '#.....#',
      '#.....#',
      '#######'
    ]);

    const reachableBlocked = computeReachable(blockedState, 'hero_warrior', 2);
    // (3,2) é parede -> não pode ser alcançado
    assert(!reachableBlocked.has(key(3, 2)), 'Tile com parede não deve ser alcançável');
    // (3,1) está atrás da parede; caminho contornando exige 3 passos -> inacessível com maxSteps = 2
    assert(!reachableBlocked.has(key(3, 1)), 'Tile atrás da parede deve estar bloqueado para maxSteps = 2');
  });
});

describe('Regras de Movimentação (validateMove)', () => {
  const mapLayout = [
    '#######',
    '#.....#',
    '#..#..#',
    '#.MW..#',
    '#...C.#',
    '#.....#',
    '#######'
  ];

  it('valida movimento com sucesso', () => {
    const state = makeTestState(mapLayout);
    // Thorin em (3,3) move para (4,3) - custo 1
    const res = validateMove(state, { character_id: 'hero_warrior', target_x: 4, target_y: 3 });
    assert(res.ok, 'Movimento legal de 1 passo deve ser aceito');
    assertEqual(res.resolved.cost, 1);
  });

  it('rejeita movimento para parede (TARGET_IS_WALL)', () => {
    const state = makeTestState(mapLayout);
    // (3,2) é parede '#'
    const res = validateMove(state, { character_id: 'hero_warrior', target_x: 3, target_y: 2 });
    assert(!res.ok);
    assertEqual(res.code, 'TARGET_IS_WALL');
  });

  it('rejeita movimento além do alcance máximo (TOO_FAR)', () => {
    const state = makeTestState(mapLayout);
    // Thorin tem MP = 4. Tentar mover para (1, 1): manhattan(|3-1| + |3-1| = 4), mas vamos colocar para distância 5 (5,1)
    const res = validateMove(state, { character_id: 'hero_warrior', target_x: 5, target_y: 1 });
    // Manhattan: |3-5| + |3-1| = 2 + 2 = 4 (dentro de MP). Se mover para (5,0) fora/parede.
    // Vamos reduzir MP para 1:
    state.entities.hero_warrior.mp = 1;
    const resTooFar = validateMove(state, { character_id: 'hero_warrior', target_x: 5, target_y: 3 });
    assert(!resTooFar.ok);
    assertEqual(resTooFar.code, 'TOO_FAR');
  });

  it('rejeita movimento inacessível por obstáculos (UNREACHABLE)', () => {
    // Mapa com parede em U prendendo Thorin em (2,2)
    const walledState = makeTestState([
      '#######',
      '#.###.#',
      '#.#W#.#',
      '#..#..#',
      '#######'
    ]);
    // W em (3,2) cercado por paredes em (3,1), (2,2), (4,2), (3,3)
    // Tentar mover para (1,2) que está a 2 passos de manhattan
    const res = validateMove(walledState, { character_id: 'hero_warrior', target_x: 1, target_y: 2 });
    assert(!res.ok);
    assertEqual(res.code, 'UNREACHABLE');
  });

  it('rejeita ação fora da vez (NOT_YOUR_TURN)', () => {
    const state = makeTestState(mapLayout);
    // Ativo é hero_warrior; tenta mover hero_mage
    const res = validateMove(state, { character_id: 'hero_mage', target_x: 2, target_y: 2 });
    assert(!res.ok);
    assertEqual(res.code, 'NOT_YOUR_TURN');
  });

  it('rejeita destino ocupado por entidade ou objeto (TARGET_OCCUPIED)', () => {
    const state = makeTestState(mapLayout);
    // Mage está em (2,3)
    const resEntity = validateMove(state, { character_id: 'hero_warrior', target_x: 2, target_y: 3 });
    assert(!resEntity.ok);
    assertEqual(resEntity.code, 'TARGET_OCCUPIED');

    // Baú está em (4,4)
    const resChest = validateMove(state, { character_id: 'hero_warrior', target_x: 4, target_y: 4 });
    assert(!resChest.ok);
    assertEqual(resChest.code, 'TARGET_OCCUPIED');
  });
});

describe('Controle de Turno (advanceTurn)', () => {
  it('avança warrior -> mage -> rogue -> ENEMY -> warrior na rodada 2 com MP restaurado; pula herói morto', () => {
    const state = makeTestState([
      '#######',
      '#.WMR.#',
      '#######'
    ]);

    assertEqual(state.activeId, 'hero_warrior');
    assertEqual(state.phase, PHASE.HERO);
    assertEqual(state.round, 1);

    // Thorin gasta MP
    state.entities.hero_warrior.mp = 0;

    // 1. warrior -> mage
    const t1 = advanceTurn(state);
    assertEqual(t1.state.activeId, 'hero_mage');
    assertEqual(t1.state.phase, PHASE.HERO);

    // 2. mage -> rogue
    const t2 = advanceTurn(t1.state);
    assertEqual(t2.state.activeId, 'hero_rogue');
    assertEqual(t2.state.phase, PHASE.HERO);

    // 3. rogue -> ENEMY_PHASE
    const t3 = advanceTurn(t2.state);
    assertEqual(t3.state.activeId, ENEMY_PHASE_ID);
    assertEqual(t3.state.phase, PHASE.ENEMY);

    // 4. ENEMY_PHASE -> warrior (Rodada 2 com MP restaurado)
    const t4 = advanceTurn(t3.state);
    assertEqual(t4.state.activeId, 'hero_warrior');
    assertEqual(t4.state.phase, PHASE.HERO);
    assertEqual(t4.state.round, 2);
    assertEqual(t4.state.entities.hero_warrior.mp, t4.state.entities.hero_warrior.maxMp, 'MP do guerreiro deve ser restaurado no início de seu turno');

    // Teste de herói morto: Lyra morta é pulada
    state.entities.hero_mage.alive = false;
    state.entities.hero_mage.hp = 0;

    const skipDead = advanceTurn(state);
    assertEqual(skipDead.state.activeId, 'hero_rogue', 'Herói morto deve ser pulado automaticamente');
  });
});

describe('Action Queue e Sequenciamento', () => {
  it('processa ações em ordem e interrompe o restante na primeira rejeição', async () => {
    let callLog = [];
    let state = { count: 0 };
    const fakeStore = {
      getState: () => state,
      commit: (s) => { state = s; }
    };

    const fakeTools = {
      action_ok: {
        validate: () => ({ ok: true, resolved: {} }),
        apply: (s) => {
          callLog.push('ok');
          return { state: { count: s.count + 1 }, events: [{ type: 'ok' }] };
        }
      },
      action_fail: {
        validate: () => ({ ok: false, code: 'FAIL', message: 'Erro intencional' }),
        apply: (s) => ({ state: s, events: [] })
      }
    };

    const queue = createActionQueue({
      store: fakeStore,
      tools: fakeTools
    });

    // Enfileira lote com: [ok1, fail, ok2]
    const res = await queue.enqueue({
      source: 'TEST',
      tool_calls: [
        { name: 'action_ok', arguments: {} },
        { name: 'action_fail', arguments: {} },
        { name: 'action_ok', arguments: {} }
      ]
    });

    assertEqual(res.applied.length, 1, 'Apenas 1 ação deve ter sido aplicada');
    assert(res.rejected !== null, 'A segunda ação deve ter sido rejeitada');
    assertEqual(res.rejected.call.name, 'action_fail');
    assertEqual(res.skipped.length, 1, 'A terceira ação deve ter sido pulada');
    assertEqual(res.skipped[0].name, 'action_ok');
    assertEqual(callLog.length, 1, 'Apenas a primeira ação deve ter sido executada');
    assertEqual(state.count, 1);
  });
});

describe('Schema e Normalização', () => {
  it('normaliza e converte strings numéricas sinalizando coerced: true', () => {
    const raw = {
      tool_calls: [
        {
          name: ' Move_Character ',
          arguments: {
            character_id: 'hero_warrior',
            target_x: ' 2 ',
            target_y: '7'
          }
        }
      ]
    };

    const norm = normalizeBatch(raw);
    const call = norm.tool_calls[0];

    assertEqual(call.name, 'move_character');
    assertEqual(call.arguments.target_x, 2);
    assertEqual(call.arguments.target_y, 7);
    assert(call.coerced === true, 'Chamada com coerção de int deve ter flag coerced: true');

    const validation = validateBatch(norm);
    assert(validation.ok, 'Lote normalizado deve passar na validação de schema');
  });

  it('rejeita excesso de tool calls (TOO_MANY_CALLS) e tool desconhecida', () => {
    const excessiveBatch = {
      tool_calls: [
        { name: 'end_turn', arguments: { character_id: 'hero_warrior' } },
        { name: 'end_turn', arguments: { character_id: 'hero_warrior' } },
        { name: 'end_turn', arguments: { character_id: 'hero_warrior' } },
        { name: 'end_turn', arguments: { character_id: 'hero_warrior' } },
        { name: 'end_turn', arguments: { character_id: 'hero_warrior' } }
      ]
    };

    const resTooMany = validateBatch(excessiveBatch);
    assert(!resTooMany.ok);
    assert(resTooMany.errors.some(e => e.includes('TOO_MANY_CALLS')));

    const unknownToolBatch = {
      tool_calls: [{ name: 'teleport', arguments: {} }]
    };

    const resUnknown = validateBatch(unknownToolBatch);
    assert(!resUnknown.ok);
    assert(resUnknown.errors.some(e => e.includes('UNKNOWN_TOOL')));
  });
});
