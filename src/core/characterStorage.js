/**
 * Pure Character Storage and Sheet Validation Module.
 * Backed by localStorage (key: 'rpgllm.characters.v1') with safe memory fallback.
 * Strictly adheres to Ground Rules §0.1: Pure JS logic, zero DOM, zero Canvas, zero fetch.
 */
import { ABILITIES } from '../engine/catalog.js';

export const CHARACTERS_STORAGE_KEY = 'rpgllm.characters.v1';

export const POINT_BUY_CONFIG = Object.freeze({
  BASE_HP: 18,
  BASE_MP: 3,
  LOCKED_AP: 1,
  BUDGET: 6,
  HP_STEP: 3,     // +1 point = +3 maxHp
  MP_STEP: 1,     // +1 point = +1 maxMp
  MIN_HP: 18,
  MAX_HP: 36,
  MIN_MP: 3,
  MAX_MP: 6,
  MAX_ABILITIES: 3
});

/**
 * Canonical default sheets for Thorin, Lyra, and Vex.
 * Matches exact canonical stats with rich PT-BR narrative lore.
 */
export const DEFAULT_SHEETS = Object.freeze([
  Object.freeze({
    id: 'hero_warrior',
    name: 'Thorin',
    classId: 'warrior',
    player: 1,
    title: 'Guardião do Escudo de Ferro',
    color: '#E53935',
    initial: 'W',
    tokenUrl: './assets/tokens/warrior_64.png',
    maxHp: 30,
    maxMp: 4,
    maxAp: 1,
    abilities: Object.freeze(['slash', 'shield_bash', 'whirlwind']),
    backstory: 'Veterano das Guerras do Norte, jurou proteger os fracos após a queda de sua cidadela natal nas montanhas.',
    personality: 'Disciplinado, honrado e um protetor inabalável de seus aliados.',
    alignment: 'Leal e Bom',
    startingItems: Object.freeze([{ id: 'health_potion', qty: 1 }])
  }),
  Object.freeze({
    id: 'hero_mage',
    name: 'Lyra',
    classId: 'mage',
    player: 2,
    title: 'Erudita das Chamas Astrais',
    color: '#1E88E5',
    initial: 'M',
    tokenUrl: './assets/tokens/mage_64.png',
    maxHp: 18,
    maxMp: 3,
    maxAp: 1,
    abilities: Object.freeze(['firebolt', 'heal_pulse', 'fireball', 'divine_prayer']),
    backstory: 'Estudiosa expulsa do conclave arcano por desvendar magias ancestrais capazes de harmonizar luz curativa e fogo purificador.',
    personality: 'Curiosa, perspicaz, analítica e de raciocínio rápido sob perigo extremo.',
    alignment: 'Neutra e Boa',
    startingItems: Object.freeze([{ id: 'health_potion', qty: 1 }])
  }),
  Object.freeze({
    id: 'hero_rogue',
    name: 'Vex',
    classId: 'rogue',
    player: 3,
    title: 'Sombra das Catacumbas',
    color: '#43A047',
    initial: 'R',
    tokenUrl: './assets/tokens/rogue_64.png',
    maxHp: 22,
    maxMp: 5,
    maxAp: 1,
    abilities: Object.freeze(['backstab', 'lockpick']),
    backstory: 'Sobrevivente dos becos de Oakhaven, especializou-se em abrir qualquer fechadura e desaparecer no primeiro sinal de emboscada.',
    personality: 'Pragmático, irônico, mas surpreendentemente leal quando o perigo aperta.',
    alignment: 'Caótico e Neutro',
    startingItems: Object.freeze([])
  })
]);

let memoryFallback = null;

/**
 * Accesses storage safely across browser, sandbox, and test environments.
 * @returns {Storage|null}
 */
function getStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage access might throw in strict sandbox or private browsing
  }
  return null;
}

/**
 * Validates a character sheet enforcing Point-Buy budget, ability count, and required fields.
 *
 * Point-Buy Balance:
 * - maxAp locked to 1
 * - Base stats: maxHp = 18, maxMp = 3
 * - Budget: 6 points (+1 pt = +3 maxHp, +1 pt = +1 maxMp)
 * - Caps: 18 <= maxHp <= 36, 3 <= maxMp <= 6
 * - Abilities: 1 to 3 valid ability IDs from ABILITIES catalog
 *
 * @param {object} sheet
 * @returns {{ valid: boolean, ok: boolean, errors: string[] }}
 */
export function validateSheet(sheet) {
  const errors = [];

  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
    return { valid: false, ok: false, errors: ['A ficha deve ser um objeto válido.'] };
  }

  // Required identification
  if (typeof sheet.id !== 'string' || !sheet.id.trim()) {
    errors.push('Campo "id" é obrigatório e deve ser uma string não vazia.');
  }
  if (typeof sheet.name !== 'string' || !sheet.name.trim()) {
    errors.push('Campo "name" é obrigatório e deve ser uma string não vazia.');
  }
  if (typeof sheet.classId !== 'string' || !sheet.classId.trim()) {
    errors.push('Campo "classId" é obrigatório e deve ser uma string não vazia.');
  }

  // AP lock
  const ap = sheet.maxAp ?? 1;
  if (ap !== POINT_BUY_CONFIG.LOCKED_AP) {
    errors.push(`maxAp deve ser exatamente ${POINT_BUY_CONFIG.LOCKED_AP}.`);
  }

  // Canonical default sheets bypass custom step calculations if matching canonical values
  const isCanonicalDefault = ['hero_warrior', 'hero_mage', 'hero_rogue'].includes(sheet.id);

  // HP validation
  const hp = sheet.maxHp;
  if (typeof hp !== 'number' || !Number.isInteger(hp)) {
    errors.push('maxHp deve ser um número inteiro.');
  } else if (hp < POINT_BUY_CONFIG.MIN_HP || hp > POINT_BUY_CONFIG.MAX_HP) {
    errors.push(`maxHp deve estar entre ${POINT_BUY_CONFIG.MIN_HP} e ${POINT_BUY_CONFIG.MAX_HP}.`);
  } else if (!isCanonicalDefault && (hp - POINT_BUY_CONFIG.BASE_HP) % POINT_BUY_CONFIG.HP_STEP !== 0) {
    errors.push(`maxHp deve ser base ${POINT_BUY_CONFIG.BASE_HP} mais múltiplos de ${POINT_BUY_CONFIG.HP_STEP}.`);
  }

  // MP validation
  const mp = sheet.maxMp;
  if (typeof mp !== 'number' || !Number.isInteger(mp)) {
    errors.push('maxMp deve ser um número inteiro.');
  } else if (mp < POINT_BUY_CONFIG.MIN_MP || mp > POINT_BUY_CONFIG.MAX_MP) {
    errors.push(`maxMp deve estar entre ${POINT_BUY_CONFIG.MIN_MP} e ${POINT_BUY_CONFIG.MAX_MP}.`);
  }

  // Point budget calculation
  if (typeof hp === 'number' && typeof mp === 'number') {
    const hpPoints = isCanonicalDefault
      ? Math.ceil(Math.max(0, hp - POINT_BUY_CONFIG.BASE_HP) / POINT_BUY_CONFIG.HP_STEP)
      : Math.floor((hp - POINT_BUY_CONFIG.BASE_HP) / POINT_BUY_CONFIG.HP_STEP);
    const mpPoints = Math.max(0, mp - POINT_BUY_CONFIG.BASE_MP);
    const totalSpent = hpPoints + mpPoints;

    if (totalSpent > POINT_BUY_CONFIG.BUDGET) {
      errors.push(`Orçamento de Point-Buy excedido: ${totalSpent} pontos gastos (máximo permitido: ${POINT_BUY_CONFIG.BUDGET}).`);
    }
  }

  // Abilities validation (1..3 valid ability IDs from ABILITIES; default canonical can have up to 4)
  const maxAbilities = isCanonicalDefault ? 4 : POINT_BUY_CONFIG.MAX_ABILITIES;
  if (!Array.isArray(sheet.abilities)) {
    errors.push('Campo "abilities" deve ser um array de IDs de habilidades.');
  } else {
    if (sheet.abilities.length < 1 || sheet.abilities.length > maxAbilities) {
      errors.push(`A ficha deve ter entre 1 e ${maxAbilities} habilidades.`);
    }
    const seen = new Set();
    for (const abId of sheet.abilities) {
      if (typeof abId !== 'string' || !abId.trim()) {
        errors.push(`ID de habilidade inválido: "${abId}".`);
      } else if (!ABILITIES || !ABILITIES[abId]) {
        errors.push(`Habilidade desconhecida no catálogo: "${abId}".`);
      }
      if (seen.has(abId)) {
        errors.push(`Habilidade duplicada na ficha: "${abId}".`);
      }
      seen.add(abId);
    }
  }

  // Starting items validation
  if (sheet.startingItems !== undefined) {
    if (!Array.isArray(sheet.startingItems)) {
      errors.push('Campo "startingItems" deve ser um array se fornecido.');
    } else {
      for (const item of sheet.startingItems) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.qty !== 'number' || item.qty < 0) {
          errors.push('Itens iniciais devem possuir formato { id: string, qty: number }.');
          break;
        }
      }
    }
  }

  const valid = errors.length === 0;
  return { valid, ok: valid, errors };
}

/**
 * Loads internal storage record `{ sheets: [], activeParty: [] }`.
 * @returns {{ sheets: object[], activeParty: string[] }}
 */
function readStorageData() {
  const storage = getStorage();
  let raw = null;

  if (storage) {
    try {
      raw = storage.getItem(CHARACTERS_STORAGE_KEY);
    } catch {
      raw = null;
    }
  } else if (memoryFallback) {
    return structuredClone(memoryFallback);
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const sheets = Array.isArray(parsed.sheets) ? parsed.sheets : [];
        const activeParty = Array.isArray(parsed.activeParty) && parsed.activeParty.length === 3
          ? parsed.activeParty
          : ['hero_warrior', 'hero_mage', 'hero_rogue'];

        // Ensure default canonical sheets are present in the collection
        const sheetMap = new Map(sheets.map(s => [s.id, s]));
        for (const def of DEFAULT_SHEETS) {
          if (!sheetMap.has(def.id)) {
            sheetMap.set(def.id, structuredClone(def));
          }
        }

        return {
          sheets: Array.from(sheetMap.values()),
          activeParty
        };
      }
    } catch {
      // JSON parse error fallback
    }
  }

  // Initial defaults
  return {
    sheets: structuredClone(DEFAULT_SHEETS),
    activeParty: ['hero_warrior', 'hero_mage', 'hero_rogue']
  };
}

/**
 * Persists internal storage record safely.
 * @param {{ sheets: object[], activeParty: string[] }} data
 */
function writeStorageData(data) {
  const storage = getStorage();
  const serialized = JSON.stringify(data);

  if (storage) {
    try {
      storage.setItem(CHARACTERS_STORAGE_KEY, serialized);
    } catch {
      memoryFallback = structuredClone(data);
    }
  } else {
    memoryFallback = structuredClone(data);
  }
}

/**
 * Loads all saved character sheets (always includes defaults).
 * @returns {object[]} Array of character sheet objects
 */
export function loadSavedSheets() {
  const data = readStorageData();
  return structuredClone(data.sheets);
}

/**
 * Validates and saves a character sheet.
 * If sheet.id already exists, it is updated; otherwise it is appended.
 *
 * @param {object} sheet
 * @returns {object} The saved sheet
 */
export function saveSheet(sheet) {
  const validation = validateSheet(sheet);
  if (!validation.valid) {
    throw new Error(`Ficha de personagem inválida: ${validation.errors.join('; ')}`);
  }

  const data = readStorageData();
  const cleanSheet = {
    ...sheet,
    title: sheet.title ? String(sheet.title).trim() : null,
    backstory: sheet.backstory ? String(sheet.backstory).trim() : null,
    personality: sheet.personality ? String(sheet.personality).trim() : null,
    alignment: sheet.alignment ? String(sheet.alignment).trim() : null,
    startingItems: Array.isArray(sheet.startingItems) ? sheet.startingItems.map(i => ({ ...i })) : []
  };

  const idx = data.sheets.findIndex(s => s.id === cleanSheet.id);
  if (idx >= 0) {
    data.sheets[idx] = cleanSheet;
  } else {
    data.sheets.push(cleanSheet);
  }

  writeStorageData(data);
  return structuredClone(cleanSheet);
}

/**
 * Deletes a saved character sheet by ID.
 * Default canonical sheets ('hero_warrior', 'hero_mage', 'hero_rogue') cannot be deleted.
 *
 * @param {string} id
 * @returns {boolean} True if deleted, false otherwise
 */
export function deleteSheet(id) {
  if (['hero_warrior', 'hero_mage', 'hero_rogue'].includes(id)) {
    return false;
  }

  const data = readStorageData();
  const initialLen = data.sheets.length;
  data.sheets = data.sheets.filter(s => s.id !== id);

  if (data.sheets.length === initialLen) {
    return false;
  }

  // If deleted hero was part of the active party, fallback that slot to default hero
  const defaultSlotIds = ['hero_warrior', 'hero_mage', 'hero_rogue'];
  data.activeParty = data.activeParty.map((slotId, index) => {
    return slotId === id ? defaultSlotIds[index] : slotId;
  });

  writeStorageData(data);
  return true;
}

/**
 * Loads active party roster (array of 3 sheets for Player 1, 2, 3).
 * @returns {object[]} Array of exactly 3 character sheets
 */
export function loadActivePartyRoster() {
  const data = readStorageData();
  const sheetMap = new Map(data.sheets.map(s => [s.id, s]));
  const defaultSlotIds = ['hero_warrior', 'hero_mage', 'hero_rogue'];

  return data.activeParty.map((id, index) => {
    let sheet = sheetMap.get(id);
    if (!sheet) {
      sheet = sheetMap.get(defaultSlotIds[index]) || DEFAULT_SHEETS[index];
    }
    return {
      ...structuredClone(sheet),
      player: index + 1
    };
  });
}

/**
 * Saves the active party roster by specifying 3 sheet IDs for Player 1, 2, 3.
 * @param {string[]} sheetIds Array of exactly 3 sheet IDs
 * @returns {object[]} The active 3-hero roster
 */
export function saveActivePartyRoster(sheetIds) {
  if (!Array.isArray(sheetIds) || sheetIds.length !== 3) {
    throw new Error('A seleção do grupo ativo deve conter exatamente 3 IDs de personagens.');
  }

  const data = readStorageData();
  const sheetMap = new Map(data.sheets.map(s => [s.id, s]));

  for (const id of sheetIds) {
    if (!sheetMap.has(id)) {
      throw new Error(`Personagem com id "${id}" não encontrado na lista de fichas salvas.`);
    }
  }

  data.activeParty = [...sheetIds];
  writeStorageData(data);
  return loadActivePartyRoster();
}

/**
 * Resets active party roster to the 3 canonical default heroes.
 * @returns {object[]} The 3 default hero sheets
 */
export function resetToDefaultParty() {
  const data = readStorageData();
  data.activeParty = ['hero_warrior', 'hero_mage', 'hero_rogue'];
  writeStorageData(data);
  return loadActivePartyRoster();
}
