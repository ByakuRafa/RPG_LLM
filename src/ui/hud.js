/**
 * HUD component (UI Sprint 2: Tactical Hotbar & Initiative Turn Ribbon).
 * Left: Active hero card (56x56 emblem, Cinzel name, thick HP bar with 30/30 overlay, MP step blocks 4/4, glowing gold diamond AP pips).
 * Center: 64x64px square RPG hotbar slots with inline SVGs, AP diamond / qty badges, compact labels, emitting ui:tagSelected.
 * Right: Compact RPG party mini-cards + prominent beveled gold/amber End Turn button.
 * Pure DOM layer, zero direct state mutation.
 */
import { CLASSES, ABILITIES, ITEMS, HERO_ROSTER } from '../engine/catalog.js';

export const ACTION_ICONS = {
  // slash = sword
  slash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hotbar-svg icon-slash">
    <path d="M14.5 4.5l5 5-9 9-4-1 1-4 8-9z" fill="currentColor" fill-opacity="0.2"/>
    <path d="M18.5 3.5l2 2-3 3-2-2 3-3z"/>
    <line x1="16.5" y1="7.5" x2="8.5" y2="15.5"/>
    <path d="M6 15l3 3"/>
    <line x1="7" y1="17" x2="3.5" y2="20.5"/>
    <circle cx="3" cy="21" r="1.5" fill="currentColor"/>
  </svg>`,

  // shield_bash = shield
  shield_bash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hotbar-svg icon-shield">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="currentColor" fill-opacity="0.2"/>
    <path d="M12 22s-8-4-8-10V5l8-3 8 3v7c0 6-8 10-8 10z"/>
    <path d="M12 7v10"/>
    <path d="M8 11h8"/>
  </svg>`,

  // firebolt = flame
  firebolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hotbar-svg icon-firebolt">
    <path d="M12 2c-.5 2.5-3 4-3 7 0 1.8.8 3.3 2 4.3-.2-1.3.3-2.6 1.2-3.3 1.5 2 1.8 4 1.8 5 0 2.8-2.2 5-5 5s-5-2.2-5-5c0-4.5 4-8.5 8-13z" fill="currentColor" fill-opacity="0.2"/>
    <path d="M12 2c-.5 2.5-3 4-3 7 0 1.8.8 3.3 2 4.3-.2-1.3.3-2.6 1.2-3.3 1.5 2 1.8 4 1.8 5 0 2.8-2.2 5-5 5s-5-2.2-5-5c0-4.5 4-8.5 8-13z"/>
    <path d="M12 14c-.6 0-1.5.7-1.5 1.5 0 1.1.9 2 2 2 .8 0 1.5-.7 1.5-1.5 0-1.5-1.2-1.7-2-2z" fill="currentColor"/>
  </svg>`,

  // heal_pulse = cross / sparkles
  heal_pulse: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hotbar-svg icon-heal">
    <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" fill="currentColor" fill-opacity="0.2"/>
    <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z"/>
    <path d="M4 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" fill="currentColor"/>
    <path d="M20 4l.8 1.5 1.5.8-1.5.8-.8 1.5-.8-1.5-1.5-.8 1.5-.8.8-1.5z" fill="currentColor"/>
    <path d="M20 18l.8 1.5 1.5.8-1.5.8-.8 1.5-.8-1.5-1.5-.8 1.5-.8.8-1.5z" fill="currentColor"/>
  </svg>`,

  // backstab = twin daggers
  backstab: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hotbar-svg icon-backstab">
    <path d="M19 5l-7 7-1.5-1.5 7-7 1.5 1.5z" fill="currentColor" fill-opacity="0.25"/>
    <line x1="10.5" y1="10.5" x2="7.5" y2="13.5"/>
    <line x1="8" y1="15" x2="5" y2="18"/>
    <line x1="6.5" y1="12" x2="9.5" y2="15"/>
    <path d="M5 5l7 7 1.5-1.5-7-7L5 5z" fill="currentColor" fill-opacity="0.25"/>
    <line x1="13.5" y1="10.5" x2="16.5" y2="13.5"/>
    <line x1="16" y1="15" x2="19" y2="18"/>
    <line x1="17.5" y1="12" x2="14.5" y2="15"/>
  </svg>`,

  // lockpick = key
  lockpick: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hotbar-svg icon-lockpick">
    <circle cx="7.5" cy="15.5" r="4.5" fill="currentColor" fill-opacity="0.2"/>
    <circle cx="7.5" cy="15.5" r="4.5"/>
    <circle cx="7.5" cy="15.5" r="1.5" fill="currentColor"/>
    <path d="M10.8 12.2L20 3l2 2-1.5 1.5L19 5l-2 2 1.5 1.5-1 1-1.5-1.5-2.2 2.2"/>
  </svg>`,

  // health_potion = flask
  health_potion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hotbar-svg icon-potion">
    <path d="M10 2h4"/>
    <path d="M10 2v3a2 2 0 0 1-.5 1.3L5.4 12.6A6 6 0 0 0 10 22h4a6 6 0 0 0 4.6-9.4L14.5 6.3A2 2 0 0 1 14 5V2"/>
    <path d="M6.5 14c1.5-1 3.5 1 5.5 0s3.5 1 5.5 0v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5v-3z" fill="currentColor" fill-opacity="0.3"/>
    <circle cx="11" cy="16" r="1" fill="currentColor"/>
    <circle cx="13" cy="18" r="1.2" fill="currentColor"/>
  </svg>`,

  // goblin_strike (club/fist)
  goblin_strike: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hotbar-svg icon-goblin">
    <path d="M14.5 4.5l5 5-9 9-4-1 1-4 8-9z" fill="currentColor" fill-opacity="0.2"/>
    <line x1="16.5" y1="7.5" x2="8.5" y2="15.5"/>
    <path d="M6 15l3 3"/>
    <line x1="7" y1="17" x2="3.5" y2="20.5"/>
  </svg>`,

  // gold_coins
  gold_coins: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hotbar-svg icon-coins">
    <ellipse cx="12" cy="7" rx="8" ry="3" fill="currentColor" fill-opacity="0.2"/>
    <ellipse cx="12" cy="7" rx="8" ry="3"/>
    <path d="M4 7v5c0 1.66 3.58 3 8 3s8-1.34 8-3V7"/>
    <path d="M4 12v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5"/>
  </svg>`,

  default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hotbar-svg">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" fill-opacity="0.2"/>
  </svg>`
};

function getActionSvg(id) {
  return ACTION_ICONS[id] || ACTION_ICONS.default;
}

function getAbilityTooltip(ab) {
  if (!ab) return '';
  let eff = '';
  if (ab.effect?.type === 'damage') {
    eff = `${ab.effect.amount} de dano${ab.effect.push ? `, empurra ${ab.effect.push}` : ''}`;
  } else if (ab.effect?.type === 'heal') {
    eff = `${ab.effect.amount} de cura`;
  } else if (ab.effect?.type === 'unlock') {
    eff = 'destranca baús';
  } else {
    eff = 'efeito especial';
  }
  return `${ab.label} — ${eff}, alcance ${ab.range}, custa ${ab.apCost} AP`;
}

function getItemTooltip(itemDef) {
  if (!itemDef) return '';
  if (!itemDef.usable) return `${itemDef.label} — Moeda / Item de valor`;
  if (itemDef.effect?.type === 'heal') {
    return `${itemDef.label} — Restaura ${itemDef.effect.amount} de vida, alcance ${itemDef.range || 1}`;
  }
  return `${itemDef.label} — Item utilizável`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function mountHud(rootEl, bus, { getState } = {}) {
  let selectedTag = null; // { kind, id } or null
  let isBusy = false;
  let lastState = typeof getState === 'function' ? getState() : null;

  function render(vm = {}) {
    const s = vm.state || lastState || (typeof getState === 'function' ? getState() : null);
    lastState = s;

    if (vm.selectedTag !== undefined) selectedTag = vm.selectedTag;
    if (vm.isBusy !== undefined) isBusy = !!vm.isBusy;

    if (!s) {
      rootEl.innerHTML = '<div class="hud-placeholder">Aguardando início do jogo...</div>';
      return;
    }

    const activeId = vm.activeId || s.activeId;
    const active = s.entities?.[activeId];
    const isEnemyPhase = s.phase === 'ENEMY';
    const isLocked = isBusy || isEnemyPhase || !active || !active.alive;

    // 1. Left: Active Hero Card
    let leftHtml = '';
    if (active) {
      const cls = CLASSES[active.classId] || {};
      const rosterEntry = HERO_ROSTER.find(r => r.id === active.id);
      const playerNum = rosterEntry?.player ?? 1;
      const hp = Math.max(0, active.hp ?? 0);
      const maxHp = active.maxHp || 1;
      const hpPct = Math.min(100, Math.max(0, Math.round((hp / maxHp) * 100)));
      const mp = active.mp ?? 0;
      const maxMp = active.maxMp ?? 0;
      const ap = active.ap ?? 0;
      const maxAp = active.maxAp ?? 1;

      // AP Diamond Pips (Glowing gold)
      let apPipsHtml = '';
      for (let i = 0; i < maxAp; i++) {
        const filled = i < ap ? 'filled' : 'empty';
        apPipsHtml += `<span class="hud-pip hud-pip-diamond ${filled}" title="AP ${ap}/${maxAp}"></span>`;
      }

      // MP Step Blocks
      let mpStepsHtml = '';
      for (let i = 0; i < maxMp; i++) {
        const isFilled = i < mp;
        mpStepsHtml += `<span class="mp-step-block ${isFilled ? 'filled' : 'empty'}" title="MP ${mp}/${maxMp}"></span>`;
      }

      let hpClass = '';
      if (hpPct <= 25) hpClass = 'critical';
      else if (hpPct <= 50) hpClass = 'warning';

      leftHtml = `
        <div class="hud-hero-card" id="hud-active-hero">
          <div class="hero-card-header">
            <div class="hero-emblem-frame" style="border-color: ${cls.color || 'var(--border-gold)'};">
              <img
                src="${cls.tokenUrl || ''}"
                alt="${escapeHtml(active.name)}"
                class="hero-emblem-img"
                onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
              />
              <span class="hero-emblem-fallback" style="background:${cls.color || '#58a6ff'}; display:none;">${cls.initial || active.name[0]}</span>
            </div>
            <div class="hero-name-col">
              <strong class="hero-name">${escapeHtml(active.name)}</strong>
              <div class="hero-subline">
                <span class="hero-class-badge" style="background:${cls.color}22; color:${cls.color}; border:1px solid ${cls.color}55;">${escapeHtml(cls.label || active.classId)}</span>
                <span class="hero-player-label">Jogador ${playerNum}</span>
              </div>
            </div>
          </div>
          <div class="hero-stats-row">
            <!-- Thick Stylized HP Bar with Numeric Overlay -->
            <div class="hero-hp-block">
              <div class="hero-bar-track hero-hp-track">
                <div class="hero-bar-fill hero-hp-fill ${hpClass}" style="width: ${hpPct}%;"></div>
                <span class="hero-hp-overlay">${hp}/${maxHp}</span>
              </div>
            </div>
            <!-- MP Step Blocks -->
            <div class="hero-mp-block" title="MP ${mp}/${maxMp}">
              <span class="hero-mp-label">MP</span>
              <div class="hero-mp-steps">
                ${mpStepsHtml}
              </div>
              <span class="hero-mp-val">${mp}/${maxMp}</span>
            </div>
            <!-- AP Diamond Pips -->
            <div class="hero-ap-block" title="Pontos de Ação (AP ${ap}/${maxAp})">
              <span class="ap-pips-label">AP</span>
              <div class="hero-ap-pips">
                ${apPipsHtml}
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      leftHtml = `
        <div class="hud-hero-card idle" id="hud-active-hero">
          <span class="hud-placeholder">Nenhum herói ativo</span>
        </div>
      `;
    }

    // 2. Center: Tactical Action Slots (64x64px Square RPG Hotbar)
    let abilitiesHtml = '';
    const abilities = active?.abilities || [];
    for (const abId of abilities) {
      const ab = ABILITIES[abId] || { id: abId, label: abId, apCost: 1, range: 1 };
      const isSelected = selectedTag?.kind === 'ability' && selectedTag?.id === abId;
      const hasAp = (active?.ap ?? 0) >= (ab.apCost ?? 1);
      const disabled = isLocked || !hasAp;
      const tooltip = getAbilityTooltip(ab);

      abilitiesHtml += `
        <button
          type="button"
          id="hud-ab-${ab.id}"
          class="tag hotbar-slot hud-tag-ability ${isSelected ? 'selected active' : ''}"
          data-kind="ability"
          data-id="${ab.id}"
          title="${escapeHtml(tooltip)}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="slot-badge slot-badge-ap" title="Custo de AP">${ab.apCost} AP</span>
          <span class="slot-icon-wrap">${getActionSvg(ab.id)}</span>
          <span class="tag-label slot-label">${escapeHtml(ab.label || ab.id)}</span>
        </button>
      `;
    }

    let itemsHtml = '';
    // Support per-hero items or party-shared inventory
    const items = (active?.items && active.items.length > 0) ? active.items : (s.inventory || []);
    for (const item of items) {
      const itemDef = ITEMS[item.id] || { id: item.id, label: item.id, usable: false };
      const isSelected = selectedTag?.kind === 'item' && selectedTag?.id === item.id;
      const disabled = isLocked || !itemDef.usable || item.qty <= 0;
      const tooltip = getItemTooltip(itemDef);

      itemsHtml += `
        <button
          type="button"
          id="hud-item-${item.id}"
          class="tag hotbar-slot hud-tag-item ${isSelected ? 'selected active' : ''}"
          data-kind="item"
          data-id="${item.id}"
          title="${escapeHtml(tooltip)}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="slot-badge slot-badge-qty" title="Quantidade">x${item.qty}</span>
          <span class="slot-icon-wrap">${getActionSvg(item.id)}</span>
          <span class="tag-label slot-label">${escapeHtml(itemDef.label || item.id)}</span>
        </button>
      `;
    }

    const centerHtml = `
      <div class="hud-tags-section" id="hud-tags">
        <div class="tags-group">
          <span class="tags-group-title">Habilidades</span>
          <div class="tags-list">
            ${abilitiesHtml || '<span class="tags-empty">Sem habilidades</span>'}
          </div>
        </div>
        <div class="tags-group">
          <span class="tags-group-title">Itens / Mochila</span>
          <div class="tags-list">
            ${itemsHtml || '<span class="tags-empty">Mochila vazia</span>'}
          </div>
        </div>
      </div>
    `;

    // 3. Right: Party mini-cards + End Turn button
    let partyMiniHtml = '';
    for (const roster of HERO_ROSTER) {
      const hero = s.entities?.[roster.id];
      if (!hero) continue;
      const cls = CLASSES[hero.classId] || {};
      const isActive = hero.id === activeId;
      const isDead = !hero.alive;
      const hp = Math.max(0, hero.hp ?? 0);
      const maxHp = hero.maxHp || 1;
      const hpPct = Math.min(100, Math.max(0, Math.round((hp / maxHp) * 100)));

      let miniHpClass = '';
      if (hpPct <= 25) miniHpClass = 'critical';
      else if (hpPct <= 50) miniHpClass = 'warning';

      partyMiniHtml += `
        <div class="party-mini-card ${isActive ? 'active' : ''} ${isDead ? 'dead' : ''}" title="${escapeHtml(hero.name)}">
          <div class="mini-portrait-frame" style="border-color: ${cls.color || 'var(--border-gold)'};">
            <img
              src="${cls.tokenUrl || ''}"
              alt="${escapeHtml(hero.name)}"
              class="mini-portrait-img"
              onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
            />
            <span class="mini-initial" style="background:${cls.color || '#58a6ff'}; display:none;">${cls.initial || hero.name[0]}</span>
          </div>
          <div class="mini-info">
            <div class="mini-name-row">
              <span class="mini-name">${escapeHtml(hero.name)}</span>
              ${isActive ? '<span class="mini-active-dot" title="Turno Ativo"></span>' : ''}
            </div>
            <div class="mini-bar-track">
              <div class="mini-bar-fill ${miniHpClass}" style="width: ${isDead ? 0 : hpPct}%;"></div>
            </div>
            <div class="mini-stats-sub">
              <span class="mini-hp-text">${hp}/${maxHp}</span>
              <span class="mini-mp">MP ${hero.mp}/${hero.maxMp}</span>
            </div>
          </div>
        </div>
      `;
    }

    const endTurnDisabled = isLocked;
    const rightHtml = `
      <div class="hud-party-section">
        <div class="hud-party-cards" id="hud-party-cards">
          ${partyMiniHtml}
        </div>
        <button
          type="button"
          id="hud-btn-end-turn"
          class="btn-end-turn"
          title="Encerrar o turno do herói ativo"
          ${endTurnDisabled ? 'disabled' : ''}
        >
          Encerrar Turno
        </button>
      </div>
    `;

    // Full layout assemble
    rootEl.innerHTML = `
      <div class="hud-layout">
        ${leftHtml}
        ${centerHtml}
        ${rightHtml}
      </div>
    `;

    // Wire Tag click events
    rootEl.querySelectorAll('.tag').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.kind;
        const id = btn.dataset.id;
        const isCurrent = selectedTag && selectedTag.kind === kind && selectedTag.id === id;
        const nextTag = isCurrent ? null : { kind, id };
        selectedTag = nextTag;
        bus?.emit('ui:tagSelected', nextTag);
        render();
      });
    });

    // Wire End Turn button
    const endTurnBtn = rootEl.querySelector('#hud-btn-end-turn');
    if (endTurnBtn) {
      endTurnBtn.addEventListener('click', () => {
        if (!active || !active.alive) return;
        bus?.emit('intent:enqueue', {
          source: 'UI',
          tool_calls: [{
            name: 'end_turn',
            arguments: { character_id: active.id }
          }]
        });
      });
    }
  }

  // Bus event wiring
  bus?.on('state:changed', ({ state }) => {
    lastState = state;
    render({ state });
  });

  bus?.on('queue:busy', (busy) => {
    isBusy = !!busy;
    render({ isBusy });
  });

  bus?.on('hud:disable', (disabled) => {
    isBusy = !!disabled;
    render({ isBusy });
  });

  bus?.on('ui:tagSelected', (tag) => {
    selectedTag = tag;
    render({ selectedTag });
  });

  bus?.on('turn:changed', ({ phase, activeId }) => {
    if (phase === 'ENEMY') {
      selectedTag = null;
    }
    const s = typeof getState === 'function' ? getState() : lastState;
    render({ state: s, activeId });
  });

  // Initial render
  render();

  return { render };
}

// Backwards compatibility alias
export const createHud = mountHud;
