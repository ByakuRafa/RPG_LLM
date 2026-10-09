/**
 * Game state: initial state factory, pure reducer and a tiny store.
 * applyCommand never mutates its input; it returns a new state plus the list
 * of visual events the renderer must play (move path, hit, death, ...).
 */
import { createMap, INITIAL_ENTITIES } from './map.js';
import { createEntity, normalizeItem } from './entities.js';
import { checkCommand } from './rules.js';

export function createInitialState() {
  const entities = {};
  for (const spec of INITIAL_ENTITIES) {
    entities[spec.id] = createEntity(spec.kind, spec.id, spec.x, spec.y, spec);
  }
  return { turn: 0, status: 'playing', map: createMap(), entities };
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function uniqueId(state, base) {
  if (!state.entities[base]) return base;
  let n = 2;
  while (state.entities[`${base}_${n}`]) n++;
  return `${base}_${n}`;
}

function addItems(target, items) {
  for (const item of items) {
    const existing = target.items.find((i) => i.id === item.id);
    if (existing) existing.qty += item.qty;
    else target.items.push({ ...item });
  }
}

function removeItems(source, items) {
  for (const item of items) {
    const existing = source.items.find((i) => i.id === item.id);
    existing.qty -= item.qty;
  }
  source.items = source.items.filter((i) => i.qty > 0);
}

function dealDamage(s, targetId, amount, events, sourceId = null) {
  const t = s.entities[targetId];
  t.hp = Math.max(0, t.hp - amount);
  events.push({ type: 'hit', id: t.id, amount, hp: t.hp, source: sourceId, entity: { ...t } });
  if (t.hp > 0) return;

  if (t.id === 'player') {
    events.push({ type: 'death', entity: { ...t }, keep: true });
    return;
  }
  const snapshot = { ...t };
  delete s.entities[t.id];
  events.push({ type: 'death', entity: snapshot });
  if (t.items?.length) {
    const bagId = uniqueId(s, `bag_${t.id}`);
    s.entities[bagId] = createEntity('bag', bagId, t.x, t.y, { items: t.items });
    events.push({ type: 'spawn', id: bagId });
  }
}

function updateStatus(s) {
  const player = s.entities.player;
  if (!player || player.hp <= 0) s.status = 'lost';
  else if (!Object.values(s.entities).some((e) => e.faction === 'enemy')) s.status = 'won';
}

/**
 * Applies an already-validated command.
 * @returns {{state: object, events: Array}}
 */
export function applyCommand(state, cmd, resolution) {
  const s = clone(state);
  const events = [];

  switch (cmd.type) {
    case 'MOVE': {
      const e = s.entities[cmd.id];
      if (resolution.path.length) {
        const from = { x: e.x, y: e.y };
        const last = resolution.path[resolution.path.length - 1];
        e.x = last.x;
        e.y = last.y;
        events.push({ type: 'move', id: e.id, path: [from, ...resolution.path] });
      }
      break;
    }
    case 'ATTACK':
      events.push({ type: 'attack', attacker: cmd.attacker, target: cmd.target });
      dealDamage(s, cmd.target, resolution.amount, events, cmd.attacker);
      break;
    case 'DAMAGE':
      dealDamage(s, cmd.target, resolution.amount, events);
      break;
    case 'INTERACT':
      s.entities[cmd.target].open = true;
      events.push({ type: 'open', id: cmd.target });
      break;
    case 'LOOT': {
      const actor = s.entities[cmd.actor];
      const src = s.entities[cmd.from];
      removeItems(src, resolution.items);
      addItems(actor, resolution.items);
      events.push({ type: 'loot', actor: actor.id, from: src.id, items: resolution.items });
      if (src.kind === 'bag' && src.items.length === 0) {
        delete s.entities[src.id];
        events.push({ type: 'despawn', entity: { ...src } });
      }
      break;
    }
    case 'SPAWN': {
      const items = (cmd.items ?? []).map(normalizeItem);
      s.entities[cmd.id] = createEntity(cmd.kind, cmd.id, cmd.at.x, cmd.at.y, { hp: cmd.hp, items });
      events.push({ type: 'spawn', id: cmd.id });
      break;
    }
    case 'DESPAWN': {
      const snapshot = { ...s.entities[cmd.id] };
      delete s.entities[cmd.id];
      events.push({ type: 'despawn', entity: snapshot });
      break;
    }
    default:
      throw new Error(`applyCommand: unsupported type ${cmd.type}`);
  }

  updateStatus(s);
  return { state: s, events };
}

/** Check + apply in one step. */
export function executeCommand(state, cmd) {
  const res = checkCommand(state, cmd);
  if (!res.ok) return { ok: false, reason: res.reason };
  const { state: next, events } = applyCommand(state, cmd, res);
  return { ok: true, state: next, events };
}

/** Observable state holder. */
export function createStore(initialState, bus = null) {
  let state = initialState;
  return {
    get: () => state,
    set(next, meta = {}) {
      state = next;
      bus?.emit('state:changed', { state, ...meta });
    },
  };
}

/** Deterministic FNV-1a hash of the state, used to prove replay determinism. */
export function hashState(state) {
  const json = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
