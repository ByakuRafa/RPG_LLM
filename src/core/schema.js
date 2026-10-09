/**
 * JSON Contract v1 — structural validation only (types, required fields).
 * State-dependent legality (walls, range, HP) lives in engine/rules.js.
 *
 * Envelope:
 *   { "narrative": string, "commands": Command[] }
 *
 * Commands:
 *   SPAWN    { id, kind, at:{x,y}, hp?, items?:[{id,name?,qty?}] }
 *   MOVE     { id, to:{x,y} }  OR  { id, target:entityId }   (exactly one)
 *   ATTACK   { attacker, target }
 *   DAMAGE   { target, amount }
 *   INTERACT { actor, target }
 *   LOOT     { actor, from, item?:{id, qty?} }   (no item = take everything)
 *   DESPAWN  { id }
 */
export const CONTRACT_VERSION = 1;
export const MAX_COMMANDS = 8;
export const MAX_NARRATIVE = 1200;
export const COMMAND_TYPES = ['SPAWN', 'MOVE', 'ATTACK', 'DAMAGE', 'INTERACT', 'LOOT', 'DESPAWN'];

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const NUMERIC_FIELDS = new Set(['x', 'y', 'amount', 'hp', 'qty']);

/** Field spec: [type, required] */
const SPECS = {
  SPAWN:    { id: ['id', true], kind: ['string', true], at: ['pos', true], hp: ['hp', false], items: ['items', false] },
  MOVE:     { id: ['id', true], to: ['pos', false], target: ['id', false] },
  ATTACK:   { attacker: ['id', true], target: ['id', true] },
  DAMAGE:   { target: ['id', true], amount: ['amount', true] },
  INTERACT: { actor: ['id', true], target: ['id', true] },
  LOOT:     { actor: ['id', true], from: ['id', true], item: ['itemRef', false] },
  DESPAWN:  { id: ['id', true] },
};

/**
 * Tolerant normalization applied before validation, identical for LLM and GM
 * payloads: drops null/empty fields, upper-cases `type`, coerces numeric
 * strings, accepts [x,y] arrays as positions and bare strings as item refs.
 */
export function normalizePayload(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const out = { ...raw };
  if (out.commands === undefined || out.commands === null) out.commands = [];
  if (Array.isArray(out.commands)) out.commands = out.commands.map(normalizeCommand);
  return out;
}

function normalizeCommand(cmd) {
  if (cmd === null || typeof cmd !== 'object' || Array.isArray(cmd)) return cmd;
  const out = cleanValue(cmd);
  if (typeof out.type === 'string') out.type = out.type.trim().toUpperCase();
  for (const key of ['at', 'to']) {
    if (Array.isArray(out[key]) && out[key].length === 2) out[key] = { x: out[key][0], y: out[key][1] };
    if (out[key] && typeof out[key] === 'object') out[key] = cleanValue(out[key]);
  }
  if (typeof out.item === 'string') out.item = { id: out.item };
  return out;
}

function cleanValue(value, key) {
  if (Array.isArray(value)) return value.map((v) => cleanValue(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      out[k] = cleanValue(v, k);
    }
    return out;
  }
  if (typeof value === 'string' && NUMERIC_FIELDS.has(key) && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  if (typeof value === 'string') return value.trim();
  return value;
}

function checkField(type, value) {
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.length > 0 && value.length <= 40 ? null : 'must be a non-empty string';
    case 'id':
      return typeof value === 'string' && ID_RE.test(value) ? null : 'must be an id string matching [A-Za-z0-9_-]';
    case 'pos':
      return value && typeof value === 'object' && Number.isInteger(value.x) && Number.isInteger(value.y)
        ? null
        : 'must be an object {"x": int, "y": int}';
    case 'hp':
      return Number.isInteger(value) && value >= 1 && value <= 999 ? null : 'must be an integer 1..999';
    case 'amount':
      return Number.isInteger(value) && value >= 1 && value <= 99 ? null : 'must be an integer 1..99';
    case 'items':
      if (!Array.isArray(value)) return 'must be an array of {"id", "qty"}';
      for (const it of value) {
        const err = checkField('itemRef', it);
        if (err) return `entries ${err}`;
      }
      return null;
    case 'itemRef':
      if (!value || typeof value !== 'object' || !ID_RE.test(value.id ?? '')) return 'must be an object {"id": string, "qty"?: int}';
      if (value.qty !== undefined && !(Number.isInteger(value.qty) && value.qty >= 1 && value.qty <= 99)) return 'qty must be an integer 1..99';
      if (value.name !== undefined && typeof value.name !== 'string') return 'name must be a string';
      return null;
    default:
      return `unknown field type ${type}`;
  }
}

/** Validates one (already normalized) command. Returns a list of error strings. */
export function validateCommand(cmd) {
  if (cmd === null || typeof cmd !== 'object' || Array.isArray(cmd)) return ['command must be an object'];
  if (typeof cmd.type !== 'string') return ['missing "type"'];
  const spec = SPECS[cmd.type];
  if (!spec) return [`unknown command type "${cmd.type}" (allowed: ${COMMAND_TYPES.join(', ')})`];

  const errors = [];
  for (const [field, [type, required]] of Object.entries(spec)) {
    if (cmd[field] === undefined) {
      if (required) errors.push(`${cmd.type}.${field} is required`);
      continue;
    }
    const err = checkField(type, cmd[field]);
    if (err) errors.push(`${cmd.type}.${field} ${err}`);
  }
  if (cmd.type === 'MOVE') {
    const hasTo = cmd.to !== undefined;
    const hasTarget = cmd.target !== undefined;
    if (hasTo === hasTarget) errors.push('MOVE requires exactly one of "to" or "target"');
  }
  return errors;
}

/**
 * Validates a full payload.
 * - `errors`: envelope-level problems (payload unusable).
 * - `commandErrors`: per-command problems (those commands are dropped).
 * - `payload`: normalized payload containing only structurally valid commands.
 * - `ok`: true only when there are no errors at all.
 */
export function validatePayload(raw) {
  const data = normalizePayload(raw);
  const errors = [];
  const commandErrors = [];

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['payload must be a JSON object {"narrative", "commands"}'], commandErrors, payload: null };
  }
  if (typeof data.narrative !== 'string' || data.narrative.trim() === '') {
    errors.push('"narrative" must be a non-empty string');
  } else if (data.narrative.length > MAX_NARRATIVE) {
    errors.push(`"narrative" exceeds ${MAX_NARRATIVE} characters`);
  }
  if (!Array.isArray(data.commands)) {
    errors.push('"commands" must be an array');
  }
  if (errors.length) return { ok: false, errors, commandErrors, payload: null };

  const valid = [];
  data.commands.forEach((cmd, index) => {
    if (index >= MAX_COMMANDS) {
      commandErrors.push({ index, command: cmd, errors: [`exceeds max ${MAX_COMMANDS} commands per turn`] });
      return;
    }
    const errs = validateCommand(cmd);
    if (errs.length) commandErrors.push({ index, command: cmd, errors: errs });
    else valid.push(cmd);
  });

  return {
    ok: commandErrors.length === 0,
    errors,
    commandErrors,
    payload: { narrative: data.narrative.trim(), commands: valid },
  };
}
