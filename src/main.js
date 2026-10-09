/**
 * RPG_LLM Main Entry Point: wires engine, render, UI, GM panel and LLM pipeline.
 */
import { createEventBus } from './core/eventBus.js';
import { createInitialState, createStore } from './engine/gameState.js';
import { createActionQueue } from './engine/actionQueue.js';
import { createGridRenderer } from './render/gridRenderer.js';
import { createHud } from './ui/hud.js';
import { createChat } from './ui/chat.js';
import { createDebugLog } from './ui/debugLog.js';
import { createGmPanel } from './gm/gmPanel.js';
import { createSettingsModal, loadSettings } from './ui/settingsModal.js';
import { createGeminiAdapter, createMockAdapter } from './llm/llmClient.js';
import { createGameMaster } from './llm/gameMaster.js';
import { createMetrics } from './core/metrics.js';
import { createSessionRecorder } from './core/session.js';

export function bootstrap() {
  const bus = createEventBus();
  const initialState = createInitialState();
  const store = createStore(initialState, bus);

  // Settings
  let currentSettings = loadSettings();

  // Canvas Renderer
  const canvas = document.getElementById('grid-canvas');
  const tileInfoEl = document.getElementById('tile-info-bar');
  const renderer = createGridRenderer({ canvas, store, bus, infoEl: tileInfoEl });
  renderer.setSpeed(currentSettings.animationSpeed || 1.0);

  // Action Queue (awaits renderer animation on each command)
  const queue = createActionQueue({
    store,
    bus,
    animator: renderer,
    stepDelayMs: 40,
  });

  // Session & Metrics
  const sessionRecorder = createSessionRecorder({ bus, store });
  const metrics = createMetrics(bus);

  // Adapters
  const geminiAdapter = createGeminiAdapter({ getSettings: () => currentSettings });
  const mockAdapter = createMockAdapter({ getState: () => store.get() });

  function getActiveAdapter() {
    return currentSettings.provider === 'gemini' ? geminiAdapter : mockAdapter;
  }

  // LLM Game Master
  const gameMaster = createGameMaster({
    store,
    queue,
    bus,
    getAdapter: getActiveAdapter,
  });

  // UI Components
  const hudContainer = document.getElementById('hud-container');
  createHud({ container: hudContainer, store, bus });

  const chatContainer = document.getElementById('chat-container');
  createChat({
    container: chatContainer,
    bus,
    onSendAction: (action) => gameMaster.handlePlayerInput(action),
  });

  const debugContainer = document.getElementById('debug-container');
  createDebugLog({ container: debugContainer, bus, metrics });

  const gmContainer = document.getElementById('gm-container');
  createGmPanel({ container: gmContainer, store, queue, bus, sessionRecorder });

  // Settings Modal
  const modalContainer = document.getElementById('modal-container');
  const settingsModal = createSettingsModal({
    container: modalContainer,
    bus,
    onSave: (newSettings) => {
      currentSettings = newSettings;
      renderer.setSpeed(newSettings.animationSpeed || 1.0);
    },
  });

  document.getElementById('btn-open-settings').addEventListener('click', () => {
    settingsModal.open();
  });

  // Window resize handler for canvas
  window.addEventListener('resize', () => {
    renderer.resize();
  });

  console.log('[RPG_LLM] PoC bootstrap completo. Pressione G para alternar o Human GM Panel.');
}

window.addEventListener('DOMContentLoaded', bootstrap);
