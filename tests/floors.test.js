/**
 * Tests for Multi-Floor Dungeon Progression, Door Transitions, and Enemy Archetypes.
 * Pure JS, Zero DOM, Zero Canvas, 100% determinism.
 */
import { describe, it, assert, assertEqual } from './runner.js';
import { CONFIG, PHASE } from '../src/core/config.js';
import { CLASSES, ABILITIES } from '../src/engine/catalog.js';
import { generateDungeon, getSpawnsForFloor } from '../src/engine/mapGenerator.js';
import { createEventBus } from '../src/core/eventBus.js';
import { createStore, createInitialState, evaluateGameOver, advanceFloor, applyDamage, applyInteract } from '../src/engine/gameState.js';
import { createActionQueue } from '../src/engine/actionQueue.js';
import { createTurnController, advanceTurn } from '../src/engine/turnTracker.js';
import { TOOLS } from '../src/engine/tools.js';
import { validateInteract } from '../src/engine/rules.js';
import { HeuristicEnemyStrategy } from '../src/engine/enemyController.js';

describe('Catálogo de Inimigos e Habilidades', () => {
  it('CLASSES possui os arquétipos goblin, skeleton e orc com atributos válidos', () => {
    assert(CLASSES.goblin, 'Classe goblin deve existir');
    assert(CLASSES.skeleton, 'Classe skeleton deve existir');
    assert(CLASSES.orc, 'Classe orc deve existir');

    assertEqual(CLASSES.skeleton.archetype, 'ranged', 'Esqueleto deve ser ranged');
    assertEqual(CLASSES.orc.archetype, 'melee', 'Orc deve ser melee');

    assert(CLASSES.skeleton.abilities.includes('bone_arrow'), 'Esqueleto deve ter bone_arrow');
    assert(CLASSES.orc.abilities.includes('heavy_smash'), 'Orc deve ter heavy_smash');
  });

  it('Habilidades de inimigos possuem alcance e efeitos adequados', () => {
    const arrow = ABILITIES.bone_arrow;
    assert(arrow, 'bone_arrow deve existir');
    assertEqual(arrow.range, 4, 'Flecha óssea deve ter alcance 4');
    assertEqual(arrow.effect.type, 'damage', 'Flecha óssea deve causar dano');

    const smash = ABILITIES.heavy_smash;
    assert(smash, 'heavy_smash deve existir');
    assertEqual(smash.range, 1, 'Golpe pesado deve ter alcance 1');
    assertEqual(smash.effect.push, 1, 'Golpe pesado deve ter empurrão');
  });
});

describe('Geração de Andares e Spawns', () => {
  it('getSpawnsForFloor retorna composições distintas e balanceadas por andar', () => {
    const f1 = getSpawnsForFloor(1);
    const f2 = getSpawnsForFloor(2);
    const f3 = getSpawnsForFloor(3);

    assertEqual(f1.length, 3, 'Andar 1 deve ter 3 inimigos');
    assert(f1.every(e => (e.classId || 'goblin') === 'goblin'), 'Andar 1 deve conter apenas goblins');

    assertEqual(f2.length, 3, 'Andar 2 deve ter 3 inimigos');
    assert(f2.some(e => e.classId === 'skeleton'), 'Andar 2 deve conter esqueletos');
    assert(f2.some(e => e.classId === 'orc'), 'Andar 2 deve conter orc');

    assertEqual(f3.length, 3, 'Andar 3 deve ter 3 inimigos');
    assert(f3.some(e => e.id === 'orc_boss'), 'Andar 3 deve conter o chefe orc');
  });

  it('generateDungeon inclui exit_door trancada e gera mapas determinísticos distintos por andar', () => {
    const dF1 = generateDungeon('TEST_SEED', { floor: 1 });
    const dF2 = generateDungeon('TEST_SEED', { floor: 2 });

    assert(dF1.map.hash !== dF2.map.hash, 'Andar 1 e Andar 2 devem ter hashes diferentes para a mesma semente base');

    const door1 = dF1.objects.find(o => o.id === 'exit_door' || o.type === 'door');
    assert(door1, 'Andar 1 deve conter exit_door');
    assertEqual(door1.locked, true, 'Porta deve iniciar trancada');
  });
});

describe('Regras de Porta e Transição de Andar', () => {
  it('validateInteract rejeita porta trancada com OBJECT_LOCKED', () => {
    const state = createInitialState('TEST_SEED');
    const door = state.objects['exit_door'];
    assert(door, 'exit_door deve existir no estado inicial');

    // Posiciona o guerreiro adjacente à porta
    state.entities.hero_warrior.position = { x: door.position.x, y: door.position.y + 1 };
    door.locked = true;

    const res = validateInteract(state, { character_id: 'hero_warrior', object_id: 'exit_door' });
    assertEqual(res.ok, false, 'Interagir com porta trancada deve falhar');
    assertEqual(res.code, 'OBJECT_LOCKED', 'Código de rejeição deve ser OBJECT_LOCKED');
  });

  it('Derrotar todos os inimigos do Andar 1 destranca a porta sem encerrar o jogo', () => {
    const state = createInitialState('TEST_SEED');
    state.floor = 1;
    state.maxFloors = 3;

    // Elimina todos os inimigos
    for (const ent of Object.values(state.entities)) {
      if (ent.role === 'enemy') {
        ent.hp = 0;
        ent.alive = false;
      }
    }

    // Aplica dano fictício que dispara evaluateGameOver
    const enemyIds = Object.values(state.entities).filter(e => e.role === 'enemy').map(e => e.id);
    const { state: nextState } = applyDamage(state, enemyIds[0], 0);

    assertEqual(evaluateGameOver(nextState), null, 'Andar 1 com porta de saída não deve dar game over imediato');
  });

  it('advanceFloor avança para o Andar 2, preserva HP/inventário e instancia novos inimigos', () => {
    const state = createInitialState('TEST_SEED');
    state.entities.hero_warrior.hp = 18; // Guerreiro ferido
    state.inventory.push({ id: 'gold_coins', qty: 50 });

    const { state: nextState, events } = advanceFloor(state, 'hero_warrior');

    assertEqual(nextState.floor, 2, 'Estado deve avançar para o Andar 2');
    assertEqual(nextState.round, 1, 'Rodada deve reiniciar em 1');
    assertEqual(nextState.phase, PHASE.HERO, 'Fase deve reiniciar em HERO');

    // HP preservado (+5 de cura de descanso ao mudar de andar: 18 + 5 = 23)
    assertEqual(nextState.entities.hero_warrior.hp, 23, 'HP do guerreiro deve ser preservado com bônus de descanso');

    // Inventário preservado
    const goldSlot = nextState.inventory.find(i => i.id === 'gold_coins');
    assert(goldSlot && goldSlot.qty === 50, 'Ouro acumulado deve ser mantido');

    // Novos inimigos presentes
    const aliveEnemies = Object.values(nextState.entities).filter(e => e.role === 'enemy');
    assertEqual(aliveEnemies.length, 3, 'Andar 2 deve ter 3 novos inimigos');
    assert(aliveEnemies.some(e => e.classId === 'skeleton'), 'Andar 2 deve ter esqueleto vivo');

    assert(events.some(ev => ev.type === 'floor_transition'), 'Evento floor_transition deve ser emitido');
  });

  it('Quando todos os inimigos são derrotados, os turnos continuam ciclando entre os heróis pulando a fase inimiga', () => {
    const state = createInitialState('TEST_SEED');
    state.floor = 1;
    state.maxFloors = 3;

    // Elimina todos os inimigos
    for (const ent of Object.values(state.entities)) {
      if (ent.role === 'enemy') {
        ent.hp = 0;
        ent.alive = false;
      }
    }

    // Vez de Thorin (Guerreiro)
    state.turnIndex = 0;
    state.activeId = 'hero_warrior';

    // Avança turno -> deve ir para Lyra (Mago)
    const turn1 = advanceTurn(state);
    assertEqual(turn1.state.activeId, 'hero_mage', 'Deve avançar para hero_mage');
    assertEqual(turn1.state.phase, PHASE.HERO, 'Fase deve ser HERO');
    assertEqual(evaluateGameOver(turn1.state), null, 'Jogo não deve terminar');

    // Avança turno -> deve ir para Vex (Ladino)
    const turn2 = advanceTurn(turn1.state);
    assertEqual(turn2.state.activeId, 'hero_rogue', 'Deve avançar para hero_rogue');
    assertEqual(turn2.state.phase, PHASE.HERO, 'Fase deve ser HERO');
    assertEqual(evaluateGameOver(turn2.state), null, 'Jogo não deve terminar');

    // Avança turno -> transita pela fase inimiga
    const turn3 = advanceTurn(turn2.state);
    assertEqual(turn3.state.activeId, 'ENEMY_PHASE', 'Deve ir para ENEMY_PHASE');
    assertEqual(turn3.state.phase, PHASE.ENEMY, 'Fase deve ser ENEMY');
    assertEqual(evaluateGameOver(turn3.state), null, 'Jogo não deve terminar');

    // Avança turno -> volta para Thorin na Rodada 2 com MP restaurado
    const turn4 = advanceTurn(turn3.state);
    assertEqual(turn4.state.activeId, 'hero_warrior', 'Deve voltar para hero_warrior');
    assertEqual(turn4.state.round, state.round + 1, 'Rodada deve incrementar');
    assertEqual(turn4.state.phase, PHASE.HERO, 'Fase deve ser HERO');
    assertEqual(evaluateGameOver(turn4.state), null, 'Jogo não deve terminar');
  });

  it('No andar final (ex: Andar 3), derrotar todos os inimigos declara vitória (status: won)', () => {
    const state = createInitialState('TEST_SEED');
    state.floor = 3;
    state.maxFloors = 3;

    // Elimina todos os inimigos
    for (const ent of Object.values(state.entities)) {
      if (ent.role === 'enemy') {
        ent.hp = 0;
        ent.alive = false;
      }
    }

    assertEqual(evaluateGameOver(state), 'won', 'No andar final, eliminar inimigos declara vitória');
  });

  it('validateInteract permite interagir com a porta destrancada tanto adjacente quanto sobre a mesma casa', () => {
    const state = createInitialState('TEST_SEED');
    const door = state.objects['exit_door'];
    door.locked = false;

    // Adjacente (distância 1)
    state.entities.hero_warrior.position = { x: door.position.x, y: door.position.y + 1 };
    const resAdj = validateInteract(state, { character_id: 'hero_warrior', object_id: 'exit_door' });
    assertEqual(resAdj.ok, true, 'Interagir com porta destrancada adjacente deve ser válido');

    // Sobre a porta (distância 0)
    state.entities.hero_warrior.position = { x: door.position.x, y: door.position.y };
    const resSame = validateInteract(state, { character_id: 'hero_warrior', object_id: 'exit_door' });
    assertEqual(resSame.ok, true, 'Interagir com porta destrancada sobre a mesma casa deve ser válido');
  });

  it('Fluxo Completo: heróis derrotam goblins, avançam turnos até a porta e passam para o Andar 2', async () => {
    const bus = createEventBus();
    const initialState = createInitialState('TEST_SEED');
    const store = createStore(initialState, bus);
    const queue = createActionQueue({ store, bus, tools: TOOLS, delayMs: 0 });
    const turns = createTurnController({ store, bus, queue });
    turns.start();

    // 1. Elimina todos os inimigos do andar 1
    for (const ent of Object.values(store.getState().entities)) {
      if (ent.role === 'enemy') {
        store.getState().entities[ent.id].alive = false;
        store.getState().entities[ent.id].hp = 0;
      }
    }
    const door = store.getState().objects['exit_door'];
    door.locked = false;

    // 2. Thorin encerra turno -> deve passar para Lyra
    await queue.enqueue({
      source: 'TEST',
      tool_calls: [{ name: 'end_turn', arguments: { character_id: 'hero_warrior' } }]
    });
    assertEqual(store.getState().activeId, 'hero_mage', 'Turno deve passar para Lyra');

    // 3. Lyra encerra turno -> deve passar para Vex
    await queue.enqueue({
      source: 'TEST',
      tool_calls: [{ name: 'end_turn', arguments: { character_id: 'hero_mage' } }]
    });
    assertEqual(store.getState().activeId, 'hero_rogue', 'Turno deve passar para Vex');

    // 4. Vex encerra turno -> ciclo deve passar pela fase inimiga vazia e voltar para Thorin na rodada 2!
    await queue.enqueue({
      source: 'TEST',
      tool_calls: [{ name: 'end_turn', arguments: { character_id: 'hero_rogue' } }]
    });
    assertEqual(store.getState().activeId, 'hero_warrior', 'Ciclo deve retornar para Thorin');
    assertEqual(store.getState().round, 2, 'Rodada deve avançar para 2');

    // 5. Posiciona Thorin sobre a porta e interage -> deve avançar para o Andar 2!
    store.getState().entities.hero_warrior.position = { x: door.position.x, y: door.position.y };
    await queue.enqueue({
      source: 'TEST',
      tool_calls: [{ name: 'interact_object', arguments: { character_id: 'hero_warrior', object_id: 'exit_door' } }]
    });

    assertEqual(store.getState().floor, 2, 'Masmorra deve avançar para o Andar 2');
    assertEqual(store.getState().round, 1, 'Rodada deve reiniciar em 1 no novo andar');
    const aliveEnemies = Object.values(store.getState().entities).filter(e => e.role === 'enemy' && e.alive);
    assertEqual(aliveEnemies.length, 3, 'Andar 2 deve ter 3 novos inimigos');
  });
});

describe('IA Inimiga Tática (Esqueleto Arqueiro & Orc)', () => {
  it('Esqueleto ataca herói à distância com bone_arrow sem andar desnecessariamente', () => {
    const state = createInitialState('TEST_SEED');
    const strat = new HeuristicEnemyStrategy();

    // Remove todos os inimigos e coloca 1 esqueleto a distância 3 do guerreiro
    for (const [id, ent] of Object.entries(state.entities)) {
      if (ent.role === 'enemy') delete state.entities[id];
    }

    state.entities.hero_warrior.position = { x: 5, y: 5 };
    state.entities.skeleton_1 = {
      id: 'skeleton_1',
      name: 'Esqueleto 1',
      classId: 'skeleton',
      role: 'enemy',
      position: { x: 5, y: 2 }, // Distância 3 Manhattan
      hp: 14,
      maxHp: 14,
      mp: 3,
      maxMp: 3,
      ap: 1,
      maxAp: 1,
      abilities: ['bone_arrow'],
      alive: true
    };

    const calls = strat.planForEnemy(state, 'skeleton_1');
    assert(calls.length > 0, 'Esqueleto deve emitir ações');

    const abilityCall = calls.find(c => c.name === 'use_ability');
    assert(abilityCall, 'Esqueleto deve usar habilidade');
    assertEqual(abilityCall.arguments.ability_id, 'bone_arrow', 'Esqueleto deve usar bone_arrow');
    assertEqual(abilityCall.arguments.target_id, 'hero_warrior', 'Alvo deve ser o guerreiro');

    // Como já estava a distância 3 (<= 4), não precisa andar
    const moveCall = calls.find(c => c.name === 'move_character');
    assert(!moveCall, 'Esqueleto não precisa mover se já estiver no alcance');
  });
});
