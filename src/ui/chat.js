/**
 * Chat component (Sprint 3, Task 3.7).
 * Real submit flow, thinking spinner with cancel button, GM parchment & system bubbles,
 * active tag badge [Tag Ativa: ...], Esc/clear handling, and safe textContent-only rendering.
 * Pure DOM layer, zero direct state mutation.
 */

export function mountChat(rootEl, bus) {
  let currentTag = null;
  let isThinking = false;
  let isQueueLocked = false;
  let isPhaseLocked = false;
  let isBenchmarking = false;
  let timerInterval = null;
  let secondsThinking = 0;

  rootEl.innerHTML = `
    <div class="chat-wrapper">
      <div class="chat-header">
        <span class="chat-title">Crônica da Masmorra</span>
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

      <!-- Active Tag Badge -->
      <div id="chat-tag-badge" class="chat-tag-badge" style="display: none;">
        <span id="chat-tag-text" class="tag-badge-text"></span>
        <button type="button" id="chat-tag-clear" class="tag-badge-close" title="Remover tag ativa (Esc)">✕</button>
      </div>

      <!-- Input Form -->
      <form id="chat-form" class="chat-form">
        <textarea
          id="chat-input"
          class="chat-input"
          placeholder="Comande sua ação em linguagem natural... (Shift+Enter para nova linha)"
          rows="2"
        ></textarea>
        <button type="submit" id="chat-send" class="chat-send-btn">Enviar</button>
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
      const tagLabel = tag.id || tag;
      tagBadgeEl.style.display = 'inline-flex';
      tagTextEl.textContent = `[Tag Ativa: ${tagLabel}]`;
    } else {
      currentTag = null;
      tagBadgeEl.style.display = 'none';
      tagTextEl.textContent = '';
    }
  }

  function appendMessage({ role = 'player', author, text, level = 'info' }) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-entry chat-role-${role}`;
    if (role === 'system' && level === 'error') {
      msgEl.classList.add('system-error');
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'chat-entry-meta';

    const badgeEl = document.createElement('span');
    badgeEl.className = `chat-role-badge badge-${role}`;
    badgeEl.textContent = author || (role === 'player' ? 'Herói' : role === 'gm' ? 'Mestre de Jogo' : 'Motor de Regras');

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
      author: 'Mestre de Jogo',
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

  bus?.on('turn:changed', ({ phase }) => {
    isPhaseLocked = phase === 'ENEMY';
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
