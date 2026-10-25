/**
 * Turn tracking, phase management, and win/loss evaluation.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { PHASE, ENEMY_PHASE_ID, TURN_ORDER } from '../core/config.js';
import { cloneState, getAliveHeroes, getAliveEnemies } from './gameState.js';

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

  const idx = TURN_ORDER.indexOf(heroId);
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

  const idx = TURN_ORDER.indexOf(ENEMY_PHASE_ID);
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
  let nextIndex = (s.turnIndex + 1) % TURN_ORDER.length;
  let nextRound = s.round + (s.turnIndex + 1 >= TURN_ORDER.length ? 1 : 0);

  for (let steps = 0; steps < TURN_ORDER.length; steps++) {
    const candidateId = TURN_ORDER[nextIndex];
    if (candidateId === ENEMY_PHASE_ID) {
      const stateWithRound = { ...s, round: nextRound, turnIndex: nextIndex };
      return beginEnemyPhase(stateWithRound);
    }

    const hero = s.entities[candidateId];
    if (hero && hero.alive) {
      const stateWithRound = { ...s, round: nextRound, turnIndex: nextIndex };
      return beginHeroTurn(stateWithRound, candidateId);
    }

    // Dead hero -> skip to next
    nextIndex = (nextIndex + 1) % TURN_ORDER.length;
    if (nextIndex === 0) {
      nextRound++;
    }
  }

  // Fallback if all heroes are dead
  const stateWithRound = { ...s, round: nextRound, turnIndex: nextIndex };
  return beginEnemyPhase(stateWithRound);
}

/**
 * Evaluates game over condition.
 * @param {object} s GameState
 * @returns {'won' | 'lost' | null}
 */
export function evaluateGameOver(s) {
  if (!s) return null;
  if (s.status === 'won' || s.status === 'lost') return s.status;

  const aliveHeroes = getAliveHeroes(s);
  const aliveEnemies = getAliveEnemies(s);

  if (aliveEnemies.length === 0) return 'won';
  if (aliveHeroes.length === 0) return 'lost';
  return null;
}

/**
 * Impure Turn Controller.
 * Wires store, bus, and queue to handle turn progression.
 * @param {{ store: object, bus: object, queue?: object, enemyController?: object|null }} options
 * @returns {{ start: () => void, runEnemyPhase: () => Promise<void> }}
 */
export function createTurnController({ store, bus, queue, enemyController = null }) {
  function start() {
    const { state, events } = beginHeroTurn(store.getState(), 'hero_warrior');
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
