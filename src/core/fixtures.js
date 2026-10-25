/**
 * Test and GM panel fixtures for Sprint 1, 2, 3, and 4.
 * Deterministic test states, benchmark snapshots, and tool call fixtures.
 */
import { CONFIG, TILE } from './config.js';
import { createInitialState, cloneState } from '../engine/gameState.js';

export const FIXTURES = Object.freeze({
  'LLM · mover+atacar': Object.freeze({
    narrative: 'Thorin avança com bravura pelo corredor e atinge o goblin com sua espada afiada.',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_warrior', target_x: 2, target_y: 8 })
      }),
      Object.freeze({
        name: 'use_ability',
        arguments: Object.freeze({ caster_id: 'hero_warrior', ability_id: 'slash', target_id: 'goblin_1' })
      })
    ])
  }),
  'LLM · andar 10 casas': Object.freeze({
    narrative: 'Thorin tenta correr 10 casas direto até o fim da masmorra.',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_warrior', target_x: 2, target_y: 1 })
      })
    ])
  }),
  'LLM · recusa': Object.freeze({
    narrative: 'Não é possível voar ou atravessar paredes de pedra sólida nesta masmorra.',
    tool_calls: Object.freeze([])
  }),
  'S1 · Mover Guerreiro 3 casas': Object.freeze({
    source: 'HUMAN_GM',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_warrior', target_x: 2, target_y: 7 })
      })
    ])
  }),
  'S1 · Mover para parede': Object.freeze({
    source: 'HUMAN_GM',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_warrior', target_x: 0, target_y: 10 })
      })
    ])
  }),
  'S1 · Fora da vez (Mago)': Object.freeze({
    source: 'HUMAN_GM',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_mage', target_x: 1, target_y: 9 })
      })
    ])
  }),
  'S1 · Mover + Encerrar': Object.freeze({
    source: 'HUMAN_GM',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_warrior', target_x: 2, target_y: 8 })
      }),
      Object.freeze({
        name: 'end_turn',
        arguments: Object.freeze({ character_id: 'hero_warrior' })
      })
    ])
  }),
  'S1 · Tool desconhecida': Object.freeze({
    source: 'HUMAN_GM',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'teleport',
        arguments: Object.freeze({})
      })
    ])
  })
});

/**
 * Applies dotted-path modifications to a cloned state.
 * Example: patch(state, { 'entities.goblin_1.position': { x: 3, y: 9 } })
 *
 * @param {object} state Base state
 * @param {Record<string, any>} patches Dotted-path key-value pairs
 * @returns {object} Deep clone with patches applied
 */
export function patch(state, patches) {
  const clone = cloneState(state);
  for (const [dotPath, value] of Object.entries(patches)) {
    const parts = dotPath.split('.');
    let curr = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (curr[part] === undefined || curr[part] === null) {
        curr[part] = {};
      }
      curr = curr[part];
    }
    const lastKey = parts[parts.length - 1];
    curr[lastKey] = value;
  }
  return clone;
}

/**
 * Validates that all entities and blocking objects in state occupy legal positions:
 * - Within grid boundaries [0, width) and [0, height)
 * - On a walkable floor tile (not a wall)
 * - No two entities or blocking objects share the same tile (no collisions)
 *
 * Throws an Error if any invariant is violated.
 *
 * @param {object} state
 * @returns {boolean} true if valid
 */
export function assertValidPositions(state) {
  if (!state || !state.map) {
    throw new Error('Estado inválido: mapa ausente.');
  }

  const { width, height, tiles } = state.map;
  const occupied = new Map();

  // Validate objects
  if (state.objects) {
    const objList = Array.isArray(state.objects) ? state.objects : Object.values(state.objects);
    for (const obj of objList) {
      if (!obj || !obj.position) continue;
      const { x, y } = obj.position;
      if (x < 0 || x >= width || y < 0 || y >= height) {
        throw new Error(`Objeto "${obj.id}" fora dos limites do mapa: (${x}, ${y})`);
      }
      if (tiles[y][x] === TILE.WALL) {
        throw new Error(`Objeto "${obj.id}" posicionado sobre parede: (${x}, ${y})`);
      }
      if (obj.blocksMovement) {
        const k = `${x},${y}`;
        if (occupied.has(k)) {
          throw new Error(`Colisão na posição (${x}, ${y}) entre "${occupied.get(k)}" e objeto "${obj.id}".`);
        }
        occupied.set(k, `objeto:${obj.id}`);
      }
    }
  }

  // Validate entities
  if (state.entities) {
    const entList = Array.isArray(state.entities) ? state.entities : Object.values(state.entities);
    for (const ent of entList) {
      if (!ent || !ent.alive || !ent.position) continue;
      const { x, y } = ent.position;
      if (x < 0 || x >= width || y < 0 || y >= height) {
        throw new Error(`Entidade "${ent.id}" fora dos limites do mapa: (${x}, ${y})`);
      }
      if (tiles[y][x] === TILE.WALL) {
        throw new Error(`Entidade "${ent.id}" posicionada sobre parede: (${x}, ${y})`);
      }
      const k = `${x},${y}`;
      if (occupied.has(k)) {
        throw new Error(`Colisão na posição (${x}, ${y}) entre "${occupied.get(k)}" e entidade "${ent.id}".`);
      }
      occupied.set(k, `entidade:${ent.id}`);
    }
  }

  return true;
}

/**
 * Named benchmark snapshot transformations (Sprint 4 §2.1).
 */
export const SNAPSHOTS = Object.freeze({
  default: s => s,
  warrior_near_goblin: s => patch(s, { 'entities.goblin_1.position': { x: 3, y: 9 } }),
  mage_wounded: s => patch(s, { 'entities.hero_mage.hp': 6, activeId: 'hero_mage', turnIndex: 1 }),
  rogue_next_to_chest2: s => patch(s, { 'entities.hero_rogue.position': { x: 3, y: 3 }, activeId: 'hero_rogue', turnIndex: 2 }),
  warrior_no_ap: s => patch(s, { 'entities.hero_warrior.ap': 0 })
});

/**
 * Builds a validated game state snapshot by name and seed.
 * createInitialState(seed) -> SNAPSHOTS[name](clone) -> assertValidPositions -> state
 *
 * @param {string} name Snapshot name from SNAPSHOTS
 * @param {string} [seed=CONFIG.DEFAULT_SEED] Seed for map generation
 * @returns {object} Validated state snapshot
 */
export function buildSnapshot(name, seed = CONFIG.DEFAULT_SEED) {
  const transform = SNAPSHOTS[name];
  if (!transform) {
    throw new Error(`Snapshot desconhecido: "${name}"`);
  }
  const baseState = createInitialState(seed);
  const cloned = cloneState(baseState);
  const state = transform(cloned);
  assertValidPositions(state);
  return state;
}

/**
 * Helper to activate a specific hero in a snapshot.
 * Sets phase = 'HERO', activeId, turnIndex, and restores MP/AP unless the snapshot overrode them.
 *
 * @param {object} state
 * @param {string} activeId
 * @returns {object} State with active hero configured
 */
export function withActive(state, activeId) {
  const cloned = cloneState(state);
  cloned.phase = 'HERO';
  cloned.activeId = activeId;
  const turnOrder = ['hero_warrior', 'hero_mage', 'hero_rogue'];
  const idx = turnOrder.indexOf(activeId);
  if (idx >= 0) {
    cloned.turnIndex = idx;
  }
  const hero = cloned.entities?.[activeId];
  if (hero) {
    if (hero.mp === undefined || hero.mp === null) {
      hero.mp = hero.maxMp ?? 4;
    }
    if (hero.ap === undefined || hero.ap === null) {
      hero.ap = hero.maxAp ?? 1;
    }
  }
  return cloned;
}
