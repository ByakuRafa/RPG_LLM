/**
 * Game state: factory, pure selectors, reducers, and store.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { CONFIG, PHASE, ENEMY_PHASE_ID } from '../core/config.js';
import { hashString } from '../core/prng.js';
import { toSlug } from '../core/schema.js';
import { CLASSES, ABILITIES, ITEMS, HERO_ROSTER } from './catalog.js';
import { generateDungeon } from './mapGenerator.js';
import { inBounds, isWallAt, getBlockerAt } from './pathfinding.js';

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
    title: spec.title ?? null,
    backstory: spec.backstory ?? null,
    personality: spec.personality ?? null,
    alignment: spec.alignment ?? null,
    role: spec.role ?? (spec.classId === 'goblin' ? 'enemy' : 'player'),
    classId: spec.classId,
    player: spec.player ?? null,
    color: spec.color ?? cls.color ?? '#FFFFFF',
    initial: spec.initial ?? cls.initial ?? '?',
    tokenUrl: spec.tokenUrl ?? cls.tokenUrl ?? null,
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
 * @param {object} [options={}] Optional options such as { roster: Array }
 * @returns {object} Initial GameState
 */
export function createInitialState(seed = CONFIG.DEFAULT_SEED, options = {}) {
  const dungeon = generateDungeon(seed);
  const entities = {};

  const defaultHeroSpawns = [
    dungeon.spawns.heroes?.hero_warrior || { x: 2, y: 10 },
    dungeon.spawns.heroes?.hero_mage    || { x: 1, y: 10 },
    dungeon.spawns.heroes?.hero_rogue   || { x: 3, y: 10 }
  ];

  const hasCustomRoster = Array.isArray(options.roster) && options.roster.length === 3;
  const roster = hasCustomRoster ? options.roster : HERO_ROSTER;

  // Heroes from roster + dungeon hero spawns
  for (let i = 0; i < roster.length; i++) {
    const hero = roster[i];
    const spawnPos = dungeon.spawns.heroes?.[hero.id] || defaultHeroSpawns[i] || { x: 2, y: 10 };
    const heroId = hero.id || `hero_${i + 1}`;
    entities[heroId] = createEntity({
      ...hero,
      id: heroId,
      player: hero.player ?? (i + 1),
      role: 'player',
      position: { x: spawnPos.x, y: spawnPos.y }
    });
  }

  // Enemies from dungeon enemy spawns
  const enemySpawns = dungeon.spawns.enemies || [];
  for (let i = 0; i < enemySpawns.length; i++) {
    const spawn = enemySpawns[i];
    const classId = spawn.classId || 'goblin';
    const cls = CLASSES[classId] || CLASSES.goblin;
    entities[spawn.id] = createEntity({
      id: spawn.id,
      name: spawn.name || `${cls.label || 'Inimigo'} ${i + 1}`,
      classId,
      role: 'enemy',
      position: { x: spawn.x, y: spawn.y },
      hp: spawn.maxHp || spawn.hp || cls.maxHp
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

  // Aggregate startingItems from roster into state.inventory
  let inventory = [];
  if (hasCustomRoster) {
    const itemMap = new Map();
    for (const hero of roster) {
      if (Array.isArray(hero.startingItems)) {
        for (const item of hero.startingItems) {
          if (item && item.id && item.qty > 0) {
            itemMap.set(item.id, (itemMap.get(item.id) || 0) + item.qty);
          }
        }
      }
    }
    for (const [id, qty] of itemMap.entries()) {
      inventory.push({ id, qty });
    }
  } else {
    inventory = [{ id: 'health_potion', qty: 2 }];
  }

  const heroIds = roster.map((h, i) => h.id || `hero_${i + 1}`);
  const turnOrder = [...heroIds, ENEMY_PHASE_ID];
  const activeId = heroIds[0] || 'hero_warrior';

  return {
    version: 1,
    seed,
    status: 'playing',
    phase: PHASE.HERO,
    round: 1,
    turnIndex: 0,
    turnOrder,
    activeId,
    floor: 1,
    maxFloors: CONFIG.MAX_FLOORS || 3,
    map: dungeon.map,
    entities,
    objects,
    inventory,
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
export const hashState = stateHash;

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

  if (aliveHeroes.length === 0) {
    return 'lost';
  }
  if (aliveEnemies.length === 0) {
    const currentFloor = s.floor || 1;
    const maxFloors = s.maxFloors || CONFIG.MAX_FLOORS || 3;
    if (currentFloor < maxFloors && s.objects?.['exit_door']) {
      return null;
    }
    return 'won';
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

  // Check if character stepped onto an unlocked exit door / stairs
  const exitDoor = Object.values(next.objects || {}).find(
    o => (o.type === 'door' || o.id === 'exit_door') && o.position.x === to.x && o.position.y === to.y
  );
  if (exitDoor && !exitDoor.locked) {
    const adv = advanceFloor(next, id);
    return { state: adv.state, events: [...events, ...adv.events] };
  }

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

    // Unlock exit door if all room enemies are defeated
    const remainingEnemies = getAliveEnemies(next);
    if (remainingEnemies.length === 0 && next.objects?.['exit_door'] && next.objects['exit_door'].locked) {
      next.objects['exit_door'].locked = false;
      next.objects['exit_door'].blocksMovement = false;
      events.push({
        type: 'door_unlocked',
        id: 'exit_door',
        message: 'Todos os inimigos da câmara foram derrotados! A passagem para o próximo andar se abriu.'
      });
    }

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
export function applyAbility(s, { caster_id, ability_id, target_id, target_x, target_y }, resolved = {}) {
  const next = cloneState(s);
  const caster = next.entities?.[caster_id];
  const ability = resolved.ability || ABILITIES[ability_id];
  const apCost = ability?.apCost ?? 1;

  if (caster) {
    caster.ap = Math.max(0, caster.ap - apCost);
  }

  const events = [];
  const effect = ability?.effect || {};

  // AoE Multi-Target Execution
  if (resolved.isAoE) {
    events.push({
      type: 'aoe_blast',
      abilityId: ability_id,
      center: resolved.center,
      tiles: resolved.tiles
    });

    for (const tInfo of (resolved.targets || [])) {
      const target = next.entities?.[tInfo.id];
      if (!target || !target.alive) continue;

      if (effect.type === 'damage') {
        const dmg = Math.max(0, effect.amount ?? 0);
        target.hp = Math.max(0, target.hp - dmg);

        events.push({
          type: 'damage',
          id: target.id,
          sourceId: caster_id,
          abilityId: ability_id,
          amount: dmg,
          hp: target.hp
        });

        if (target.hp === 0 && target.alive) {
          target.alive = false;
          events.push({ type: 'death', id: target.id });

          // Unlock exit door if all room enemies are defeated
          const remainingEnemies = getAliveEnemies(next);
          if (remainingEnemies.length === 0 && next.objects?.['exit_door'] && next.objects['exit_door'].locked) {
            next.objects['exit_door'].locked = false;
            next.objects['exit_door'].blocksMovement = false;
            events.push({
              type: 'door_unlocked',
              id: 'exit_door',
              message: 'Todos os inimigos da câmara foram derrotados! A passagem para o próximo andar se abriu.'
            });
          }

          const outcome = evaluateGameOver(next);
          if (outcome) {
            next.status = outcome;
            next.phase = PHASE.GAME_OVER;
            next.gameOver = true;
            events.push({ type: 'game_over', status: outcome, result: outcome });
          }
        }

        if (effect.push) {
          let pushTo = tInfo.pushTo;
          let pushBlockedReason = tInfo.pushBlockedReason;

          // Check if previously moved entity or object now blocks pushTo
          if (pushTo && getBlockerAt(next, pushTo.x, pushTo.y, { ignoreId: target.id })) {
            pushTo = null;
            pushBlockedReason = 'occupied';
          }

          if (pushTo) {
            const fromPos = { ...target.position };
            target.position = { x: pushTo.x, y: pushTo.y };
            events.push({
              type: 'push',
              id: target.id,
              from: fromPos,
              to: { x: target.position.x, y: target.position.y }
            });
          } else if (pushBlockedReason) {
            events.push({
              type: 'push_blocked',
              id: target.id,
              reason: pushBlockedReason
            });
          }
        }
      } else if (effect.type === 'heal') {
        const healAmt = Math.max(0, effect.amount ?? 0);
        const oldHp = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + healAmt);
        const effective = target.hp - oldHp;

        events.push({
          type: 'heal',
          id: target.id,
          sourceId: caster_id,
          via: ability_id,
          amount: effective,
          hp: target.hp
        });
      }
    }

    return { state: next, events };
  }

  if (effect.type === 'damage') {
    let target = next.entities?.[target_id];
    if (!target && next.entities && typeof target_id === 'string') {
      const slug = toSlug(target_id);
      if (['thorin', 'guerreiro', 'warrior'].includes(slug)) target = next.entities.hero_warrior;
      else if (['lyra', 'mago', 'maga', 'mage'].includes(slug)) target = next.entities.hero_mage;
      else if (['vex', 'ladino', 'ladina', 'rogue'].includes(slug)) target = next.entities.hero_rogue;
      else target = Object.values(next.entities).find(e => e && (toSlug(e.name) === slug || toSlug(e.id) === slug));
    }
    if (target) {
      const actualTargetId = target.id;
      const dmg = Math.max(0, effect.amount ?? 0);
      target.hp = Math.max(0, target.hp - dmg);

      events.push({
        type: 'damage',
        id: actualTargetId,
        sourceId: caster_id,
        abilityId: ability_id,
        amount: dmg,
        hp: target.hp
      });

      if (target.hp === 0 && target.alive) {
        target.alive = false;
        events.push({ type: 'death', id: actualTargetId });

        // Unlock exit door if all room enemies are defeated
        const remainingEnemies = getAliveEnemies(next);
        if (remainingEnemies.length === 0 && next.objects?.['exit_door'] && next.objects['exit_door'].locked) {
          next.objects['exit_door'].locked = false;
          next.objects['exit_door'].blocksMovement = false;
          events.push({
            type: 'door_unlocked',
            id: 'exit_door',
            message: 'Todos os inimigos da câmara foram derrotados! A passagem para o próximo andar se abriu.'
          });
        }

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
        let pushTo = resolved.pushTo;
        let pushBlockedReason = resolved.pushBlockedReason;

        // Fallback calculation if not pre-resolved
        if (!pushTo && !pushBlockedReason && caster && target) {
          const dx = Math.sign(target.position.x - caster.position.x);
          const dy = Math.sign(target.position.y - caster.position.y);
          const destX = target.position.x + dx;
          const destY = target.position.y + dy;

          if (!inBounds(next.map, destX, destY)) {
            pushBlockedReason = 'edge';
          } else if (isWallAt(next.map, destX, destY)) {
            pushBlockedReason = 'wall';
          } else if (getBlockerAt(next, destX, destY, { ignoreId: target.id })) {
            pushBlockedReason = 'occupied';
          } else {
            pushTo = { x: destX, y: destY };
          }
        }

        if (pushTo) {
          const fromPos = { ...target.position };
          target.position = { x: pushTo.x, y: pushTo.y };
          events.push({
            type: 'push',
            id: actualTargetId,
            from: fromPos,
            to: { x: target.position.x, y: target.position.y }
          });
        } else if (pushBlockedReason) {
          events.push({
            type: 'push_blocked',
            id: actualTargetId,
            reason: pushBlockedReason
          });
        }
      }
    }
  } else if (effect.type === 'heal') {
    let target = next.entities?.[target_id];
    if (!target && next.entities && typeof target_id === 'string') {
      const slug = toSlug(target_id);
      if (['thorin', 'guerreiro', 'warrior'].includes(slug)) target = next.entities.hero_warrior;
      else if (['lyra', 'mago', 'maga', 'mage'].includes(slug)) target = next.entities.hero_mage;
      else if (['vex', 'ladino', 'ladina', 'rogue'].includes(slug)) target = next.entities.hero_rogue;
      else target = Object.values(next.entities).find(e => e && (toSlug(e.name) === slug || toSlug(e.id) === slug));
    }
    if (target) {
      const actualTargetId = target.id;
      const healAmt = Math.max(0, effect.amount ?? 0);
      const oldHp = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + healAmt);
      const effective = target.hp - oldHp;

      events.push({
        type: 'heal',
        id: actualTargetId,
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
  const itemSlug = toSlug(item_id || '');
  const effectiveItemId = (['potion', 'pocao', 'pocao_de_cura', 'pocao_cura', 'pocao_de_vida', 'cura'].includes(itemSlug)) ? 'health_potion' : item_id;
  const targetId = target_id || character_id;
  const actor = next.entities?.[character_id];
  let target = next.entities?.[targetId];
  if (!target && next.entities && typeof targetId === 'string') {
    const slug = toSlug(targetId);
    if (['thorin', 'guerreiro', 'warrior'].includes(slug)) target = next.entities.hero_warrior;
    else if (['lyra', 'mago', 'maga', 'mage'].includes(slug)) target = next.entities.hero_mage;
    else if (['vex', 'ladino', 'ladina', 'rogue'].includes(slug)) target = next.entities.hero_rogue;
    else target = Object.values(next.entities).find(e => e && (toSlug(e.name) === slug || toSlug(e.id) === slug));
  }
  const item = resolved.item || ITEMS[item_id] || ITEMS[effectiveItemId];

  if (actor) {
    actor.ap = Math.max(0, actor.ap - 1);
  }

  // Decrement stack in inventory
  if (Array.isArray(next.inventory)) {
    const idx = next.inventory.findIndex(it => it.id === item_id || it.id === effectiveItemId || toSlug(it.id) === itemSlug);
    if (idx !== -1) {
      next.inventory[idx].qty -= 1;
      if (next.inventory[idx].qty <= 0) {
        next.inventory.splice(idx, 1);
      }
    }
  }

  const actualTargetId = target ? target.id : targetId;
  const events = [{
    type: 'item_used',
    itemId: effectiveItemId,
    byId: character_id,
    targetId: actualTargetId
  }];

  if (item?.effect?.type === 'heal' && target) {
    const healAmt = Math.max(0, item.effect.amount ?? 0);
    const oldHp = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + healAmt);
    const effective = target.hp - oldHp;

    events.push({
      type: 'heal',
      id: actualTargetId,
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
    if (obj.type === 'door' || obj.id === 'exit_door') {
      obj.opened = true;
      const adv = advanceFloor(next, character_id);
      return {
        state: adv.state,
        events: [
          {
            type: 'door_opened',
            objectId: object_id,
            byId: character_id
          },
          ...adv.events
        ]
      };
    }

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
 * Advances the game to the next dungeon floor.
 * Preserves alive hero health, gold, items, resets turn and spawns next floor enemies.
 * @param {object} s GameState
 * @param {string} [actorId]
 * @returns {{ state: object, events: object[] }}
 */
export function advanceFloor(s, actorId = null) {
  const next = cloneState(s);
  const currentFloor = next.floor || 1;
  const maxFloors = next.maxFloors || CONFIG.MAX_FLOORS || 3;

  if (currentFloor >= maxFloors) {
    next.status = 'won';
    next.phase = PHASE.GAME_OVER;
    next.gameOver = true;
    return {
      state: next,
      events: [{
        type: 'game_over',
        status: 'won',
        result: 'won',
        message: 'A masmorra foi completamente conquistada com glória!'
      }]
    };
  }

  const nextFloor = currentFloor + 1;
  next.floor = nextFloor;

  // Generate new dungeon for the next floor
  const floorDungeon = generateDungeon(next.seed, { floor: nextFloor });
  next.map = floorDungeon.map;

  // Reposition living heroes at new floor entrance spawns, refresh AP/MP, give +5 HP rest heal
  const defaultFloorSpawns = [
    floorDungeon.spawns.heroes?.hero_warrior || { x: 2, y: 10 },
    floorDungeon.spawns.heroes?.hero_mage    || { x: 1, y: 10 },
    floorDungeon.spawns.heroes?.hero_rogue   || { x: 3, y: 10 }
  ];
  const livingHeroIds = next.turnOrder
    ? next.turnOrder.filter(id => id !== ENEMY_PHASE_ID)
    : HERO_ROSTER.map(h => h.id);

  livingHeroIds.forEach((heroId, idx) => {
    const heroEntity = next.entities[heroId];
    if (heroEntity && heroEntity.alive) {
      const spawnPos = floorDungeon.spawns.heroes?.[heroId] || defaultFloorSpawns[idx] || { x: 2, y: 10 };
      heroEntity.position = { x: spawnPos.x, y: spawnPos.y };
      heroEntity.ap = heroEntity.maxAp ?? 1;
      heroEntity.mp = heroEntity.maxMp ?? 4;
      heroEntity.hp = Math.min(heroEntity.maxHp, heroEntity.hp + 5);
    }
  });

  // Remove old enemies and instantiate new enemies for next floor
  for (const [entId, ent] of Object.entries(next.entities)) {
    if (ent.role === 'enemy') {
      delete next.entities[entId];
    }
  }

  const enemySpawns = floorDungeon.spawns.enemies || [];
  for (let i = 0; i < enemySpawns.length; i++) {
    const spawn = enemySpawns[i];
    const classId = spawn.classId || 'goblin';
    const cls = CLASSES[classId] || CLASSES.goblin;
    next.entities[spawn.id] = createEntity({
      id: spawn.id,
      name: spawn.name || `${cls.label || 'Inimigo'} ${i + 1}`,
      classId,
      role: 'enemy',
      position: { x: spawn.x, y: spawn.y },
      hp: spawn.maxHp || spawn.hp || cls.maxHp
    });
  }

  // Populate new floor objects
  next.objects = {};
  const objList = Array.isArray(floorDungeon.objects) ? floorDungeon.objects : Object.values(floorDungeon.objects || {});
  for (const obj of objList) {
    next.objects[obj.id] = {
      ...obj,
      position: { ...obj.position },
      loot: obj.loot ? obj.loot.map(l => ({ ...l })) : []
    };
  }

  // Reset round and active hero
  next.round = 1;
  next.turnIndex = 0;
  next.phase = PHASE.HERO;
  const aliveHeroes = getAliveHeroes(next);
  next.activeId = aliveHeroes[0]?.id || 'hero_warrior';

  const events = [
    {
      type: 'floor_transition',
      floor: nextFloor,
      maxFloors,
      actorId,
      message: `Os heróis desceram para o Andar ${nextFloor}! A atmosfera fica mais densa e novos perigos surgem.`
    },
    {
      type: 'turn_started',
      round: 1,
      activeId: next.activeId
    }
  ];

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
