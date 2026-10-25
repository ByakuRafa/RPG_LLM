/**
 * RPG_LLM Main Entry Point (Task 3.1).
 * Composition root wiring store, renderer, queue, turns, UI panels, and URL overrides.
 */
import { CONFIG, PHASE } from './core/config.js';
import { createEventBus } from './core/eventBus.js';
import { FIXTURES } from './core/fixtures.js';
import { createInitialState, createStore } from './engine/gameState.js';
import { TOOLS } from './engine/tools.js';
import { createActionQueue } from './engine/actionQueue.js';
import { createTurnController } from './engine/turnTracker.js';
import { createEnemyController } from './engine/enemyController.js';

import { computeReachable } from './engine/pathfinding.js';
import { CLASSES, ABILITIES, HERO_ROSTER } from './engine/catalog.js';
import { createGridRenderer } from './render/gridRenderer.js';
import { mountTurnBar } from './ui/turnBar.js';
import { mountActivityLog } from './ui/activityLog.js';
import { mountGmPanel } from './ui/gmPanel.js';

/**
 * Builds the view model for renderer consumption.
 * reachable is only computed in HERO phase for the active hero with mp > 0.
 *
 * @param {object} state GameState
 * @returns {{ state: object, activeId: string|null, reachable: Map<string, number>|null }}
 */
export function buildViewModel(state) {
  if (!state) return { state: null, activeId: null, reachable: null };

  const activeId = state.activeId;
  const activeHero = state.entities?.[activeId];
  let reachable = null;

  if (state.phase === PHASE.HERO && activeHero && activeHero.alive && activeHero.mp > 0) {
    reachable = computeReachable(state, activeId, activeHero.mp);
  }

  return {
    state,
    activeId,
    reachable
  };
}

let lastBootResult = null;

/**
 * Main application boot function.
 */
export async function boot() {
  if (lastBootResult) return lastBootResult;

  // 1. URL Overrides: ?seed=... & ?debug=1
  const urlParams = new URLSearchParams(window.location.search);
  const seed = urlParams.get('seed') || CONFIG.DEFAULT_SEED;
  const debug = urlParams.get('debug') === '1';

  // 2. Pure Event Bus
  const bus = createEventBus();

  // 3. State Store
  const store = createStore(createInitialState(seed), bus);

  // 4. Canvas Renderer
  const canvas = document.getElementById('board');
  const renderer = createGridRenderer(canvas, bus);

  // 5. Action Queue (sequential execution & validation)
  const queue = createActionQueue({
    store,
    bus,
    tools: TOOLS,
    animator: renderer.animator,
    stepDelayMs: CONFIG.QUEUE_STEP_DELAY_MS
  });

  // 6. Turn Controller & Enemy AI
  const enemyController = createEnemyController();
  const turns = createTurnController({ store, bus, queue, enemyController });

  // 7. Mount UI Panels
  const turnBarEl = document.getElementById('turn-bar');
  const activityLogEl = document.getElementById('activity-log');
  const gmDrawerEl = document.getElementById('gm-drawer');

  if (turnBarEl) {
    mountTurnBar(turnBarEl, bus, { getState: store.getState });
  }

  if (activityLogEl) {
    mountActivityLog(activityLogEl, bus);
  }

  if (gmDrawerEl) {
    mountGmPanel(gmDrawerEl, bus, {
      getState: store.getState,
      catalog: { CLASSES, ABILITIES, HERO_ROSTER },
      fixtures: FIXTURES
    });
  }

  // 8. Wire Intent Events
  bus.on('intent:enqueue', batch => {
    queue.enqueue(batch);
  });

  bus.on('intent:reset', ({ seed: newSeed } = {}) => {
    queue.clear();
    const effectiveSeed = newSeed || seed;
    store.reset(createInitialState(effectiveSeed));
    turns.start();
  });

  // 9. Wire State Changes to Renderer View Model
  bus.on('state:changed', ({ state }) => {
    renderer.setView(buildViewModel(state));
  });

  // 10. Start First Turn & Initial Render
  turns.start();
  renderer.setView(buildViewModel(store.getState()));

  // Debug globals if requested
  if (debug) {
    window.__store = store;
    window.__bus = bus;
    window.__queue = queue;
    window.__renderer = renderer;
    window.__turns = turns;
    console.info('[RPG_LLM] Debug mode active. Globals: __store, __bus, __queue, __renderer, __turns');
  }

  lastBootResult = { store, bus, queue, renderer, turns, enemyController };
  return lastBootResult;
}

// Auto-boot on DOM ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot());
  } else {
    boot();
  }
}
