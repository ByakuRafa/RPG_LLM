/**
 * Activity Log UI Component (Task 3.14).
 * Pure DOM layer, textContent only for sanitization.
 */
import { CONFIG } from '../core/config.js';

export function mountActivityLog(rootEl, bus, { max = CONFIG.LOG_MAX_ENTRIES || 300 } = {}) {
  const listEl = rootEl.querySelector('.log-list') || rootEl.querySelector('ul');
  const copyBtn = rootEl.querySelector('#btn-log-copy') || document.getElementById('btn-log-copy');
  const clearBtn = rootEl.querySelector('#btn-log-clear') || document.getElementById('btn-log-clear');

  function append(entry) {
    if (!listEl || !entry) return;

    // Check if user is scrolled near bottom
    const isAtBottom = (listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight) <= 30;

    const li = document.createElement('li');
    const level = entry.level || 'INFO';
    li.className = `log-${level}`;

    // Timestamp
    const timeEl = document.createElement('time');
    const d = entry.ts ? new Date(entry.ts) : new Date();
    timeEl.textContent = d.toTimeString().slice(0, 8);

    // Level tag
    const bEl = document.createElement('b');
    bEl.textContent = `[${level}] `;

    // Message text (sanitized via textContent)
    let cleanText = entry.text || '';
    const prefixRegex = new RegExp(`^\\[${level}\\]\\s*`, 'i');
    cleanText = cleanText.replace(prefixRegex, '');

    const textNode = document.createTextNode(cleanText);

    li.appendChild(timeEl);
    li.appendChild(bEl);
    li.appendChild(textNode);

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
    const lines = Array.from(listEl.children).map(li => li.textContent);
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

  return { append, clear: () => listEl?.replaceChildren() };
}
