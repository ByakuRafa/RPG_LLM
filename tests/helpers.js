/**
 * Test helpers: deterministic state creation from ASCII diagrams.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { TILE, PHASE } from '../src/core/config.js';
import { createEntity } from '../src/engine/gameState.js';

/**
 * Builds a deterministic game state from an array of ASCII strings.
 * Symbols:
 *   '#' -> Wall
 *   '.' -> Floor
 *   'W' -> Warrior (hero_warrior, Thorin)
 *   'M' -> Mage (hero_mage, Lyra)
 *   'R' -> Rogue (hero_rogue, Vex)
 *   'G' -> Goblin (goblin_1, goblin_2, ...)
 *   'C' -> Unlocked Chest (chest_1, ...)
 *   'L' -> Locked Chest (chest_1, ...)
 *
 * @param {string[]|string} asciiRows
 * @param {object} [overrides]
 * @returns {object} GameState
 */
export function makeTestState(asciiRows, overrides = {}) {
  const rows = Array.isArray(asciiRows)
    ? asciiRows
    : asciiRows.trim().split('\n').map(r => r.trim());

  const height = rows.length;
  const width = rows[0] ? rows[0].length : 0;

  const tiles = Array.from({ length: height }, () => Array(width).fill(TILE.FLOOR));
  const entities = {};
  const objects = {};

  let goblinCount = 0;
  let chestCount = 0;

  for (let y = 0; y < height; y++) {
    const row = rows[y];
    for (let x = 0; x < width; x++) {
      const char = row[x];

      if (char === '#') {
        tiles[y][x] = TILE.WALL;
        continue;
      }

      tiles[y][x] = TILE.FLOOR;

      if (char === 'W') {
        entities['hero_warrior'] = createEntity({
          id: 'hero_warrior',
          name: 'Thorin',
          classId: 'warrior',
          player: 1,
          position: { x, y }
        });
      } else if (char === 'M') {
        entities['hero_mage'] = createEntity({
          id: 'hero_mage',
          name: 'Lyra',
          classId: 'mage',
          player: 2,
          position: { x, y }
        });
      } else if (char === 'R') {
        entities['hero_rogue'] = createEntity({
          id: 'hero_rogue',
          name: 'Vex',
          classId: 'rogue',
          player: 3,
          position: { x, y }
        });
      } else if (char === 'G') {
        goblinCount++;
        const id = `goblin_${goblinCount}`;
        entities[id] = createEntity({
          id,
          name: `Goblin ${goblinCount}`,
          classId: 'goblin',
          role: 'enemy',
          position: { x, y }
        });
      } else if (char === 'C') {
        chestCount++;
        const id = `chest_${chestCount}`;
        objects[id] = {
          id,
          type: 'chest',
          label: 'Baú',
          position: { x, y },
          locked: false,
          opened: false,
          blocksMovement: true,
          items: [{ id: 'health_potion', qty: 1 }],
          loot: [{ id: 'health_potion', qty: 1 }]
        };
      } else if (char === 'L') {
        chestCount++;
        const id = `chest_${chestCount}`;
        objects[id] = {
          id,
          type: 'chest',
          label: 'Baú Trancado',
          position: { x, y },
          locked: true,
          opened: false,
          blocksMovement: true,
          items: [{ id: 'health_potion', qty: 1 }, { id: 'gold_coins', qty: 25 }],
          loot: [{ id: 'health_potion', qty: 1 }, { id: 'gold_coins', qty: 25 }]
        };
      }
    }
  }

  const baseState = {
    map: {
      width,
      height,
      tiles,
      hash: 'test_state_hash'
    },
    objects,
    entities,
    inventory: [{ id: 'health_potion', qty: 2 }],
    phase: PHASE.HERO,
    round: 1,
    turnIndex: 0,
    activeId: 'hero_warrior',
    seq: 0,
    config: {
      MOVEMENT_MODE: 'BFS'
    }
  };

  return {
    ...baseState,
    ...overrides,
    map: {
      ...baseState.map,
      ...(overrides.map || {})
    },
    entities: {
      ...baseState.entities,
      ...(overrides.entities || {})
    },
    objects: {
      ...baseState.objects,
      ...(overrides.objects || {})
    }
  };
}
