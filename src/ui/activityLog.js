/**
 * Activity Log UI Component (Task 3.14 & UI Sprint 3).
 * Compact Rules Log overhaul:
 * White theme card, collapsible header toggle, clean horizontal rows,
 * colored pill badges (.log-TURN, .log-SUCCESS, .log-REJECTED, .log-COMBAT),
 * and pure textContent sanitization.
 */
import { CONFIG } from '../core/config.js';

export function mountActivityLog(rootEl, bus, { max = CONFIG.LOG_MAX_ENTRIES || 300 } = {}) {
  const listEl = rootEl.querySelector('.log-list') || rootEl.querySelector('ul');
  const copyBtn = rootEl.querySelector('#btn-log-copy') || document.getElementById('btn-log-copy');
  const clearBtn = rootEl.querySelector('#btn-log-clear') || document.getElementById('btn-log-clear');
  let toggleBtn = rootEl.querySelector('#btn-log-toggle') || document.getElementById('btn-log-toggle');
  let isCollapsed = false;

  // Ensure collapse/expand toggle button exists in panel header
  if (!toggleBtn) {
    const headerEl = rootEl.querySelector('.panel-header');
    if (headerEl) {
      toggleBtn = document.createElement('button');
      toggleBtn.id = 'btn-log-toggle';
      toggleBtn.className = 'btn-log-toggle';
      toggleBtn.title = 'Recolher Registro de Atividades';
      toggleBtn.setAttribute('aria-label', 'Recolher Registro de Atividades');
      toggleBtn.textContent = '▼';
      const h3 = headerEl.querySelector('h3');
      if (h3) {
        headerEl.insertBefore(toggleBtn, h3);
      } else {
        headerEl.prepend(toggleBtn);
      }
    }
  }

  function setCollapsed(collapsed) {
    isCollapsed = collapsed;
    rootEl.classList.toggle('collapsed', isCollapsed);
    if (toggleBtn) {
      toggleBtn.textContent = isCollapsed ? '▲' : '▼';
      toggleBtn.setAttribute('title', isCollapsed ? 'Expandir Registro de Atividades' : 'Recolher Registro de Atividades');
      toggleBtn.setAttribute('aria-label', isCollapsed ? 'Expandir Registro de Atividades' : 'Recolher Registro de Atividades');
      toggleBtn.classList.toggle('is-collapsed', isCollapsed);
    }
    bus?.emit('ui:logCollapsed', isCollapsed);
  }

  toggleBtn?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setCollapsed(!isCollapsed);
  });

  function append(entry) {
    if (!listEl || !entry) return;

    // Check if user is scrolled near bottom
    const isAtBottom = (listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight) <= 35;

    const li = document.createElement('li');
    const level = (entry.level || 'INFO').toUpperCase();
    li.className = `log-row log-${level}`;

    // Timestamp
    const timeEl = document.createElement('time');
    timeEl.className = 'log-time';
    const d = entry.ts ? new Date(entry.ts) : new Date();
    timeEl.textContent = d.toTimeString().slice(0, 8);

    // Colored Pill Badge
    const badgeEl = document.createElement('span');
    badgeEl.className = `log-pill log-${level}`;
    badgeEl.textContent = level;

    // Message text (sanitized via textContent only)
    let cleanText = entry.text || '';
    const prefixRegex = new RegExp(`^\\[?${level}\\]?\\s*`, 'i');
    cleanText = cleanText.replace(prefixRegex, '');

    const textEl = document.createElement('span');
    textEl.className = 'log-text';
    textEl.textContent = cleanText;

    li.appendChild(timeEl);
    li.appendChild(badgeEl);
    li.appendChild(textEl);

    listEl.appendChild(li);

    // Trim oldest entries beyond max
    while (listEl.children.length > max) {
      listEl.removeChild(listEl.firstChild);
    }

    // Auto-scroll if already at bottom
    if (isAtBottom) {
      listEl.scrollTop = listEl.scrollHeight;
    }
  }

  bus?.on('log:entry', append);

  clearBtn?.addEventListener('click', () => {
    if (listEl) {
      listEl.replaceChildren();
    }
  });

  copyBtn?.addEventListener('click', async () => {
    if (!listEl) return;
    const lines = Array.from(listEl.children).map(li => {
      const time = li.querySelector('.log-time')?.textContent || '';
      const pill = li.querySelector('.log-pill')?.textContent || '';
      const text = li.querySelector('.log-text')?.textContent || '';
      return `${time} [${pill}] ${text}`.trim();
    });
    const fullText = lines.join('\n');
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullText);
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copiado!';
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 1500);
      }
    } catch (err) {
      console.warn('Clipboard write error:', err);
    }
  });

  return {
    append,
    clear: () => listEl?.replaceChildren(),
    setCollapsed,
    toggle: () => setCollapsed(!isCollapsed)
  };
}
