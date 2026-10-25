/**
 * Seeded 12x12 dungeon generator and ASCII serializer.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { CONFIG, TILE } from '../core/config.js';
import { createRng, hashString } from '../core/prng.js';
import { DIRS4, key, computeDistanceField } from './pathfinding.js';

export const SPAWNS = Object.freeze({
  heroes: Object.freeze({
    hero_warrior: Object.freeze({ x: 2, y: 10 }),
    hero_mage:    Object.freeze({ x: 1, y: 10 }),
    hero_rogue:   Object.freeze({ x: 3, y: 10 })
  }),
  enemies: Object.freeze([
    Object.freeze({ id: 'goblin_1', x: 9, y: 2 }),
    Object.freeze({ id: 'goblin_2', x: 10, y: 4 }),
    Object.freeze({ id: 'goblin_3', x: 8, y: 6 })
  ])
});

function createFallbackLayout() {
  const tiles = Array.from({ length: CONFIG.GRID_H }, () => Array(CONFIG.GRID_W).fill(TILE.FLOOR));
  for (let y = 0; y < CONFIG.GRID_H; y++) {
    for (let x = 0; x < CONFIG.GRID_W; x++) {
      if (x === 0 || x === CONFIG.GRID_W - 1 || y === 0 || y === CONFIG.GRID_H - 1) {
        tiles[y][x] = TILE.WALL;
      }
    }
  }

  const objects = [
    {
      id: 'chest_1',
      type: 'chest',
      label: 'Baú',
      position: { x: 5, y: 5 },
      locked: false,
      opened: false,
      blocksMovement: true,
      loot: [{ id: 'health_potion', qty: 1 }]
    },
    {
      id: 'chest_2',
      type: 'chest',
      label: 'Baú Trancado',
      position: { x: 3, y: 2 },
      locked: true,
      opened: false,
      blocksMovement: true,
      loot: [
        { id: 'health_potion', qty: 1 },
        { id: 'gold_coins', qty: 25 }
      ]
    }
  ];

  return { tiles, objects };
}

function validateConnectivity(tiles, objects, spawns) {
  const map = { width: CONFIG.GRID_W, height: CONFIG.GRID_H, tiles };
  const warriorSpawn = spawns.heroes.hero_warrior;
  const distField = computeDistanceField({ map, objects }, warriorSpawn, { ignoreUnits: true });

  // 1. Must reach warrior spawn itself
  if (!distField.has(key(warriorSpawn.x, warriorSpawn.y))) return false;

  // 2. Must reach every hero spawn
  for (const hero of Object.values(spawns.heroes)) {
    if (!distField.has(key(hero.x, hero.y))) return false;
  }

  // 3. Must reach every goblin spawn
  for (const enemy of spawns.enemies) {
    if (!distField.has(key(enemy.x, enemy.y))) return false;
  }

  // 4. Must reach at least one orthogonal neighbour of each chest
  const objList = Array.isArray(objects) ? objects : Object.values(objects || {});
  for (const obj of objList) {
    if (obj.type === 'chest') {
      let reachedNeighbour = false;
      for (const [dx, dy] of DIRS4) {
        const nx = obj.position.x + dx;
        const ny = obj.position.y + dy;
        if (distField.has(key(nx, ny))) {
          reachedNeighbour = true;
          break;
        }
      }
      if (!reachedNeighbour) return false;
    }
  }

  return true;
}

/**
 * Generates a procedural 12x12 dungeon from seed.
 * @param {string} [seed=CONFIG.DEFAULT_SEED]
 * @returns {{
 *   map: { seed: string, width: number, height: number, tiles: number[][], hash: string },
 *   objects: object[],
 *   spawns: typeof SPAWNS
 * }}
 */
export function generateDungeon(seed = CONFIG.DEFAULT_SEED) {
  const rng = createRng(seed);
  let finalTiles = null;
  let finalObjects = null;

  for (let attempt = 0; attempt < 50; attempt++) {
    const tiles = Array.from({ length: CONFIG.GRID_H }, () => Array(CONFIG.GRID_W).fill(TILE.FLOOR));

    // Set border to TILE.WALL
    for (let y = 0; y < CONFIG.GRID_H; y++) {
      for (let x = 0; x < CONFIG.GRID_W; x++) {
        if (x === 0 || x === CONFIG.GRID_W - 1 || y === 0 || y === CONFIG.GRID_H - 1) {
          tiles[y][x] = TILE.WALL;
        }
      }
    }

    // Reserved spawn tiles + radius-1 ring around hero spawns
    const reserved = new Set();
    for (const hero of Object.values(SPAWNS.heroes)) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const rx = hero.x + dx;
          const ry = hero.y + dy;
          if (rx >= 0 && rx < CONFIG.GRID_W && ry >= 0 && ry < CONFIG.GRID_H) {
            reserved.add(key(rx, ry));
          }
        }
      }
    }
    for (const enemy of SPAWNS.enemies) {
      reserved.add(key(enemy.x, enemy.y));
    }

    // 6 wall segments
    for (let s = 0; s < 6; s++) {
      const startX = rng.int(2, 9);
      const startY = rng.int(2, 9);
      const isHorizontal = rng.chance(0.5);
      const length = rng.int(2, 4);

      for (let step = 0; step < length; step++) {
        const wx = isHorizontal ? startX + step : startX;
        const wy = isHorizontal ? startY : startY + step;
        if (wx >= 1 && wx < CONFIG.GRID_W - 1 && wy >= 1 && wy < CONFIG.GRID_H - 1) {
          if (!reserved.has(key(wx, wy))) {
            tiles[wy][wx] = TILE.WALL;
          }
        }
      }
    }

    // Chest 1: unlocked, health_potion x1 in rows 4..7
    const c1Candidates = [];
    for (let y = 4; y <= 7; y++) {
      for (let x = 1; x < CONFIG.GRID_W - 1; x++) {
        if (tiles[y][x] === TILE.FLOOR && !reserved.has(key(x, y))) {
          c1Candidates.push({ x, y });
        }
      }
    }
    if (c1Candidates.length === 0) continue;
    const c1Pos = rng.pick(c1Candidates);
    const chest1 = {
      id: 'chest_1',
      type: 'chest',
      label: 'Baú',
      position: { x: c1Pos.x, y: c1Pos.y },
      locked: false,
      opened: false,
      blocksMovement: true,
      loot: [{ id: 'health_potion', qty: 1 }]
    };
    reserved.add(key(c1Pos.x, c1Pos.y));

    // Chest 2: locked, health_potion x1 + gold_coins x25 in top-left quadrant x 1..5, y 1..4
    const c2Candidates = [];
    for (let y = 1; y <= 4; y++) {
      for (let x = 1; x <= 5; x++) {
        if (tiles[y][x] === TILE.FLOOR && !reserved.has(key(x, y))) {
          c2Candidates.push({ x, y });
        }
      }
    }
    if (c2Candidates.length === 0) continue;
    const c2Pos = rng.pick(c2Candidates);
    const chest2 = {
      id: 'chest_2',
      type: 'chest',
      label: 'Baú Trancado',
      position: { x: c2Pos.x, y: c2Pos.y },
      locked: true,
      opened: false,
      blocksMovement: true,
      loot: [
        { id: 'health_potion', qty: 1 },
        { id: 'gold_coins', qty: 25 }
      ]
    };

    const objects = [chest1, chest2];
    if (validateConnectivity(tiles, objects, SPAWNS)) {
      finalTiles = tiles;
      finalObjects = objects;
      break;
    }
  }

  if (!finalTiles) {
    const fallback = createFallbackLayout();
    finalTiles = fallback.tiles;
    finalObjects = fallback.objects;
  }

  const mapHash = hashString(JSON.stringify(finalTiles) + JSON.stringify(finalObjects));
  const map = {
    seed,
    width: CONFIG.GRID_W,
    height: CONFIG.GRID_H,
    tiles: finalTiles,
    hash: mapHash
  };

  return {
    map,
    objects: finalObjects,
    spawns: SPAWNS
  };
}

/**
 * Returns ASCII representation of the map and optional entities/objects.
 * Rows like "#..W.....G.#" (# wall, . floor, C chest, L locked chest, W/M/R/G units).
 * @param {object} mapOrState
 * @param {object} [state=null]
 * @returns {string[]}
 */
export function toAscii(mapOrState, state = null) {
  let map = mapOrState;
  let s = state;

  if (mapOrState && mapOrState.map && !mapOrState.tiles) {
    map = mapOrState.map;
    s = s || mapOrState;
  }

  const rows = [];
  const height = map?.height ?? CONFIG.GRID_H;
  const width = map?.width ?? CONFIG.GRID_W;

  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      let char = null;

      // 1. Alive units
      if (s && s.entities) {
        const entities = Array.isArray(s.entities) ? s.entities : Object.values(s.entities);
        const entity = entities.find(e => e.alive && e.position?.x === x && e.position?.y === y);
        if (entity) {
          char = entity.initial || (entity.role === 'enemy' ? 'G' : 'H');
        }
      }

      // 2. Objects (chests)
      if (!char) {
        const objects = s?.objects || mapOrState?.objects;
        if (objects) {
          const objList = Array.isArray(objects) ? objects : Object.values(objects);
          const obj = objList.find(o => o.position?.x === x && o.position?.y === y);
          if (obj && obj.type === 'chest') {
            char = obj.locked ? 'L' : 'C';
          }
        }
      }

      // 3. Tiles
      if (!char) {
        if (map && map.tiles && map.tiles[y] && map.tiles[y][x] === TILE.WALL) {
          char = '#';
        } else {
          char = '.';
        }
      }

      row += char;
    }
    rows.push(row);
  }

  return rows;
}
