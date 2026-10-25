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
    optional: Object.freeze({})
  }),
  use_ability: Object.freeze({
    required: Object.freeze({
      caster_id: 'id',
      ability_id: 'id',
      target_id: 'id'
    }),
    optional: Object.freeze({})
  }),
  use_item: Object.freeze({
    required: Object.freeze({
      character_id: 'id',
      item_id: 'id'
    }),
    optional: Object.freeze({
      target_id: 'id'
    })
  }),
  interact_object: Object.freeze({
    required: Object.freeze({
      character_id: 'id',
      object_id: 'id'
    }),
    optional: Object.freeze({})
  }),
  check_inventory: Object.freeze({
    required: Object.freeze({
      character_id: 'id'
    }),
    optional: Object.freeze({})
  }),
  end_turn: Object.freeze({
    required: Object.freeze({
      character_id: 'id'
    }),
    optional: Object.freeze({})
  })
});

/**
 * Tolerant normalization applied to raw tool batches:
 * - Accepts { tool_calls: [...] } or a bare array of calls.
 * - Trims and lowercases tool names.
 * - Drops null or undefined argument values.
 * - Coerces numeric strings on int fields and flags `coerced: true` on that call.
 * - Defaults `use_item.target_id` to `character_id`.
 *
 * @param {object|Array} raw
 * @returns {{ source?: string, tool_calls: Array }} Normalized batch
 */
export function normalizeBatch(raw) {
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

    const rawName = typeof call.name === 'string' ? call.name.trim().toLowerCase() : call.name;
    const rawArgs = call.arguments || call.args || {};
    const spec = TOOL_SPECS[rawName];

    let callWasCoerced = false;
    const normArgs = {};

    if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      for (const [key, val] of Object.entries(rawArgs)) {
        if (val === null || val === undefined) {
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

    // Default use_item.target_id to character_id
    if (rawName === 'use_item') {
      if ((normArgs.target_id === undefined || normArgs.target_id === null || normArgs.target_id === '') && normArgs.character_id) {
        normArgs.target_id = normArgs.character_id;
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

    // Check for unexpected/unknown arguments (only if spec defines required or optional)
    if (Object.keys(required).length > 0 || Object.keys(optional).length > 0) {
      for (const key of Object.keys(args)) {
        if (!required[key] && !optional[key]) {
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
