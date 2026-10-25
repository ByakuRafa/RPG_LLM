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
    abilities: ['slash', 'shield_bash'],
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
    abilities: ['firebolt', 'heal_pulse'],
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
    tokenUrl: './assets/tokens/goblin_64.png'
  }
};

export const CHEST_TOKENS = {
  closed: './assets/tokens/chest_closed_64.png',
  opened: './assets/tokens/chest_opened_64.png'
};

/** target: 'enemy' (hostile to caster) | 'ally' (same side, incl. self) | 'object' */
export const ABILITIES = {
  slash:         { id: 'slash',         label: 'Corte',           apCost: 1, range: 1, target: 'enemy',  effect: { type: 'damage', amount: 6 } },
  shield_bash:   { id: 'shield_bash',   label: 'Golpe de Escudo', apCost: 1, range: 1, target: 'enemy',  effect: { type: 'damage', amount: 4, push: 1 } },
  firebolt:      { id: 'firebolt',      label: 'Raio de Fogo',    apCost: 1, range: 4, target: 'enemy',  effect: { type: 'damage', amount: 7 } },
  heal_pulse:    { id: 'heal_pulse',    label: 'Pulso de Cura',   apCost: 1, range: 3, target: 'ally',   effect: { type: 'heal',   amount: 8 } },
  backstab:      { id: 'backstab',      label: 'Apunhalar',       apCost: 1, range: 1, target: 'enemy',  effect: { type: 'damage', amount: 8 } },
  lockpick:      { id: 'lockpick',      label: 'Arrombar',        apCost: 1, range: 1, target: 'object', effect: { type: 'unlock' } },
  goblin_strike: { id: 'goblin_strike', label: 'Golpe Goblin',    apCost: 1, range: 1, target: 'enemy',  effect: { type: 'damage', amount: 3 } }
};

export const ITEMS = {
  health_potion: { id: 'health_potion', label: 'Poção de Vida',  usable: true,  range: 1, effect: { type: 'heal', amount: 10 } },
  gold_coins:    { id: 'gold_coins',    label: 'Moedas de Ouro', usable: false }
};

export const HERO_ROSTER = [
  { id: 'hero_warrior', name: 'Thorin', classId: 'warrior', player: 1 },
  { id: 'hero_mage',    name: 'Lyra',   classId: 'mage',    player: 2 },
  { id: 'hero_rogue',   name: 'Vex',    classId: 'rogue',   player: 3 }
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
