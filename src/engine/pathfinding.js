/**
 * Pathfinding and spatial queries for 12x12 grid.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { TILE } from '../core/config.js';

export const DIRS4 = [
  [0, -1], // N
  [1, 0],  // E
  [0, 1],  // S
  [-1, 0]  // W
];

export const key = (x, y) => `${x},${y}`;

export function manhattan(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

export function inBounds(map, x, y) {
  if (!map) return false;
  const width = map.width ?? (Array.isArray(map[0]) ? map[0].length : 0);
  const height = map.height ?? (Array.isArray(map) ? map.length : 0);
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function isWallAt(map, x, y) {
  if (!map) return true;
  const tiles = map.tiles ?? map;
  if (!tiles || !tiles[y]) return true;
  return tiles[y][x] === TILE.WALL;
}

/**
 * Checks for alive entities or blocking objects at (x, y).
 * Accepts state with entities/objects as dictionaries or arrays.
 * @param {object} state
 * @param {number} x
 * @param {number} y
 * @param {{ ignoreId?: string, ignoreUnits?: boolean }} [opts]
 * @returns {object|null} The blocking entity or object, or null.
 */
export function getBlockerAt(state, x, y, { ignoreId, ignoreUnits = false } = {}) {
  if (!state) return null;

  if (!ignoreUnits && state.entities) {
    const entList = Array.isArray(state.entities) ? state.entities : Object.values(state.entities);
    for (const e of entList) {
      if (e && e.alive && e.position && e.position.x === x && e.position.y === y && e.id !== ignoreId) {
        return e;
      }
    }
  }

  if (state.objects) {
    const objList = Array.isArray(state.objects) ? state.objects : Object.values(state.objects);
    for (const obj of objList) {
      if (obj && obj.blocksMovement && obj.position && obj.position.x === x && obj.position.y === y && obj.id !== ignoreId) {
        return obj;
      }
    }
  }

  return null;
}

export function isWalkable(state, x, y, opts) {
  return inBounds(state.map, x, y) && !isWallAt(state.map, x, y) && !getBlockerAt(state, x, y, opts);
}

/**
 * BFS flood-fill limited by maxSteps. Origin excluded.
 * @param {object} state
 * @param {string} entityId
 * @param {number} maxSteps
 * @returns {Map<string, number>} Map of 'x,y' -> stepCost
 */
export function computeReachable(state, entityId, maxSteps) {
  const e = state?.entities?.[entityId];
  if (!e || !e.position || maxSteps <= 0) return new Map();

  const out = new Map();
  const seen = new Set([key(e.position.x, e.position.y)]);
  let frontier = [e.position];
  let cost = 0;

  while (frontier.length && cost < maxSteps) {
    cost++;
    const next = [];
    for (const p of frontier) {
      for (const [dx, dy] of DIRS4) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        const k = key(nx, ny);
        if (seen.has(k) || !isWalkable(state, nx, ny, { ignoreId: entityId })) continue;
        seen.add(k);
        out.set(k, cost);
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }

  return out;
}

/**
 * Unbounded BFS from a tile (origin included with cost 0).
 * Used by mapGenerator and enemy AI. Accepts bare { map, objects } or full state.
 * @param {object} state
 * @param {{ x: number, y: number }} from
 * @param {{ ignoreUnits?: boolean, ignoreId?: string }} [opts]
 * @returns {Map<string, number>} Map of 'x,y' -> stepCost
 */
export function computeDistanceField(state, from, { ignoreUnits = false, ignoreId } = {}) {
  const out = new Map();
  if (!state || !state.map || !from) return out;
  if (!inBounds(state.map, from.x, from.y) || isWallAt(state.map, from.x, from.y)) return out;

  const startKey = key(from.x, from.y);
  out.set(startKey, 0);
  let frontier = [{ x: from.x, y: from.y }];
  let cost = 0;

  while (frontier.length) {
    cost++;
    const next = [];
    for (const p of frontier) {
      for (const [dx, dy] of DIRS4) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        const k = key(nx, ny);
        if (out.has(k)) continue;
        if (!isWalkable(state, nx, ny, { ignoreUnits, ignoreId })) continue;
        out.set(k, cost);
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }

  return out;
}

/**
 * Computes tiles affected by an Area of Effect (AoE) ability.
 * Supports shapes: 'circle', 'adjacent', 'line'.
 * Only includes in-bounds, non-wall tiles.
 *
 * @param {object} map Map object with tiles/grid, width, height
 * @param {{ x: number, y: number }} center Center/target coordinates
 * @param {{ shape: 'circle'|'adjacent'|'line', radius: number }} aoeDef
 * @param {{ x: number, y: number }|null} [casterPos=null] Caster position (required for 'line')
 * @returns {Array<{ x: number, y: number }>}
 */
export function computeAoETiles(map, center, aoeDef, casterPos = null) {
  if (!map || !center || !aoeDef) return [];
  const radius = Math.max(0, aoeDef.radius ?? 1);
  const shape = aoeDef.shape || 'circle';
  const tiles = [];
  const seen = new Set();

  if (shape === 'circle') {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= radius) {
          const x = center.x + dx;
          const y = center.y + dy;
          if (inBounds(map, x, y) && !isWallAt(map, x, y)) {
            const k = key(x, y);
            if (!seen.has(k)) {
              seen.add(k);
              tiles.push({ x, y });
            }
          }
        }
      }
    }
  } else if (shape === 'adjacent') {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist >= 1 && dist <= radius) {
          const x = center.x + dx;
          const y = center.y + dy;
          if (inBounds(map, x, y) && !isWallAt(map, x, y)) {
            const k = key(x, y);
            if (!seen.has(k)) {
              seen.add(k);
              tiles.push({ x, y });
            }
          }
        }
      }
    }
  } else if (shape === 'line') {
    const origin = casterPos || center;
    let dirX = Math.sign(center.x - origin.x);
    let dirY = Math.sign(center.y - origin.y);

    if (dirX === 0 && dirY === 0) {
      dirY = -1;
    } else if (dirX !== 0 && dirY !== 0) {
      if (Math.abs(center.x - origin.x) >= Math.abs(center.y - origin.y)) {
        dirY = 0;
      } else {
        dirX = 0;
      }
    }

    for (let step = 1; step <= radius; step++) {
      const x = origin.x + dirX * step;
      const y = origin.y + dirY * step;
      if (!inBounds(map, x, y) || isWallAt(map, x, y)) {
        break;
      }
      const k = key(x, y);
      if (!seen.has(k)) {
        seen.add(k);
        tiles.push({ x, y });
      }
    }
  }

  tiles.sort((a, b) => a.y - b.y || a.x - b.x);
  return tiles;
}
