/**
 * Turns raw LLM text into a validated payload. Tolerates code fences and
 * leading/trailing chatter; everything else is reported as a typed error.
 */
import { validatePayload } from '../core/schema.js';

/** Finds the first balanced {...} block, honoring strings and escapes. */
export function extractJsonBlock(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * @returns {{ok: boolean, stage: 'empty'|'json'|'schema'|'ok', payload: object|null,
 *            errors: string[], commandErrors: Array, raw: string}}
 */
export function parseLLMResponse(text) {
  const raw = typeof text === 'string' ? text : '';
  const base = { raw, payload: null, errors: [], commandErrors: [] };
  if (!raw.trim()) return { ...base, ok: false, stage: 'empty', errors: ['empty response'] };

  const unfenced = raw.replace(/```(?:json)?/gi, '').trim();
  let data;
  try {
    data = JSON.parse(unfenced);
  } catch {
    const block = extractJsonBlock(unfenced);
    if (!block) return { ...base, ok: false, stage: 'json', errors: ['no JSON object found in response'] };
    try {
      data = JSON.parse(block);
    } catch (err) {
      return { ...base, ok: false, stage: 'json', errors: [`invalid JSON: ${err.message}`] };
    }
  }

  const v = validatePayload(data);
  return {
    ...base,
    ok: v.ok,
    stage: v.ok ? 'ok' : 'schema',
    payload: v.payload,
    errors: v.errors,
    commandErrors: v.commandErrors,
  };
}

/** Human/LLM-readable list of every problem in a parse result. */
export function describeParseErrors(result) {
  const lines = [...result.errors];
  for (const ce of result.commandErrors) lines.push(`commands[${ce.index}]: ${ce.errors.join('; ')}`);
  return lines;
}
