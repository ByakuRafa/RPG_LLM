/**
 * Human GM Mode Panel (Task 3.8 / Task 3.15).
 * Developer control panel to bypass LLM and manually push payloads.
 * Features: Movement, Abilities, Items, Interaction, Inventory, Invalidator Presets & Hash Check.
 * Pure DOM layer, zero direct state mutation.
 */
import { hashString } from '../core/prng.js';
import { FIXTURES as DEFAULT_FIXTURES } from '../core/fixtures.js';
import { CLASSES as DEFAULT_CLASSES, ABILITIES as DEFAULT_ABILITIES, ITEMS as DEFAULT_ITEMS } from '../engine/catalog.js';
import { buildIllegalPresets } from './illegalPresets.js';

export function mountGmPanel(rootEl, bus, { getState, catalog, fixtures = DEFAULT_FIXTURES, getGameMaster = null } = {}) {
  const catClasses = catalog?.CLASSES || DEFAULT_CLASSES;
  const catAbilities = catalog?.ABILITIES || DEFAULT_ABILITIES;
  const catItems = catalog?.ITEMS || DEFAULT_ITEMS;

  const PRESET_KEYS = [
    'walk_beyond_mp',
    'walk_into_wall',
    'walk_behind_wall',
    'attack_out_of_range',
    'wrong_turn',
    'heal_enemy',
    'use_missing_item',
    'use_gold',
    'loot_far_chest',
    'double_action'
  ];

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

    <!-- 3. Item Section -->
    <div class="gm-section">
      <h4>3. Usar Item</h4>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Personagem:</label>
        <select id="gm-item-char" style="flex:1;"></select>
      </div>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Item:</label>
        <select id="gm-item-id" style="flex:1;">
          <option value="health_potion">Poção de Vida (health_potion)</option>
          <option value="gold_coins">Moedas de Ouro (gold_coins)</option>
          <option value="mega_elixir">Mega Elixir (mega_elixir - Inválido)</option>
        </select>
      </div>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Alvo:</label>
        <select id="gm-item-target" style="flex:1;"></select>
        <button id="gm-btn-item" class="btn-sm" style="padding:6px 12px; background:var(--accent-green); color:#fff; font-weight:600;">Usar</button>
      </div>
    </div>

    <!-- 4. Interact Section -->
    <div class="gm-section">
      <h4>4. Interagir com Objeto</h4>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Personagem:</label>
        <select id="gm-obj-char" style="flex:1;"></select>
      </div>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Objeto:</label>
        <select id="gm-obj-id" style="flex:1;"></select>
        <button id="gm-btn-interact" class="btn-sm" style="padding:6px 12px; background:var(--accent-gold); color:#fff; font-weight:600;">Interagir</button>
      </div>
    </div>

    <!-- 5. Inventory Section -->
    <div class="gm-section">
      <h4>5. Consultar Inventário</h4>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Personagem:</label>
        <select id="gm-inv-char" style="flex:1;"></select>
        <button id="gm-btn-inventory" class="btn-sm" style="padding:6px 12px; background:var(--panel-hover); border:1px solid var(--border); color:var(--text); font-weight:600;">Consultar</button>
      </div>
    </div>

    <!-- 6. Illegal Presets Section -->
    <div class="gm-section">
      <h4>6. Testes de Validação (Illegal Presets)</h4>
      <div style="font-size:11px; color:var(--text-dim); margin-bottom:8px;">
        Dispara cargas ilegais geradas dinamicamente para verificar integridade e rejeição pelo motor.
      </div>
      <div id="gm-presets-container" style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
        <button id="gm-illegal-walk_beyond_mp" class="btn-sm preset-btn" title="Mover além do MP">Mover além do MP</button>
        <button id="gm-illegal-walk_into_wall" class="btn-sm preset-btn" title="Mover em parede">Entrar em Parede</button>
        <button id="gm-illegal-walk_behind_wall" class="btn-sm preset-btn" title="Mover atrás de parede (BFS > MP)">Atrás de Parede</button>
        <button id="gm-illegal-attack_out_of_range" class="btn-sm preset-btn" title="Ataque fora de alcance">Ataque Longe</button>
        <button id="gm-illegal-wrong_turn" class="btn-sm preset-btn" title="Mover outro herói fora de turno">Fora de Turno</button>
        <button id="gm-illegal-heal_enemy" class="btn-sm preset-btn" title="Curar inimigo com Pulso de Cura">Curar Inimigo</button>
        <button id="gm-illegal-use_missing_item" class="btn-sm preset-btn" title="Usar item inexistente (mega_elixir)">Item Fantasma</button>
        <button id="gm-illegal-use_gold" class="btn-sm preset-btn" title="Usar item não consumível (ouro)">Usar Ouro</button>
        <button id="gm-illegal-loot_far_chest" class="btn-sm preset-btn" title="Saquear baú distante">Baú Distante</button>
        <button id="gm-illegal-double_action" class="btn-sm preset-btn" title="Duas habilidades no mesmo batch (Sem AP)">Ação Dupla (AP)</button>
      </div>
    </div>

    <!-- 7. Turn Section -->
    <div class="gm-section">
      <h4>7. Controle de Turno</h4>
      <div class="gm-row" style="gap:10px;">
        <button id="gm-btn-end-turn" class="btn-sm" style="flex:1; padding:8px 12px; background:var(--panel-hover); color:var(--accent-gold); font-weight:600; border:1px solid var(--border);">Encerrar Turno</button>
        <button id="gm-btn-reset" class="btn-sm" style="padding:8px 12px; background:var(--panel-hover); color:var(--accent-red); border:1px solid var(--border);">Reiniciar</button>
      </div>
    </div>

    <!-- 8. Raw JSON Section -->
    <div class="gm-section">
      <h4>8. Injetor Raw JSON</h4>
      <div class="gm-row">
        <label style="width:70px; font-size:12px; color:var(--text-muted);">Fixture:</label>
        <select id="gm-fixture" style="flex:1;">
          <option value="">-- Selecione uma fixture --</option>
        </select>
      </div>
      <textarea id="gm-raw-json" rows="4" style="width:100%; margin:8px 0; font-family:var(--font-mono); font-size:11px; resize:vertical;"></textarea>
      <div style="display:flex; justify-content:flex-end;">
        <button id="gm-btn-inject" class="btn-sm" style="padding:6px 14px; background:var(--accent-green); color:#fff; font-weight:600;">Injetar Ações</button>
      </div>
    </div>

    <!-- 9. LLM Prompt & Raw Response Inspection (Task 3.9) -->
    <div class="gm-section">
      <h4>9. Inspeção LLM (Prompt & Raw)</h4>
      <div style="display:flex; gap:6px; margin-bottom:8px;">
        <button type="button" id="gm-btn-last-prompt" class="btn-sm" style="flex:1; background:var(--panel-hover); border:1px solid var(--border); color:var(--text); font-weight:600;">Último Prompt</button>
        <button type="button" id="gm-btn-last-raw" class="btn-sm" style="flex:1; background:var(--panel-hover); border:1px solid var(--border); color:var(--text); font-weight:600;">Último Raw</button>
      </div>
      <pre id="gm-inspect-pre" style="max-height:160px; overflow-y:auto; background:var(--bg-deep); border:1px solid var(--border); border-radius:4px; padding:6px; font-size:10px; line-height:1.4; color:var(--text-muted); font-family:var(--font-mono); white-space:pre-wrap; margin:0;">(Nenhum prompt registrado ainda)</pre>
    </div>

    <!-- 10. Footer Hashes & Integrity Status -->
    <div class="gm-section" style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted); line-height:1.8;">
      <div>State Hash: <span id="gm-state-hash" style="color:var(--accent-gold);">--</span></div>
      <div>Map Hash: <span id="gm-map-hash" style="color:var(--accent);">--</span></div>
      <div>Seq: <span id="gm-seq" style="color:var(--text);">0</span></div>
      <div id="gm-integrity-status" style="display:none; margin-top:8px; padding:6px 8px; border-radius:4px; font-weight:bold; font-size:11px; text-align:center;"></div>
    </div>
  `;

  // Element References
  const closeBtn = rootEl.querySelector('#gm-btn-close');
  const toggleBtn = document.getElementById('btn-toggle-gm');

  // Movement
  const moveCharSelect = rootEl.querySelector('#gm-move-char');
  const moveXInput = rootEl.querySelector('#gm-move-x');
  const moveYInput = rootEl.querySelector('#gm-move-y');
  const btnMove = rootEl.querySelector('#gm-btn-move');

  // Ability
  const abCasterSelect = rootEl.querySelector('#gm-ab-caster');
  const abIdSelect = rootEl.querySelector('#gm-ab-id');
  const abTargetSelect = rootEl.querySelector('#gm-ab-target');
  const btnAbility = rootEl.querySelector('#gm-btn-ability');

  // Item
  const itemCharSelect = rootEl.querySelector('#gm-item-char');
  const itemIdSelect = rootEl.querySelector('#gm-item-id');
  const itemTargetSelect = rootEl.querySelector('#gm-item-target');
  const btnItem = rootEl.querySelector('#gm-btn-item');

  // Interact
  const objCharSelect = rootEl.querySelector('#gm-obj-char');
  const objIdSelect = rootEl.querySelector('#gm-obj-id');
  const btnInteract = rootEl.querySelector('#gm-btn-interact');

  // Inventory
  const invCharSelect = rootEl.querySelector('#gm-inv-char');
  const btnInventory = rootEl.querySelector('#gm-btn-inventory');

  // Turns & Inject
  const btnEndTurn = rootEl.querySelector('#gm-btn-end-turn');
  const btnReset = rootEl.querySelector('#gm-btn-reset');
  const fixtureSelect = rootEl.querySelector('#gm-fixture');
  const rawJsonTextarea = rootEl.querySelector('#gm-raw-json');
  const btnInject = rootEl.querySelector('#gm-btn-inject');

  // LLM Inspect
  const btnLastPrompt = rootEl.querySelector('#gm-btn-last-prompt');
  const btnLastRaw = rootEl.querySelector('#gm-btn-last-raw');
  const inspectPre = rootEl.querySelector('#gm-inspect-pre');

  btnLastPrompt?.addEventListener('click', () => {
    const gm = typeof getGameMaster === 'function' ? getGameMaster() : null;
    const prompt = gm?.getLastPrompt?.();
    inspectPre.textContent = prompt ? JSON.stringify(prompt, null, 2) : '(Nenhum prompt registrado ainda)';
  });

  btnLastRaw?.addEventListener('click', () => {
    const gm = typeof getGameMaster === 'function' ? getGameMaster() : null;
    const raw = gm?.getLastRawResponse?.();
    inspectPre.textContent = raw ? raw : '(Nenhuma resposta raw registrada ainda)';
  });

  function getSelectedFixtureText() {
    const raw = rawJsonTextarea?.value?.trim();
    if (raw) return raw;
    const selectedKey = fixtureSelect?.value;
    if (selectedKey && fixtures?.[selectedKey]) {
      return JSON.stringify(fixtures[selectedKey], null, 2);
    }
    const defaultFix = fixtures['LLM · mover+atacar'] || Object.values(fixtures)[0];
    return JSON.stringify(defaultFix || { narrative: 'Mestre avalia.', tool_calls: [] }, null, 2);
  }

  // Hashes & Integrity
  const stateHashEl = rootEl.querySelector('#gm-state-hash');
  const mapHashEl = rootEl.querySelector('#gm-map-hash');
  const seqEl = rootEl.querySelector('#gm-seq');
  const integrityEl = rootEl.querySelector('#gm-integrity-status');

  // Preset Buttons
  const presetButtons = {};
  for (const k of PRESET_KEYS) {
    presetButtons[k] = rootEl.querySelector(`#gm-illegal-${k}`);
  }

  const allActionButtons = [
    btnMove, btnAbility, btnItem, btnInteract, btnInventory,
    btnEndTurn, btnReset, btnInject, ...Object.values(presetButtons)
  ].filter(Boolean);

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

  function setCorruptionWarning(corrupted) {
    if (!integrityEl) return;
    if (corrupted) {
      integrityEl.style.display = 'block';
      integrityEl.style.background = 'rgba(248, 81, 73, 0.2)';
      integrityEl.style.color = 'var(--accent-red)';
      integrityEl.style.border = '1px solid var(--accent-red)';
      integrityEl.textContent = 'ESTADO CORROMPIDO (Hash alterado após rejeição!)';
    } else {
      integrityEl.style.display = 'block';
      integrityEl.style.background = 'rgba(63, 185, 80, 0.15)';
      integrityEl.style.color = 'var(--accent-green)';
      integrityEl.style.border = '1px solid var(--accent-green)';
      integrityEl.textContent = 'Hash Íntegro ✓';
      setTimeout(() => {
        if (integrityEl.textContent.includes('✓')) {
          integrityEl.style.display = 'none';
        }
      }, 3000);
    }
  }

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
    const aliveHeroes = aliveList.filter(e => e.role === 'player');
    const objects = Object.values(state.objects || {});

    // Helper to populate entity selects
    function populateEntitySelect(selectEl, list, preferId) {
      if (!selectEl) return;
      const prevVal = selectEl.value;
      selectEl.replaceChildren();
      for (const e of list) {
        const opt = document.createElement('option');
        opt.value = e.id;
        const roleTag = e.role === 'player' ? 'Herói' : 'Inimigo';
        opt.textContent = `${e.name} (${roleTag}) [HP: ${e.hp}]`;
        selectEl.appendChild(opt);
      }
      if (preferId && list.some(e => e.id === preferId)) {
        selectEl.value = preferId;
      } else if (prevVal && list.some(e => e.id === prevVal)) {
        selectEl.value = prevVal;
      }
    }

    // 1. Move
    populateEntitySelect(moveCharSelect, aliveList, state.activeId);

    // 2. Ability Caster & Target
    populateEntitySelect(abCasterSelect, aliveList, state.activeId);
    refreshAbilitiesForCaster(abCasterSelect.value || state.activeId, state);

    // Target select includes alive entities + objects
    const prevAbTarget = abTargetSelect.value;
    abTargetSelect.replaceChildren();
    for (const e of aliveList) {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = `${e.name} (${e.position.x},${e.position.y}) [HP: ${e.hp}]`;
      abTargetSelect.appendChild(opt);
    }
    for (const obj of objects) {
      const opt = document.createElement('option');
      opt.value = obj.id;
      opt.textContent = `${obj.label || (obj.type === 'chest' ? 'Baú' : obj.id)} (${obj.position.x},${obj.position.y})`;
      abTargetSelect.appendChild(opt);
    }
    if (prevAbTarget && (state.entities[prevAbTarget]?.alive || state.objects[prevAbTarget])) {
      abTargetSelect.value = prevAbTarget;
    }

    // 3. Item Char & Target
    populateEntitySelect(itemCharSelect, aliveHeroes, state.activeId);
    populateEntitySelect(itemTargetSelect, aliveList, state.activeId);

    // 4. Object Interact
    populateEntitySelect(objCharSelect, aliveHeroes, state.activeId);
    const prevObjVal = objIdSelect.value;
    objIdSelect.replaceChildren();
    for (const obj of objects) {
      const opt = document.createElement('option');
      opt.value = obj.id;
      const lockStatus = obj.locked ? 'Trancado' : (obj.opened ? 'Aberto' : 'Destrancado');
      opt.textContent = `${obj.label || 'Baú'} (${obj.id}) [${lockStatus}]`;
      objIdSelect.appendChild(opt);
    }
    if (prevObjVal && state.objects?.[prevObjVal]) {
      objIdSelect.value = prevObjVal;
    }

    // 5. Inventory
    populateEntitySelect(invCharSelect, aliveHeroes, state.activeId);
  }

  // --- Button Handlers ---

  // 1. Move
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

  // 2. Ability
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

  // 3. Item
  btnItem?.addEventListener('click', () => {
    const charId = itemCharSelect.value;
    const itemId = itemIdSelect.value;
    const targetId = itemTargetSelect.value;

    if (!charId || !itemId || !targetId) {
      bus?.emit('log:entry', {
        level: 'REJECTED',
        text: '[REJECTED] Parâmetros de item incompletos.',
        source: 'HUMAN_GM',
        ts: Date.now()
      });
      return;
    }

    bus?.emit('intent:enqueue', {
      source: 'HUMAN_GM',
      tool_calls: [{
        name: 'use_item',
        arguments: {
          character_id: charId,
          item_id: itemId,
          target_id: targetId
        }
      }]
    });
  });

  // 4. Interact
  btnInteract?.addEventListener('click', () => {
    const charId = objCharSelect.value;
    const objId = objIdSelect.value;

    if (!charId || !objId) {
      bus?.emit('log:entry', {
        level: 'REJECTED',
        text: '[REJECTED] Parâmetros de interação incompletos.',
        source: 'HUMAN_GM',
        ts: Date.now()
      });
      return;
    }

    bus?.emit('intent:enqueue', {
      source: 'HUMAN_GM',
      tool_calls: [{
        name: 'interact_object',
        arguments: {
          character_id: charId,
          object_id: objId
        }
      }]
    });
  });

  // 5. Inventory
  btnInventory?.addEventListener('click', () => {
    const charId = invCharSelect.value;
    if (!charId) return;

    bus?.emit('intent:enqueue', {
      source: 'HUMAN_GM',
      tool_calls: [{
        name: 'check_inventory',
        arguments: {
          character_id: charId
        }
      }]
    });
  });

  // 6. Illegal Presets Buttons
  for (const key of PRESET_KEYS) {
    const btn = presetButtons[key];
    if (!btn) continue;

    btn.addEventListener('click', () => {
      const state = typeof getState === 'function' ? getState() : null;
      if (!state) return;

      const presets = buildIllegalPresets(state);
      const preset = presets[key];
      if (!preset || !preset.batch) {
        bus?.emit('log:entry', {
          level: 'REJECTED',
          text: `[REJECTED] Preset ${key} indisponível para o estado atual.`,
          source: 'HUMAN_GM',
          ts: Date.now()
        });
        return;
      }

      // Capture before hash
      const beforeHash = hashString(JSON.stringify(state));

      // Listen for batch completion to verify hash integrity
      const onBatchDone = (result) => {
        bus?.off('queue:batchDone', onBatchDone);
        const afterState = typeof getState === 'function' ? getState() : null;
        const afterHash = hashString(JSON.stringify(afterState));

        // If batch had ZERO applied calls, the state MUST NOT be mutated
        if (result && Array.isArray(result.applied) && result.applied.length === 0) {
          if (afterHash !== beforeHash) {
            setCorruptionWarning(true);
          } else {
            setCorruptionWarning(false);
          }
        }
      };
      bus?.on('queue:batchDone', onBatchDone);

      bus?.emit('intent:enqueue', {
        source: 'HUMAN_GM',
        ...preset.batch
      });
    });
  }

  // 7. Turns
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

  // 8. Raw JSON Inject
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
    for (const btn of allActionButtons) {
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

  return { updateUI, getSelectedFixtureText };
}
