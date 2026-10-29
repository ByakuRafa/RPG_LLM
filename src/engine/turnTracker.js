/**
 * Turn tracking, phase management, and win/loss evaluation.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { PHASE, ENEMY_PHASE_ID, TURN_ORDER } from '../core/config.js';
import { cloneState, getAliveHeroes, getAliveEnemies, evaluateGameOver } from './gameState.js';

export { evaluateGameOver };

/**
 * Pure function: sets up hero turn state and emits turn event.
 * @param {object} s GameState
 * @param {string} heroId
 * @returns {{ state: object, events: object[] }}
 */
export function beginHeroTurn(s, heroId) {
  const next = cloneState(s);
  const hero = next.entities[heroId];
  if (hero) {
    hero.mp = hero.maxMp;
    hero.ap = hero.maxAp;
  }
  next.phase = PHASE.HERO;
  next.activeId = heroId;

  const turnOrder = s.turnOrder || TURN_ORDER;
  const idx = turnOrder.indexOf(heroId);
  if (idx >= 0) {
    next.turnIndex = idx;
  }

  const events = [{
    type: 'turn',
    activeId: heroId,
    round: next.round,
    phase: PHASE.HERO
  }];

  return { state: next, events };
}

/**
 * Pure function: sets up enemy phase state and resets goblin AP/MP.
 * @param {object} s GameState
 * @returns {{ state: object, events: object[] }}
 */
export function beginEnemyPhase(s) {
  const next = cloneState(s);
  const aliveGoblins = getAliveEnemies(next);
  for (const goblin of aliveGoblins) {
    goblin.mp = goblin.maxMp;
    goblin.ap = goblin.maxAp;
  }
  next.phase = PHASE.ENEMY;
  next.activeId = ENEMY_PHASE_ID;

  const turnOrder = s.turnOrder || TURN_ORDER;
  const idx = turnOrder.indexOf(ENEMY_PHASE_ID);
  if (idx >= 0) {
    next.turnIndex = idx;
  }

  const events = [{
    type: 'turn',
    activeId: ENEMY_PHASE_ID,
    round: next.round,
    phase: PHASE.ENEMY
  }];

  return { state: next, events };
}

/**
 * Pure function: advances turnIndex, wrapping around to next round and skipping dead heroes.
 * Delegates to beginHeroTurn or beginEnemyPhase.
 * @param {object} s GameState
 * @returns {{ state: object, events: object[] }}
 */
export function advanceTurn(s) {
  const turnOrder = s.turnOrder || TURN_ORDER;
  let nextIndex = (s.turnIndex + 1) % turnOrder.length;
  let nextRound = s.round + (s.turnIndex + 1 >= turnOrder.length ? 1 : 0);

  for (let steps = 0; steps < turnOrder.length; steps++) {
    const candidateId = turnOrder[nextIndex];
    if (candidateId === ENEMY_PHASE_ID) {
      const stateWithRound = { ...s, round: nextRound, turnIndex: nextIndex, turnOrder };
      return beginEnemyPhase(stateWithRound);
    }

    const hero = s.entities[candidateId];
    if (hero && hero.alive) {
      const stateWithRound = { ...s, round: nextRound, turnIndex: nextIndex, turnOrder };
      return beginHeroTurn(stateWithRound, candidateId);
    }

    // Dead hero -> skip to next
    nextIndex = (nextIndex + 1) % turnOrder.length;
    if (nextIndex === 0) {
      nextRound++;
    }
  }

  // Fallback if all heroes are dead
  const stateWithRound = { ...s, round: nextRound, turnIndex: nextIndex, turnOrder };
  return beginEnemyPhase(stateWithRound);
}

/**
 * Impure Turn Controller.
 * Wires store, bus, and queue to handle turn progression.
 * @param {{ store: object, bus: object, queue?: object, enemyController?: object|null }} options
 * @returns {{ start: () => void, runEnemyPhase: () => Promise<void> }}
 */
export function createTurnController({ store, bus, queue, enemyController = null }) {
  function start() {
    const current = store.getState();
    const firstHeroId = (current.turnOrder && current.turnOrder[0] !== ENEMY_PHASE_ID)
      ? current.turnOrder[0]
      : 'hero_warrior';
    const { state, events } = beginHeroTurn(current, firstHeroId);
    store.commit(state, events);
    bus?.emit('turn:changed', { activeId: state.activeId, round: state.round, phase: state.phase });
    const heroName = state.entities[state.activeId]?.name || 'Thorin';
    bus?.emit('log:entry', {
      level: 'TURN',
      text: `[TURN] Vez de ${heroName} (Rodada ${state.round}).`,
      source: 'SYSTEM',
      ts: Date.now()
    });
  }

  async function runEnemyPhase() {
    const aliveEnemies = getAliveEnemies(store.getState());
    if (aliveEnemies.length === 0) {
      const outcome = evaluateGameOver(store.getState());
      if (!outcome) {
        const { state: nextState, events } = advanceTurn(store.getState());
        store.commit(nextState, events);
        bus?.emit('turn:changed', { activeId: nextState.activeId, round: nextState.round, phase: nextState.phase });
        const heroName = nextState.entities[nextState.activeId]?.name || 'Thorin';
        bus?.emit('log:entry', {
          level: 'TURN',
          text: `[TURN] Vez de ${heroName} (Rodada ${nextState.round}).`,
          source: 'SYSTEM',
          ts: Date.now()
        });
      }
      return;
    }

    bus?.emit('log:entry', {
      level: 'TURN',
      text: '[TURN] Fase Inimiga',
      source: 'SYSTEM',
      ts: Date.now()
    });

    if (enemyController && typeof enemyController.executeTurn === 'function') {
      await enemyController.executeTurn({ store, queue });
    }

    const outcome = evaluateGameOver(store.getState());
    if (!outcome) {
      const { state: nextState, events } = advanceTurn(store.getState());
      store.commit(nextState, events);
      bus?.emit('turn:changed', { activeId: nextState.activeId, round: nextState.round, phase: nextState.phase });
      const heroName = nextState.entities[nextState.activeId]?.name || 'Thorin';
      bus?.emit('log:entry', {
        level: 'TURN',
        text: `[TURN] Vez de ${heroName} (Rodada ${nextState.round}).`,
        source: 'SYSTEM',
        ts: Date.now()
      });
    }
  }

  if (bus && typeof bus.on === 'function') {
    bus.on('queue:batchDone', async (result) => {
      const hadEndTurn = result?.applied?.some(item => item.call?.name === 'end_turn');
      if (hadEndTurn) {
        const outcome = evaluateGameOver(store.getState());
        if (outcome) return;

        const { state: nextState, events } = advanceTurn(store.getState());
        store.commit(nextState, events);
        bus?.emit('turn:changed', { activeId: nextState.activeId, round: nextState.round, phase: nextState.phase });
        if (nextState.phase === PHASE.ENEMY) {
          await runEnemyPhase();
        } else {
          const heroName = nextState.entities[nextState.activeId]?.name || 'Thorin';
          bus?.emit('log:entry', {
            level: 'TURN',
            text: `[TURN] Vez de ${heroName} (Rodada ${nextState.round}).`,
            source: 'SYSTEM',
            ts: Date.now()
          });
        }
      }
    });
  }

  return { start, runEnemyPhase };
}
