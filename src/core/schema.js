/**
 * Structural JSON validation and normalization for tool calls.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { CONFIG } from './config.js';

export const TOOL_SPECS = Object.freeze({
  move_character: Object.freeze({
    required: Object.freeze({
      character_id: 'id',
      target_x: 'int',
      target_y: 'int'
    }),
    optional: Object.freeze({
      caster_id: 'id'
    })
  }),
  use_ability: Object.freeze({
    required: Object.freeze({
      caster_id: 'id',
      ability_id: 'id',
      target_id: 'id'
    }),
    optional: Object.freeze({
      character_id: 'id',
      target_x: 'int',
      target_y: 'int'
    })
  }),
  use_item: Object.freeze({
    required: Object.freeze({
      character_id: 'id',
      item_id: 'id'
    }),
    optional: Object.freeze({
      target_id: 'id',
      caster_id: 'id'
    })
  }),
  interact_object: Object.freeze({
    required: Object.freeze({
      character_id: 'id',
      object_id: 'id'
    }),
    optional: Object.freeze({
      target_id: 'id',
      target_x: 'int',
      target_y: 'int',
      caster_id: 'id'
    })
  }),
  check_inventory: Object.freeze({
    required: Object.freeze({
      character_id: 'id'
    }),
    optional: Object.freeze({
      caster_id: 'id'
    })
  }),
  end_turn: Object.freeze({
    required: Object.freeze({
      character_id: 'id'
    }),
    optional: Object.freeze({
      caster_id: 'id'
    })
  })
});

export const RESPONSE_SCHEMA_FIELDS = Object.freeze(new Set([
  'character_id',
  'caster_id',
  'target_id',
  'ability_id',
  'item_id',
  'object_id',
  'target_x',
  'target_y'
]));

/**
 * Resolves semantic target names/pronouns to entity IDs.
 * Examples: "Thorin" -> "hero_warrior", "Lyra" -> "hero_mage", "self" -> casterId.
 * @param {string} rawTarget
 * @param {object|null} state
 * @param {string|null} casterId
 * @returns {string} resolved ID or original string
 */
export function resolveSemanticTarget(rawTarget, state = null, casterId = null) {
  if (typeof rawTarget !== 'string' || !rawTarget.trim()) return rawTarget;
  const lower = rawTarget.trim().toLowerCase();

  // 1. Self / caster aliases
  if (['self', 'mim', 'eu', 'me', 'myself', 'proprio', 'próprio', 'si', 'si_mesmo', 'si_mesma'].includes(lower)) {
    return casterId || state?.activeId || rawTarget;
  }

  // 2. Roster hero name / class aliases
  if (lower === 'thorin' || lower === 'guerreiro' || lower === 'warrior') return 'hero_warrior';
  if (lower === 'lyra' || lower === 'mago' || lower === 'maga' || lower === 'mage') return 'hero_mage';
  if (lower === 'vex' || lower === 'ladino' || lower === 'ladina' || lower === 'rogue') return 'hero_rogue';

  // 3. Exact key match in state entities/objects
  if (state?.entities?.[rawTarget]) return rawTarget;
  if (state?.objects?.[rawTarget]) return rawTarget;

  // 4. Entity match by name in state
  if (state?.entities) {
    const entList = Object.values(state.entities);
    const byName = entList.find(e => e?.name && e.name.toLowerCase() === lower);
    if (byName) return byName.id;
  }

  // 5. Generic enemy name ("goblin", "esqueleto", "orc")
  if (state?.entities) {
    const livingEnemies = Object.values(state.entities).filter(e => e && e.role === 'enemy' && e.alive);
    if (lower === 'goblin') {
      const g = livingEnemies.find(e => e.id.startsWith('goblin') || e.classId === 'goblin');
      if (g) return g.id;
    }
    if (lower === 'esqueleto' || lower === 'skeleton') {
      const s = livingEnemies.find(e => e.id.startsWith('skeleton') || e.classId === 'skeleton');
      if (s) return s.id;
    }
    if (lower === 'orc') {
      const o = livingEnemies.find(e => e.id.startsWith('orc') || e.classId === 'orc');
      if (o) return o.id;
    }
  }

  return rawTarget;
}

/**
 * Tolerant normalization applied to raw tool batches:
 * - Accepts { tool_calls: [...] } or a bare array of calls.
 * - Trims and lowercases tool names.
 * - Maps tool aliases (e.g. attack -> use_ability, move -> move_character).
 * - Maps argument aliases (e.g. character_id <-> caster_id, target -> target_id, ability -> ability_id).
 * - Drops null, undefined, or empty string values.
 * - Coerces numeric strings on int fields and flags `coerced: true` on that call.
 * - Defaults `use_item.target_id` to `character_id`.
 * - Resolves target_id from (target_x, target_y) or adjacent enemies if state is provided.
 *
 * @param {object|Array} raw
 * @param {object|null} [state=null] Optional GameState for contextual target/ability resolution
 * @returns {{ source?: string, tool_calls: Array }} Normalized batch
 */
export function normalizeBatch(raw, state = null) {
  let source = 'UNKNOWN';
  let rawCalls = [];

  if (Array.isArray(raw)) {
    rawCalls = raw;
  } else if (raw && typeof raw === 'object') {
    if (typeof raw.source === 'string') source = raw.source;
    if (Array.isArray(raw.tool_calls)) {
      rawCalls = raw.tool_calls;
    }
  }

  const normalizedCalls = rawCalls.map(call => {
    if (!call || typeof call !== 'object' || Array.isArray(call)) {
      return call;
    }

    let rawName = typeof call.name === 'string' ? call.name.trim().toLowerCase() : call.name;
    const rawArgs = call.arguments || call.args || {};
    let callWasCoerced = false;

    // Tool Name Aliases
    if (rawName === 'attack' || rawName === 'attack_enemy' || rawName === 'attack_character' || rawName === 'strike' || rawName === 'cast_ability') {
      rawName = 'use_ability';
      callWasCoerced = true;
    } else if (rawName === 'move' || rawName === 'move_to' || rawName === 'walk') {
      rawName = 'move_character';
      callWasCoerced = true;
    } else if (rawName === 'interact' || rawName === 'open' || rawName === 'open_chest') {
      rawName = 'interact_object';
      callWasCoerced = true;
    } else if (rawName === 'push' || rawName === 'push_enemy' || rawName === 'shove' || rawName === 'empurrar' || rawName === 'shield_bash' || rawName === 'bash' || rawName === 'golpe_de_escudo' || rawName === 'escudada') {
      rawName = 'use_ability';
      if (!rawArgs.ability_id && !rawArgs.ability) {
        rawArgs.ability_id = 'shield_bash';
      }
      callWasCoerced = true;
    } else if (rawName === 'heal' || rawName === 'heal_pulse' || rawName === 'curar' || rawName === 'cura' || rawName === 'pulso_de_cura') {
      rawName = 'use_ability';
      if (!rawArgs.ability_id && !rawArgs.ability) {
        rawArgs.ability_id = 'heal_pulse';
      }
      callWasCoerced = true;
    } else if (rawName === 'firebolt' || rawName === 'raio_de_fogo') {
      rawName = 'use_ability';
      if (!rawArgs.ability_id && !rawArgs.ability) {
        rawArgs.ability_id = 'firebolt';
      }
      callWasCoerced = true;
    } else if (rawName === 'slash' || rawName === 'cortar' || rawName === 'corte') {
      rawName = 'use_ability';
      if (!rawArgs.ability_id && !rawArgs.ability) {
        rawArgs.ability_id = 'slash';
      }
      callWasCoerced = true;
    } else if (rawName === 'backstab' || rawName === 'apunhalar') {
      rawName = 'use_ability';
      if (!rawArgs.ability_id && !rawArgs.ability) {
        rawArgs.ability_id = 'backstab';
      }
      callWasCoerced = true;
    } else if (rawName === 'lockpick' || rawName === 'arrombar') {
      rawName = 'use_ability';
      if (!rawArgs.ability_id && !rawArgs.ability) {
        rawArgs.ability_id = 'lockpick';
      }
      callWasCoerced = true;
    } else if (rawName === 'potion' || rawName === 'use_potion' || rawName === 'drink_potion' || rawName === 'tomar_pocao' || rawName === 'beber_pocao') {
      rawName = 'use_item';
      if (!rawArgs.item_id && !rawArgs.item) {
        rawArgs.item_id = 'health_potion';
      }
      callWasCoerced = true;
    }

    const spec = TOOL_SPECS[rawName];
    const normArgs = {};

    if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      for (const [key, val] of Object.entries(rawArgs)) {
        if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
          continue;
        }

        const expectedType = spec?.required?.[key] || spec?.optional?.[key];
        if (expectedType === 'int' && typeof val === 'string' && /^-?\d+$/.test(val.trim())) {
          normArgs[key] = parseInt(val.trim(), 10);
          callWasCoerced = true;
        } else {
          normArgs[key] = val;
        }
      }
    }

    // Argument Aliases & Transformations
    if (rawName === 'use_ability') {
      // 1. caster_id aliases
      if (!normArgs.caster_id && normArgs.character_id) {
        normArgs.caster_id = normArgs.character_id;
        callWasCoerced = true;
      }
      if (!normArgs.caster_id && normArgs.actor) {
        normArgs.caster_id = normArgs.actor;
        callWasCoerced = true;
      }
      if (!normArgs.caster_id && state?.activeId) {
        normArgs.caster_id = state.activeId;
        callWasCoerced = true;
      }

      // 2. ability_id aliases
      if (!normArgs.ability_id && normArgs.ability) {
        normArgs.ability_id = normArgs.ability;
        delete normArgs.ability;
        callWasCoerced = true;
      }
      if (!normArgs.ability_id && normArgs.skill) {
        normArgs.ability_id = normArgs.skill;
        delete normArgs.skill;
        callWasCoerced = true;
      }
      if (normArgs.ability_id) {
        const abLower = String(normArgs.ability_id).trim().toLowerCase();
        if (['push', 'shove', 'empurrar', 'bash', 'escudo', 'escudada', 'golpe_de_escudo'].includes(abLower)) {
          if (normArgs.ability_id !== 'shield_bash') {
            normArgs.ability_id = 'shield_bash';
            callWasCoerced = true;
          }
        } else if (['heal', 'cura', 'curar', 'pulso_de_cura', 'pulso'].includes(abLower)) {
          if (normArgs.ability_id !== 'heal_pulse') {
            normArgs.ability_id = 'heal_pulse';
            callWasCoerced = true;
          }
        } else if (['fogo', 'raio', 'raio_de_fogo', 'fire'].includes(abLower)) {
          if (normArgs.ability_id !== 'firebolt') {
            normArgs.ability_id = 'firebolt';
            callWasCoerced = true;
          }
        } else if (['corte', 'cortar', 'espada'].includes(abLower)) {
          if (normArgs.ability_id !== 'slash') {
            normArgs.ability_id = 'slash';
            callWasCoerced = true;
          }
        } else if (['lock', 'arrombamento', 'arrombar'].includes(abLower)) {
          if (normArgs.ability_id !== 'lockpick') {
            normArgs.ability_id = 'lockpick';
            callWasCoerced = true;
          }
        }
      }
      if (!normArgs.ability_id && state?.activeId) {
        const activeHero = state.entities?.[state.activeId];
        if (activeHero?.abilities?.length > 0) {
          normArgs.ability_id = activeHero.abilities[0];
          callWasCoerced = true;
        }
      }

      // 3. target_id aliases
      if (!normArgs.target_id && normArgs.target) {
        normArgs.target_id = normArgs.target;
        delete normArgs.target;
        callWasCoerced = true;
      }
      if (!normArgs.target_id && normArgs.enemy_id) {
        normArgs.target_id = normArgs.enemy_id;
        delete normArgs.enemy_id;
        callWasCoerced = true;
      }

      // Semantic resolution for target_id
      if (normArgs.target_id) {
        const resolved = resolveSemanticTarget(normArgs.target_id, state, normArgs.caster_id);
        if (resolved && resolved !== normArgs.target_id) {
          normArgs.target_id = resolved;
          callWasCoerced = true;
        }
      }

      // If target_id missing but target_x & target_y present, resolve from state
      if (!normArgs.target_id && state && typeof normArgs.target_x === 'number' && typeof normArgs.target_y === 'number') {
        const entAtPos = Object.values(state.entities || {}).find(e => e && e.alive && e.position?.x === normArgs.target_x && e.position?.y === normArgs.target_y);
        if (entAtPos) {
          normArgs.target_id = entAtPos.id;
          callWasCoerced = true;
        } else {
          const objAtPos = Object.values(state.objects || {}).find(o => o && o.position?.x === normArgs.target_x && o.position?.y === normArgs.target_y);
          if (objAtPos) {
            normArgs.target_id = objAtPos.id;
            callWasCoerced = true;
          }
        }
      }

      // If target_id still missing, resolve contextually based on ability type:
      if (!normArgs.target_id && state && normArgs.caster_id) {
        const caster = state.entities?.[normArgs.caster_id];
        if (caster && caster.position) {
          const isHeal = normArgs.ability_id === 'heal_pulse';
          if (isHeal) {
            // Heal priority:
            // 1. If caster is damaged, self-heal
            if (typeof caster.hp === 'number' && typeof caster.maxHp === 'number' && caster.hp < caster.maxHp) {
              normArgs.target_id = caster.id;
              callWasCoerced = true;
            } else {
              // 2. Look for living damaged allies in range 3
              const allies = Object.values(state.entities || {}).filter(e => e && e.role === 'player' && e.alive && e.position);
              const inRangeAllies = allies.filter(e => Math.abs(e.position.x - caster.position.x) + Math.abs(e.position.y - caster.position.y) <= 3);
              const damagedAllies = inRangeAllies.filter(e => typeof e.hp === 'number' && typeof e.maxHp === 'number' && e.hp < e.maxHp);
              damagedAllies.sort((a, b) => a.hp - b.hp);

              if (damagedAllies.length > 0) {
                normArgs.target_id = damagedAllies[0].id;
                callWasCoerced = true;
              } else {
                normArgs.target_id = caster.id;
                callWasCoerced = true;
              }
            }
          } else {
            // Hostile ability: find adjacent living enemy
            const enemies = Object.values(state.entities || {}).filter(e => e && e.role === 'enemy' && e.alive && e.position);
            const adj = enemies.filter(e => Math.abs(e.position.x - caster.position.x) + Math.abs(e.position.y - caster.position.y) === 1);
            if (adj.length > 0) {
              adj.sort((a, b) => a.hp - b.hp);
              normArgs.target_id = adj[0].id;
              callWasCoerced = true;
            }
          }
        }
      }

      // Prune redundant character_id / coordinates if target_id is present
      if (normArgs.caster_id && 'character_id' in normArgs) {
        delete normArgs.character_id;
      }
      if (normArgs.target_id) {
        delete normArgs.target_x;
        delete normArgs.target_y;
      }
    } else {
      if (!normArgs.character_id && normArgs.caster_id) {
        normArgs.character_id = normArgs.caster_id;
        callWasCoerced = true;
      }
      if (normArgs.character_id && 'caster_id' in normArgs) {
        delete normArgs.caster_id;
      }

      if (rawName === 'interact_object') {
        if (!normArgs.object_id && normArgs.target_id) {
          normArgs.object_id = normArgs.target_id;
          delete normArgs.target_id;
          callWasCoerced = true;
        }
        if (!normArgs.object_id && normArgs.target) {
          normArgs.object_id = normArgs.target;
          delete normArgs.target;
          callWasCoerced = true;
        }
        if (!normArgs.object_id && state && normArgs.character_id) {
          const actor = state.entities?.[normArgs.character_id];
          if (actor && actor.position) {
            const objs = Object.values(state.objects || {}).filter(o => o && o.position);
            const adj = objs.filter(o => Math.abs(o.position.x - actor.position.x) + Math.abs(o.position.y - actor.position.y) === 1);
            if (adj.length > 0) {
              normArgs.object_id = adj[0].id;
              callWasCoerced = true;
            }
          }
        }
      }

      if (rawName === 'use_item') {
        if (!normArgs.item_id && normArgs.item) {
          normArgs.item_id = normArgs.item;
          delete normArgs.item;
          callWasCoerced = true;
        }
        // Normalize item_id aliases
        if (normArgs.item_id) {
          const itemLower = String(normArgs.item_id).trim().toLowerCase();
          if (['potion', 'pocao', 'pocao_de_cura', 'pocao_cura', 'cura', 'health_potion', 'vida'].includes(itemLower)) {
            if (normArgs.item_id !== 'health_potion') {
              normArgs.item_id = 'health_potion';
              callWasCoerced = true;
            }
          } else if (['gold', 'coins', 'moedas', 'ouro', 'moedas_de_ouro'].includes(itemLower)) {
            if (normArgs.item_id !== 'gold_coins') {
              normArgs.item_id = 'gold_coins';
              callWasCoerced = true;
            }
          }
        } else {
          normArgs.item_id = 'health_potion';
          callWasCoerced = true;
        }

        if (!normArgs.target_id && normArgs.target) {
          normArgs.target_id = normArgs.target;
          delete normArgs.target;
          callWasCoerced = true;
        }

        // Semantic resolution for target_id
        if (normArgs.target_id) {
          const resolved = resolveSemanticTarget(normArgs.target_id, state, normArgs.character_id);
          if (resolved && resolved !== normArgs.target_id) {
            normArgs.target_id = resolved;
            callWasCoerced = true;
          }
        }

        if ((normArgs.target_id === undefined || normArgs.target_id === null || normArgs.target_id === '') && normArgs.character_id) {
          normArgs.target_id = normArgs.character_id;
        }
      }
    }

    const result = {
      ...call,
      name: rawName,
      arguments: normArgs
    };

    if (callWasCoerced) {
      result.coerced = true;
    }

    return result;
  });

  const base = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? { ...raw } : {};
  return {
    ...base,
    source,
    tool_calls: normalizedCalls
  };
}

/**
 * Validates a normalized batch of tool calls against TOOL_SPECS.
 *
 * @param {object} batch
 * @param {object|null} [customTools=null] Optional tool registry for custom test tools
 * @returns {{ ok: boolean, errors: string[], calls: Array }}
 */
export function validateBatch(batch, customTools = null) {
  const maxCalls = CONFIG.MAX_TOOL_CALLS ?? 4;
  const errors = [];

  if (!batch || typeof batch !== 'object' || !Array.isArray(batch.tool_calls)) {
    return {
      ok: false,
      errors: ['O lote de ferramentas deve conter um array tool_calls válido.'],
      calls: []
    };
  }

  const calls = batch.tool_calls;

  if (calls.length > maxCalls) {
    errors.push(`TOO_MANY_CALLS: Lote com ${calls.length} chamadas excede o limite máximo de ${maxCalls}.`);
  }

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const prefix = `Chamada #${i + 1}`;

    if (!call || typeof call !== 'object' || Array.isArray(call)) {
      errors.push(`${prefix}: Estrutura de chamada inválida.`);
      continue;
    }

    if (typeof call.name !== 'string') {
      errors.push(`${prefix}: Nome da tool ausente ou não é string.`);
      continue;
    }

    const spec = TOOL_SPECS[call.name] || (customTools && customTools[call.name]?.spec) || (customTools && customTools[call.name] ? { required: {}, optional: {} } : null);
    if (!spec) {
      errors.push(`${prefix}: UNKNOWN_TOOL "${call.name}".`);
      continue;
    }

    const args = call.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      errors.push(`${prefix} (${call.name}): Argumentos inválidos.`);
      continue;
    }

    const required = spec.required || {};
    const optional = spec.optional || {};

    // Check required fields and types
    for (const [field, expectedType] of Object.entries(required)) {
      if (!(field in args)) {
        errors.push(`${prefix} (${call.name}): Argumento obrigatório ausente: "${field}".`);
        continue;
      }

      const val = args[field];
      if (expectedType === 'id') {
        if (typeof val !== 'string' || val.trim().length === 0) {
          errors.push(`${prefix} (${call.name}): Argumento "${field}" deve ser um ID em string não vazia.`);
        }
      } else if (expectedType === 'int') {
        if (typeof val !== 'number' || !Number.isInteger(val)) {
          errors.push(`${prefix} (${call.name}): Argumento "${field}" deve ser um número inteiro.`);
        }
      }
    }

    // Check optional fields if present
    for (const [field, expectedType] of Object.entries(optional)) {
      if (field in args && args[field] !== undefined && args[field] !== null) {
        const val = args[field];
        if (expectedType === 'id') {
          if (typeof val !== 'string' || val.trim().length === 0) {
            errors.push(`${prefix} (${call.name}): Argumento opcional "${field}" deve ser um ID em string não vazia.`);
          }
        } else if (expectedType === 'int') {
          if (typeof val !== 'number' || !Number.isInteger(val)) {
            errors.push(`${prefix} (${call.name}): Argumento opcional "${field}" deve ser um número inteiro.`);
          }
        }
      }
    }

    // Check for unexpected/unknown arguments (ignoring harmless schema properties from flat RESPONSE_SCHEMA)
    if (Object.keys(required).length > 0 || Object.keys(optional).length > 0) {
      for (const key of Object.keys(args)) {
        if (!required[key] && !optional[key]) {
          if (RESPONSE_SCHEMA_FIELDS.has(key)) {
            continue;
          }
          errors.push(`${prefix} (${call.name}): Argumento desconhecido rejeitado: "${key}".`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    calls
  };
}

/**
 * Gemini responseSchema definition.
 * arguments is a flat object with every possible field nullable so Gemini
 * outputs a consistent structure. validateBatch subsequently enforces per-tool constraints.
 */
export const RESPONSE_SCHEMA = Object.freeze({
  type: 'OBJECT',
  properties: {
    narrative: { type: 'STRING' },
    tool_calls: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: {
            type: 'STRING',
            enum: ['move_character', 'use_ability', 'use_item', 'interact_object', 'check_inventory', 'end_turn']
          },
          arguments: {
            type: 'OBJECT',
            properties: {
              character_id: { type: 'STRING',  nullable: true },
              caster_id:    { type: 'STRING',  nullable: true },
              target_id:    { type: 'STRING',  nullable: true },
              ability_id:   { type: 'STRING',  nullable: true },
              item_id:      { type: 'STRING',  nullable: true },
              object_id:    { type: 'STRING',  nullable: true },
              target_x:     { type: 'INTEGER', nullable: true },
              target_y:     { type: 'INTEGER', nullable: true }
            }
          }
        },
        required: ['name', 'arguments']
      }
    }
  },
  required: ['narrative', 'tool_calls']
});

export const MAX_COMMANDS = CONFIG.MAX_TOOL_CALLS ?? 4;
