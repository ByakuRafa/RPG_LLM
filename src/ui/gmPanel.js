/**
 * Human GM Mode Panel (Task 3.15).
 * Developer control panel to bypass LLM and manually push payloads.
 * Pure DOM layer, zero direct state mutation.
 */
import { hashString } from '../core/prng.js';
import { FIXTURES as DEFAULT_FIXTURES } from '../core/fixtures.js';
import { CLASSES as DEFAULT_CLASSES, ABILITIES as DEFAULT_ABILITIES } from '../engine/catalog.js';

export function mountGmPanel(rootEl, bus, { getState, catalog, fixtures = DEFAULT_FIXTURES } = {}) {
  const catClasses = catalog?.CLASSES || DEFAULT_CLASSES;
  const catAbilities = catalog?.ABILITIES || DEFAULT_ABILITIES;

  // Build Panel DOM
  rootEl.innerHTML = `
    <div class="gm-drawer-header">
      <div style="display:flex; align-items:center; gap:8px;">
        <strong style="color:var(--accent); font-size:14px;">Modo Mestre GM (Dev)</strong>
        <span style="font-size:11px; background:var(--panel-hover); border:1px solid var(--border); padding:2px 6px; border-radius:4px; color:var(--text-dim);">Bypass LLM</span>
      </div>
      <button id="gm-btn-close" class="btn-sm" title="Fechar (Atalho: \`)">✕</button>
    </div>

    <!-- 1. Move Section -->
    <div class="gm-section">
      <h4>1. Movimento</h4>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Ator:</label>
        <select id="gm-move-char" style="flex:1;"></select>
      </div>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Destino:</label>
        <div style="display:flex; gap:6px; flex:1;">
          <input type="number" id="gm-move-x" min="0" max="11" placeholder="X" style="width:50%;" />
          <input type="number" id="gm-move-y" min="0" max="11" placeholder="Y" style="width:50%;" />
        </div>
        <button id="gm-btn-move" class="btn-sm" style="padding:6px 12px; background:var(--accent); color:#fff; font-weight:600;">Mover</button>
      </div>
      <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">
        Dica: Com o painel aberto, clique no tabuleiro para preencher X e Y.
      </div>
    </div>

    <!-- 2. Ability Section -->
    <div class="gm-section">
      <h4>2. Habilidade Básica</h4>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Conjurador:</label>
        <select id="gm-ab-caster" style="flex:1;"></select>
      </div>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Poder:</label>
        <select id="gm-ab-id" style="flex:1;"></select>
      </div>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Alvo:</label>
        <select id="gm-ab-target" style="flex:1;"></select>
        <button id="gm-btn-ability" class="btn-sm" style="padding:6px 12px; background:var(--accent-purple); color:#fff; font-weight:600;">Usar</button>
      </div>
    </div>

    <!-- 3. Turn Section -->
    <div class="gm-section">
      <h4>3. Controle de Turno</h4>
      <div class="gm-row" style="gap:10px;">
        <button id="gm-btn-end-turn" class="btn-sm" style="flex:1; padding:8px 12px; background:var(--panel-hover); color:var(--accent-gold); font-weight:600; border:1px solid var(--border);">Encerrar Turno</button>
        <button id="gm-btn-reset" class="btn-sm" style="padding:8px 12px; background:var(--panel-hover); color:var(--accent-red); border:1px solid var(--border);">Reiniciar</button>
      </div>
    </div>

    <!-- 4. Raw JSON Section -->
    <div class="gm-section">
      <h4>4. Injetor Raw JSON</h4>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Fixture:</label>
        <select id="gm-fixture" style="flex:1;">
          <option value="">-- Selecione uma fixture --</option>
        </select>
      </div>
      <textarea id="gm-raw-json" rows="6" style="width:100%; margin:8px 0; font-family:var(--font-mono); font-size:11px; resize:vertical;"></textarea>
      <div style="display:flex; justify-content:flex-end;">
        <button id="gm-btn-inject" class="btn-sm" style="padding:6px 14px; background:var(--accent-green); color:#fff; font-weight:600;">Injetar Ações</button>
      </div>
    </div>

    <!-- 5. Footer Hashes -->
    <div class="gm-section" style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted); line-height:1.8;">
      <div>State Hash: <span id="gm-state-hash" style="color:var(--accent-gold);">--</span></div>
      <div>Map Hash: <span id="gm-map-hash" style="color:var(--accent);">--</span></div>
      <div>Seq: <span id="gm-seq" style="color:var(--text);">0</span></div>
    </div>
  `;

  // Element References
  const closeBtn = rootEl.querySelector('#gm-btn-close');
  const toggleBtn = document.getElementById('btn-toggle-gm');

  const moveCharSelect = rootEl.querySelector('#gm-move-char');
  const moveXInput = rootEl.querySelector('#gm-move-x');
  const moveYInput = rootEl.querySelector('#gm-move-y');
  const btnMove = rootEl.querySelector('#gm-btn-move');

  const abCasterSelect = rootEl.querySelector('#gm-ab-caster');
  const abIdSelect = rootEl.querySelector('#gm-ab-id');
  const abTargetSelect = rootEl.querySelector('#gm-ab-target');
  const btnAbility = rootEl.querySelector('#gm-btn-ability');

  const btnEndTurn = rootEl.querySelector('#gm-btn-end-turn');
  const btnReset = rootEl.querySelector('#gm-btn-reset');

  const fixtureSelect = rootEl.querySelector('#gm-fixture');
  const rawJsonTextarea = rootEl.querySelector('#gm-raw-json');
  const btnInject = rootEl.querySelector('#gm-btn-inject');

  const stateHashEl = rootEl.querySelector('#gm-state-hash');
  const mapHashEl = rootEl.querySelector('#gm-map-hash');
  const seqEl = rootEl.querySelector('#gm-seq');

  const actionButtons = [btnMove, btnAbility, btnEndTurn, btnReset, btnInject];

  // Drawer Toggle Helpers
  function isOpen() {
    return rootEl.classList.contains('open') || !rootEl.classList.contains('gm-drawer-collapsed');
  }

  function toggleDrawer() {
    if (isOpen()) {
      rootEl.classList.add('gm-drawer-collapsed');
      rootEl.classList.remove('open');
    } else {
      rootEl.classList.remove('gm-drawer-collapsed');
      rootEl.classList.add('open');
    }
  }

  closeBtn?.addEventListener('click', toggleDrawer);
  toggleBtn?.addEventListener('click', toggleDrawer);

  window.addEventListener('keydown', (ev) => {
    if (ev.key === '`' || ev.key === 'Dead') {
      if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) {
        return;
      }
      ev.preventDefault();
      toggleDrawer();
    }
  });

  // Board Click integration: fills X/Y while drawer is open
  bus?.on('board:tileClicked', ({ x, y }) => {
    if (isOpen()) {
      moveXInput.value = x;
      moveYInput.value = y;
    }
  });

  // Populate Fixtures Dropdown
  if (fixtures) {
    for (const name of Object.keys(fixtures)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      fixtureSelect.appendChild(opt);
    }

    fixtureSelect.addEventListener('change', () => {
      const selected = fixtureSelect.value;
      if (selected && fixtures[selected]) {
        rawJsonTextarea.value = JSON.stringify(fixtures[selected], null, 2);
      }
    });
  }

  // Populate Ability Dropdown when Caster Changes
  function refreshAbilitiesForCaster(casterId, state) {
    abIdSelect.replaceChildren();
    const entity = state?.entities?.[casterId];
    const abilities = entity?.abilities || [];

    for (const abId of abilities) {
      const spec = catAbilities[abId] || { id: abId, label: abId };
      const opt = document.createElement('option');
      opt.value = abId;
      opt.textContent = `${spec.label || spec.id} (${spec.apCost || 1} AP)`;
      abIdSelect.appendChild(opt);
    }
  }

  abCasterSelect?.addEventListener('change', () => {
    const state = typeof getState === 'function' ? getState() : null;
    refreshAbilitiesForCaster(abCasterSelect.value, state);
  });

  // Update State & Hashes
  function updateUI(state) {
    if (!state) return;

    // Hashes
    if (stateHashEl) stateHashEl.textContent = hashString(JSON.stringify(state));
    if (mapHashEl) mapHashEl.textContent = state.map?.hash || '--';
    if (seqEl) seqEl.textContent = String(state.seq || 0);

    // Characters list (heroes + enemies)
    const entities = Object.values(state.entities || {});
    const aliveList = entities.filter(e => e.alive);

    // Update Move Char select
    const prevMoveVal = moveCharSelect.value;
    moveCharSelect.replaceChildren();
    for (const e of aliveList) {
      const opt = document.createElement('option');
      opt.value = e.id;
      const roleTag = e.role === 'player' ? 'Herói' : 'Inimigo';
      opt.textContent = `${e.name} (${roleTag}) — MP: ${e.mp}/${e.maxMp}`;
      moveCharSelect.appendChild(opt);
    }
    if (state.activeId && state.entities[state.activeId]?.alive) {
      moveCharSelect.value = state.activeId;
    } else if (prevMoveVal && state.entities[prevMoveVal]?.alive) {
      moveCharSelect.value = prevMoveVal;
    }

    // Update Ability Caster select
    const prevCasterVal = abCasterSelect.value;
    abCasterSelect.replaceChildren();
    for (const e of aliveList) {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = `${e.name} — AP: ${e.ap}/${e.maxAp}`;
      abCasterSelect.appendChild(opt);
    }
    const currentCaster = (state.activeId && state.entities[state.activeId]?.alive)
      ? state.activeId
      : (prevCasterVal || aliveList[0]?.id);
    abCasterSelect.value = currentCaster;
    refreshAbilitiesForCaster(currentCaster, state);

    // Update Ability Targets select (entities + objects)
    const prevTargetVal = abTargetSelect.value;
    abTargetSelect.replaceChildren();
    for (const e of aliveList) {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = `${e.name} (${e.position.x},${e.position.y}) [HP: ${e.hp}]`;
      abTargetSelect.appendChild(opt);
    }
    const objects = Object.values(state.objects || {});
    for (const obj of objects) {
      const opt = document.createElement('option');
      opt.value = obj.id;
      opt.textContent = `${obj.label || (obj.type === 'chest' ? 'Baú' : obj.id)} (${obj.position.x},${obj.position.y})`;
      abTargetSelect.appendChild(opt);
    }
    if (prevTargetVal && (state.entities[prevTargetVal]?.alive || state.objects[prevTargetVal])) {
      abTargetSelect.value = prevTargetVal;
    }
  }

  // Button Handlers
  btnMove?.addEventListener('click', () => {
    const charId = moveCharSelect.value;
    const targetX = parseInt(moveXInput.value, 10);
    const targetY = parseInt(moveYInput.value, 10);

    if (!charId || isNaN(targetX) || isNaN(targetY)) {
      bus?.emit('log:entry', {
        level: 'REJECTED',
        text: '[REJECTED] Coordenadas inválidas para movimento.',
        source: 'HUMAN_GM',
        ts: Date.now()
      });
      return;
    }

    bus?.emit('intent:enqueue', {
      source: 'HUMAN_GM',
      tool_calls: [{
        name: 'move_character',
        arguments: {
          character_id: charId,
          target_x: targetX,
          target_y: targetY
        }
      }]
    });
  });

  btnAbility?.addEventListener('click', () => {
    const casterId = abCasterSelect.value;
    const abilityId = abIdSelect.value;
    const targetId = abTargetSelect.value;

    if (!casterId || !abilityId || !targetId) {
      bus?.emit('log:entry', {
        level: 'REJECTED',
        text: '[REJECTED] Parâmetros de habilidade incompletos.',
        source: 'HUMAN_GM',
        ts: Date.now()
      });
      return;
    }

    bus?.emit('intent:enqueue', {
      source: 'HUMAN_GM',
      tool_calls: [{
        name: 'use_ability',
        arguments: {
          caster_id: casterId,
          ability_id: abilityId,
          target_id: targetId
        }
      }]
    });
  });

  btnEndTurn?.addEventListener('click', () => {
    const state = typeof getState === 'function' ? getState() : null;
    const activeId = state?.activeId || moveCharSelect.value;

    bus?.emit('intent:enqueue', {
      source: 'HUMAN_GM',
      tool_calls: [{
        name: 'end_turn',
        arguments: {
          character_id: activeId
        }
      }]
    });
  });

  btnReset?.addEventListener('click', () => {
    const state = typeof getState === 'function' ? getState() : null;
    bus?.emit('intent:reset', { seed: state?.seed });
  });

  btnInject?.addEventListener('click', () => {
    const raw = rawJsonTextarea.value.trim();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const batch = Array.isArray(parsed) ? { tool_calls: parsed } : parsed;
      bus?.emit('intent:enqueue', {
        source: 'HUMAN_GM',
        ...batch
      });
    } catch (err) {
      bus?.emit('log:entry', {
        level: 'ERROR',
        text: `[ERROR] JSON inválido: ${err.message}`,
        source: 'HUMAN_GM',
        ts: Date.now()
      });
    }
  });

  // Action Buttons Disabled on Queue Busy
  bus?.on('queue:busy', (busy) => {
    for (const btn of actionButtons) {
      if (btn) btn.disabled = !!busy;
    }
  });

  // State Changed Listener
  bus?.on('state:changed', ({ state }) => {
    updateUI(state);
  });

  // Initial update
  if (typeof getState === 'function') {
    updateUI(getState());
  }

  return { updateUI };
}
