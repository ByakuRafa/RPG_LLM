/**
 * Entity templates and item catalog. Pure data + factory, no side effects.
 */
export const KINDS = {
  player:   { name: 'Herói',     faction: 'player', hp: 20, atk: 4, blocks: true },
  goblin:   { name: 'Goblin',    faction: 'enemy',  hp: 8,  atk: 2, blocks: true },
  skeleton: { name: 'Esqueleto', faction: 'enemy',  hp: 12, atk: 3, blocks: true },
  chest:    { name: 'Baú',       faction: 'object', blocks: true,  interactable: true, container: true, startsOpen: false },
  door:     { name: 'Porta',     faction: 'object', blocks: true,  interactable: true, startsOpen: false },
  bag:      { name: 'Espólio',   faction: 'object', blocks: false, container: true, startsOpen: true },
};

/** Kinds the GM (human or LLM) may SPAWN. The player is unique. */
export const SPAWNABLE_KINDS = Object.keys(KINDS).filter((k) => k !== 'player');

export const ITEMS = {
  potion: { name: 'Poção de Cura' },
  gold:   { name: 'Moedas de Ouro' },
  dagger: { name: 'Adaga Enferrujada' },
  key:    { name: 'Chave de Ferro' },
  bone:   { name: 'Osso Velho' },
};

export function normalizeItem(item) {
  return {
    id: item.id,
    name: item.name ?? ITEMS[item.id]?.name ?? item.id,
    qty: item.qty ?? 1,
  };
}

export function isCreature(entity) {
  return entity != null && typeof entity.hp === 'number';
}

export function isContainer(entity) {
  return entity != null && KINDS[entity.kind]?.container === true;
}

export function isInteractable(entity) {
  return entity != null && KINDS[entity.kind]?.interactable === true;
}

export function blocksMovement(entity) {
  const tpl = KINDS[entity.kind];
  if (!tpl?.blocks) return false;
  if (entity.kind === 'door' && entity.open) return false;
  return true;
}

/**
 * Builds a fresh entity from its template.
 * @param {string} kind
 * @param {string} id
 * @param {number} x
 * @param {number} y
 * @param {{hp?: number, atk?: number, items?: Array}} [overrides]
 */
export function createEntity(kind, id, x, y, overrides = {}) {
  const tpl = KINDS[kind];
  if (!tpl) throw new Error(`Unknown kind "${kind}"`);
  const entity = { id, kind, name: tpl.name, faction: tpl.faction, x, y };
  if (typeof tpl.hp === 'number') {
    entity.hp = overrides.hp ?? tpl.hp;
    entity.maxHp = Math.max(entity.hp, tpl.hp);
    entity.atk = overrides.atk ?? tpl.atk;
  }
  if (tpl.interactable || tpl.container) entity.open = !!tpl.startsOpen;
  if (tpl.container || tpl.faction !== 'object') {
    entity.items = (overrides.items ?? []).map(normalizeItem);
  }
  return entity;
}
