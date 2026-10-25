/**
 * Dynamic Illegal Presets Generator (Task 3.8).
 * Derives invalid action batches from current state to stress-test rules engine & validation.
 * Pure DOM/UI helper, zero direct state mutation.
 */
import { TILE } from '../core/config.js';
import { ABILITIES, CLASSES } from '../engine/catalog.js';

function manhattan(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * Builds the set of 10 illegal preset batches dynamically derived from current state.
 *
 * @param {object} state GameState
 * @returns {Record<string, { label: string, batch: { tool_calls: Array<{ name: string, arguments: object }> } }>}
 */
export function buildIllegalPresets(state) {
  if (!state || !state.entities) return {};

  const activeId = state.activeId;
  const active = state.entities[activeId] || Object.values(state.entities).find(e => e.role === 'player' && e.alive);
  if (!active || !active.position) return {};

  const ax = active.position.x;
  const ay = active.position.y;
  const mp = active.mp ?? 4;
  const map = state.map;
  const grid = map?.grid || [];
  const width = map?.width || 12;
  const height = map?.height || 12;

  const aliveEntities = Object.values(state.entities).filter(e => e.alive);
  const aliveGoblins = aliveEntities.filter(e => e.role === 'enemy');
  const aliveHeroes = aliveEntities.filter(e => e.role === 'player');
  const otherHeroes = aliveHeroes.filter(e => e.id !== active.id);
  const objects = Object.values(state.objects || {});

  // 1. walk_beyond_mp: a floor tile at Manhattan mp + 2 (or furthest reachable)
  let beyondTile = null;
  const targetDist = mp + 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y]?.[x] === TILE.FLOOR) {
        const d = manhattan(ax, ay, x, y);
        if (d === targetDist) {
          beyondTile = { x, y };
          break;
        } else if (d > mp && (!beyondTile || d < manhattan(ax, ay, beyondTile.x, beyondTile.y))) {
          beyondTile = { x, y };
        }
      }
    }
    if (beyondTile && manhattan(ax, ay, beyondTile.x, beyondTile.y) === targetDist) break;
  }
  if (!beyondTile) {
    beyondTile = { x: Math.min(width - 1, ax + targetDist), y: ay };
  }

  // 2. walk_into_wall: nearest wall tile
  let wallTile = null;
  let minWallDist = Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y]?.[x] === TILE.WALL) {
        const d = manhattan(ax, ay, x, y);
        if (d < minWallDist) {
          minWallDist = d;
          wallTile = { x, y };
        }
      }
    }
  }
  if (!wallTile) wallTile = { x: 0, y: 0 };

  // 3. walk_behind_wall: tile with Manhattan <= MP but BFS cost > MP (or unreachable)
  // Simple BFS on grid from active pos
  const bfsDist = new Map();
  const queue = [{ x: ax, y: ay, d: 0 }];
  bfsDist.set(`${ax},${ay}`, 0);

  // Occupied tiles by other alive entities
  const occupied = new Set();
  for (const e of aliveEntities) {
    if (e.id !== active.id && e.position) {
      occupied.add(`${e.position.x},${e.position.y}`);
    }
  }

  while (queue.length > 0) {
    const cur = queue.shift();
    const neighbors = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 }
    ];
    for (const n of neighbors) {
      if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
        if (grid[n.y]?.[n.x] === TILE.FLOOR && !occupied.has(`${n.x},${n.y}`)) {
          const key = `${n.x},${n.y}`;
          if (!bfsDist.has(key)) {
            bfsDist.set(key, cur.d + 1);
            queue.push({ x: n.x, y: n.y, d: cur.d + 1 });
          }
        }
      }
    }
  }

  let behindWallTile = null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y]?.[x] === TILE.FLOOR && !(x === ax && y === ay)) {
        const mDist = manhattan(ax, ay, x, y);
        const bDist = bfsDist.get(`${x},${y}`) ?? Infinity;
        if (mDist <= mp && bDist > mp) {
          behindWallTile = { x, y };
          break;
        }
      }
    }
    if (behindWallTile) break;
  }
  if (!behindWallTile) {
    // Fallback: pick any floor tile unreachable or with highest BFS distance
    let maxDist = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (grid[y]?.[x] === TILE.FLOOR) {
          const bDist = bfsDist.get(`${x},${y}`) ?? Infinity;
          if (bDist === Infinity) {
            behindWallTile = { x, y };
            break;
          } else if (bDist > maxDist) {
            maxDist = bDist;
            behindWallTile = { x, y };
          }
        }
      }
      if (behindWallTile && (bfsDist.get(`${behindWallTile.x},${behindWallTile.y}`) ?? Infinity) === Infinity) break;
    }
  }
  if (!behindWallTile) behindWallTile = { x: ax, y: ay };

  // 4. attack_out_of_range: active hero's first damage ability vs the farthest goblin
  const firstDmgAbility = (active.abilities || []).find(id => ABILITIES[id]?.effect?.type === 'damage') || active.abilities?.[0] || 'slash';
  let farthestGoblin = aliveGoblins[0] || null;
  let maxGoblinDist = -1;
  for (const g of aliveGoblins) {
    if (g.position) {
      const d = manhattan(ax, ay, g.position.x, g.position.y);
      if (d > maxGoblinDist) {
        maxGoblinDist = d;
        farthestGoblin = g;
      }
    }
  }
  const attackTargetId = farthestGoblin?.id || 'goblin_1';

  // 5. wrong_turn: move a non-active hero
  const nonActiveHero = otherHeroes[0] || active;
  const naPos = nonActiveHero.position || { x: 1, y: 1 };
  let naTarget = { x: naPos.x, y: naPos.y + 1 };
  if (grid[naTarget.y]?.[naTarget.x] === TILE.WALL) {
    naTarget = { x: naPos.x + 1, y: naPos.y };
  }

  // 6. heal_enemy: heal_pulse (mage) on a goblin
  const healTargetId = aliveGoblins[0]?.id || 'goblin_1';

  // 7. use_missing_item: use_item mega_elixir
  // 8. use_gold: use_item gold_coins
  // 9. loot_far_chest: interact_object on a non-adjacent chest
  let farChest = objects.find(obj => {
    if (obj.type !== 'chest' && obj.kind !== 'chest') return false;
    if (!obj.position) return false;
    return manhattan(ax, ay, obj.position.x, obj.position.y) > 1;
  });
  if (!farChest) {
    farChest = objects.find(obj => obj.type === 'chest' || obj.kind === 'chest') || { id: 'chest_2' };
  }

  // 10. double_action: two ability calls in one batch (first applies, second NO_AP)
  const doubleAbId = active.abilities?.[0] || 'slash';
  // Try to find a target in range for the first ability to apply
  const abDef = ABILITIES[doubleAbId] || { range: 1, target: 'enemy' };
  let validTarget = null;
  if (abDef.target === 'ally') {
    validTarget = active;
  } else {
    validTarget = aliveGoblins.find(g => g.position && manhattan(ax, ay, g.position.x, g.position.y) <= (abDef.range || 1));
    if (!validTarget) {
      validTarget = aliveGoblins[0] || { id: 'goblin_1' };
    }
  }

  return {
    walk_beyond_mp: {
      label: 'Mover além do MP',
      batch: {
        tool_calls: [{
          name: 'move_character',
          arguments: { character_id: active.id, target_x: beyondTile.x, target_y: beyondTile.y }
        }]
      }
    },
    walk_into_wall: {
      label: 'Mover para dentro de parede',
      batch: {
        tool_calls: [{
          name: 'move_character',
          arguments: { character_id: active.id, target_x: wallTile.x, target_y: wallTile.y }
        }]
      }
    },
    walk_behind_wall: {
      label: 'Mover atrás de parede (BFS > MP)',
      batch: {
        tool_calls: [{
          name: 'move_character',
          arguments: { character_id: active.id, target_x: behindWallTile.x, target_y: behindWallTile.y }
        }]
      }
    },
    attack_out_of_range: {
      label: 'Ataque fora de alcance',
      batch: {
        tool_calls: [{
          name: 'use_ability',
          arguments: { caster_id: active.id, ability_id: firstDmgAbility, target_id: attackTargetId }
        }]
      }
    },
    wrong_turn: {
      label: 'Mover herói fora de turno',
      batch: {
        tool_calls: [{
          name: 'move_character',
          arguments: { character_id: nonActiveHero.id, target_x: naTarget.x, target_y: naTarget.y }
        }]
      }
    },
    heal_enemy: {
      label: 'Curar inimigo',
      batch: {
        tool_calls: [{
          name: 'use_ability',
          arguments: { caster_id: active.id, ability_id: 'heal_pulse', target_id: healTargetId }
        }]
      }
    },
    use_missing_item: {
      label: 'Usar item inexistente',
      batch: {
        tool_calls: [{
          name: 'use_item',
          arguments: { character_id: active.id, item_id: 'mega_elixir', target_id: active.id }
        }]
      }
    },
    use_gold: {
      label: 'Usar ouro (não utilizável)',
      batch: {
        tool_calls: [{
          name: 'use_item',
          arguments: { character_id: active.id, item_id: 'gold_coins', target_id: active.id }
        }]
      }
    },
    loot_far_chest: {
      label: 'Saquear baú distante',
      batch: {
        tool_calls: [{
          name: 'interact_object',
          arguments: { character_id: active.id, object_id: farChest.id }
        }]
      }
    },
    double_action: {
      label: 'Ação dupla (Sem AP)',
      batch: {
        tool_calls: [
          {
            name: 'use_ability',
            arguments: { caster_id: active.id, ability_id: doubleAbId, target_id: validTarget.id }
          },
          {
            name: 'use_ability',
            arguments: { caster_id: active.id, ability_id: doubleAbId, target_id: validTarget.id }
          }
        ]
      }
    }
  };
}
