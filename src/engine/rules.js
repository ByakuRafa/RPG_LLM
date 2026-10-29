/**
 * Game rules validation for tool execution.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { CONFIG, PHASE } from '../core/config.js';
import { REJECT } from '../core/messages.js';
import { inBounds, isWallAt, getBlockerAt, manhattan, computeReachable, key } from './pathfinding.js';
import { ABILITIES, ITEMS, isHostile } from './catalog.js';

export { isHostile };

const ALLOWED_ENEMY_SOURCES = new Set(['ENEMY_AI', 'HUMAN_GM', 'TEST']);

/**
 * Checks whether two positions are orthogonally adjacent (Manhattan distance === 1).
 * @param {{ x: number, y: number }} posA
 * @param {{ x: number, y: number }} posB
 * @returns {boolean}
 */
export function isAdjacent(posA, posB) {
  if (!posA || !posB) return false;
  return manhattan(posA.x, posA.y, posB.x, posB.y) === 1;
}

/**
 * Resolves an ID to either an entity or an object.
 * @param {object} s GameState
 * @param {string} id
 * @returns {{ kind: 'entity' | 'object', ref: object } | null}
 */
export function resolveTarget(s, id) {
  if (!s || !id) return null;
  if (s.entities && s.entities[id]) {
    return { kind: 'entity', ref: s.entities[id] };
  }
  if (s.objects && s.objects[id]) {
    return { kind: 'object', ref: s.objects[id] };
  }
  return null;
}

/**
 * Checks whether the game is currently playable.
 * @param {object} s GameState
 * @returns {{ ok: false, code: string, message: string } | null}
 */
export function checkPlaying(s) {
  if (s.phase === PHASE.GAME_OVER || s.gameOver || s.status === 'won' || s.status === 'lost') {
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
    return { ok: false, code: 'WRONG_PHASE', message: REJECT.WRONG_PHASE({ phase: s.phase }) };
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
 * Validates use_ability action (Task 3.1):
 * 1. Actor guards
 * 2. UNKNOWN_ABILITY / ABILITY_NOT_OWNED
 * 3. NO_AP (ap < apCost)
 * 4. Resolve target -> UNKNOWN_TARGET
 * 5. Type check: enemy -> hostile entity; ally -> same-side entity (self allowed); object -> object; otherwise INVALID_TARGET_TYPE
 * 6. TARGET_DEAD
 * 7. OUT_OF_RANGE (manhattan > range)
 * 8. Lockpick on unlocked -> NOT_LOCKED
 * Computes push destination and blocked reason if ability has push.
 *
 * @param {object} s GameState
 * @param {{ caster_id: string, ability_id: string, target_id: string }} action
 * @param {object} [ctx]
 * @returns {{ ok: boolean, code?: string, message?: string, resolved?: object }}
 */
export function validateUseAbility(s, { caster_id, ability_id, target_id }, ctx = {}) {
  // 1. Actor guards
  const actorErr = checkActor(s, caster_id, ctx);
  if (actorErr) return actorErr;

  const actor = s.entities[caster_id];

  // 2. UNKNOWN_ABILITY / ABILITY_NOT_OWNED
  const ability = ABILITIES[ability_id];
  if (!ability) {
    return { ok: false, code: 'UNKNOWN_ABILITY', message: REJECT.UNKNOWN_ABILITY({ abilityId: ability_id }) };
  }

  if (!actor.abilities || !actor.abilities.includes(ability_id)) {
    return {
      ok: false,
      code: 'ABILITY_NOT_OWNED',
      message: REJECT.ABILITY_NOT_OWNED({ abilityId: ability_id, name: actor.name })
    };
  }

  // 3. NO_AP
  const apCost = ability.apCost ?? 1;
  if (actor.ap < apCost) {
    return { ok: false, code: 'NO_AP', message: REJECT.NO_AP(actor) };
  }

  // 4. Resolve target
  const resolvedTarget = resolveTarget(s, target_id);
  if (!resolvedTarget) {
    return { ok: false, code: 'UNKNOWN_TARGET', message: REJECT.UNKNOWN_TARGET({ targetId: target_id }) };
  }
  const target = resolvedTarget.ref;

  // 5. Type check
  if (ability.target === 'enemy') {
    if (resolvedTarget.kind !== 'entity' || !isHostile(actor, target)) {
      return { ok: false, code: 'INVALID_TARGET_TYPE', message: REJECT.INVALID_TARGET_TYPE() };
    }
  } else if (ability.target === 'ally') {
    if (resolvedTarget.kind !== 'entity' || isHostile(actor, target)) {
      return { ok: false, code: 'INVALID_TARGET_TYPE', message: REJECT.INVALID_TARGET_TYPE() };
    }
  } else if (ability.target === 'object') {
    if (resolvedTarget.kind !== 'object') {
      return { ok: false, code: 'INVALID_TARGET_TYPE', message: REJECT.INVALID_TARGET_TYPE() };
    }
  } else {
    return { ok: false, code: 'INVALID_TARGET_TYPE', message: REJECT.INVALID_TARGET_TYPE() };
  }

  // 6. TARGET_DEAD
  if (resolvedTarget.kind === 'entity') {
    if (!target.alive || (typeof target.hp === 'number' && target.hp <= 0)) {
      return { ok: false, code: 'TARGET_DEAD', message: REJECT.TARGET_DEAD(target) };
    }
  }

  // 7. OUT_OF_RANGE
  const dist = manhattan(actor.position.x, actor.position.y, target.position.x, target.position.y);
  const range = ability.range ?? 1;
  if (dist > range) {
    return { ok: false, code: 'OUT_OF_RANGE', message: REJECT.OUT_OF_RANGE({ range, distance: dist }) };
  }

  // 8. Lockpick on unlocked -> NOT_LOCKED
  if (ability.effect?.type === 'unlock') {
    if (!target.locked) {
      return { ok: false, code: 'NOT_LOCKED', message: REJECT.NOT_LOCKED(target) };
    }
  }

  // Push calculation
  let pushTo = null;
  let pushBlockedReason = null;
  if (ability.effect?.push) {
    const dx = Math.sign(target.position.x - actor.position.x);
    const dy = Math.sign(target.position.y - actor.position.y);
    const destX = target.position.x + dx;
    const destY = target.position.y + dy;

    if (!inBounds(s.map, destX, destY)) {
      pushBlockedReason = 'edge';
    } else if (isWallAt(s.map, destX, destY)) {
      pushBlockedReason = 'wall';
    } else if (getBlockerAt(s, destX, destY, { ignoreId: target.id })) {
      pushBlockedReason = 'occupied';
    } else {
      pushTo = { x: destX, y: destY };
    }
  }

  return {
    ok: true,
    resolved: {
      ability,
      target,
      targetKind: resolvedTarget.kind,
      distance: dist,
      pushTo,
      pushBlockedReason
    }
  };
}

/**
 * Validates use_item action (Task 3.1):
 * actor -> UNKNOWN_ITEM -> ITEM_NOT_IN_INVENTORY -> ITEM_NOT_USABLE -> NO_AP ->
 * target must be a living ally (INVALID_TARGET_TYPE) -> OUT_OF_RANGE (manhattan > range; self = 0).
 *
 * @param {object} s GameState
 * @param {{ character_id: string, item_id: string, target_id?: string }} action
 * @param {object} [ctx]
 * @returns {{ ok: boolean, code?: string, message?: string, resolved?: object }}
 */
export function validateUseItem(s, { character_id, item_id, target_id }, ctx = {}) {
  // 1. Actor guards
  const actorErr = checkActor(s, character_id, ctx);
  if (actorErr) return actorErr;

  const actor = s.entities[character_id];

  // 2. UNKNOWN_ITEM
  const item = ITEMS[item_id];
  if (!item) {
    return { ok: false, code: 'UNKNOWN_ITEM', message: REJECT.UNKNOWN_ITEM({ itemId: item_id }) };
  }

  // 3. ITEM_NOT_IN_INVENTORY
  const invSlot = (s.inventory || []).find(it => it.id === item_id);
  if (!invSlot || invSlot.qty < 1) {
    return { ok: false, code: 'ITEM_NOT_IN_INVENTORY', message: REJECT.ITEM_NOT_IN_INVENTORY({ itemId: item_id }) };
  }

  // 4. ITEM_NOT_USABLE
  if (!item.usable) {
    return { ok: false, code: 'ITEM_NOT_USABLE', message: REJECT.ITEM_NOT_USABLE({ itemId: item_id }) };
  }

  // 5. NO_AP
  if (actor.ap < 1) {
    return { ok: false, code: 'NO_AP', message: REJECT.NO_AP(actor) };
  }

  // 6. Target must be a living ally
  const targetId = target_id || character_id;
  const target = s?.entities?.[targetId];
  if (!target) {
    return { ok: false, code: 'UNKNOWN_TARGET', message: REJECT.UNKNOWN_TARGET({ targetId }) };
  }
  if (isHostile(actor, target)) {
    return { ok: false, code: 'INVALID_TARGET_TYPE', message: REJECT.INVALID_TARGET_TYPE() };
  }
  if (!target.alive || (typeof target.hp === 'number' && target.hp <= 0)) {
    return { ok: false, code: 'TARGET_DEAD', message: REJECT.TARGET_DEAD(target) };
  }

  // 7. OUT_OF_RANGE
  const dist = (actor.id === target.id) ? 0 : manhattan(actor.position.x, actor.position.y, target.position.x, target.position.y);
  const range = item.range ?? 1;
  if (dist > range) {
    return { ok: false, code: 'OUT_OF_RANGE', message: REJECT.OUT_OF_RANGE({ range, distance: dist }) };
  }

  return {
    ok: true,
    resolved: {
      item,
      target,
      distance: dist
    }
  };
}

/**
 * Validates interact_object action (Task 3.1):
 * actor -> UNKNOWN_OBJECT -> NO_AP -> NOT_ADJACENT -> OBJECT_LOCKED -> ALREADY_OPENED.
 *
 * @param {object} s GameState
 * @param {{ character_id: string, object_id: string }} action
 * @param {object} [ctx]
 * @returns {{ ok: boolean, code?: string, message?: string, resolved?: object }}
 */
export function validateInteract(s, { character_id, object_id }, ctx = {}) {
  // 1. Actor guards
  const actorErr = checkActor(s, character_id, ctx);
  if (actorErr) return actorErr;

  const actor = s.entities[character_id];

  // 2. UNKNOWN_OBJECT
  const obj = s?.objects?.[object_id];
  if (!obj) {
    return { ok: false, code: 'UNKNOWN_OBJECT', message: REJECT.UNKNOWN_OBJECT({ objectId: object_id }) };
  }

  // 3. NO_AP
  if (actor.ap < 1) {
    return { ok: false, code: 'NO_AP', message: REJECT.NO_AP(actor) };
  }

  // 4. NOT_ADJACENT
  const isDirectlyOnDoor = (obj.type === 'door' || obj.id === 'exit_door') &&
    actor.position.x === obj.position.x && actor.position.y === obj.position.y;
  if (!isAdjacent(actor.position, obj.position) && !isDirectlyOnDoor) {
    return { ok: false, code: 'NOT_ADJACENT', message: REJECT.NOT_ADJACENT() };
  }

  // 5. OBJECT_LOCKED
  if (obj.locked) {
    return { ok: false, code: 'OBJECT_LOCKED', message: REJECT.OBJECT_LOCKED() };
  }

  // 6. ALREADY_OPENED
  if (obj.opened && obj.type !== 'door') {
    return { ok: false, code: 'ALREADY_OPENED', message: REJECT.ALREADY_OPENED() };
  }

  return {
    ok: true,
    resolved: {
      object: obj
    }
  };
}

/**
 * Validates check_inventory action (actor guards only).
 * @param {object} s GameState
 * @param {{ character_id: string }} action
 * @param {object} [ctx]
 * @returns {{ ok: boolean, code?: string, message?: string, resolved?: object }}
 */
export function validateCheckInventory(s, { character_id }, ctx = {}) {
  const actorErr = checkActor(s, character_id, ctx);
  if (actorErr) return actorErr;
  return { ok: true, resolved: {} };
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
 * Alias for backward compatibility with Sprint 1 tests.
 */
export const validateUseAbilityBasic = validateUseAbility;

/**
 * Translates validation result into a formatted PT-BR explanation sentence.
 * @param {{ ok: boolean, code?: string, message?: string }} result
 * @returns {string}
 */
export function explain(result) {
  if (!result) return 'Resultado indefinido.';
  if (result.ok) return 'Ação válida.';
  if (result.message) return result.message;
  if (result.code && REJECT[result.code]) return REJECT[result.code]();
  return 'Ação inválida.';
}
