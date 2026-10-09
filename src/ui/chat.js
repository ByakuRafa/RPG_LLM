/**
 * Chat component: Narrative feed, player input, action suggestions,
 * GM thinking state and input history.
 */
export function createChat({ container, bus, onSendAction, onCancelAction }) {
  container.innerHTML = `
    <div class="chat-header">
      <div class="chat-title-group">
        <span class="chat-title">Cronica da Masmorra</span>
        <span class="chat-status-indicator" id="chat-status-indicator"></span>
      </div>
      <button class="chat-clear-btn" id="chat-clear-btn" title="Limpar historico da tela">Limpar</button>
    </div>
    <div class="chat-log" id="chat-log"></div>
    <div class="chat-suggestions" id="chat-suggestions">
      <button class="chip-btn" data-action="Abrir porta">Abrir porta</button>
      <button class="chip-btn" data-action="Atacar goblin">Atacar goblin</button>
      <button class="chip-btn" data-action="Saquear bau">Saquear bau</button>
      <button class="chip-btn" data-action="Ir para o norte">Norte</button>
      <button class="chip-btn" data-action="Ir para o sul">Sul</button>
      <button class="chip-btn" data-action="Ir para o leste">Leste</button>
      <button class="chip-btn" data-action="Ir para o oeste">Oeste</button>
    </div>
    <div class="chat-input-wrapper">
      <form class="chat-form" id="chat-form">
        <input
          type="text"
          id="chat-input"
          class="chat-input"
          placeholder="Acao em linguagem natural ou clique no mapa... (Ex: 'atacar goblin', 'norte', 'abrir porta')"
          autocomplete="off"
        />
        <button type="submit" id="chat-send-btn" class="chat-send-btn">Enviar</button>
      </form>
      <div class="chat-thinking-badge" id="chat-thinking-badge" style="display: none;">
        <div class="chat-thinking-content">
          <span class="spinner"></span>
          <span id="chat-thinking-text">O Mestre esta pensando... (0s)</span>
        </div>
        <button type="button" id="chat-cancel-btn" class="chat-thinking-cancel-btn" title="Cancelar espera">Cancelar</button>
      </div>
    </div>
  `;

  const logEl = container.querySelector('#chat-log');
  const formEl = container.querySelector('#chat-form');
  const inputEl = container.querySelector('#chat-input');
  const sendBtn = container.querySelector('#chat-send-btn');
  const thinkingEl = container.querySelector('#chat-thinking-badge');
  const thinkingTextEl = container.querySelector('#chat-thinking-text');
  const cancelBtn = container.querySelector('#chat-cancel-btn');
  const suggestionsEl = container.querySelector('#chat-suggestions');
  const clearBtn = container.querySelector('#chat-clear-btn');

  let thinkingTimer = null;
  let thinkingSeconds = 0;
  let thinkingModel = '';

  const history = [];
  let historyIdx = -1;

  function appendEntry({ text, type = 'narrative', source = 'gm' }) {
    const entry = document.createElement('div');
    entry.className = `chat-entry ${type} source-${source}`;

    let badge = 'MESTRE';
    if (type === 'player') badge = 'VOCÊ';
    else if (source === 'mock') badge = 'MOCK GM';
    else if (source === 'system') badge = 'SISTEMA';
    else if (source === 'human_gm') badge = 'HUMAN GM';

    entry.innerHTML = `
      <div class="entry-meta">
        <span class="entry-badge">${badge}</span>
        <span class="entry-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="entry-text">${escapeHtml(text)}</div>
    `;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function updateThinkingText() {
    if (!thinkingTextEl) return;
    const isGemma = /gemma/i.test(thinkingModel);
    let note = '';
    if (thinkingSeconds >= 45 && isGemma) {
      note = ' - Gemma 4 pode levar ate 90s no Google AI Studio...';
    } else if (thinkingSeconds >= 20) {
      note = ' - aguardando geracao...';
    }
    thinkingTextEl.textContent = `O Mestre esta pensando... (${thinkingSeconds}s${note})`;
  }

  function setBusy(busy, meta = {}) {
    inputEl.disabled = busy;
    sendBtn.disabled = busy;
    suggestionsEl.querySelectorAll('.chip-btn').forEach((b) => (b.disabled = busy));

    if (thinkingTimer) {
      clearInterval(thinkingTimer);
      thinkingTimer = null;
    }

    if (busy) {
      thinkingSeconds = 0;
      thinkingModel = meta?.model || '';
      updateThinkingText();
      thinkingEl.style.display = 'flex';
      thinkingTimer = setInterval(() => {
        thinkingSeconds++;
        updateThinkingText();
      }, 1000);
    } else {
      thinkingEl.style.display = 'none';
      inputEl.focus();
    }
  }

  cancelBtn.addEventListener('click', () => {
    bus.emit('gm:cancel');
    onCancelAction?.();
  });

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = inputEl.value.trim();
    if (!val) return;
    history.push(val);
    historyIdx = history.length;
    inputEl.value = '';
    appendEntry({ text: val, type: 'player', source: 'player' });
    onSendAction(val);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      if (historyIdx > 0) {
        historyIdx--;
        inputEl.value = history[historyIdx] || '';
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIdx < history.length - 1) {
        historyIdx++;
        inputEl.value = history[historyIdx] || '';
      } else {
        historyIdx = history.length;
        inputEl.value = '';
      }
    }
  });

  suggestionsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip-btn');
    if (!chip) return;
    const action = chip.dataset.action;
    inputEl.value = action;
    inputEl.focus();
  });

  clearBtn.addEventListener('click', () => {
    logEl.innerHTML = '';
  });

  // Event bus hooks
  bus.on('narrative', ({ text, source }) => {
    appendEntry({ text, type: 'narrative', source });
  });

  bus.on('gm:thinking', (arg) => {
    if (typeof arg === 'boolean') {
      setBusy(arg);
    } else {
      setBusy(Boolean(arg?.busy), arg);
    }
  });

  bus.on('game:over', ({ status }) => {
    if (status === 'won') {
      appendEntry({ text: '[Vitoria] Parabens! Voce derrotou todos os inimigos da masmorra!', type: 'system', source: 'system' });
    } else if (status === 'lost') {
      appendEntry({ text: '[Derrota] Suas forcas se esgotaram... Voce sucumbiu a masmorra.', type: 'system', source: 'system' });
    }
  });

  // Easy action description from grid clicks!
  bus.on('grid:select', ({ x, y, entityId }) => {
    if (entityId) {
      if (entityId.startsWith('goblin') || entityId.startsWith('skel')) {
        inputEl.value = `Atacar ${entityId}`;
      } else if (entityId.startsWith('door')) {
        inputEl.value = 'Abrir porta';
      } else if (entityId.startsWith('chest')) {
        inputEl.value = 'Abrir e saquear bau';
      } else if (entityId.startsWith('bag')) {
        inputEl.value = 'Saquear espolio';
      } else {
        inputEl.value = `Mover ate (${x}, ${y})`;
      }
    } else {
      inputEl.value = `Mover para (${x}, ${y})`;
    }
    inputEl.focus();
  });

  // Welcome message
  appendEntry({
    text: 'Voce adentra os corredores umidos da masmorra abandonada. Uma tocha crepita na parede. A sua frente ha uma porta de madeira fechada e, mais adiante, barulhos guturais de criaturas rondando...',
    type: 'narrative',
    source: 'gm',
  });

  return { appendEntry, setBusy, focus: () => inputEl.focus() };
}
