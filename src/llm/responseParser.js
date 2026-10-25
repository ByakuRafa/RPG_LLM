/**
 * Response parser for LLM outputs.
 * Extracts JSON, normalizes narrative and tool_calls, coerces stringified arguments,
 * builds repair turns, and integrates schema validation.
 */
import { normalizeBatch, validateBatch } from '../core/schema.js';

/**
 * Finds the first balanced {...} block in text, honoring strings and escapes.
 * @param {string} text
 * @returns {string|null}
 */
export function extractJsonBlock(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Extracts and parses a JSON object from raw LLM text:
 * 1. Trims and strips Markdown code fences (```json ... ```)
 * 2. Attempts JSON.parse
 * 3. Falls back to extracting balanced {...} block with string/escape awareness
 * 4. Returns typed error if not found or malformed.
 *
 * @param {string} text
 * @returns {{ ok: boolean, value: object|null, error: string|null }}
 */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, value: null, error: 'Texto de resposta vazio ou inválido' };
  }

  let cleaned = text.trim();

  // Strip wrapping markdown code fences
  const outerFence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (outerFence) {
    cleaned = outerFence[1].trim();
  }

  // 1. Direct parse attempt on cleaned text
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') {
      return { ok: true, value: parsed, error: null };
    }
  } catch {
    // Continue to fallback strategies
  }

  // 2. Try embedded code fence if surrounded by conversational text
  const innerFence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (innerFence) {
    try {
      const parsedFence = JSON.parse(innerFence[1].trim());
      if (parsedFence && typeof parsedFence === 'object') {
        return { ok: true, value: parsedFence, error: null };
      }
    } catch {
      // Continue to balanced block extraction
    }
  }

  // 3. Fallback: Extract first balanced {...} block
  const block = extractJsonBlock(cleaned) || extractJsonBlock(text);
  if (block) {
    try {
      const parsedBlock = JSON.parse(block);
      if (parsedBlock && typeof parsedBlock === 'object') {
        return { ok: true, value: parsedBlock, error: null };
      }
    } catch (err) {
      return { ok: false, value: null, error: `JSON inválido na resposta: ${err.message}` };
    }
  }

  return { ok: false, value: null, error: 'Nenhum objeto JSON encontrado na resposta' };
}

/**
 * Normalizes the extracted JSON object into a consistent envelope:
 * - narrative default '', truncated to 1200 chars
 * - aliases toolCalls / commands / actions -> tool_calls (flags.aliasUsed = true)
 * - arguments given as JSON strings are parsed (flags.coerced = true)
 * - applies normalizeBatch (drops nulls, coerces integer fields, sets flags.coerced)
 *
 * @param {object|Array} obj
 * @returns {{ narrative: string, tool_calls: Array, flags: { aliasUsed: boolean, coerced: boolean } }}
 */
export function normalizeEnvelope(obj, state = null) {
  let narrative = '';
  const flags = {
    aliasUsed: false,
    coerced: false
  };

  if (obj && typeof obj === 'object') {
    if (typeof obj.narrative === 'string') {
      narrative = obj.narrative.slice(0, 1200);
    }
  }

  let rawCalls = [];
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj.tool_calls)) {
      rawCalls = obj.tool_calls;
    } else if (Array.isArray(obj.toolCalls)) {
      rawCalls = obj.toolCalls;
      flags.aliasUsed = true;
    } else if (Array.isArray(obj.commands)) {
      rawCalls = obj.commands;
      flags.aliasUsed = true;
    } else if (Array.isArray(obj.actions)) {
      rawCalls = obj.actions;
      flags.aliasUsed = true;
    } else if (Array.isArray(obj)) {
      rawCalls = obj;
    }
  }

  // Parse stringified arguments if LLM emitted JSON string inside arguments
  const callsWithParsedArgs = rawCalls.map((call) => {
    if (!call || typeof call !== 'object' || Array.isArray(call)) {
      return call;
    }

    let parsedArgs = call.arguments ?? call.args;

    if (typeof parsedArgs === 'string') {
      try {
        parsedArgs = JSON.parse(parsedArgs);
        flags.coerced = true;
      } catch {
        // Keep original if not valid JSON
      }
    }

    return {
      ...call,
      arguments: parsedArgs
    };
  });

  const batch = normalizeBatch({ tool_calls: callsWithParsedArgs }, state);

  if (batch.tool_calls.some((c) => c && c.coerced)) {
    flags.coerced = true;
  }

  return {
    narrative,
    tool_calls: batch.tool_calls,
    flags
  };
}

/**
 * Builds a single-shot repair turn prompt when the LLM returned invalid syntax or contract.
 * @param {string|object} error
 * @returns {{ role: 'user', text: string, parts: Array<{ text: string }> }}
 */
export function buildRepairTurn(error) {
  const errMsg = typeof error === 'string' ? error : (error?.message || error?.error || 'formato inválido');
  const text = `Sua resposta anterior não era um JSON válido no contrato (erro: ${errMsg}). Responda SOMENTE com o objeto JSON {"narrative": "...", "tool_calls": [...]}. Sem texto adicional, sem formatação Markdown fora do JSON.`;
  return {
    role: 'user',
    text,
    parts: [{ text }]
  };
}

/**
 * Convenience orchestrator parsing and validating raw LLM text:
 * extractJson -> normalizeEnvelope -> validateBatch
 * @param {string} text
 * @param {object|null} [customTools=null]
 * @returns {{ ok: boolean, error: string|null, errors: string[], envelope: object|null, calls: Array, flags: object }}
 */
export function parseAndValidate(text, customTools = null, state = null) {
  const jsonRes = extractJson(text);
  if (!jsonRes.ok) {
    return {
      ok: false,
      error: jsonRes.error,
      errors: [jsonRes.error],
      envelope: null,
      calls: [],
      flags: { aliasUsed: false, coerced: false }
    };
  }

  const envelope = normalizeEnvelope(jsonRes.value, state);
  const valRes = validateBatch({ tool_calls: envelope.tool_calls }, customTools);

  if (!valRes.ok) {
    return {
      ok: false,
      error: valRes.errors.join('; '),
      errors: valRes.errors,
      envelope,
      calls: envelope.tool_calls,
      flags: envelope.flags
    };
  }

  return {
    ok: true,
    error: null,
    errors: [],
    envelope,
    calls: valRes.calls,
    flags: envelope.flags
  };
}

/**
 * Legacy wrapper for backwards compatibility with tests.
 * @param {string} text
 */
export function parseLLMResponse(text, state = null) {
  const res = parseAndValidate(text, null, state);
  if (res.ok) {
    return {
      ok: true,
      stage: 'ok',
      payload: { narrative: res.envelope.narrative, commands: res.calls, tool_calls: res.calls },
      errors: [],
      commandErrors: [],
      raw: text
    };
  }

  const isJsonStage = res.envelope === null;
  return {
    ok: false,
    stage: isJsonStage ? 'json' : 'schema',
    payload: res.envelope ? { narrative: res.envelope.narrative, commands: res.calls, tool_calls: res.calls } : null,
    errors: res.errors,
    commandErrors: [],
    raw: text
  };
}

/**
 * Describes parse errors for debugging / logging.
 * @param {object} result
 * @returns {string[]}
 */
export function describeParseErrors(result) {
  const lines = [...(result.errors || [])];
  if (result.commandErrors) {
    for (const ce of result.commandErrors) {
      lines.push(`commands[${ce.index}]: ${ce.errors.join('; ')}`);
    }
  }
  return lines;
}
