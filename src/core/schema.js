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
    })
  }),
  use_ability: Object.freeze({
    required: Object.freeze({
      caster_id: 'id',
      ability_id: 'id',
      target_id: 'id'
    })
  }),
  end_turn: Object.freeze({
    required: Object.freeze({
      character_id: 'id'
    })
  })
});

/**
 * Tolerant normalization applied to raw tool batches:
 * - Accepts { tool_calls: [...] } or a bare array of calls.
 * - Trims and lowercases tool names.
 * - Drops null or undefined argument values.
 * - Coerces numeric strings on int fields and flags `coerced: true` on that call.
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

        const expectedType = spec?.required?.[key];
        if (expectedType === 'int' && typeof val === 'string' && /^-?\d+$/.test(val.trim())) {
          normArgs[key] = parseInt(val.trim(), 10);
          callWasCoerced = true;
        } else {
          normArgs[key] = val;
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
 * @returns {{ ok: boolean, errors: string[], calls: Array }}
 */
export function validateBatch(batch) {
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

    const spec = TOOL_SPECS[call.name];
    if (!spec) {
      errors.push(`${prefix}: UNKNOWN_TOOL "${call.name}".`);
      continue;
    }

    const args = call.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      errors.push(`${prefix} (${call.name}): Argumentos inválidos.`);
      continue;
    }

    // Check required fields and types
    for (const [field, expectedType] of Object.entries(spec.required || {})) {
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

    // Check for unexpected/unknown arguments
    for (const key of Object.keys(args)) {
      if (!spec.required?.[key]) {
        errors.push(`${prefix} (${call.name}): Argumento desconhecido rejeitado: "${key}".`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    calls
  };
}
