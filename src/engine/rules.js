/**
 * Game rules validation for tool execution.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { CONFIG, PHASE } from '../core/config.js';
import { REJECT } from '../core/messages.js';
import { inBounds, isWallAt, getBlockerAt, manhattan, computeReachable, key } from './pathfinding.js';
import { ABILITIES } from './catalog.js';

const ALLOWED_ENEMY_SOURCES = new Set(['ENEMY_AI', 'HUMAN_GM', 'TEST']);

/**
 * Checks whether the game is currently playable.
 * @param {object} s GameState
 * @returns {{ ok: false, code: string, message: string } | null}
 */
export function checkPlaying(s) {
  if (s.phase === PHASE.GAME_OVER || s.gameOver) {
    return { ok: false, code: 'GAME_OVER', message: REJECT.GAME_OVER() };
  }
  return null;
}

/**
 * Validates whether an actor can act right now.
 * - GAME_OVER check
 * - Actor exists in entities
 * - Actor is alive
 * - HERO phase: actor === activeId
 * - ENEMY phase: actor is an enemy entity and source is allowed
 *
 * @param {object} s GameState
 * @param {string} id Entity ID
 * @param {object} [ctx] Context including source
 * @returns {{ ok: false, code: string, message: string } | null}
 */
export function checkActor(s, id, ctx = {}) {
  const playingErr = checkPlaying(s);
  if (playingErr) return playingErr;

  const actor = s?.entities?.[id];
  if (!actor) {
    return { ok: false, code: 'UNKNOWN_ENTITY', message: REJECT.UNKNOWN_ENTITY({ id }) };
  }

  if (!actor.alive || (typeof actor.hp === 'number' && actor.hp <= 0)) {
    return { ok: false, code: 'ENTITY_DEAD', message: REJECT.ENTITY_DEAD(actor) };
  }

  if (s.phase === PHASE.HERO) {
    if (id !== s.activeId) {
      return { ok: false, code: 'NOT_YOUR_TURN', message: REJECT.NOT_YOUR_TURN(actor) };
    }
  } else if (s.phase === PHASE.ENEMY) {
    const source = ctx?.source || 'HUMAN_GM';
    if (actor.role !== 'enemy' || !ALLOWED_ENEMY_SOURCES.has(source)) {
      return { ok: false, code: 'NOT_YOUR_TURN', message: REJECT.NOT_YOUR_TURN(actor) };
    }
  } else {
    return { ok: false, code: 'NOT_YOUR_TURN', message: REJECT.NOT_YOUR_TURN(actor) };
  }

  return null;
}

/**
 * Validates move_character action according to Task 3.8 order:
 * 1. Actor guards
 * 2. OUT_OF_BOUNDS
 * 3. SAME_TILE
 * 4. TARGET_IS_WALL
 * 5. TARGET_OCCUPIED
 * 6. NO_MP
 * 7. TOO_FAR (manhattan > mp)
 * 8. If BFS mode: reachable check -> UNREACHABLE
 *
 * @param {object} s GameState
 * @param {{ character_id: string, target_x: number, target_y: number }} action
 * @param {object} [ctx]
 * @returns {{ ok: boolean, code?: string, message?: string, resolved?: { cost: number } }}
 */
export function validateMove(s, { character_id, target_x, target_y }, ctx = {}) {
  // 1. Actor guards
  const actorErr = checkActor(s, character_id, ctx);
  if (actorErr) return actorErr;

  const actor = s.entities[character_id];

  // 2. OUT_OF_BOUNDS
  if (!inBounds(s.map, target_x, target_y)) {
    return { ok: false, code: 'OUT_OF_BOUNDS', message: REJECT.OUT_OF_BOUNDS() };
  }

  // 3. SAME_TILE
  if (actor.position.x === target_x && actor.position.y === target_y) {
    return { ok: false, code: 'SAME_TILE', message: REJECT.SAME_TILE() };
  }

  // 4. TARGET_IS_WALL
  if (isWallAt(s.map, target_x, target_y)) {
    return { ok: false, code: 'TARGET_IS_WALL', message: REJECT.TARGET_IS_WALL() };
  }

  // 5. TARGET_OCCUPIED
  const blocker = getBlockerAt(s, target_x, target_y, { ignoreId: character_id });
  if (blocker) {
    return { ok: false, code: 'TARGET_OCCUPIED', message: REJECT.TARGET_OCCUPIED(blocker) };
  }

  // 6. NO_MP
  if (actor.mp <= 0) {
    return { ok: false, code: 'NO_MP', message: REJECT.NO_MP(actor) };
  }

  // 7. TOO_FAR (manhattan > mp)
  const dist = manhattan(actor.position.x, actor.position.y, target_x, target_y);
  if (dist > actor.mp) {
    return { ok: false, code: 'TOO_FAR', message: REJECT.TOO_FAR() };
  }

  // 8. BFS mode check
  const mode = s.config?.MOVEMENT_MODE || CONFIG.MOVEMENT_MODE || 'BFS';
  if (mode === 'BFS') {
    const reachable = computeReachable(s, character_id, actor.mp);
    const cost = reachable.get(key(target_x, target_y));
    if (cost === undefined) {
      return { ok: false, code: 'UNREACHABLE', message: REJECT.UNREACHABLE() };
    }
    return { ok: true, resolved: { cost } };
  } else {
    return { ok: true, resolved: { cost: dist } };
  }
}

/**
 * Validates end_turn action (actor guards only).
 * @param {object} s GameState
 * @param {{ character_id: string }} action
 * @param {object} [ctx]
 * @returns {{ ok: boolean, code?: string, message?: string, resolved?: object }}
 */
export function validateEndTurn(s, { character_id }, ctx = {}) {
  const actorErr = checkActor(s, character_id, ctx);
  if (actorErr) return actorErr;
  return { ok: true, resolved: {} };
}

/**
 * Validates use_ability basic action (Sprint 1 subset):
 * Actor guards, NO_AP, ABILITY_NOT_OWNED, UNKNOWN_TARGET.
 *
 * @param {object} s GameState
 * @param {{ caster_id: string, ability_id: string, target_id: string }} action
 * @param {object} [ctx]
 * @returns {{ ok: boolean, code?: string, message?: string, resolved?: { ability: object, target: object } }}
 */
export function validateUseAbilityBasic(s, { caster_id, ability_id, target_id }, ctx = {}) {
  const actorErr = checkActor(s, caster_id, ctx);
  if (actorErr) return actorErr;

  const actor = s.entities[caster_id];
  const ability = ABILITIES[ability_id];
  const apCost = ability?.apCost ?? 1;

  if (actor.ap < apCost) {
    return { ok: false, code: 'NO_AP', message: REJECT.NO_AP(actor) };
  }

  if (!actor.abilities || !actor.abilities.includes(ability_id)) {
    return {
      ok: false,
      code: 'ABILITY_NOT_OWNED',
      message: REJECT.ABILITY_NOT_OWNED({ abilityId: ability_id, name: actor.name })
    };
  }

  const target = s?.entities?.[target_id] || s?.objects?.[target_id];
  if (!target) {
    return { ok: false, code: 'UNKNOWN_TARGET', message: REJECT.UNKNOWN_TARGET({ targetId: target_id }) };
  }

  return { ok: true, resolved: { ability, target } };
}
