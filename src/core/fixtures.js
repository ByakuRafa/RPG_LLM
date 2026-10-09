/**
 * Canonical mock payloads. Shared by the Human GM panel and the test suite so
 * that what the human validates is exactly what the tests assert.
 * All fixed-id fixtures assume the initial demo state (engine/map.js).
 */

const GM = '[Mestre Humano]';

/** Parameterized preset builders used by the GM panel buttons. */
export const presets = {
  spawn: (id, kind, x, y) => ({
    narrative: `${GM} Um ${kind} surge em (${x},${y}).`,
    commands: [{ type: 'SPAWN', id, kind, at: { x, y } }],
  }),
  movePlayer: (x, y) => ({
    narrative: `${GM} O herói se move para (${x},${y}).`,
    commands: [{ type: 'MOVE', id: 'player', to: { x, y } }],
  }),
  moveEntity: (id, x, y) => ({
    narrative: `${GM} ${id} se move para (${x},${y}).`,
    commands: [{ type: 'MOVE', id, to: { x, y } }],
  }),
  approach: (target) => ({
    narrative: `${GM} O herói se aproxima de ${target}.`,
    commands: [{ type: 'MOVE', id: 'player', target }],
  }),
  playerAttack: (target) => ({
    narrative: `${GM} O herói ataca ${target}!`,
    commands: [{ type: 'ATTACK', attacker: 'player', target }],
  }),
  enemyAttack: (attacker) => ({
    narrative: `${GM} ${attacker} ataca o herói!`,
    commands: [{ type: 'ATTACK', attacker, target: 'player' }],
  }),
  damage: (target, amount) => ({
    narrative: `${GM} ${target} sofre ${amount} de dano.`,
    commands: [{ type: 'DAMAGE', target, amount }],
  }),
  interact: (target) => ({
    narrative: `${GM} O herói interage com ${target}.`,
    commands: [{ type: 'INTERACT', actor: 'player', target }],
  }),
  lootAll: (from) => ({
    narrative: `${GM} O herói saqueia ${from}.`,
    commands: [{ type: 'LOOT', actor: 'player', from }],
  }),
  despawn: (id) => ({
    narrative: `${GM} ${id} desaparece.`,
    commands: [{ type: 'DESPAWN', id }],
  }),
};

/** Payloads that MUST be rejected by the validator or the rules engine. */
export const ILLEGAL_PRESETS = [
  {
    label: 'Mover para parede',
    expect: 'rules',
    payload: { narrative: `${GM} Tentativa de atravessar a parede.`, commands: [{ type: 'MOVE', id: 'player', to: { x: 0, y: 0 } }] },
  },
  {
    label: 'Mover fora do mapa',
    expect: 'rules',
    payload: { narrative: `${GM} Tentativa de sair do mapa.`, commands: [{ type: 'MOVE', id: 'player', to: { x: 30, y: 2 } }] },
  },
  {
    label: 'Atacar fora de alcance',
    expect: 'rules',
    payload: { narrative: `${GM} Ataque à distância impossível.`, commands: [{ type: 'ATTACK', attacker: 'player', target: 'goblin_1' }] },
  },
  {
    label: 'Saquear baú fechado',
    expect: 'rules',
    payload: { narrative: `${GM} Saque sem abrir o baú.`, commands: [{ type: 'LOOT', actor: 'player', from: 'chest_1' }] },
  },
  {
    label: 'Saquear item inexistente',
    expect: 'rules',
    payload: { narrative: `${GM} Procurando Excalibur.`, commands: [{ type: 'LOOT', actor: 'player', from: 'chest_1', item: { id: 'excalibur' } }] },
  },
  {
    label: 'Entidade inexistente',
    expect: 'rules',
    payload: { narrative: `${GM} Atacando um fantasma.`, commands: [{ type: 'ATTACK', attacker: 'player', target: 'dragon_9' }] },
  },
  {
    label: 'Comando desconhecido',
    expect: 'schema',
    payload: { narrative: `${GM} O herói tenta voar.`, commands: [{ type: 'FLY', id: 'player' }] },
  },
  {
    label: 'Campo obrigatório ausente',
    expect: 'schema',
    payload: { narrative: `${GM} Dano sem valor.`, commands: [{ type: 'DAMAGE', target: 'player' }] },
  },
  {
    label: 'JSON malformado',
    expect: 'json',
    raw: '{"narrative": "JSON quebrado", "commands": [ {"type": "MOVE", ',
  },
];

/**
 * One payload with 6 chained commands. Validates that the queue waits for each
 * animation (open door → walk → hit → hit/death → loot) before the next one.
 */
export const COMBO_FROM_START = {
  narrative: `${GM} O herói abre a porta, avança sobre o goblin, derruba-o com dois golpes e recolhe o espólio.`,
  commands: [
    { type: 'MOVE', id: 'player', target: 'door_1' },
    { type: 'INTERACT', actor: 'player', target: 'door_1' },
    { type: 'MOVE', id: 'player', target: 'goblin_1' },
    { type: 'ATTACK', attacker: 'player', target: 'goblin_1' },
    { type: 'ATTACK', attacker: 'player', target: 'goblin_1' },
    { type: 'LOOT', actor: 'player', from: 'bag_goblin_1' },
  ],
};

/** Full demo scenario from the initial state, ending in victory. */
export const SCRIPTED_SCENARIO = [
  {
    narrative: 'Você caminha até a porta de madeira e a empurra. Ela range ao abrir.',
    commands: [
      { type: 'MOVE', id: 'player', target: 'door_1' },
      { type: 'INTERACT', actor: 'player', target: 'door_1' },
    ],
  },
  {
    narrative: 'Um goblin rosna na sala ao lado. Você avança e desfere um golpe certeiro; ele revida.',
    commands: [
      { type: 'MOVE', id: 'player', target: 'goblin_1' },
      { type: 'ATTACK', attacker: 'player', target: 'goblin_1' },
      { type: 'ATTACK', attacker: 'goblin_1', target: 'player' },
    ],
  },
  {
    narrative: 'Seu segundo golpe derruba o goblin. Algumas moedas rolam pelo chão.',
    commands: [{ type: 'ATTACK', attacker: 'player', target: 'goblin_1' }],
  },
  {
    narrative: 'Você recolhe as moedas deixadas pelo goblin.',
    commands: [{ type: 'LOOT', actor: 'player', from: 'bag_goblin_1' }],
  },
  {
    narrative: 'Você desce pelo corredor até um baú antigo e força a tampa.',
    commands: [
      { type: 'MOVE', id: 'player', target: 'chest_1' },
      { type: 'INTERACT', actor: 'player', target: 'chest_1' },
    ],
  },
  {
    narrative: 'Dentro do baú há uma poção e um punhado de ouro. Você guarda tudo.',
    commands: [{ type: 'LOOT', actor: 'player', from: 'chest_1' }],
  },
  {
    narrative: 'O segundo goblin percebe sua presença. Você corre em sua direção e ataca!',
    commands: [
      { type: 'MOVE', id: 'player', target: 'goblin_2' },
      { type: 'ATTACK', attacker: 'player', target: 'goblin_2' },
      { type: 'ATTACK', attacker: 'goblin_2', target: 'player' },
    ],
  },
  {
    narrative: 'Com um golpe final, o último goblin cai. A masmorra está livre!',
    commands: [{ type: 'ATTACK', attacker: 'player', target: 'goblin_2' }],
  },
];
