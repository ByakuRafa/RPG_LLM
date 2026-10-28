/**
 * RPG_LLM Main Entry Point (Sprint 4 Final Polish).
 * Composition root wiring store, renderer, queue, turns, enemy AI (Heuristic + LLM),
 * UI panels, chat, HUD, hotseat banner, shortcuts, global error boundary,
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
import { LlmEnemyStrategy } from './llm/llmEnemyStrategy.js';

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

  // Global Error Boundary (Sprint 4, Task 3.8)
  window.addEventListener('error', (event) => {
    const errorMsg = event.error?.message || event.message || 'Erro inesperado na aplicação';
    bus.emit('log:entry', {
      level: 'ERROR',
      text: `[ERROR] ${errorMsg}`,
      source: 'SYSTEM',
      ts: Date.now()
    });
    console.error('[RPG_LLM Global Error]', event.error || event);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reasonMsg = event.reason?.message || event.reason || 'Rejeição assíncrona não tratada';
    bus.emit('log:entry', {
      level: 'ERROR',
      text: `[ERROR] Rejeição: ${reasonMsg}`,
      source: 'SYSTEM',
      ts: Date.now()
    });
    console.error('[RPG_LLM Unhandled Rejection]', event.reason);
  });

  // 3. State Store
  const store = createStore(createInitialState(seed), bus);

  // 4. Canvas Renderer
  const canvas = document.getElementById('board');
  const renderer = createGridRenderer(canvas, bus, { getSettings: loadSettings });

  // 5. Action Queue (sequential execution & validation)
  const queue = createActionQueue({
    store,
    bus,
    tools: TOOLS,
    animator: renderer.animator,
    stepDelayMs: CONFIG.QUEUE_STEP_DELAY_MS
  });

  // 6. LLM Client & Enemy Strategy Setup
  let gmPanel = null;
  const llm = isFakeLlm
    ? createFakeLlmClient({
        responder: () => (gmPanel ? gmPanel.getSelectedFixtureText() : '{"narrative":"Simulação offline","tool_calls":[]}')
      })
    : createLlmClient({ getSettings: loadSettings });

  const heuristicEnemyStrat = new HeuristicEnemyStrategy();
  const llmEnemyStrat = new LlmEnemyStrategy({
    llm,
    bus,
    fallbackStrategy: heuristicEnemyStrat,
    timeoutMs: 8000
  });

  const initialSettings = loadSettings();
  const enemyController = createEnemyController({
    mode: initialSettings.enemyAIMode || 'HEURISTIC',
    strategies: {
      HEURISTIC: heuristicEnemyStrat,
      LLM: llmEnemyStrat
    }
  });

  // Keep enemy AI mode in sync with user settings
  bus.on('settings:changed', (newSettings) => {
    if (newSettings && newSettings.enemyAIMode) {
      enemyController.setMode(newSettings.enemyAIMode);
    }
  });

  // 7. Turn Controller
  const turns = createTurnController({ store, bus, queue, enemyController });

  // 8. Game Master Orchestrator (Sprint 3 & 4)
  const gm = createGameMaster({
    store,
    queue,
    bus,
    llm,
    getSettings: loadSettings
  });

  // 9. Mount Settings Modal
  const settingsModal = mountSettingsModal(bus);

  // 10. Mount UI Panels
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
      store,
      queue,
      catalog: { CLASSES, ABILITIES, HERO_ROSTER },
      fixtures: FIXTURES,
      getGameMaster: () => gm,
      getSettings: loadSettings
    });
  }

  let hud = null;
  if (hudEl) {
    hud = mountHud(hudEl, bus, { getState: store.getState });
  }

  let chat = null;
  if (chatPanelEl) {
    chat = mountChat(chatPanelEl, bus);

    // Natural Language Chat Submit Handler
    bus.on('chat:submit', async ({ text, tag }) => {
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
        text: `"${text}"${tagPart}`,
        classId: active?.classId,
        hero: active
      });

      // Pipeline execution through Game Master
      await gm.handleInput({ text, tag, recordPrompt: true });
    });
  }

  // 11. Hotseat Hand-off Banner (Sprint 4, Task 3.8)
  const bannerEl = document.getElementById('hotseat-banner');
  let bannerTimer = null;

  bus.on('turn:changed', ({ phase, activeId, state }) => {
    if (phase === PHASE.HERO && bannerEl) {
      const s = state || store.getState();
      const hero = s.entities?.[activeId];
      const roster = HERO_ROSTER.find(h => h.id === activeId);
      const playerNum = roster?.player ?? ((s.turnIndex ?? 0) + 1);
      const heroName = hero?.name || roster?.name || 'Herói';
      const classId = hero?.classId || roster?.classId || 'warrior';
      const classLabel = CLASSES[classId]?.label || 'Guerreiro';

      bannerEl.textContent = `Vez do Jogador ${playerNum} — ${heroName} (${classLabel})`;
      bannerEl.classList.add('show');

      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        bannerEl.classList.remove('show');
        bannerTimer = null;
      }, 1200);
    }
  });

  // 12. Game Over Overlay with rounds played (Task 3.8)
  const overlayEl = document.getElementById('overlay-gameover');
  const titleEl = document.getElementById('gameover-title');
  const descEl = document.getElementById('gameover-desc');
  const iconEl = document.getElementById('gameover-icon');
  const newGameBtn = document.getElementById('btn-new-game');

  function checkGameOver(state) {
    if (!overlayEl || !state) return;
    const roundsPlayed = state.round || 1;
    const roundText = roundsPlayed === 1 ? '1 rodada' : `${roundsPlayed} rodadas`;

    if (state.status === 'won' && !overlayEl.open) {
      if (titleEl) titleEl.textContent = 'Vitória!';
      if (descEl) descEl.textContent = `Todos os inimigos foram derrotados e a masmorra foi conquistada com honra após ${roundText}!`;
      if (iconEl) iconEl.textContent = '🏆';
      overlayEl.showModal();
    } else if (state.status === 'lost' && !overlayEl.open) {
      if (titleEl) titleEl.textContent = 'Derrota...';
      if (descEl) descEl.textContent = `Todos os heróis tombaram em combate após ${roundText}. A masmorra prevaleceu.`;
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

  // 13. Global Keyboard Shortcuts (Sprint 4, Task 3.8)
  window.addEventListener('keydown', (ev) => {
    // Esc: clear selected tag or close open modal/dialog or collapse GM drawer
    if (ev.key === 'Escape') {
      if (settingsModal && typeof settingsModal.isOpen === 'function' && settingsModal.isOpen()) {
        settingsModal.close();
        return;
      }
      if (overlayEl && overlayEl.open) {
        overlayEl.close();
        return;
      }
      if (chat && typeof chat.clearTag === 'function') {
        chat.clearTag();
      }
      if (gmPanel && typeof gmPanel.isOpen === 'function' && gmPanel.isOpen()) {
        gmPanel.toggleDrawer();
        return;
      }
    }

    // Ctrl+Enter: end turn for active hero
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      const s = store.getState();
      if (s.phase === PHASE.HERO && s.activeId) {
        bus.emit('intent:enqueue', {
          source: 'HOTKEY',
          tool_calls: [{ name: 'end_turn', arguments: { character_id: s.activeId } }]
        });
      }
      return;
    }

    // Enter: focus chat input if not currently typing in an input/textarea
    if (ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      const activeEl = document.activeElement;
      const tagName = activeEl ? activeEl.tagName : '';
      if (tagName !== 'INPUT' && tagName !== 'TEXTAREA' && tagName !== 'BUTTON') {
        const chatInput = document.getElementById('chat-input');
        if (chatInput && !chatInput.disabled) {
          ev.preventDefault();
          chatInput.focus();
        }
      }
    }
  });

  // 14. Wire Intent Events
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

  // 15. Wire State Changes to Renderer View Model & Game Over
  bus.on('state:changed', ({ state }) => {
    renderer.setView(buildViewModel(state));
    checkGameOver(state);
  });

  // 16. Start First Turn & Initial Render
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
    window.__enemyController = enemyController;
    window.__hud = hud;
    window.__chat = chat;
    window.__gm = gm;
    window.__settingsModal = settingsModal;
    console.info('[RPG_LLM] Debug mode active. Globals: __store, __bus, __queue, __renderer, __turns, __enemyController, __hud, __chat, __gm, __settingsModal');
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
