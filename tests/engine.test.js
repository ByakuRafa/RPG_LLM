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
import { createInitialState } from '../src/engine/gameState.js';
import {
  DEFAULT_SHEETS,
  validateSheet,
  loadSavedSheets,
  saveSheet,
  deleteSheet,
  loadActivePartyRoster,
  saveActivePartyRoster,
  resetToDefaultParty
} from '../src/core/characterStorage.js';

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

describe('Character Sheet System & Dynamic Roster (Sprint 1)', () => {
  it('validateSheet valida regras de Point-Buy, orçamento, habilidades e campos obrigatórios', () => {
    // Ficha customizada válida (24 HP = +2 pts, 5 MP = +2 pts -> 4/6 pontos gastos)
    const validCustom = {
      id: 'hero_kaelen',
      name: 'Kaelen, o Sombrio',
      classId: 'rogue',
      maxHp: 24,
      maxMp: 5,
      maxAp: 1,
      abilities: ['backstab', 'lockpick', 'slash']
    };
    const resValid = validateSheet(validCustom);
    assert(resValid.valid, `Ficha válida deveria passar: ${resValid.errors?.join(', ')}`);

    // Estouro de orçamento de Point-Buy (36 HP = 6 pts, 5 MP = 2 pts -> 8/6 pontos gastos)
    const overflowCustom = {
      ...validCustom,
      id: 'hero_overflow',
      maxHp: 36,
      maxMp: 5
    };
    const resOverflow = validateSheet(overflowCustom);
    assert(!resOverflow.valid, 'Estouro de orçamento deve falhar');
    assert(resOverflow.errors.some(e => e.includes('Orçamento de Point-Buy excedido')));

    // maxAp diferente de 1
    const invalidAp = { ...validCustom, maxAp: 2 };
    const resAp = validateSheet(invalidAp);
    assert(!resAp.valid, 'maxAp !== 1 deve falhar');

    // maxHp fora de múltiplos de 3 (ex: 22 para ficha customizada não canônica)
    const nonStepHp = { ...validCustom, maxHp: 22 };
    const resNonStep = validateSheet(nonStepHp);
    assert(!resNonStep.valid, 'maxHp fora de múltiplos da base 18 + 3 deve falhar');

    // Habilidades vazias ou excesso (> 3)
    const emptyAbilities = { ...validCustom, abilities: [] };
    assert(!validateSheet(emptyAbilities).valid, 'Zero habilidades deve falhar');

    const tooManyAbilities = { ...validCustom, abilities: ['slash', 'shield_bash', 'whirlwind', 'firebolt'] };
    assert(!validateSheet(tooManyAbilities).valid, 'Mais de 3 habilidades para custom deve falhar');

    // Habilidade inexistente no catálogo
    const unknownAbility = { ...validCustom, abilities: ['magia_inexistente'] };
    assert(!validateSheet(unknownAbility).valid, 'Habilidade inexistente deve falhar');

    // Todas as fichas canônicas padrão (Thorin, Lyra, Vex) devem ser válidas
    for (const def of DEFAULT_SHEETS) {
      const resDef = validateSheet(def);
      assert(resDef.valid, `DEFAULT_SHEET de ${def.name} deve ser válida: ${resDef.errors?.join(', ')}`);
    }
  });

  it('createInitialState com default options preserva comportamento canônico (Benchmark Protection)', () => {
    const s = createInitialState(CONFIG.DEFAULT_SEED);
    assertEqual(s.entities.hero_warrior.name, 'Thorin');
    assertEqual(s.entities.hero_warrior.maxHp, 30);
    assertEqual(s.entities.hero_mage.name, 'Lyra');
    assertEqual(s.entities.hero_mage.maxHp, 18);
    assertEqual(s.entities.hero_rogue.name, 'Vex');
    assertEqual(s.entities.hero_rogue.maxHp, 22);

    // Inventário padrão
    assertDeepEqual(s.inventory, [{ id: 'health_potion', qty: 2 }]);

    // Ordem de turno padrão
    assertDeepEqual(s.turnOrder, ['hero_warrior', 'hero_mage', 'hero_rogue', ENEMY_PHASE_ID]);
    assertEqual(s.activeId, 'hero_warrior');
  });

  it('createInitialState com custom 3-hero roster configura nomes, status, habilidades, lore e inventário agregado', () => {
    const customRoster = [
      {
        id: 'hero_kaelen',
        name: 'Kaelen, o Sombrio',
        classId: 'rogue',
        player: 1,
        title: 'Lâmina Noturna',
        backstory: 'Ex-espião da corte exilado nas catacumbas.',
        personality: 'Metódico e silencioso.',
        alignment: 'Caótico e Bom',
        maxHp: 24,
        maxMp: 5,
        maxAp: 1,
        abilities: ['backstab', 'lockpick', 'slash'],
        startingItems: [{ id: 'health_potion', qty: 2 }]
      },
      {
        id: 'hero_elena',
        name: 'Elena Alvorada',
        classId: 'mage',
        player: 2,
        title: 'Sacerdotisa da Luz',
        backstory: 'Devota dedicada à cura dos feridos.',
        personality: 'Altruísta e corajosa.',
        alignment: 'Leal e Boa',
        maxHp: 21,
        maxMp: 6,
        maxAp: 1,
        abilities: ['heal_pulse', 'divine_prayer'],
        startingItems: [{ id: 'health_potion', qty: 1 }]
      },
      {
        id: 'hero_bram',
        name: 'Bram Punho de Pedra',
        classId: 'warrior',
        player: 3,
        title: 'Guardião da Montanha',
        backstory: 'Guerreiro das pedreiras ancestrais.',
        personality: 'Calmo como uma rocha.',
        alignment: 'Neutro e Bom',
        maxHp: 33,
        maxMp: 4,
        maxAp: 1,
        abilities: ['slash', 'shield_bash'],
        startingItems: []
      }
    ];

    const s = createInitialState(CONFIG.DEFAULT_SEED, { roster: customRoster });

    // Verifica herói 1
    assertEqual(s.entities.hero_kaelen.name, 'Kaelen, o Sombrio');
    assertEqual(s.entities.hero_kaelen.title, 'Lâmina Noturna');
    assertEqual(s.entities.hero_kaelen.backstory, 'Ex-espião da corte exilado nas catacumbas.');
    assertEqual(s.entities.hero_kaelen.personality, 'Metódico e silencioso.');
    assertEqual(s.entities.hero_kaelen.alignment, 'Caótico e Bom');
    assertEqual(s.entities.hero_kaelen.maxHp, 24);
    assertEqual(s.entities.hero_kaelen.hp, 24);
    assertEqual(s.entities.hero_kaelen.maxMp, 5);
    assertEqual(s.entities.hero_kaelen.mp, 5);
    assertDeepEqual(s.entities.hero_kaelen.abilities, ['backstab', 'lockpick', 'slash']);

    // Verifica herói 2 e 3
    assertEqual(s.entities.hero_elena.name, 'Elena Alvorada');
    assertEqual(s.entities.hero_bram.name, 'Bram Punho de Pedra');

    // Ordem dinâmica de turnos e herói ativo inicial
    assertDeepEqual(s.turnOrder, ['hero_kaelen', 'hero_elena', 'hero_bram', ENEMY_PHASE_ID]);
    assertEqual(s.activeId, 'hero_kaelen');

    // Agregação de startingItems (2 do Kaelen + 1 da Elena = 3 health_potion)
    assertDeepEqual(s.inventory, [{ id: 'health_potion', qty: 3 }]);
  });

  it('normalizeBatch resolve nome de herói customizado (ex: "Kaelen") para o ID da entidade em heal_pulse e use_item', () => {
    const customRoster = [
      {
        id: 'hero_kaelen',
        name: 'Kaelen, o Sombrio',
        classId: 'rogue',
        player: 1,
        title: 'Lâmina Noturna',
        maxHp: 24,
        maxMp: 5,
        maxAp: 1,
        abilities: ['backstab', 'lockpick']
      },
      {
        id: 'hero_elena',
        name: 'Elena Alvorada',
        classId: 'mage',
        player: 2,
        title: 'Sacerdotisa da Luz',
        maxHp: 21,
        maxMp: 6,
        maxAp: 1,
        abilities: ['heal_pulse']
      },
      {
        id: 'hero_bram',
        name: 'Bram Punho de Pedra',
        classId: 'warrior',
        player: 3,
        title: 'Guardião da Montanha',
        maxHp: 33,
        maxMp: 4,
        maxAp: 1,
        abilities: ['slash']
      }
    ];

    const s = createInitialState(CONFIG.DEFAULT_SEED, { roster: customRoster });

    // 1. Resolução em heal_pulse: caster "Elena" -> "hero_elena", target "Kaelen" -> "hero_kaelen"
    const rawHeal = {
      tool_calls: [
        {
          name: 'heal_pulse',
          arguments: {
            caster_id: 'Elena',
            target_id: 'Kaelen'
          }
        }
      ]
    };
    const normHeal = normalizeBatch(rawHeal, s);
    assertEqual(normHeal.tool_calls[0].name, 'use_ability');
    assertEqual(normHeal.tool_calls[0].arguments.ability_id, 'heal_pulse');
    assertEqual(normHeal.tool_calls[0].arguments.caster_id, 'hero_elena');
    assertEqual(normHeal.tool_calls[0].arguments.target_id, 'hero_kaelen');

    // 2. Resolução em use_item: target "Kaelen" -> "hero_kaelen"
    const rawItem = {
      tool_calls: [
        {
          name: 'use_item',
          arguments: {
            character_id: 'hero_bram',
            item_id: 'pocao_de_vida',
            target_id: 'Kaelen'
          }
        }
      ]
    };
    const normItem = normalizeBatch(rawItem, s);
    assertEqual(normItem.tool_calls[0].arguments.item_id, 'health_potion');
    assertEqual(normItem.tool_calls[0].arguments.target_id, 'hero_kaelen');

    // 3. Resolução pelo título "Lâmina Noturna" -> "hero_kaelen"
    const rawTitle = {
      tool_calls: [
        {
          name: 'use_item',
          arguments: {
            character_id: 'hero_bram',
            item_id: 'health_potion',
            target_id: 'Lâmina Noturna'
          }
        }
      ]
    };
    const normTitle = normalizeBatch(rawTitle, s);
    assertEqual(normTitle.tool_calls[0].arguments.target_id, 'hero_kaelen');
  });

  it('characterStorage gerencia sheets salvas e active party roster', () => {
    // Reset para party padrão
    const defParty = resetToDefaultParty();
    assertEqual(defParty.length, 3);
    assertEqual(defParty[0].id, 'hero_warrior');
    assertEqual(defParty[1].id, 'hero_mage');
    assertEqual(defParty[2].id, 'hero_rogue');

    // Salva ficha customizada válida
    const customSheet = {
      id: 'hero_valkyrie',
      name: 'Freya',
      classId: 'warrior',
      title: 'Valquíria de Ferro',
      maxHp: 27,
      maxMp: 4,
      maxAp: 1,
      abilities: ['slash', 'shield_bash'],
      startingItems: [{ id: 'health_potion', qty: 1 }]
    };
    saveSheet(customSheet);

    const saved = loadSavedSheets();
    assert(saved.some(s => s.id === 'hero_valkyrie'), 'Ficha customizada deve estar em loadSavedSheets()');

    // Salva novo grupo ativo usando Freya no slot 1
    const active = saveActivePartyRoster(['hero_valkyrie', 'hero_mage', 'hero_rogue']);
    assertEqual(active[0].id, 'hero_valkyrie');
    assertEqual(active[0].player, 1);
    assertEqual(active[1].id, 'hero_mage');
    assertEqual(active[1].player, 2);

    // Deletar custom sheet
    const deleted = deleteSheet('hero_valkyrie');
    assert(deleted, 'Deve permitir deletar ficha customizada');

    // Após deletar ficha do grupo ativo, o slot faz fallback para o herói padrão do slot
    const rosterAfterDelete = loadActivePartyRoster();
    assertEqual(rosterAfterDelete[0].id, 'hero_warrior');

    // Tentativa de deletar herói canônico padrão deve ser rejeitada
    assert(!deleteSheet('hero_warrior'), 'Não deve permitir deletar herói padrão');
  });
});
