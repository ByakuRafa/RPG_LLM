/**
 * Static 12x12 test map + initial entity placement for the demo scenario.
 * '#' = wall, '.' = floor. Coordinates: x = column (0..11, left→right),
 * y = row (0..11, top→bottom).
 */
export const MAP_ROWS = [
  '############',
  '#....#.....#',
  '#....#.....#',
  '#..........#', // door_1 sits on (5,3)
  '#....#.....#',
  '###.####.###',
  '#..........#',
  '#..........#',
  '#....##....#',
  '#..........#',
  '#..........#',
  '############',
];

export const INITIAL_ENTITIES = [
  { kind: 'player', id: 'player',   x: 2,  y: 2 },
  { kind: 'door',   id: 'door_1',   x: 5,  y: 3 },
  { kind: 'goblin', id: 'goblin_1', x: 8,  y: 2, items: [{ id: 'gold', qty: 5 }] },
  { kind: 'goblin', id: 'goblin_2', x: 3,  y: 9, items: [{ id: 'dagger', qty: 1 }] },
  { kind: 'chest',  id: 'chest_1',  x: 10, y: 10, items: [{ id: 'potion', qty: 1 }, { id: 'gold', qty: 10 }] },
];

export function createMap() {
  return { width: MAP_ROWS[0].length, height: MAP_ROWS.length, tiles: [...MAP_ROWS] };
}

export function inBounds(map, x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function isWall(map, x, y) {
  return map.tiles[y][x] === '#';
}
