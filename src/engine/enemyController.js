/**
 * Deterministic Enemy AI and Controller (Task 3.4).
 * Pure JS logic, Zero DOM, Zero Canvas, Zero Math.random().
 */
import { CONFIG, TURN_ORDER } from '../core/config.js';
import { key, manhattan, computeReachable, computeDistanceField } from './pathfinding.js';
import { getAliveHeroes, getAliveEnemies } from './gameState.js';

/**
 * Heuristic enemy strategy:
 * Deterministic targeting and pathfinding using computeDistanceField and computeReachable.
 */
export class HeuristicEnemyStrategy {
  /**
   * Plans actions for a single enemy deterministically.
   * Does NOT mutate state.
   *
   * @param {object} state GameState
   * @param {string} enemyId ID of the enemy entity
   * @returns {Array<{ name: string, arguments: object }>} Array of tool calls (0, 1, or 2 calls)
   */
  planForEnemy(state, enemyId) {
    const enemy = state?.entities?.[enemyId];
    if (!enemy || !enemy.alive || !enemy.position) {
      return [];
    }

    // 1. heroes = getAliveHeroes(state); none -> []
    const heroes = getAliveHeroes(state);
    if (!heroes || heroes.length === 0) {
      return [];
    }

    // 2. Target: for each hero, field = computeDistanceField(state, hero.position, { ignoreUnits: true });
    // read the goblin's distance. Pick min distance; tie -> lowest hp; tie -> TURN_ORDER index.
    let targetHero = null;
    let targetField = null;
    let minHeroDist = Infinity;

    for (const hero of heroes) {
      const field = computeDistanceField(state, hero.position, { ignoreUnits: true });
      const dist = field.get(key(enemy.position.x, enemy.position.y)) ?? Infinity;

      if (!targetHero) {
        targetHero = hero;
        targetField = field;
        minHeroDist = dist;
      } else {
        let cmp = dist - minHeroDist;
        if (cmp === 0) {
          cmp = (hero.hp ?? 0) - (targetHero.hp ?? 0);
        }
        if (cmp === 0) {
          const idxA = TURN_ORDER.indexOf(hero.id);
          const idxB = TURN_ORDER.indexOf(targetHero.id);
          cmp = (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        }
        if (cmp < 0) {
          targetHero = hero;
          targetField = field;
          minHeroDist = dist;
        }
      }
    }

    const calls = [];
    let currentPos = { x: enemy.position.x, y: enemy.position.y };

    // 3. Already adjacent to any hero -> skip movement.
    const isAdjacentToAnyHero = heroes.some(h =>
      manhattan(enemy.position.x, enemy.position.y, h.position.x, h.position.y) === 1
    );

    // 4. Else reach = computeReachable(state, enemyId, enemy.mp); choose the tile minimizing (field.get(tile), reachCost, y, x).
    // Emit move_character only if it reduces the distance.
    if (!isAdjacentToAnyHero && (enemy.mp ?? 0) > 0 && targetField) {
      const reach = computeReachable(state, enemyId, enemy.mp);
      let bestCandidate = null;

      for (const [tileKey, reachCost] of reach.entries()) {
        const [tx, ty] = tileKey.split(',').map(Number);
        const dist = targetField.get(tileKey) ?? Infinity;
        const candidate = { dist, reachCost, y: ty, x: tx };

        if (!bestCandidate) {
          bestCandidate = candidate;
        } else {
          let cmp = candidate.dist - bestCandidate.dist;
          if (cmp === 0) cmp = candidate.reachCost - bestCandidate.reachCost;
          if (cmp === 0) cmp = candidate.y - bestCandidate.y;
          if (cmp === 0) cmp = candidate.x - bestCandidate.x;

          if (cmp < 0) {
            bestCandidate = candidate;
          }
        }
      }

      const currentDist = targetField.get(key(enemy.position.x, enemy.position.y)) ?? Infinity;
      if (bestCandidate && bestCandidate.dist < currentDist) {
        calls.push({
          name: 'move_character',
          arguments: {
            character_id: enemyId,
            target_x: bestCandidate.x,
            target_y: bestCandidate.y
          }
        });
        currentPos = { x: bestCandidate.x, y: bestCandidate.y };
      }
    }

    // 5. From the (simulated) final position, if adjacent to any hero -> emit use_ability('goblin_strike')
    // on the adjacent hero with the lowest hp (tie -> TURN_ORDER index).
    const adjacentHeroes = heroes.filter(h =>
      manhattan(currentPos.x, currentPos.y, h.position.x, h.position.y) === 1
    );

    if (adjacentHeroes.length > 0 && (enemy.ap ?? 1) >= 1) {
      adjacentHeroes.sort((a, b) => {
        if (a.hp !== b.hp) return a.hp - b.hp;
        const idxA = TURN_ORDER.indexOf(a.id);
        const idxB = TURN_ORDER.indexOf(b.id);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      });

      const attackTarget = adjacentHeroes[0];
      calls.push({
        name: 'use_ability',
        arguments: {
          caster_id: enemyId,
          ability_id: 'goblin_strike',
          target_id: attackTarget.id
        }
      });
    }

    return calls;
  }
}

/**
 * Creates the enemy controller handling turn execution and strategy dispatch.
 *
 * @param {{ mode?: string, strategies?: object }} [options]
 * @returns {{ executeTurn: (ctx: { store: object, queue: object }) => Promise<void>, setMode: (m: string) => void, getMode: () => string }}
 */
export function createEnemyController({ mode = CONFIG.ENEMY_AI_MODE, strategies } = {}) {
  let currentMode = mode;
  const strats = {
    HEURISTIC: new HeuristicEnemyStrategy(),
    ...(strategies || {})
  };

  async function executeTurn({ store, queue }) {
    if (!store || !queue) return;
    const ids = getAliveEnemies(store.getState()).map(e => e.id).sort();
    for (const id of ids) {
      const s = store.getState();
      const status = s.status || 'playing';
      if (status !== 'playing' || !s.entities?.[id]?.alive) continue;
      const strategy = strats[currentMode];
      if (!strategy) continue;
      const calls = await strategy.planForEnemy(s, id);
      if (calls && calls.length) {
        await queue.enqueue({ source: 'ENEMY_AI', tool_calls: calls });
      }
    }
  }

  function setMode(newMode) {
    currentMode = newMode;
  }

  function getMode() {
    return currentMode;
  }

  return {
    executeTurn,
    setMode,
    getMode
  };
}
