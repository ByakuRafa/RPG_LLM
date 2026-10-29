/**
 * Turn Bar UI Component (UI Sprint 2: Tactical Initiative Ribbon).
 * Pure DOM layer, zero direct state mutation.
 */
import { PHASE, ENEMY_PHASE_ID, TURN_ORDER } from '../core/config.js';
import { CLASSES, HERO_ROSTER } from '../engine/catalog.js';
import { loadSettings } from '../core/settings.js';

export function mountTurnBar(rootEl, bus, { getState, isFakeLlm = false } = {}) {
  const roundEl = rootEl.querySelector('#turn-round') || document.getElementById('turn-round');
  const activeEl = rootEl.querySelector('#turn-active') || document.getElementById('turn-active');

  function updateBadge() {
    let badgeEl = rootEl.querySelector('#turn-llm-badge');
    if (!badgeEl) {
      const contentEl = rootEl.querySelector('.turn-bar-content');
      if (contentEl) {
        badgeEl = document.createElement('span');
        badgeEl.id = 'turn-llm-badge';
        badgeEl.className = 'turn-llm-badge';
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
        const floorText = state.floor ? `Andar ${state.floor} · ` : '';
        roundEl.textContent = `${floorText}Rodada ${state.round || 1}`;
      }
    }

    if (activeEl) {
      activeEl.replaceChildren();

      if (state.phase === PHASE.GAME_OVER) {
        const outcome = state.status === 'won'
          ? '🏆 Vitória! Todos os inimigos foram derrotados.'
          : '💀 Derrota! Todos os heróis caíram.';
        const outcomeSpan = document.createElement('span');
        outcomeSpan.className = 'initiative-gameover-badge';
        outcomeSpan.textContent = outcome;
        activeEl.appendChild(outcomeSpan);
        return;
      }

      const ribbon = document.createElement('div');
      ribbon.className = 'initiative-ribbon';

      const order = TURN_ORDER || ['hero_warrior', 'hero_mage', 'hero_rogue', ENEMY_PHASE_ID];

      order.forEach((unitId, idx) => {
        if (idx > 0) {
          const arrow = document.createElement('span');
          arrow.className = 'initiative-arrow';
          arrow.textContent = '→';
          arrow.setAttribute('aria-hidden', 'true');
          ribbon.appendChild(arrow);
        }

        const isEnemy = unitId === ENEMY_PHASE_ID;
        const chip = document.createElement('div');
        chip.className = 'initiative-chip';

        if (!isEnemy) {
          const hero = state.entities?.[unitId];
          const roster = HERO_ROSTER.find(h => h.id === unitId);
          const classId = hero?.classId || roster?.classId || 'warrior';
          const cls = CLASSES[classId] || {};
          const name = hero?.name || roster?.name || unitId;
          const isAlive = hero ? hero.alive : true;
          const isActive = (state.phase === PHASE.HERO && state.activeId === unitId);

          if (isActive) chip.classList.add('active');
          if (!isAlive) chip.classList.add('dead');
          chip.dataset.unitId = unitId;

          // Portrait / Token Emblem
          const portrait = document.createElement('div');
          portrait.className = 'initiative-portrait';
          portrait.style.borderColor = cls.color || 'var(--border-gold)';

          const img = document.createElement('img');
          img.className = 'initiative-img';
          img.src = cls.tokenUrl || '';
          img.alt = name;
          img.onerror = () => {
            img.style.display = 'none';
            fallback.style.display = 'flex';
          };

          const fallback = document.createElement('span');
          fallback.className = 'initiative-fallback';
          fallback.style.backgroundColor = cls.color || '#58a6ff';
          fallback.textContent = cls.initial || name[0];
          fallback.style.display = 'none';

          portrait.appendChild(img);
          portrait.appendChild(fallback);
          chip.appendChild(portrait);

          // Hero Name
          const nameSpan = document.createElement('span');
          nameSpan.className = 'initiative-name';
          nameSpan.textContent = name;
          chip.appendChild(nameSpan);

          // Class-colored Badge
          const badge = document.createElement('span');
          badge.className = 'initiative-badge';
          badge.style.backgroundColor = cls.color || '#E53935';
          badge.textContent = cls.label || classId;
          chip.appendChild(badge);

          if (isActive) {
            const pip = document.createElement('span');
            pip.className = 'initiative-active-pip';
            pip.title = 'Turno Ativo';
            chip.appendChild(pip);
          }
        } else {
          // Enemy Phase Chip
          const isEnemyActive = (state.phase === PHASE.ENEMY);
          const aliveEnemies = Object.values(state.entities || {}).filter(e => e.role === 'enemy' && e.alive);
          const allDead = aliveEnemies.length === 0;

          if (isEnemyActive) chip.classList.add('active');
          if (allDead) chip.classList.add('dead');
          chip.classList.add('enemy-chip');
          chip.dataset.unitId = ENEMY_PHASE_ID;

          const portrait = document.createElement('div');
          portrait.className = 'initiative-portrait';
          portrait.style.borderColor = '#8D6E63';

          const img = document.createElement('img');
          img.className = 'initiative-img';
          img.src = './assets/tokens/goblin_64.png';
          img.alt = 'Inimigos';
          img.onerror = () => {
            img.style.display = 'none';
            fallback.style.display = 'flex';
          };

          const fallback = document.createElement('span');
          fallback.className = 'initiative-fallback';
          fallback.style.backgroundColor = '#8D6E63';
          fallback.textContent = 'G';
          fallback.style.display = 'none';

          portrait.appendChild(img);
          portrait.appendChild(fallback);
          chip.appendChild(portrait);

          const nameSpan = document.createElement('span');
          nameSpan.className = 'initiative-name';
          nameSpan.textContent = 'Inimigos';
          chip.appendChild(nameSpan);

          const badge = document.createElement('span');
          badge.className = 'initiative-badge';
          badge.style.backgroundColor = '#8D6E63';
          badge.textContent = 'Fase Inimiga';
          chip.appendChild(badge);

          if (isEnemyActive) {
            const pip = document.createElement('span');
            pip.className = 'initiative-active-pip';
            pip.title = 'Fase Inimiga Ativa';
            chip.appendChild(pip);
          }
        }

        ribbon.appendChild(chip);
      });

      activeEl.appendChild(ribbon);
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
