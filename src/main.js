/**
 * RPG_LLM Main Entry Point (Sprint 3, Task 3.9).
 * Composition root wiring store, renderer, queue, turns, enemy AI, UI panels, chat, HUD,
 * game over overlay, GameMaster pipeline, Settings modal, and Fake/Real LLM clients.
 */
import { CONFIG, PHASE } from './core/config.js';
import { createEventBus } from './core/eventBus.js';
import { FIXTURES } from './core/fixtures.js';
import { loadSettings, initSettings, hasApiKey } from './core/settings.js';
import { createInitialState, createStore } from './engine/gameState.js';
import { TOOLS } from './engine/tools.js';
import { createActionQueue } from './engine/actionQueue.js';
import { createTurnController } from './engine/turnTracker.js';
import { HeuristicEnemyStrategy, createEnemyController } from './engine/enemyController.js';
import { computeReachable } from './engine/pathfinding.js';
import { CLASSES, ABILITIES, HERO_ROSTER } from './engine/catalog.js';

import { createLlmClient } from './llm/llmClient.js';
import { createFakeLlmClient } from './llm/fakeLlmClient.js';
import { createGameMaster } from './llm/gameMaster.js';

import { createGridRenderer } from './render/gridRenderer.js';
import { mountTurnBar } from './ui/turnBar.js';
import { mountActivityLog } from './ui/activityLog.js';
import { mountGmPanel } from './ui/gmPanel.js';
import { mountHud } from './ui/hud.js';
import { mountChat } from './ui/chat.js';
import { mountSettingsModal } from './ui/settingsModal.js';

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

  // 1. URL Overrides: ?seed=..., ?debug=1, ?fakeLlm=1
  const urlParams = new URLSearchParams(window.location.search);
  const seed = urlParams.get('seed') || CONFIG.DEFAULT_SEED;
  const debug = urlParams.get('debug') === '1';
  const isFakeLlm = urlParams.has('fakeLlm') || urlParams.get('fakeLlm') === '1';

  // 2. Pure Event Bus & Settings Initialization
  const bus = createEventBus();
  initSettings(bus);

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

  // 6. Turn Controller & Deterministic Enemy AI
  const enemyController = createEnemyController({
    strategies: {
      HEURISTIC: new HeuristicEnemyStrategy()
    }
  });
  const turns = createTurnController({ store, bus, queue, enemyController });

  // 7. LLM Client & Game Master Orchestrator (Task 3.9)
  let gmPanel = null;
  const llm = isFakeLlm
    ? createFakeLlmClient({
        responder: () => (gmPanel ? gmPanel.getSelectedFixtureText() : '{"narrative":"Simulação offline","tool_calls":[]}')
      })
    : createLlmClient({ getSettings: loadSettings });

  const gm = createGameMaster({
    store,
    queue,
    bus,
    llm,
    getSettings: loadSettings
  });

  // 8. Mount Settings Modal
  const settingsModal = mountSettingsModal(bus);

  // 9. Mount UI Panels
  const turnBarEl = document.getElementById('turn-bar');
  const activityLogEl = document.getElementById('activity-log');
  const gmDrawerEl = document.getElementById('gm-drawer');
  const hudEl = document.getElementById('hud');
  const chatPanelEl = document.getElementById('chat-panel');

  if (turnBarEl) {
    mountTurnBar(turnBarEl, bus, { getState: store.getState, isFakeLlm });
  }

  if (activityLogEl) {
    mountActivityLog(activityLogEl, bus);
  }

  if (gmDrawerEl) {
    gmPanel = mountGmPanel(gmDrawerEl, bus, {
      getState: store.getState,
      catalog: { CLASSES, ABILITIES, HERO_ROSTER },
      fixtures: FIXTURES,
      getGameMaster: () => gm
    });
  }

  let hud = null;
  if (hudEl) {
    hud = mountHud(hudEl, bus, { getState: store.getState });
  }

  let chat = null;
  if (chatPanelEl) {
    chat = mountChat(chatPanelEl, bus);

    // Natural Language Chat Submit Handler (Task 3.9)
    bus.on('chat:submit', async ({ text, tag }) => {
      // If running real LLM and no API key configured, prompt settings modal
      if (!isFakeLlm && !hasApiKey()) {
        settingsModal.open();
        bus.emit('chat:system', {
          level: 'info',
          text: 'Configure sua Chave de API Google AI Studio nas Configurações para interagir com o Mestre.'
        });
        return;
      }

      // Echo player message into chat
      const s = store.getState();
      const active = s.entities?.[s.activeId];
      const author = active?.name || 'Herói';
      const tagPart = tag ? ` [Tag: ${tag.id || tag}]` : '';

      chat.appendMessage({
        role: 'player',
        author,
        text: `"${text}"${tagPart}`
      });

      // Pipeline execution through Game Master
      await gm.handleInput({ text, tag, recordPrompt: true });
    });
  }

  // 10. Game Over Overlay (Task 3.9)
  const overlayEl = document.getElementById('overlay-gameover');
  const titleEl = document.getElementById('gameover-title');
  const descEl = document.getElementById('gameover-desc');
  const iconEl = document.getElementById('gameover-icon');
  const newGameBtn = document.getElementById('btn-new-game');

  function checkGameOver(state) {
    if (!overlayEl || !state) return;
    if (state.status === 'won' && !overlayEl.open) {
      if (titleEl) titleEl.textContent = 'Vitória!';
      if (descEl) descEl.textContent = 'Todos os inimigos foram derrotados e a masmorra foi conquistada!';
      if (iconEl) iconEl.textContent = '🏆';
      overlayEl.showModal();
    } else if (state.status === 'lost' && !overlayEl.open) {
      if (titleEl) titleEl.textContent = 'Derrota...';
      if (descEl) descEl.textContent = 'Todos os heróis tombaram em combate. A masmorra prevaleceu.';
      if (iconEl) iconEl.textContent = '💀';
      overlayEl.showModal();
    }
  }

  newGameBtn?.addEventListener('click', () => {
    if (overlayEl && overlayEl.open) {
      overlayEl.close();
    }
    bus.emit('intent:reset');
  });

  // 11. Wire Intent Events
  bus.on('intent:enqueue', (batch) => {
    queue.enqueue(batch);
  });

  bus.on('intent:reset', ({ seed: newSeed } = {}) => {
    queue.clear();
    if (overlayEl && overlayEl.open) overlayEl.close();
    const effectiveSeed = newSeed || seed;
    store.reset(createInitialState(effectiveSeed));
    turns.start();
  });

  // 12. Wire State Changes to Renderer View Model & Game Over
  bus.on('state:changed', ({ state }) => {
    renderer.setView(buildViewModel(state));
    checkGameOver(state);
  });

  // 13. Start First Turn & Initial Render
  turns.start();
  const initialState = store.getState();
  renderer.setView(buildViewModel(initialState));
  checkGameOver(initialState);

  // Debug globals if requested
  if (debug) {
    window.__store = store;
    window.__bus = bus;
    window.__queue = queue;
    window.__renderer = renderer;
    window.__turns = turns;
    window.__hud = hud;
    window.__chat = chat;
    window.__gm = gm;
    window.__settingsModal = settingsModal;
    console.info('[RPG_LLM] Debug mode active. Globals: __store, __bus, __queue, __renderer, __turns, __hud, __chat, __gm, __settingsModal');
  }

  lastBootResult = { store, bus, queue, renderer, turns, enemyController, hud, chat, gm, settingsModal };
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
