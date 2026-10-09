/**
 * Builds provider-agnostic requests: { system, contents:[{role, text}], meta }.
 * Structural instructions are in English (better rule-following); the model
 * is explicitly told to write "narrative" in Brazilian Portuguese.
 */
import { MAX_COMMANDS } from '../core/schema.js';
import { MAX_MOVE } from '../engine/rules.js';
import { SPAWNABLE_KINDS } from '../engine/entities.js';

export const HISTORY_TURNS = 6;

export const SYSTEM_PROMPT = `You are the GAME MASTER of a turn-based, grid-based dungeon RPG.
The player describes an action in natural language (usually Portuguese). You decide what happens and reply with ONE JSON object that a deterministic game engine executes.

# OUTPUT FORMAT (MANDATORY)
Reply with JSON only. No markdown, no code fences, no text outside the JSON.
{
  "narrative": string,   // 1-3 short sentences, second person, written in BRAZILIAN PORTUGUESE (pt-BR)
  "commands": Command[]  // 0..${MAX_COMMANDS} commands, executed strictly in order
}

# LANGUAGE
- "narrative" MUST be written in Brazilian Portuguese (pt-BR), immersive, vivid, concise.
- All JSON keys, command types and entity ids stay exactly as specified (English, unchanged).

# COORDINATES
- x = column (0 = left), y = row (0 = top). Movement is 4-directional (no diagonals).
- "Adjacent" means Manhattan distance exactly 1 (up, down, left or right).

# COMMANDS (use only these, with exactly these fields)
- {"type":"MOVE","id":"<entity>","target":"<entity>"}  -> engine walks <id> to the nearest free tile adjacent to <target>. PREFER THIS FORM.
- {"type":"MOVE","id":"<entity>","to":{"x":int,"y":int}} -> walk to an exact free floor tile. Use "to" OR "target", never both.
- {"type":"ATTACK","attacker":"<entity>","target":"<entity>"} -> attacker must be adjacent; engine applies damage = attacker ATK. Do NOT add a DAMAGE command for an ATTACK.
- {"type":"DAMAGE","target":"<entity>","amount":int} -> direct damage from the environment (traps, falling rocks). Use rarely.
- {"type":"INTERACT","actor":"<entity>","target":"<entity>"} -> open a closed door or chest. Actor must be adjacent.
- {"type":"LOOT","actor":"<entity>","from":"<container>"} -> take everything from an OPEN chest or a loot bag. Optional "item":{"id":"<item id>","qty":int} to take one item.
- {"type":"SPAWN","id":"<new unique id>","kind":"${SPAWNABLE_KINDS.join('|')}","at":{"x":int,"y":int}} -> only when the story truly demands it; max 1 per turn.
- {"type":"DESPAWN","id":"<entity>"} -> remove an entity from the map (never the player).

# ENGINE RULES (the engine rejects illegal commands; plan around them)
- Walls (#), closed doors and creatures block movement. Open doors and loot bags do not.
- A MOVE may cover at most ${MAX_MOVE} steps. Use only ids that exist in the CURRENT STATE.
- To attack/interact/loot something that is not adjacent, first emit MOVE with "target", then the action.
- Chests must be opened with INTERACT before LOOT. Defeated creatures drop a loot bag "bag_<id>" if they carried items.
- When a creature reaches 0 HP the engine removes it automatically. Do NOT DESPAWN it yourself.
- If the player asks for something impossible or outside these mechanics, narrate why it fails and return "commands": [].
- Never act on behalf of the player beyond what they asked. One player intent per turn.

# ENEMY BEHAVIOR (you control the enemies)
- After the player's commands, each living enemy that would be adjacent to the player may ATTACK the player (append those commands after the player's).
- Enemies that are awake and within 5 tiles may MOVE toward the player with "target":"player".
- Only emit an enemy ATTACK if the enemy will survive the player's attacks this turn (track HP: damage = attacker ATK).

# REJECTION FEEDBACK
If the state lists rejected commands from last turn, do not repeat the same mistake.

# EXAMPLES
Player: "Abro a porta"   (player adjacent to door_1)
{"narrative":"Você empurra a porta pesada, que se abre com um rangido longo.","commands":[{"type":"INTERACT","actor":"player","target":"door_1"}]}

Player: "Ataco o goblin"   (goblin_1 is 3 tiles away, HP 8, player ATK 4)
{"narrative":"Você avança e acerta o goblin no ombro. Ele guincha e revida com uma lâmina enferrujada.","commands":[{"type":"MOVE","id":"player","target":"goblin_1"},{"type":"ATTACK","attacker":"player","target":"goblin_1"},{"type":"ATTACK","attacker":"goblin_1","target":"player"}]}

Player: "Pego o que tem no baú"   (chest_1 adjacent and already open)
{"narrative":"Você recolhe o conteúdo do baú e guarda na mochila.","commands":[{"type":"LOOT","actor":"player","from":"chest_1"}]}

Player: "Eu voo até o teto"
{"narrative":"Você salta com todas as forças, mas a gravidade vence. Seus pés tocam o chão de pedra novamente.","commands":[]}`;

const GLYPHS = { player: 'P', goblin: 'g', skeleton: 's', chest: 'C', door: 'D', bag: 'b' };

function glyphFor(e) {
  const g = GLYPHS[e.kind] ?? '?';
  if ((e.kind === 'chest' || e.kind === 'door') && e.open) return g.toLowerCase();
  return g;
}

/** ASCII map with coordinates and entity glyphs. */
export function renderAsciiMap(state) {
  const { map } = state;
  const rows = map.tiles.map((r) => r.split(''));
  const ordered = Object.values(state.entities).sort((a, b) => (a.kind === 'bag') - (b.kind === 'bag')).reverse();
  for (const e of ordered) rows[e.y][e.x] = glyphFor(e);
  const header = '   ' + Array.from({ length: map.width }, (_, x) => x % 10).join('');
  const body = rows.map((r, y) => String(y).padStart(2, ' ') + ' ' + r.join(''));
  return [header, ...body].join('\n');
}

function describeEntity(e) {
  const parts = [`${e.id}`, `kind=${e.kind}`, `pos=(${e.x},${e.y})`];
  if (typeof e.hp === 'number') parts.push(`hp=${e.hp}/${e.maxHp}`, `atk=${e.atk}`);
  if (e.open !== undefined && e.kind !== 'bag') parts.push(e.open ? 'open' : 'closed');
  if (e.items && e.id !== 'player' && (e.kind !== 'chest' || e.open)) {
    parts.push(`items=[${e.items.map((i) => `${i.id} x${i.qty}`).join(', ')}]`);
  }
  if (e.kind === 'chest' && !e.open) parts.push('items=unknown until opened');
  return '- ' + parts.join(' | ');
}

/** Compact, LLM-readable snapshot of the authoritative game state. */
export function renderStateSnapshot(state) {
  const player = state.entities.player;
  const inv = player?.items?.length ? player.items.map((i) => `${i.id} x${i.qty} (${i.name})`).join(', ') : 'empty';
  return [
    `TURN: ${state.turn} | STATUS: ${state.status}`,
    'MAP (legend: # wall, . floor, P player, g goblin, s skeleton, C closed chest, c open chest, D closed door, d open door, b loot bag):',
    renderAsciiMap(state),
    'ENTITIES:',
    ...Object.values(state.entities).map(describeEntity),
    `PLAYER INVENTORY: ${inv}`,
  ].join('\n');
}

function describeRejections(rejections) {
  if (!rejections?.length) return 'none';
  return rejections.map((r) => `- ${JSON.stringify(r.cmd)} -> ${r.reason}`).join('\n');
}

export function buildTurnMessage({ state, action, rejections }) {
  return [
    'CURRENT STATE:',
    renderStateSnapshot(state),
    '',
    'REJECTED COMMANDS FROM LAST TURN:',
    describeRejections(rejections),
    '',
    `PLAYER ACTION: "${action}"`,
    '',
    'Reply with the JSON object only.',
  ].join('\n');
}

/**
 * @param {{state: object, history: Array<{action: string, response: string}>, action: string, rejections?: Array}} p
 */
export function buildRequest({ state, history = [], action, rejections = [] }) {
  const contents = [];
  for (const h of history.slice(-HISTORY_TURNS)) {
    contents.push({ role: 'user', text: `PLAYER ACTION: "${h.action}"` });
    contents.push({ role: 'model', text: h.response });
  }
  contents.push({ role: 'user', text: buildTurnMessage({ state, action, rejections }) });
  return { system: SYSTEM_PROMPT, contents, meta: { action, repair: false } };
}

/** Appends the invalid answer + validation errors so the model can fix it. */
export function buildRepairRequest(request, rawText, errors) {
  return {
    ...request,
    contents: [
      ...request.contents,
      { role: 'model', text: rawText || '(empty response)' },
      {
        role: 'user',
        text: `Your previous reply was INVALID and nothing was executed. Errors:\n${errors.map((e) => `- ${e}`).join('\n')}\nReturn ONLY the corrected JSON object following the contract exactly.`,
      },
    ],
    meta: { ...request.meta, repair: true },
  };
}

/**
 * Gemini responseSchema (OpenAPI subset). Commands use a flat object with an
 * enum "type"; per-type requirements are enforced by core/schema.js.
 */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    narrative: { type: 'STRING' },
    commands: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['SPAWN', 'MOVE', 'ATTACK', 'DAMAGE', 'INTERACT', 'LOOT', 'DESPAWN'] },
          id: { type: 'STRING' },
          kind: { type: 'STRING' },
          at: { type: 'OBJECT', properties: { x: { type: 'INTEGER' }, y: { type: 'INTEGER' } }, required: ['x', 'y'] },
          to: { type: 'OBJECT', properties: { x: { type: 'INTEGER' }, y: { type: 'INTEGER' } }, required: ['x', 'y'] },
          target: { type: 'STRING' },
          attacker: { type: 'STRING' },
          actor: { type: 'STRING' },
          from: { type: 'STRING' },
          amount: { type: 'INTEGER' },
          hp: { type: 'INTEGER' },
          item: { type: 'OBJECT', properties: { id: { type: 'STRING' }, qty: { type: 'INTEGER' } }, required: ['id'] },
        },
        required: ['type'],
      },
    },
  },
  required: ['narrative', 'commands'],
  propertyOrdering: ['narrative', 'commands'],
};
