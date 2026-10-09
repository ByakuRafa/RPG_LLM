/**
 * Rules engine: state-dependent legality checks. The LLM proposes, the
 * engine disposes. Every check returns either
 *   { ok: true, ...resolution }   (data needed by the reducer, e.g. a path)
 *   { ok: false, reason }         (English, fed back to the LLM next turn)
 */
import { inBounds, isWall } from './map.js';
import { KINDS, SPAWNABLE_KINDS, blocksMovement, isContainer, isCreature, isInteractable } from './entities.js';

export const MAX_MOVE = 12;

const fail = (reason) => ({ ok: false, reason });
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function entitiesAt(state, x, y) {
  return Object.values(state.entities).filter((e) => e.x === x && e.y === y);
}

export function blockerAt(state, x, y, ignoreId = null) {
  return entitiesAt(state, x, y).find((e) => e.id !== ignoreId && blocksMovement(e)) ?? null;
}

function isWalkable(state, x, y, selfId) {
  return inBounds(state.map, x, y) && !isWall(state.map, x, y) && !blockerAt(state, x, y, selfId);
}

/**
 * 4-directional BFS. Returns the list of steps (excluding start) to the first
 * tile satisfying `isGoal`, or null when unreachable.
 */
export function findPath(state, start, isGoal, selfId) {
  const key = (x, y) => `${x},${y}`;
  const prev = new Map([[key(start.x, start.y), null]]);
  const queue = [{ x: start.x, y: start.y }];
  while (queue.length) {
    const cur = queue.shift();
    if (isGoal(cur)) {
      const path = [];
      let node = cur;
      while (node && !(node.x === start.x && node.y === start.y)) {
        path.unshift({ x: node.x, y: node.y });
        node = prev.get(key(node.x, node.y));
      }
      return path;
    }
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const k = key(nx, ny);
      if (prev.has(k) || !isWalkable(state, nx, ny, selfId)) continue;
      prev.set(k, cur);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

function requireEntity(state, id, role) {
  const e = state.entities[id];
  return e ? null : `${role} "${id}" does not exist`;
}

function checkMove(state, cmd) {
  const err = requireEntity(state, cmd.id, 'entity');
  if (err) return fail(err);
  const ent = state.entities[cmd.id];
  if (!isCreature(ent)) return fail(`"${ent.id}" (${ent.kind}) cannot move`);

  let isGoal;
  if (cmd.to) {
    const { x, y } = cmd.to;
    if (!inBounds(state.map, x, y)) return fail(`(${x},${y}) is out of bounds (map is ${state.map.width}x${state.map.height})`);
    if (isWall(state.map, x, y)) return fail(`(${x},${y}) is a wall`);
    const blocker = blockerAt(state, x, y, ent.id);
    if (blocker) return fail(`(${x},${y}) is occupied by "${blocker.id}"`);
    if (ent.x === x && ent.y === y) return { ok: true, path: [] };
    isGoal = (p) => p.x === x && p.y === y;
  } else {
    const terr = requireEntity(state, cmd.target, 'target');
    if (terr) return fail(terr);
    const target = state.entities[cmd.target];
    if (target.id === ent.id) return fail('an entity cannot move toward itself');
    if (manhattan(ent, target) === 1) return { ok: true, path: [] };
    isGoal = (p) => manhattan(p, target) === 1;
  }

  const path = findPath(state, ent, isGoal, ent.id);
  const dest = cmd.to ? `(${cmd.to.x},${cmd.to.y})` : `"${cmd.target}"`;
  if (!path) return fail(`no walkable path from (${ent.x},${ent.y}) to ${dest} (walls, closed doors or blockers in the way)`);
  if (path.length > MAX_MOVE) return fail(`${dest} is ${path.length} steps away (max ${MAX_MOVE} per MOVE)`);
  return { ok: true, path };
}

function checkAttack(state, cmd) {
  const err = requireEntity(state, cmd.attacker, 'attacker') ?? requireEntity(state, cmd.target, 'target');
  if (err) return fail(err);
  const a = state.entities[cmd.attacker];
  const t = state.entities[cmd.target];
  if (!isCreature(a)) return fail(`"${a.id}" cannot attack`);
  if (!isCreature(t)) return fail(`"${t.id}" (${t.kind}) cannot be attacked`);
  if (a.id === t.id) return fail('an entity cannot attack itself');
  const d = manhattan(a, t);
  if (d !== 1) return fail(`"${t.id}" at (${t.x},${t.y}) is not adjacent to "${a.id}" at (${a.x},${a.y}) (distance ${d}); MOVE first`);
  return { ok: true, amount: a.atk };
}

function checkDamage(state, cmd) {
  const err = requireEntity(state, cmd.target, 'target');
  if (err) return fail(err);
  if (!isCreature(state.entities[cmd.target])) return fail(`"${cmd.target}" cannot take damage`);
  return { ok: true, amount: cmd.amount };
}

function checkInteract(state, cmd) {
  const err = requireEntity(state, cmd.actor, 'actor') ?? requireEntity(state, cmd.target, 'target');
  if (err) return fail(err);
  const a = state.entities[cmd.actor];
  const t = state.entities[cmd.target];
  if (!isCreature(a)) return fail(`"${a.id}" cannot interact`);
  if (!isInteractable(t)) return fail(`"${t.id}" (${t.kind}) is not interactable`);
  const d = manhattan(a, t);
  if (d > 1) return fail(`"${t.id}" at (${t.x},${t.y}) is not adjacent to "${a.id}" (distance ${d}); MOVE first`);
  if (t.open) return fail(`"${t.id}" is already open`);
  return { ok: true };
}

function checkLoot(state, cmd) {
  const err = requireEntity(state, cmd.actor, 'actor') ?? requireEntity(state, cmd.from, 'source');
  if (err) return fail(err);
  const a = state.entities[cmd.actor];
  const src = state.entities[cmd.from];
  if (!isCreature(a)) return fail(`"${a.id}" cannot loot`);
  if (!isContainer(src)) return fail(`"${src.id}" (${src.kind}) is not a container; only chests and loot bags can be looted`);
  const d = manhattan(a, src);
  if (d > 1) return fail(`"${src.id}" at (${src.x},${src.y}) is not adjacent to "${a.id}" (distance ${d}); MOVE first`);
  if (!src.open) return fail(`"${src.id}" is closed; INTERACT with it first`);
  if (src.items.length === 0) return fail(`"${src.id}" is empty`);

  if (!cmd.item) return { ok: true, items: src.items.map((i) => ({ ...i })) };
  const found = src.items.find((i) => i.id === cmd.item.id);
  const available = src.items.map((i) => `${i.id} x${i.qty}`).join(', ');
  if (!found) return fail(`item "${cmd.item.id}" not found in "${src.id}" (available: ${available})`);
  const qty = cmd.item.qty ?? found.qty;
  if (qty > found.qty) return fail(`"${src.id}" only has ${found.qty}x "${found.id}"`);
  return { ok: true, items: [{ ...found, qty }] };
}

function checkSpawn(state, cmd) {
  if (state.entities[cmd.id]) return fail(`id "${cmd.id}" already exists`);
  if (!KINDS[cmd.kind]) return fail(`unknown kind "${cmd.kind}" (allowed: ${SPAWNABLE_KINDS.join(', ')})`);
  if (!SPAWNABLE_KINDS.includes(cmd.kind)) return fail(`kind "${cmd.kind}" cannot be spawned`);
  const { x, y } = cmd.at;
  if (!inBounds(state.map, x, y)) return fail(`(${x},${y}) is out of bounds`);
  if (isWall(state.map, x, y)) return fail(`(${x},${y}) is a wall`);
  const blocker = blockerAt(state, x, y);
  if (blocker) return fail(`(${x},${y}) is occupied by "${blocker.id}"`);
  return { ok: true };
}

function checkDespawn(state, cmd) {
  const err = requireEntity(state, cmd.id, 'entity');
  if (err) return fail(err);
  if (cmd.id === 'player') return fail('the player cannot be despawned');
  return { ok: true };
}

const CHECKS = {
  MOVE: checkMove,
  ATTACK: checkAttack,
  DAMAGE: checkDamage,
  INTERACT: checkInteract,
  LOOT: checkLoot,
  SPAWN: checkSpawn,
  DESPAWN: checkDespawn,
};

/** Legality check for one structurally valid command against the current state. */
export function checkCommand(state, cmd) {
  if (state.status !== 'playing') return fail(`game is over (${state.status}); no further commands are accepted`);
  const check = CHECKS[cmd.type];
  if (!check) return fail(`unknown command type "${cmd.type}"`);
  return check(state, cmd);
}
