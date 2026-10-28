/**
 * Chat component (Sprint 3, Task 3.7 & UI Sprint 3).
 * Adventure Chronicle & Compact Rules Log overhaul:
 * Storybook/grimoire GM cards, active hero class player cards,
 * floating "Prepared Action" spell pill, and clean game command bar.
 * Pure DOM layer, zero direct state mutation, strict textContent sanitization.
 */
import { CLASSES, HERO_ROSTER } from '../engine/catalog.js';

export function mountChat(rootEl, bus) {
  let currentTag = null;
  let isThinking = false;
  let isQueueLocked = false;
  let isPhaseLocked = false;
  let isBenchmarking = false;
  let timerInterval = null;
  let secondsThinking = 0;
  let currentActiveHero = null;

  rootEl.innerHTML = `
    <div class="chat-wrapper">
      <div class="chat-header">
        <div class="chat-title-group">
          <span class="chat-title-icon">📖</span>
          <span class="chat-title">Crônica da Masmorra</span>
        </div>
        <span class="chat-status-indicator" id="chat-status-indicator">Pronto</span>
      </div>

      <div id="chat-history" class="chat-history"></div>

      <!-- Thinking Spinner with Cancel Button -->
      <div id="chat-spinner" class="chat-spinner" style="display: none;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="spinner-icon">⏳</span>
          <span id="chat-spinner-text">O Mestre está pensando... (0s)</span>
        </div>
        <button type="button" id="chat-cancel" class="btn-chat-cancel" title="Cancelar requisição">Cancelar</button>
      </div>

      <!-- Active Tag Badge: Floating Prepared Action Spell Pill -->
      <div id="chat-tag-badge" class="chat-tag-badge" style="display: none;">
        <span class="spell-pill-icon">✨</span>
        <span id="chat-tag-text" class="tag-badge-text"></span>
        <button type="button" id="chat-tag-clear" class="tag-badge-close" title="Cancelar Ação Preparada (Esc)">✕</button>
      </div>

      <!-- Input Form: Clean Game Command Bar -->
      <form id="chat-form" class="chat-form">
        <textarea
          id="chat-input"
          class="chat-input"
          placeholder="Comande sua ação em linguagem natural... (Shift+Enter para nova linha)"
          rows="2"
        ></textarea>
        <button type="submit" id="chat-send" class="chat-send-btn">
          <span>Enviar</span>
        </button>
      </form>
    </div>
  `;

  const historyEl = rootEl.querySelector('#chat-history');
  const spinnerEl = rootEl.querySelector('#chat-spinner');
  const spinnerTextEl = rootEl.querySelector('#chat-spinner-text');
  const cancelBtn = rootEl.querySelector('#chat-cancel');
  const tagBadgeEl = rootEl.querySelector('#chat-tag-badge');
  const tagTextEl = rootEl.querySelector('#chat-tag-text');
  const tagClearBtn = rootEl.querySelector('#chat-tag-clear');
  const formEl = rootEl.querySelector('#chat-form');
  const inputEl = rootEl.querySelector('#chat-input');
  const sendBtn = rootEl.querySelector('#chat-send');
  const statusEl = rootEl.querySelector('#chat-status-indicator');

  function updateLockState() {
    const shouldDisable = isThinking || isQueueLocked || isPhaseLocked || isBenchmarking;
    inputEl.disabled = shouldDisable;
    sendBtn.disabled = shouldDisable;

    if (statusEl) {
      if (isBenchmarking) {
        statusEl.textContent = 'Benchmark Ativo';
        statusEl.className = 'chat-status-indicator busy';
      } else if (isThinking) {
        statusEl.textContent = 'Pensando...';
        statusEl.className = 'chat-status-indicator busy';
      } else if (isPhaseLocked) {
        statusEl.textContent = 'Turno Inimigo';
        statusEl.className = 'chat-status-indicator busy';
      } else if (isQueueLocked) {
        statusEl.textContent = 'Executando...';
        statusEl.className = 'chat-status-indicator busy';
      } else {
        statusEl.textContent = 'Pronto';
        statusEl.className = 'chat-status-indicator ready';
      }
    }
  }

  function setThinking(thinking) {
    isThinking = thinking;
    if (thinking) {
      secondsThinking = 0;
      spinnerTextEl.textContent = 'O Mestre está pensando... (0s)';
      spinnerEl.style.display = 'flex';
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        secondsThinking++;
        spinnerTextEl.textContent = `O Mestre está pensando... (${secondsThinking}s)`;
      }, 1000);
    } else {
      clearInterval(timerInterval);
      timerInterval = null;
      spinnerEl.style.display = 'none';
    }
    updateLockState();
  }

  function clearTag() {
    currentTag = null;
    tagBadgeEl.style.display = 'none';
    tagTextEl.textContent = '';
    bus?.emit('ui:tagSelected', null);
  }

  function setTag(tag) {
    if (tag && (tag.id || typeof tag === 'string')) {
      currentTag = tag;
      const tagLabel = tag.label || tag.id || tag;
      tagBadgeEl.style.display = 'inline-flex';
      tagTextEl.textContent = `Ação Preparada: ${tagLabel}`;
    } else {
      currentTag = null;
      tagBadgeEl.style.display = 'none';
      tagTextEl.textContent = '';
    }
  }

  function appendMessage({ role = 'player', author, text, level = 'info', classId = null, hero = null }) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-entry msg-${role} chat-role-${role}`;
    if (role === 'system' && level === 'error') {
      msgEl.classList.add('system-error');
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'chat-entry-meta';

    const badgeEl = document.createElement('span');

    if (role === 'gm') {
      badgeEl.className = 'chat-role-badge badge-gm';
      badgeEl.textContent = author || 'Mestre da Masmorra';
    } else if (role === 'player') {
      const resolvedClassId = classId || hero?.classId || currentActiveHero?.classId ||
        HERO_ROSTER?.find(h => h.name === author)?.classId || 'warrior';
      const cls = (CLASSES && CLASSES[resolvedClassId]) || { label: 'Herói', color: '#2563EB' };
      const heroColor = cls.color || '#2563EB';

      msgEl.classList.add(`hero-class-${resolvedClassId}`);
      msgEl.style.setProperty('--hero-color', heroColor);
      msgEl.style.borderLeftColor = heroColor;

      badgeEl.className = 'chat-role-badge badge-player';
      badgeEl.style.borderColor = heroColor;
      badgeEl.style.color = heroColor;
      badgeEl.style.backgroundColor = heroColor + '18';
      badgeEl.textContent = author || cls.label || 'Herói';
    } else {
      badgeEl.className = `chat-role-badge badge-${role}`;
      badgeEl.textContent = author || (level === 'error' ? 'Ação Rejeitada' : 'Motor de Regras');
    }

    const timeEl = document.createElement('span');
    timeEl.className = 'chat-time';
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    metaEl.appendChild(badgeEl);
    metaEl.appendChild(timeEl);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'chat-entry-body';
    bodyEl.textContent = text || '';

    msgEl.appendChild(metaEl);
    msgEl.appendChild(bodyEl);

    historyEl.appendChild(msgEl);
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  // Cancel thinking button
  cancelBtn?.addEventListener('click', () => {
    bus?.emit('gm:cancel');
    setThinking(false);
  });

  // Tag Badge UI interactions
  tagClearBtn.addEventListener('click', () => {
    clearTag();
  });

  inputEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (currentTag) {
        ev.preventDefault();
        clearTag();
      }
    } else if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      formEl.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  // Submit Handler
  formEl.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (isThinking || isQueueLocked || isPhaseLocked) return;

    const text = inputEl.value.trim();
    if (!text && !currentTag) return;

    const submittedTag = currentTag ? (typeof currentTag === 'object' ? { ...currentTag } : currentTag) : null;
    bus?.emit('chat:submit', { text, tag: submittedTag });

    inputEl.value = '';
  });

  // Bus Event Listeners
  bus?.on('chat:gm', ({ narrative }) => {
    appendMessage({
      role: 'gm',
      author: 'Mestre da Masmorra',
      text: narrative
    });
  });

  bus?.on('chat:system', ({ level = 'info', text }) => {
    appendMessage({
      role: 'system',
      level,
      author: level === 'error' ? 'Ação Rejeitada' : 'Motor de Regras',
      text
    });
  });

  bus?.on('llm:thinking', (busy) => {
    setThinking(Boolean(busy));
  });

  bus?.on('ui:tagSelected', (tag) => {
    setTag(tag);
  });

  bus?.on('turn:changed', ({ phase, activeId, state }) => {
    isPhaseLocked = phase === 'ENEMY';
    if (state && activeId && state.entities) {
      currentActiveHero = state.entities[activeId];
    } else if (activeId) {
      const roster = HERO_ROSTER?.find(h => h.id === activeId);
      if (roster) {
        currentActiveHero = roster;
      }
    }
    updateLockState();
  });

  bus?.on('queue:busy', (busy) => {
    isQueueLocked = Boolean(busy);
    updateLockState();
  });

  // Welcome message
  appendMessage({
    role: 'gm',
    author: 'Mestre da Masmorra',
    text: 'A masmorra aguarda suas decisões. Escolha uma habilidade no HUD ou declare sua ação abaixo.'
  });

  return {
    appendMessage,
    clearTag,
    setThinking,
    focus: () => inputEl.focus()
  };
}

export const createChat = mountChat;
