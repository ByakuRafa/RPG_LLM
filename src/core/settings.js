/**
 * Pure settings module backed by localStorage (key: 'rpgllm.settings.v1').
 * Adheres strictly to Ground Rule §0.1:
 * Pure JS logic, zero DOM (document/window), zero Canvas, zero fetch.
 */

export const SETTINGS_KEY = 'rpgllm.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',                    // localStorage only; never logged, never committed
  model: 'gemini-3.8-flash',
  promptConfig: 'B',             // 'A' | 'B'
  temperature: 0.2,
  maxOutputTokens: 2048,
  timeoutMs: 30000,
  enemyAIMode: 'HEURISTIC',      // used in Sprint 4
  benchmarkRps: 1,               // 1 req/sec default (rate limits)
  useSprites: true               // used in Sprint 4
});

let eventBus = null;
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
 * Injects an optional event bus for broadcasting 'settings:changed'.
 * @param {object|null} bus
 */
export function initSettings(bus = null) {
  eventBus = bus;
}

/**
 * Loads persisted settings merged with DEFAULT_SETTINGS.
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function loadSettings() {
  const storage = getStorage();
  let parsed = null;

  if (storage) {
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      if (raw) {
        parsed = JSON.parse(raw);
      }
    } catch {
      parsed = null;
    }
  } else if (memoryFallback) {
    parsed = memoryFallback;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    ...DEFAULT_SETTINGS,
    ...parsed
  };
}

/**
 * Persists a patch of settings, updates storage, and emits 'settings:changed'.
 * @param {object} patch
 * @returns {object} Updated settings object
 */
export function saveSettings(patch = {}) {
  const current = loadSettings();
  const updated = {
    ...current,
    ...patch
  };

  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    } catch {
      // QuotaExceededError or disabled storage fallback
      memoryFallback = { ...updated };
    }
  } else {
    memoryFallback = { ...updated };
  }

  if (eventBus && typeof eventBus.emit === 'function') {
    eventBus.emit('settings:changed', updated);
  }

  return updated;
}

/**
 * Checks whether an API key has been configured and is non-empty.
 * @returns {boolean}
 */
export function hasApiKey() {
  const s = loadSettings();
  return Boolean(typeof s.apiKey === 'string' && s.apiKey.trim().length > 0);
}

/**
 * Resets settings to default values.
 * @returns {object} Default settings
 */
export function resetSettings() {
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(SETTINGS_KEY);
    } catch {}
  }
  memoryFallback = null;

  const defaults = { ...DEFAULT_SETTINGS };
  if (eventBus && typeof eventBus.emit === 'function') {
    eventBus.emit('settings:changed', defaults);
  }
  return defaults;
}
