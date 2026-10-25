/**
 * Turn Bar UI Component (Task 3.13).
 * Pure DOM layer, zero direct state mutation.
 */
import { PHASE } from '../core/config.js';
import { CLASSES } from '../engine/catalog.js';
import { loadSettings } from '../core/settings.js';

export function mountTurnBar(rootEl, bus, { getState, isFakeLlm = false } = {}) {
  const roundEl = rootEl.querySelector('#turn-round') || document.getElementById('turn-round');
  const activeEl = rootEl.querySelector('#turn-active') || document.getElementById('turn-active');

  function updateBadge() {
    let badgeEl = rootEl.querySelector('#turn-llm-badge');
    if (!badgeEl) {
      const contentEl = rootEl.querySelector('.turn-bar-content');
      if (contentEl) {
        const sep = document.createElement('span');
        sep.className = 'turn-separator';
        sep.textContent = '·';
        badgeEl = document.createElement('span');
        badgeEl.id = 'turn-llm-badge';
        badgeEl.className = 'turn-llm-badge';
        contentEl.appendChild(sep);
        contentEl.appendChild(badgeEl);
      }
    }
    if (badgeEl) {
      if (isFakeLlm) {
        badgeEl.textContent = 'FAKE LLM';
        badgeEl.style.color = 'var(--accent-gold)';
      } else {
        const s = loadSettings();
        badgeEl.textContent = `Prompt ${s.promptConfig || 'B'} · ${s.model || 'gemini-3.8-flash'}`;
        badgeEl.style.color = 'var(--accent)';
      }
    }
  }

  function render(state) {
    updateBadge();
    if (!state) return;

    if (roundEl) {
      if (state.phase === PHASE.GAME_OVER) {
        roundEl.textContent = 'Fim de Jogo';
      } else {
        roundEl.textContent = `Rodada ${state.round || 1}`;
      }
    }

    if (activeEl) {
      activeEl.replaceChildren();

      if (state.phase === PHASE.HERO) {
        const hero = state.entities?.[state.activeId];
        if (hero) {
          const classLabel = CLASSES[hero.classId]?.label || hero.classId;

          const prefixNode = document.createTextNode('Vez de: ');
          activeEl.appendChild(prefixNode);

          const chip = document.createElement('span');
          chip.className = 'turn-chip';
          chip.style.backgroundColor = hero.color || '#E53935';
          chip.textContent = hero.name;
          activeEl.appendChild(chip);

          const suffixNode = document.createTextNode(` (${classLabel}) — Jogador ${hero.player || 1}`);
          activeEl.appendChild(suffixNode);
        } else {
          activeEl.textContent = `Vez de: ${state.activeId || 'Herói'}`;
        }
      } else if (state.phase === PHASE.ENEMY) {
        const textNode = document.createTextNode('Fase Inimiga');
        activeEl.appendChild(textNode);

        const spacer = document.createTextNode(' ');
        activeEl.appendChild(spacer);

        const chip = document.createElement('span');
        chip.className = 'turn-chip';
        chip.style.backgroundColor = '#8D6E63';
        chip.textContent = 'Inimigos';
        activeEl.appendChild(chip);
      } else if (state.phase === PHASE.GAME_OVER) {
        const outcome = state.status === 'won' ? 'Vitória! Todos os inimigos foram derrotados.' : 'Derrota! Todos os heróis caíram.';
        activeEl.textContent = outcome;
      }
    }
  }

  bus?.on('settings:changed', () => updateBadge());
  bus?.on('state:changed', ({ state }) => render(state));
  bus?.on('turn:changed', () => {
    if (typeof getState === 'function') {
      render(getState());
    }
  });

  if (typeof getState === 'function') {
    render(getState());
  }

  return { render };
}
