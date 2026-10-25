/**
 * Prompt Builder for LLM Game Master (Sprint 3, Task 3.4).
 * Generates system prompts (Config A vs B), deterministic state snapshots,
 * and structured Gemini API requests.
 *
 * Ground Rules: Pure JS, zero DOM, zero Canvas, zero Math.random(), never mutates state.
 */
import { RESPONSE_SCHEMA } from '../core/schema.js';
import { CLASSES, ABILITIES, ITEMS } from '../engine/catalog.js';
import { computeReachable } from '../engine/pathfinding.js';
import { toAscii } from '../engine/mapGenerator.js';

export { RESPONSE_SCHEMA };

/**
 * Builds the system prompt for the Game Master.
 * Config A: Role + Tool Contract + Rules.
 * Config B: Adds spatial reasoning guidance and 3 PT-BR few-shot examples.
 *
 * @param {'A'|'B'} [config='B']
 * @returns {string}
 */
export function buildSystemPrompt(config = 'B') {
  const isB = config === 'B';

  const roleBlock = `Você é o Mestre de Jogo de um RPG tático por turnos em uma masmorra 12x12.
Escreva o campo "narrative" SEMPRE em português do Brasil, contendo de 1 a 3 frases imersivas e concisas descrevendo a ação do herói ativo e a reação do ambiente ou criaturas.
Você NÃO altera o estado do jogo diretamente: você apenas propõe "tool_calls" estritamente de acordo com o contrato JSON abaixo. O motor de regras é a autoridade absoluta: ele valida e pode rejeitar qualquer chamada que viole as regras da masmorra.`;

  const contractBlock = `# CONTRATO DE SAÍDA (JSON)
Sua resposta DEVE ser estritamente um objeto JSON com duas chaves:
{
  "narrative": "Frase em português descrevendo os acontecimentos...",
  "tool_calls": [
    {
      "name": "<nome_da_ferramenta>",
      "arguments": { ... }
    }
  ]
}

# FERRAMENTAS DISPONÍVEIS E REGRAS:
1. move_character:
   - Argumentos: { "character_id": string, "target_x": integer, "target_y": integer }
   - Move o herói ativo até as coordenadas (target_x, target_y).
   - O custo em pontos de movimento (MP) é a distância de passos pelo caminho livre de obstáculos.
   - Convenção de coordenadas: x de 0 a 11 (leste = x+1, oeste = x-1), y de 0 a 11 (norte = y-1, sul = y+1).
   - Paredes (#) e outras criaturas vivas bloqueiam movimento.

2. use_ability:
   - Argumentos: { "caster_id": string, "ability_id": string, "target_id": string (opcional), "target_x": integer (opcional), "target_y": integer (opcional) }
   - Custa 1 AP (Pontos de Ação). O conjurador DEVE ser o herói ativo.
   - A habilidade deve pertencer à classe do herói ativo e o alvo deve estar dentro do alcance (range) e com linha de visão.
   - Habilidades ofensivas (slash, shield_bash, firebolt, backstab) exigem alvo inimigo vivo.
   - Habilidades de cura (heal_pulse) exigem alvo aliado vivo (ou o próprio conjurador).
   - Habilidades de objeto (lockpick) exigem alvo baú adjacente.

3. use_item:
   - Argumentos: { "character_id": string, "item_id": string, "target_id": string (opcional, padrão = character_id) }
   - Consome 1 unidade do item do inventário do herói ativo. Não custa AP nem MP.

4. interact_object:
   - Argumentos: { "character_id": string, "object_id": string }
   - Interage com um objeto adjacente (distância Manhattan = 1), como abrir um baú destrancado.

5. check_inventory:
   - Argumentos: { "character_id": string }
   - Consulta o inventário do herói ativo. Ação livre.

6. end_turn:
   - Argumentos: { "character_id": string }
   - Encerra o turno do herói ativo.
   - REGRA CRÍTICA: NUNCA chame end_turn a menos que o jogador peça explicitamente para passar ou encerrar a vez.

# RESTRIÇÕES GERAIS:
- Use APENAS IDs existentes no ESTADO fornecido (ex: "hero_warrior", "goblin_1", "chest_1").
- No máximo 4 tool_calls por resposta.
- APENAS o herói ativo ("active_character") pode agir.
- Se o pedido do jogador for impossível ou violar as regras (ex: tentar atravessar paredes, atacar sem alcance, gastar AP sem ter, mover sem MP suficiente), retorne "tool_calls": [] e explique cordialmente na "narrative" a razão da impossibilidade física ou tática.`;

  const spatialBlock = isB
    ? `
# ORIENTAÇÃO ESPACIAL E TÁTICA (CONFIG B):
- Escolha coordenadas de destino para move_character ESTRITAMENTE a partir da lista "reachable_tiles" do ESTADO.
- Para realizar uma investida de mover e atacar no mesmo turno, consulte "attack_positions": ela indica posições alcançáveis de onde o herói terá alcance suficiente para atingir o inimigo desejado.
- Se "selected_ui_tag" estiver preenchido no ESTADO, priorize o uso daquela habilidade ou item indicado pela interface.`
    : '';

  const fewShotBlock = isB
    ? `
# EXEMPLOS DE COMPORTAMENTO (POUCOS DISPAROS):
Exemplo 1 (Mover + Atacar):
Jogador: "Ando até o goblin e corto ele"
{
  "narrative": "Thorin avança com bravura pelo corredor de pedra e golpeia o goblin com sua lâmina afiada.",
  "tool_calls": [
    {
      "name": "move_character",
      "arguments": { "character_id": "hero_warrior", "target_x": 2, "target_y": 8 }
    },
    {
      "name": "use_ability",
      "arguments": { "caster_id": "hero_warrior", "ability_id": "slash", "target_id": "goblin_1" }
    }
  ]
}

Exemplo 2 (Contextual / Cura):
Jogador: "Estou ferido, quero me curar"
{
  "narrative": "Sentindo o peso dos ferimentos, Lyra canaliza energia luminosa para restaurar suas forças vitais.",
  "tool_calls": [
    {
      "name": "use_ability",
      "arguments": { "caster_id": "hero_mage", "ability_id": "heal_pulse", "target_id": "hero_mage" }
    }
  ]
}

Exemplo 3 (Recusa / Impossível):
Jogador: "Atravesso a parede e mato todos os goblins"
{
  "narrative": "Paredes de pedra sólida não podem ser atravessadas e você possui energia para apenas uma ação principal neste turno.",
  "tool_calls": []
}`
    : '';

  return [roleBlock, contractBlock, spatialBlock, fewShotBlock].filter(Boolean).join('\n\n');
}

/**
 * Formats ability effect into friendly PT-BR description.
 * @param {object} spec
 * @returns {string}
 */
function describeAbilityEffect(spec) {
  if (!spec?.effect) return '';
  const eff = spec.effect;
  if (eff.type === 'damage') {
    return `${eff.amount} de dano${eff.push ? `, empurra ${eff.push}` : ''}`;
  }
  if (eff.type === 'heal') {
    return `+${eff.amount} PV em aliado`;
  }
  if (eff.type === 'unlock') {
    return 'destranca baú adjacente';
  }
  return eff.type;
}

/**
 * Generates an ASCII representation of the 12x12 map with entities stamped.
 * @param {object} state
 * @returns {string[]} Array of 12 strings
 */
export function buildMapAscii(state) {
  return toAscii(state);
}

/**
 * Builds a deterministic state snapshot object for LLM consumption.
 *
 * @param {object} state
 * @param {'A'|'B'} [config='B']
 * @returns {object}
 */
export function buildStateSnapshot(state, config = 'B') {
  const activeId = state?.activeId;
  const activeHero = state?.entities?.[activeId];

  // Abilities of active hero
  const heroAbilities = (activeHero?.abilities || []).map((abId) => {
    const spec = ABILITIES[abId] || { id: abId, label: abId, range: 1 };
    return {
      id: abId,
      name: spec.label || abId,
      range: spec.range ?? 1,
      effect: describeAbilityEffect(spec)
    };
  });

  const activeCharObj = activeHero
    ? {
        id: activeHero.id,
        name: activeHero.name,
        class: activeHero.classId,
        position: { x: activeHero.position.x, y: activeHero.position.y },
        hp: activeHero.hp,
        max_hp: activeHero.maxHp,
        mp: activeHero.mp,
        ap: activeHero.ap,
        abilities: heroAbilities
      }
    : null;

  // Party members (all other heroes sorted by ID)
  const party = Object.values(state?.entities || {})
    .filter((e) => e.role === 'hero' && e.id !== activeId)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((h) => ({
      id: h.id,
      name: h.name,
      class: h.classId,
      position: { x: h.position.x, y: h.position.y },
      hp: h.hp,
      max_hp: h.maxHp,
      alive: Boolean(h.alive)
    }));

  // Enemies (living enemies sorted by ID)
  const enemies = Object.values(state?.entities || {})
    .filter((e) => e.role === 'enemy' && e.alive)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      position: { x: e.position.x, y: e.position.y },
      hp: e.hp,
      max_hp: e.maxHp
    }));

  // Objects (sorted by ID)
  const objects = Object.values(state?.objects || {})
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((o) => ({
      id: o.id,
      type: o.type,
      position: { x: o.position.x, y: o.position.y },
      locked: Boolean(o.locked),
      opened: Boolean(o.opened)
    }));

  // Inventory (sorted by ID)
  const inventory = (activeHero?.inventory || [])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      qty: item.qty,
      usable: Boolean(ITEMS[item.id]?.usable)
    }));

  // Snapshot Base (Configs A & B)
  const snapshot = {
    round: state?.round ?? 1,
    active_character: activeCharObj,
    party,
    enemies,
    objects,
    inventory,
    map_ascii: buildMapAscii(state),
    player_text_pt: '',
    selected_ui_tag: null
  };

  // Config B: Spatial pre-computations
  if (config === 'B' && activeHero && activeHero.alive) {
    // 1. reachable_tiles
    const reachableMap = computeReachable(state, activeHero.id, activeHero.mp);
    const reachable_tiles = [];
    for (const [k, cost] of reachableMap.entries()) {
      if (cost <= activeHero.mp) {
        const [x, y] = k.split(',').map(Number);
        reachable_tiles.push([x, y, cost]);
      }
    }
    // Deterministic sort: cost asc, y asc, x asc
    reachable_tiles.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    snapshot.reachable_tiles = reachable_tiles;

    // 2. enemy_distances & in_range_now
    const enemy_distances = enemies.map((enemy) => {
      const manhattan = Math.abs(enemy.position.x - activeHero.position.x) + Math.abs(enemy.position.y - activeHero.position.y);
      const in_range_now = {};
      for (const ab of heroAbilities) {
        in_range_now[ab.id] = manhattan <= ab.range;
      }
      return {
        id: enemy.id,
        manhattan,
        in_range_now
      };
    });
    snapshot.enemy_distances = enemy_distances;

    // 3. attack_positions: { [ability_id]: { [enemy_id]: [[x, y, cost], ...] } }
    const attack_positions = {};
    for (const ab of heroAbilities) {
      const abSpec = ABILITIES[ab.id];
      if (abSpec?.target === 'enemy') {
        attack_positions[ab.id] = {};
        for (const enemy of enemies) {
          const tilesThatReach = reachable_tiles.filter(([x, y]) => {
            const dist = Math.abs(x - enemy.position.x) + Math.abs(y - enemy.position.y);
            return dist <= ab.range;
          });
          if (tilesThatReach.length > 0) {
            attack_positions[ab.id][enemy.id] = tilesThatReach;
          }
        }
      }
    }
    snapshot.attack_positions = attack_positions;

    // 4. adjacent_objects
    const adjacent_objects = objects.filter((o) => {
      const dist = Math.abs(o.position.x - activeHero.position.x) + Math.abs(o.position.y - activeHero.position.y);
      return dist <= 1;
    });
    snapshot.adjacent_objects = adjacent_objects;
  }

  return snapshot;
}

/**
 * Builds the user turn text block with snapshot and player input.
 * @param {object} params
 * @param {object} params.state
 * @param {string} params.text
 * @param {object|string|null} [params.tag]
 * @param {'A'|'B'} [params.config='B']
 * @returns {string}
 */
export function buildUserTurn({ state, text, tag = null, config = 'B' }) {
  const snapshot = buildStateSnapshot(state, config);
  snapshot.player_text_pt = text;
  snapshot.selected_ui_tag = tag?.id || (typeof tag === 'string' ? tag : null);

  const activeHero = state?.entities?.[state?.activeId];
  const heroName = activeHero?.name || 'Herói';
  const tagStr = snapshot.selected_ui_tag ? `
[Tag Ativa: ${snapshot.selected_ui_tag}]` : '';

  return `ESTADO:
${JSON.stringify(snapshot, null, 2)}

JOGADOR (${heroName}): ${text}${tagStr}`;
}

/**
 * Builds the complete structured request for Gemini API.
 * @param {object} params
 * @param {object} params.state
 * @param {string} params.text
 * @param {object|string|null} [params.tag]
 * @param {'A'|'B'} [params.config='B']
 * @param {Array} [params.memory=[]]
 * @returns {{ system: string, contents: Array, schema: object }}
 */
export function buildRequest({ state, text, tag = null, config = 'B', memory = [] }) {
  const system = buildSystemPrompt(config);
  const userText = buildUserTurn({ state, text, tag, config });

  const contents = [
    ...memory.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }]
    })),
    {
      role: 'user',
      parts: [{ text: userText }]
    }
  ];

  return {
    system,
    contents,
    schema: RESPONSE_SCHEMA
  };
}
