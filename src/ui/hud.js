/**
 * HUD component (Task 3.5).
 * Left: Active hero card (name, class, Jogador N, HP bar, MP 2/4, AP pips).
 * Center: Clickable ability and item tags emitting ui:tagSelected.
 * Right: Party mini-cards + End Turn button.
 * Pure DOM layer, zero direct state mutation.
 */
import { CLASSES, ABILITIES, ITEMS, HERO_ROSTER } from '../engine/catalog.js';

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

    // 1. Left: Active hero card
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

      let apPipsHtml = '';
      for (let i = 0; i < maxAp; i++) {
        const filled = i < ap ? 'filled' : 'empty';
        apPipsHtml += `<span class="hud-pip ${filled}" title="AP ${ap}/${maxAp}"></span>`;
      }

      let hpClass = '';
      if (hpPct <= 25) hpClass = 'critical';
      else if (hpPct <= 50) hpClass = 'warning';

      leftHtml = `
        <div class="hud-hero-card" id="hud-active-hero">
          <div class="hero-card-header">
            <span class="hero-token-initial" style="background:${cls.color || '#58a6ff'};">${cls.initial || active.name[0]}</span>
            <div class="hero-name-col">
              <strong class="hero-name">${escapeHtml(active.name)}</strong>
              <span class="hero-class-label">${escapeHtml(cls.label || active.classId)} · Jogador ${playerNum}</span>
            </div>
          </div>
          <div class="hero-stats-row">
            <div class="hero-hp-block">
              <div class="hero-hp-label">
                <span>HP</span>
                <span>${hp}/${maxHp}</span>
              </div>
              <div class="hero-bar-track">
                <div class="hero-bar-fill ${hpClass}" style="width: ${hpPct}%;"></div>
              </div>
            </div>
            <div class="hero-resources-col">
              <span class="hero-mp-badge">MP ${mp}/${maxMp}</span>
              <div class="hero-ap-pips">
                <span class="ap-pips-label">AP</span>
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

    // 2. Center: Ability & Item tags
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
          class="tag hud-tag-ability ${isSelected ? 'selected' : ''}"
          data-kind="ability"
          data-id="${ab.id}"
          title="${escapeHtml(tooltip)}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="tag-label">${escapeHtml(ab.label || ab.id)}</span>
          <span class="tag-cost">${ab.apCost} AP</span>
        </button>
      `;
    }

    let itemsHtml = '';
    const items = active?.items || [];
    for (const item of items) {
      const itemDef = ITEMS[item.id] || { id: item.id, label: item.id, usable: false };
      const isSelected = selectedTag?.kind === 'item' && selectedTag?.id === item.id;
      const disabled = isLocked || !itemDef.usable || item.qty <= 0;
      const tooltip = getItemTooltip(itemDef);

      itemsHtml += `
        <button
          type="button"
          id="hud-item-${item.id}"
          class="tag hud-tag-item ${isSelected ? 'selected' : ''}"
          data-kind="item"
          data-id="${item.id}"
          title="${escapeHtml(tooltip)}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="tag-label">${escapeHtml(itemDef.label || item.id)}</span>
          <span class="tag-qty">×${item.qty}</span>
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

      partyMiniHtml += `
        <div class="party-mini-card ${isActive ? 'active' : ''} ${isDead ? 'dead' : ''}" title="${escapeHtml(hero.name)}">
          <span class="mini-initial" style="background:${cls.color || '#58a6ff'};">${cls.initial || hero.name[0]}</span>
          <div class="mini-info">
            <span class="mini-name">${escapeHtml(hero.name)}</span>
            <div class="mini-bar-track">
              <div class="mini-bar-fill" style="width: ${isDead ? 0 : hpPct}%;"></div>
            </div>
            <span class="mini-mp">MP ${hero.mp}/${hero.maxMp}</span>
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
