/**
 * Chat component (Task 3.6).
 * Pre-LLM chat feed, active tag badge [Tag Ativa: ...], Esc/clear handling,
 * and safe textContent-only rendering.
 * Pure DOM layer, zero direct state mutation.
 */

export function mountChat(rootEl, bus) {
  let currentTag = null;
  let isLocked = false;

  rootEl.innerHTML = `
    <div class="chat-wrapper">
      <div class="chat-header">
        <span class="chat-title">Crônica da Masmorra</span>
        <span class="chat-status-indicator" id="chat-status-indicator">Pronto</span>
      </div>
      <div id="chat-history" class="chat-history"></div>
      <div id="chat-tag-badge" class="chat-tag-badge" style="display: none;">
        <span id="chat-tag-text" class="tag-badge-text"></span>
        <button type="button" id="chat-tag-clear" class="tag-badge-close" title="Remover tag ativa (Esc)">✕</button>
      </div>
      <form id="chat-form" class="chat-form">
        <textarea
          id="chat-input"
          class="chat-input"
          placeholder="Ação em linguagem natural... (ex: 'atacar goblin', 'beber poção')"
          rows="2"
        ></textarea>
        <button type="submit" id="chat-send" class="chat-send-btn">Enviar</button>
      </form>
    </div>
  `;

  const historyEl = rootEl.querySelector('#chat-history');
  const tagBadgeEl = rootEl.querySelector('#chat-tag-badge');
  const tagTextEl = rootEl.querySelector('#chat-tag-text');
  const tagClearBtn = rootEl.querySelector('#chat-tag-clear');
  const formEl = rootEl.querySelector('#chat-form');
  const inputEl = rootEl.querySelector('#chat-input');
  const sendBtn = rootEl.querySelector('#chat-send');
  const statusEl = rootEl.querySelector('#chat-status-indicator');

  function setLocked(locked) {
    isLocked = locked;
    inputEl.disabled = locked;
    sendBtn.disabled = locked;
    if (statusEl) {
      statusEl.textContent = locked ? 'Aguardando...' : 'Pronto';
      statusEl.className = `chat-status-indicator ${locked ? 'busy' : 'ready'}`;
    }
  }

  function clearTag() {
    currentTag = null;
    tagBadgeEl.style.display = 'none';
    tagTextEl.textContent = '';
    bus?.emit('ui:tagSelected', null);
  }

  function setTag(tag) {
    if (tag && tag.id) {
      currentTag = tag;
      tagBadgeEl.style.display = 'inline-flex';
      tagTextEl.textContent = `[Tag Ativa: ${tag.id}]`;
    } else {
      currentTag = null;
      tagBadgeEl.style.display = 'none';
      tagTextEl.textContent = '';
    }
  }

  function appendMessage({ role = 'player', author, text }) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-entry chat-role-${role}`;

    const metaEl = document.createElement('div');
    metaEl.className = 'chat-entry-meta';

    const badgeEl = document.createElement('span');
    badgeEl.className = `chat-role-badge badge-${role}`;
    badgeEl.textContent = author || (role === 'player' ? 'Herói' : role === 'gm' ? 'Mestre GM' : 'Sistema');

    const timeEl = document.createElement('span');
    timeEl.className = 'chat-time';
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
    if (isLocked) return;

    const text = inputEl.value.trim();
    if (!text && !currentTag) return;

    const submittedTag = currentTag ? { ...currentTag } : null;
    bus?.emit('chat:submit', { text, tag: submittedTag });

    inputEl.value = '';
    clearTag();
  });

  // Bus Event Listeners
  bus?.on('ui:tagSelected', (tag) => {
    setTag(tag);
  });

  bus?.on('turn:changed', ({ phase }) => {
    // Auto-clear active tag on turn change
    setTag(null);
    setLocked(phase === 'ENEMY');
  });

  bus?.on('queue:busy', (busy) => {
    setLocked(!!busy);
  });

  // Initial welcome message
  appendMessage({
    role: 'gm',
    author: 'Mestre da Masmorra',
    text: 'A masmorra aguarda suas decisões. Escolha uma habilidade no HUD ou declare sua ação abaixo.'
  });

  return {
    appendMessage,
    clearTag,
    setLocked,
    focus: () => inputEl.focus()
  };
}

// Backwards compatibility alias
export const createChat = mountChat;
