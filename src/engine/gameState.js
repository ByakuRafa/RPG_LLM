/**
 * Game state: factory, pure selectors, reducers, and store.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { CONFIG, PHASE } from '../core/config.js';
import { hashString } from '../core/prng.js';
import { CLASSES, ABILITIES, HERO_ROSTER } from './catalog.js';
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
 * Applies basic ability use (damage). Never mutates input state.
 * @param {object} s
 * @param {{ caster_id: string, ability_id: string, target_id: string }} action
 * @returns {{ state: object, events: object[] }}
 */
export function applyAbilityBasic(s, { caster_id, ability_id, target_id }) {
  const next = cloneState(s);
  const caster = next.entities[caster_id];
  const ability = ABILITIES[ability_id];
  const target = next.entities[target_id];

  const apCost = ability?.apCost ?? 1;
  if (caster) {
    caster.ap = Math.max(0, caster.ap - apCost);
  }

  const damage = ability?.effect?.amount ?? 0;
  if (target) {
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp === 0) {
      target.alive = false;
    }
  }

  const events = [{
    type: 'damage',
    id: target_id,
    sourceId: caster_id,
    abilityId: ability_id,
    amount: damage,
    hp: target ? target.hp : 0
  }];

  return { state: next, events };
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
