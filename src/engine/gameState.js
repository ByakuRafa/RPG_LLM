/**
 * Game state: factory, pure selectors, reducers, and store.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { CONFIG, PHASE } from '../core/config.js';
import { hashString } from '../core/prng.js';
import { CLASSES, ABILITIES, ITEMS, HERO_ROSTER } from './catalog.js';
import { generateDungeon } from './mapGenerator.js';

/**
 * Creates an entity by merging spec with class definitions.
 * @param {object} spec
 * @returns {object} Entity
 */
export function createEntity(spec) {
  const cls = CLASSES[spec.classId] || {};
  const maxHp = spec.maxHp ?? cls.maxHp ?? 10;
  const maxMp = spec.maxMp ?? cls.maxMp ?? 0;
  const maxAp = spec.maxAp ?? cls.maxAp ?? 1;

  return {
    id: spec.id,
    name: spec.name ?? cls.label ?? spec.id,
    role: spec.role ?? (spec.classId === 'goblin' ? 'enemy' : 'player'),
    classId: spec.classId,
    player: spec.player ?? null,
    color: spec.color ?? cls.color ?? '#FFFFFF',
    initial: spec.initial ?? cls.initial ?? '?',
    tokenUrl: spec.tokenUrl ?? null,
    position: {
      x: spec.position?.x ?? spec.x ?? 0,
      y: spec.position?.y ?? spec.y ?? 0
    },
    hp: spec.hp ?? maxHp,
    maxHp,
    mp: spec.mp ?? maxMp,
    maxMp,
    ap: spec.ap ?? maxAp,
    maxAp,
    abilities: spec.abilities ? [...spec.abilities] : [...(cls.abilities || [])],
    alive: spec.alive ?? true
  };
}

/**
 * Creates initial game state for a given seed.
 * @param {string} [seed=CONFIG.DEFAULT_SEED]
 * @returns {object} Initial GameState
 */
export function createInitialState(seed = CONFIG.DEFAULT_SEED) {
  const dungeon = generateDungeon(seed);
  const entities = {};

  // Heroes from HERO_ROSTER + dungeon hero spawns
  for (const hero of HERO_ROSTER) {
    const spawnPos = dungeon.spawns.heroes[hero.id] || { x: 2, y: 10 };
    entities[hero.id] = createEntity({
      ...hero,
      role: 'player',
      position: { x: spawnPos.x, y: spawnPos.y }
    });
  }

  // Goblins from dungeon enemy spawns + CLASSES.goblin
  const enemySpawns = dungeon.spawns.enemies || [];
  for (let i = 0; i < enemySpawns.length; i++) {
    const spawn = enemySpawns[i];
    entities[spawn.id] = createEntity({
      id: spawn.id,
      name: `Goblin ${i + 1}`,
      classId: 'goblin',
      role: 'enemy',
      position: { x: spawn.x, y: spawn.y }
    });
  }

  // Objects dictionary
  const objects = {};
  const objList = Array.isArray(dungeon.objects) ? dungeon.objects : Object.values(dungeon.objects || {});
  for (const obj of objList) {
    objects[obj.id] = {
      ...obj,
      position: { ...obj.position },
      loot: obj.loot ? obj.loot.map(l => ({ ...l })) : []
    };
  }

  return {
    version: 1,
    seed,
    status: 'playing',
    phase: PHASE.HERO,
    round: 1,
    turnIndex: 0,
    activeId: 'hero_warrior',
    map: dungeon.map,
    entities,
    objects,
    inventory: [{ id: 'health_potion', qty: 2 }],
    seq: 0
  };
}

/**
 * Deep clones state safely using structuredClone.
 * @param {object} s
 * @returns {object}
 */
export function cloneState(s) {
  return structuredClone(s);
}

/**
 * Computes deterministic hash of state.
 * @param {object} s
 * @returns {string} 8 hex characters
 */
export function stateHash(s) {
  return hashString(JSON.stringify(s));
}

// Pure Selectors
export function getEntity(s, id) {
  return s?.entities?.[id] || null;
}

export function getActive(s) {
  return s?.entities?.[s?.activeId] || null;
}

export function getAliveHeroes(s) {
  if (!s || !s.entities) return [];
  return Object.values(s.entities).filter(e => e.role === 'player' && e.alive);
}

export function getAliveEnemies(s) {
  if (!s || !s.entities) return [];
  return Object.values(s.entities).filter(e => e.role === 'enemy' && e.alive);
}

export function getEntityAt(s, x, y) {
  if (!s || !s.entities) return null;
  return Object.values(s.entities).find(e => e.alive && e.position?.x === x && e.position?.y === y) || null;
}

export function getObject(s, id) {
  return s?.objects?.[id] || null;
}

/**
 * Evaluates whether the game is won, lost, or still playing.
 * @param {object} s GameState
 * @returns {'won' | 'lost' | null}
 */
export function evaluateGameOver(s) {
  const aliveHeroes = getAliveHeroes(s);
  const aliveEnemies = getAliveEnemies(s);

  if (aliveEnemies.length === 0) {
    return 'won';
  }
  if (aliveHeroes.length === 0) {
    return 'lost';
  }
  return null;
}

// Reducers
/**
 * Applies movement to an entity. Never mutates input state.
 * @param {object} s
 * @param {string} id
 * @param {{ x: number, y: number }} to
 * @param {number} cost
 * @returns {{ state: object, events: object[] }}
 */
export function applyMove(s, id, to, cost) {
  const next = cloneState(s);
  const e = next.entities[id];
  const from = { ...e.position };
  e.position = { x: to.x, y: to.y };
  e.mp = Math.max(0, e.mp - cost);

  const events = [{
    type: 'move',
    id,
    from,
    to: { x: to.x, y: to.y },
    cost
  }];

  return { state: next, events };
}

/**
 * Applies damage to an entity, checking for death and game-over conditions.
 * @param {object} s GameState
 * @param {string} targetId
 * @param {number} amount
 * @param {{ sourceId?: string, abilityId?: string }} [meta]
 * @returns {{ state: object, events: object[] }}
 */
export function applyDamage(s, targetId, amount, meta = {}) {
  const next = cloneState(s);
  const target = next.entities?.[targetId];
  if (!target) return { state: next, events: [] };

  const dmg = Math.max(0, amount);
  target.hp = Math.max(0, target.hp - dmg);

  const events = [{
    type: 'damage',
    id: targetId,
    sourceId: meta.sourceId || null,
    abilityId: meta.abilityId || null,
    amount: dmg,
    hp: target.hp
  }];

  if (target.hp === 0 && target.alive) {
    target.alive = false;
    events.push({ type: 'death', id: targetId });

    const outcome = evaluateGameOver(next);
    if (outcome) {
      next.status = outcome;
      next.phase = PHASE.GAME_OVER;
      next.gameOver = true;
      events.push({ type: 'game_over', status: outcome, result: outcome });
    }
  }

  return { state: next, events };
}

/**
 * Applies healing to an entity, clamped at maxHp. Emits effective amount healed.
 * @param {object} s GameState
 * @param {string} targetId
 * @param {number} amount
 * @param {{ sourceId?: string, via?: string }} [meta]
 * @returns {{ state: object, events: object[] }}
 */
export function applyHeal(s, targetId, amount, meta = {}) {
  const next = cloneState(s);
  const target = next.entities?.[targetId];
  if (!target) return { state: next, events: [] };

  const healAmt = Math.max(0, amount);
  const oldHp = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + healAmt);
  const effective = target.hp - oldHp;

  const events = [{
    type: 'heal',
    id: targetId,
    sourceId: meta.sourceId || null,
    via: meta.via || 'heal_pulse',
    amount: effective,
    hp: target.hp
  }];

  return { state: next, events };
}

/**
 * Applies ability usage (damage, heal, unlock, push).
 * @param {object} s GameState
 * @param {{ caster_id: string, ability_id: string, target_id: string }} action
 * @param {object} [resolved]
 * @returns {{ state: object, events: object[] }}
 */
export function applyAbility(s, { caster_id, ability_id, target_id }, resolved = {}) {
  const next = cloneState(s);
  const caster = next.entities?.[caster_id];
  const ability = resolved.ability || ABILITIES[ability_id];
  const apCost = ability?.apCost ?? 1;

  if (caster) {
    caster.ap = Math.max(0, caster.ap - apCost);
  }

  const events = [];
  const effect = ability?.effect || {};

  if (effect.type === 'damage') {
    const target = next.entities?.[target_id];
    if (target) {
      const dmg = Math.max(0, effect.amount ?? 0);
      target.hp = Math.max(0, target.hp - dmg);

      events.push({
        type: 'damage',
        id: target_id,
        sourceId: caster_id,
        abilityId: ability_id,
        amount: dmg,
        hp: target.hp
      });

      if (target.hp === 0 && target.alive) {
        target.alive = false;
        events.push({ type: 'death', id: target_id });

        const outcome = evaluateGameOver(next);
        if (outcome) {
          next.status = outcome;
          next.phase = PHASE.GAME_OVER;
          next.gameOver = true;
          events.push({ type: 'game_over', status: outcome, result: outcome });
        }
      }

      // Push handling
      if (effect.push) {
        if (resolved.pushTo) {
          const fromPos = { ...target.position };
          target.position = { x: resolved.pushTo.x, y: resolved.pushTo.y };
          events.push({
            type: 'push',
            id: target_id,
            from: fromPos,
            to: { x: target.position.x, y: target.position.y }
          });
        } else if (resolved.pushBlockedReason) {
          events.push({
            type: 'push_blocked',
            id: target_id,
            reason: resolved.pushBlockedReason
          });
        }
      }
    }
  } else if (effect.type === 'heal') {
    const target = next.entities?.[target_id];
    if (target) {
      const healAmt = Math.max(0, effect.amount ?? 0);
      const oldHp = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + healAmt);
      const effective = target.hp - oldHp;

      events.push({
        type: 'heal',
        id: target_id,
        sourceId: caster_id,
        via: ability_id,
        amount: effective,
        hp: target.hp
      });
    }
  } else if (effect.type === 'unlock') {
    const obj = next.objects?.[target_id];
    if (obj) {
      obj.locked = false;
      events.push({
        type: 'unlocked',
        objectId: target_id,
        byId: caster_id
      });
    }
  }

  return { state: next, events };
}

/**
 * Applies use_item action (AP cost, decrement stack, apply item effect).
 * @param {object} s GameState
 * @param {{ character_id: string, item_id: string, target_id?: string }} action
 * @param {object} [resolved]
 * @returns {{ state: object, events: object[] }}
 */
export function applyUseItem(s, { character_id, item_id, target_id }, resolved = {}) {
  const next = cloneState(s);
  const targetId = target_id || character_id;
  const actor = next.entities?.[character_id];
  const target = next.entities?.[targetId];
  const item = resolved.item || ITEMS[item_id];

  if (actor) {
    actor.ap = Math.max(0, actor.ap - 1);
  }

  // Decrement stack in inventory
  if (Array.isArray(next.inventory)) {
    const idx = next.inventory.findIndex(it => it.id === item_id);
    if (idx !== -1) {
      next.inventory[idx].qty -= 1;
      if (next.inventory[idx].qty <= 0) {
        next.inventory.splice(idx, 1);
      }
    }
  }

  const events = [{
    type: 'item_used',
    itemId: item_id,
    byId: character_id,
    targetId
  }];

  if (item?.effect?.type === 'heal' && target) {
    const healAmt = Math.max(0, item.effect.amount ?? 0);
    const oldHp = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + healAmt);
    const effective = target.hp - oldHp;

    events.push({
      type: 'heal',
      id: targetId,
      sourceId: character_id,
      via: item_id,
      amount: effective,
      hp: target.hp
    });
  }

  return { state: next, events };
}

/**
 * Applies interact_object action (AP cost, opened = true, loot merged into inventory).
 * @param {object} s GameState
 * @param {{ character_id: string, object_id: string }} action
 * @param {object} [resolved]
 * @returns {{ state: object, events: object[] }}
 */
export function applyInteract(s, { character_id, object_id }, resolved = {}) {
  const next = cloneState(s);
  const actor = next.entities?.[character_id];
  const obj = next.objects?.[object_id];

  if (actor) {
    actor.ap = Math.max(0, actor.ap - 1);
  }

  const events = [];

  if (obj) {
    obj.opened = true;
    if (obj.blocksMovement !== undefined) {
      obj.blocksMovement = false;
    }

    const loot = obj.loot ? obj.loot.map(l => ({ ...l })) : [];
    if (!Array.isArray(next.inventory)) {
      next.inventory = [];
    }

    for (const item of loot) {
      const existing = next.inventory.find(i => i.id === item.id);
      if (existing) {
        existing.qty += item.qty;
      } else {
        next.inventory.push({ id: item.id, qty: item.qty });
      }
    }

    obj.loot = [];

    events.push({
      type: 'chest_opened',
      objectId: object_id,
      byId: character_id,
      loot
    });
  }

  return { state: next, events };
}

/**
 * Applies check_inventory action (no state change, emits inventory event).
 * @param {object} s GameState
 * @param {{ character_id: string }} action
 * @returns {{ state: object, events: object[] }}
 */
export function applyCheckInventory(s, { character_id }) {
  const next = cloneState(s);
  const events = [{
    type: 'inventory',
    byId: character_id,
    items: Array.isArray(next.inventory) ? next.inventory.map(i => ({ ...i })) : []
  }];

  return { state: next, events };
}

/**
 * Applies basic ability use (backward compatibility with Sprint 1).
 * @param {object} s
 * @param {{ caster_id: string, ability_id: string, target_id: string }} action
 * @returns {{ state: object, events: object[] }}
 */
export function applyAbilityBasic(s, action) {
  return applyAbility(s, action);
}

/**
 * Applies end turn request. Emits end_turn_requested without state field changes.
 * @param {object} s
 * @param {{ character_id: string }} action
 * @returns {{ state: object, events: object[] }}
 */
export function applyEndTurn(s, { character_id }) {
  return {
    state: cloneState(s),
    events: [{ type: 'end_turn_requested', id: character_id }]
  };
}

/**
 * Creates state store with pub/sub emission.
 * @param {object} initial Initial state
 * @param {object} bus Event bus
 * @returns {{ getState: () => object, commit: (next: object, events?: object[]) => void, reset: (snapshot: object) => void }}
 */
export function createStore(initial, bus) {
  let state = initial;
  return {
    getState: () => state,
    commit(next, events = []) {
      state = { ...next, seq: (state.seq || 0) + 1 };
      bus?.emit('state:changed', { state, events });
    },
    reset(snapshot) {
      state = cloneState(snapshot);
      bus?.emit('state:changed', { state, events: [{ type: 'reset' }] });
    }
  };
}
