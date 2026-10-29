/**
 * Game catalogs (classes, abilities, items, hero roster, token assets).
 * Pure data structures.
 */

export const CLASSES = {
  warrior: {
    classId: 'warrior',
    label: 'Guerreiro',
    initial: 'W',
    color: '#E53935',
    maxHp: 30,
    maxMp: 4,
    maxAp: 1,
    abilities: ['slash', 'shield_bash', 'whirlwind'],
    tokenUrl: './assets/tokens/warrior_64.png'
  },
  mage: {
    classId: 'mage',
    label: 'Mago',
    initial: 'M',
    color: '#1E88E5',
    maxHp: 18,
    maxMp: 3,
    maxAp: 1,
    abilities: ['firebolt', 'heal_pulse', 'fireball', 'divine_prayer'],
    tokenUrl: './assets/tokens/mage_64.png'
  },
  rogue: {
    classId: 'rogue',
    label: 'Ladino',
    initial: 'R',
    color: '#43A047',
    maxHp: 22,
    maxMp: 5,
    maxAp: 1,
    abilities: ['backstab', 'lockpick'],
    tokenUrl: './assets/tokens/rogue_64.png'
  },
  goblin: {
    classId: 'goblin',
    label: 'Goblin',
    initial: 'G',
    color: '#8D6E63',
    maxHp: 12,
    maxMp: 3,
    maxAp: 1,
    abilities: ['goblin_strike'],
    tokenUrl: './assets/tokens/goblin_64.png',
    archetype: 'melee'
  },
  skeleton: {
    classId: 'skeleton',
    label: 'Esqueleto Arqueiro',
    initial: 'S',
    color: '#94A3B8',
    maxHp: 14,
    maxMp: 3,
    maxAp: 1,
    abilities: ['bone_arrow'],
    tokenUrl: './assets/tokens/skeleton_64.png',
    archetype: 'ranged'
  },
  orc: {
    classId: 'orc',
    label: 'Orc Bruto',
    initial: 'O',
    color: '#15803D',
    maxHp: 24,
    maxMp: 2,
    maxAp: 1,
    abilities: ['heavy_smash'],
    tokenUrl: './assets/tokens/orc_64.png',
    archetype: 'melee'
  }
};

export const CHEST_TOKENS = {
  closed: './assets/tokens/chest_closed_64.png',
  opened: './assets/tokens/chest_opened_64.png'
};

/** target: 'enemy' (hostile to caster) | 'ally' (same side, incl. self) | 'object' | 'self' | 'tile' */
export const ABILITIES = {
  slash:         { id: 'slash',         label: 'Corte',           apCost: 1, range: 1, target: 'enemy',  effect: { type: 'damage', amount: 6 } },
  shield_bash:   { id: 'shield_bash',   label: 'Golpe de Escudo', apCost: 1, range: 1, target: 'enemy',  effect: { type: 'damage', amount: 4, push: 1 } },
  whirlwind:     { id: 'whirlwind',     label: 'Redemoinho',      apCost: 1, range: 0, target: 'self',  aoe: { shape: 'adjacent', radius: 1, targetFilter: 'enemy' }, effect: { type: 'damage', amount: 5, push: 1 } },
  firebolt:      { id: 'firebolt',      label: 'Raio de Fogo',    apCost: 1, range: 4, target: 'enemy',  effect: { type: 'damage', amount: 7 } },
  fireball:      { id: 'fireball',      label: 'Bola de Fogo',    apCost: 1, range: 4, target: 'tile',   aoe: { shape: 'circle', radius: 1, targetFilter: 'enemy' },   effect: { type: 'damage', amount: 8 } },
  heal_pulse:    { id: 'heal_pulse',    label: 'Pulso de Cura',   apCost: 1, range: 3, target: 'ally',   effect: { type: 'heal',   amount: 8 } },
  divine_prayer: { id: 'divine_prayer', label: 'Prece Sagrada',   apCost: 1, range: 0, target: 'self',  aoe: { shape: 'circle', radius: 2, targetFilter: 'ally' },    effect: { type: 'heal',   amount: 6 } },
  backstab:      { id: 'backstab',      label: 'Apunhalar',       apCost: 1, range: 1, target: 'enemy',  effect: { type: 'damage', amount: 8 } },
  lockpick:      { id: 'lockpick',      label: 'Arrombar',        apCost: 1, range: 1, target: 'object', effect: { type: 'unlock' } },
  goblin_strike: { id: 'goblin_strike', label: 'Golpe Goblin',    apCost: 1, range: 1, target: 'enemy',  effect: { type: 'damage', amount: 3 } },
  bone_arrow:    { id: 'bone_arrow',    label: 'Flecha Óssea',    apCost: 1, range: 4, target: 'enemy',  effect: { type: 'damage', amount: 5 } },
  heavy_smash:   { id: 'heavy_smash',   label: 'Golpe Pesado',    apCost: 1, range: 1, target: 'enemy',  effect: { type: 'damage', amount: 8, push: 1 } }
};

export const ITEMS = {
  health_potion: { id: 'health_potion', label: 'Poção de Vida',  usable: true,  range: 1, effect: { type: 'heal', amount: 10 } },
  gold_coins:    { id: 'gold_coins',    label: 'Moedas de Ouro', usable: false }
};

export const HERO_ROSTER = [
  {
    id: 'hero_warrior',
    name: 'Thorin',
    classId: 'warrior',
    player: 1,
    title: 'Guardião do Escudo de Ferro',
    alignment: 'Leal e Bom',
    personality: 'Disciplinado, honrado e um protetor inabalável de seus aliados.',
    backstory: 'Veterano das Guerras do Norte, jurou proteger os fracos após a queda de sua cidadela natal nas montanhas.'
  },
  {
    id: 'hero_mage',
    name: 'Lyra',
    classId: 'mage',
    player: 2,
    title: 'Erudita das Chamas Astrais',
    alignment: 'Neutro e Bom',
    personality: 'Curiosa, compassiva e obstinada em desvendar mistérios arcanos.',
    backstory: 'Estudiosa expulsa do conclave arcano por desvendar magias ancestrais capazes de harmonizar luz curativa e fogo purificador.'
  },
  {
    id: 'hero_rogue',
    name: 'Vex',
    classId: 'rogue',
    player: 3,
    title: 'Sombra das Catacumbas',
    alignment: 'Caótico e Neutro',
    personality: 'Pragmático, irônico e sempre atento a rotas de fuga e tesouros.',
    backstory: 'Ex-batedor de guildas subterrâneas, aceitou a missão após apostar seu último tostão nas tavernas da capital.'
  }
];

/**
 * Checks whether two entities are hostile to each other.
 * target: 'enemy' is relative to the caster: for a goblin, "enemy" means a hero.
 * @param {{ role: string }} a
 * @param {{ role: string }} b
 * @returns {boolean}
 */
export function isHostile(a, b) {
  if (!a || !b) return false;
  return a.role !== b.role;
}
