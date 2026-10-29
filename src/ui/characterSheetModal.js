/**
 * Character Sheet Modal Component (Sprint 2: Inspector & Party Creator).
 * Pure DOM layer, zero direct state mutation.
 * Strictly adheres to Alabaster & Gold Tabletop RPG aesthetics and Ground Rule §0.4 (Sanitization: zero innerHTML with user strings).
 */
import { CLASSES, ABILITIES, HERO_ROSTER } from '../engine/catalog.js';
import { ACTION_ICONS } from './hud.js';
import {
  DEFAULT_SHEETS,
  POINT_BUY_CONFIG,
  validateSheet,
  loadSavedSheets,
  saveSheet,
  deleteSheet,
  loadActivePartyRoster,
  saveActivePartyRoster,
  resetToDefaultParty
} from '../core/characterStorage.js';

export const HERO_ABILITY_IDS = Object.freeze([
  'slash',
  'shield_bash',
  'whirlwind',
  'firebolt',
  'fireball',
  'heal_pulse',
  'divine_prayer',
  'backstab',
  'lockpick'
]);

const COLOR_SWATCHES = Object.freeze([
  '#E53935',
  '#1E88E5',
  '#43A047',
  '#8D6E63',
  '#D97706',
  '#7C3AED',
  '#0284C7',
  '#059669',
  '#D946EF',
  '#B45309'
]);

const ALIGNMENTS = Object.freeze([
  'Leal e Bom',
  'Neutro e Bom',
  'Caótico e Bom',
  'Leal e Neutro',
  'Neutro Verdadeiro',
  'Caótico e Neutro',
  'Leal e Mau',
  'Neutro e Mau',
  'Caótico e Mau'
]);

/**
 * Mounts the Character Sheet & Creator Modal.
 *
 * @param {object|null} bus EventBus for communication
 * @param {{ getState?: () => object }} options Optional state accessor
 * @returns {{ open: (opts?: { heroId?: string, mode?: string }) => void, close: () => void, isOpen: () => boolean }}
 */
export function mountCharacterSheetModal(bus = null, { getState = null } = {}) {
  let modalEl = document.getElementById('character-sheet-modal');

  if (!modalEl) {
    modalEl = document.createElement('dialog');
    modalEl.id = 'character-sheet-modal';
    modalEl.className = 'character-sheet-modal';
    document.body.appendChild(modalEl);
  }

  // Shell structure using static HTML templates (zero dynamic user-provided strings)
  modalEl.innerHTML = `
    <div class="sheet-modal-box">
      <!-- Modal Header -->
      <header class="sheet-modal-header">
        <div class="sheet-header-title-group">
          <span class="sheet-header-icon" aria-hidden="true">📜</span>
          <h2 class="sheet-header-title">Pergaminho de Heróis</h2>
        </div>
        <div class="sheet-header-tabs" role="tablist">
          <button type="button" id="tab-btn-inspect" class="sheet-tab-btn active" role="tab" aria-selected="true">
            🛡️ Ficha do Herói (Inspecionar)
          </button>
          <button type="button" id="tab-btn-creator" class="sheet-tab-btn" role="tab" aria-selected="false">
            ⚔️ Forjar Heróis & Grupo
          </button>
        </div>
        <button type="button" id="btn-close-sheet-modal" class="btn-sheet-close" title="Fechar (Esc)">✕</button>
      </header>

      <!-- Panel 1: In-Game Inspector -->
      <section id="panel-sheet-inspect" class="sheet-tab-panel active" role="tabpanel">
        <!-- Hero Selector Switcher -->
        <nav class="sheet-hero-nav" id="sheet-inspect-nav" aria-label="Selecionar Herói"></nav>

        <!-- Main Parchment Sheet Container -->
        <article class="sheet-parchment-card" id="sheet-inspect-card">
          <!-- Header: Large Token Portrait & Identity -->
          <div class="sheet-card-hero-banner">
            <div class="sheet-portrait-frame" id="inspect-portrait-frame">
              <img id="inspect-portrait-img" class="sheet-portrait-img" alt="" />
              <span id="inspect-portrait-fallback" class="sheet-portrait-fallback">?</span>
            </div>
            <div class="sheet-hero-details">
              <div class="sheet-hero-name-row">
                <h3 class="sheet-hero-name" id="inspect-hero-name"></h3>
                <span class="sheet-badge-seat" id="inspect-seat-badge"></span>
                <span class="sheet-badge-alive" id="inspect-alive-badge"></span>
              </div>
              <div class="sheet-hero-title-row">
                <em class="sheet-hero-title" id="inspect-hero-title"></em>
              </div>
              <div class="sheet-hero-badges-row">
                <span class="sheet-badge-class" id="inspect-class-badge"></span>
                <span class="sheet-badge-align" id="inspect-align-badge"></span>
              </div>
            </div>
          </div>

          <!-- Vitals Stats Cards (HP, MP, AP) -->
          <div class="sheet-vitals-grid">
            <div class="sheet-vital-card vital-hp">
              <div class="vital-label">Pontos de Vida</div>
              <div class="vital-value" id="inspect-hp-val">0 / 0</div>
              <div class="sheet-bar-track">
                <div class="sheet-bar-fill vital-hp-fill" id="inspect-hp-bar"></div>
              </div>
            </div>
            <div class="sheet-vital-card vital-mp">
              <div class="vital-label">Pontos de Movimento</div>
              <div class="vital-value" id="inspect-mp-val">0 / 0</div>
              <div class="sheet-mp-steps" id="inspect-mp-steps"></div>
            </div>
            <div class="sheet-vital-card vital-ap">
              <div class="vital-label">Pontos de Ação</div>
              <div class="vital-value" id="inspect-ap-val">0 / 0</div>
              <div class="sheet-ap-pips" id="inspect-ap-pips"></div>
            </div>
          </div>

          <!-- Equipped Abilities / Grimório -->
          <div class="sheet-section-block">
            <h4 class="sheet-section-title">Grimório de Habilidades Equipadas</h4>
            <div class="sheet-abilities-grid" id="inspect-abilities-grid"></div>
          </div>

          <!-- Lore & Narrative Parchment Blocks -->
          <div class="sheet-lore-grid">
            <div class="sheet-lore-block">
              <h4 class="sheet-lore-title">📜 História & Antecedentes</h4>
              <p class="sheet-lore-text" id="inspect-backstory-text"></p>
            </div>
            <div class="sheet-lore-block">
              <h4 class="sheet-lore-title">🎭 Personalidade & Traços</h4>
              <p class="sheet-lore-text" id="inspect-personality-text"></p>
            </div>
          </div>
        </article>
      </section>

      <!-- Panel 2: Creator & Roster Editor -->
      <section id="panel-sheet-creator" class="sheet-tab-panel" role="tabpanel">
        <!-- Top Slot Selector & Restore Defaults -->
        <div class="sheet-creator-topbar">
          <div class="sheet-slot-tabs" id="creator-slot-tabs">
            <button type="button" class="sheet-slot-tab active" data-slot="0">Jogador 1</button>
            <button type="button" class="sheet-slot-tab" data-slot="1">Jogador 2</button>
            <button type="button" class="sheet-slot-tab" data-slot="2">Jogador 3</button>
          </div>
          <div class="sheet-creator-topbar-actions">
            <select id="creator-preset-select" class="form-select form-select-sm" title="Carregar Ficha Pronta">
              <option value="">-- Carregar Ficha Salva --</option>
            </select>
            <button type="button" id="btn-restore-defaults" class="btn-sheet-subtle" title="Restaurar Thorin, Lyra e Vex">
              ↺ Restaurar Heróis Clássicos
            </button>
          </div>
        </div>

        <!-- Creator Form Layout (Two Columns) -->
        <div class="sheet-creator-layout">
          <!-- Left Column: Identity, Appearance, Point-Buy Stats -->
          <div class="sheet-creator-col">
            <!-- Identity Section -->
            <div class="sheet-creator-box">
              <h4 class="sheet-box-title">Identidade & Aparência</h4>
              <div class="form-group">
                <label class="form-label" for="creator-input-name">Nome do Herói:</label>
                <input type="text" id="creator-input-name" class="form-input" maxlength="24" placeholder="Ex: Kaelen" />
              </div>
              <div class="form-group">
                <label class="form-label" for="creator-input-title">Título / Epíteto:</label>
                <input type="text" id="creator-input-title" class="form-input" maxlength="36" placeholder="Ex: O Guardião de Ferro" />
              </div>
              <div class="form-row-2">
                <div class="form-group">
                  <label class="form-label" for="creator-select-class">Classe Base:</label>
                  <select id="creator-select-class" class="form-select">
                    <option value="warrior">Guerreiro</option>
                    <option value="mage">Mago</option>
                    <option value="rogue">Ladino</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label" for="creator-select-align">Alinhamento:</label>
                  <select id="creator-select-align" class="form-select"></select>
                </div>
              </div>

              <!-- Appearance / Token & Palette -->
              <div class="sheet-appearance-row">
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Aparência do Token:</label>
                  <select id="creator-select-token" class="form-select">
                    <option value="sprite_warrior">Sprite: Guerreiro</option>
                    <option value="sprite_mage">Sprite: Mago</option>
                    <option value="sprite_rogue">Sprite: Ladino</option>
                    <option value="emblem">Emblema Personalizado</option>
                  </select>
                  <!-- Color Swatches -->
                  <div class="sheet-swatches-row" id="creator-color-swatches"></div>
                </div>
                <div class="form-group" style="width: 72px;">
                  <label class="form-label" for="creator-input-initial">Inicial:</label>
                  <input type="text" id="creator-input-initial" class="form-input" maxlength="2" style="text-align: center; text-transform: uppercase;" />
                </div>
                <!-- Live Token Preview Box -->
                <div class="sheet-live-token-preview" id="creator-live-token" title="Pré-visualização do Token">
                  <img id="creator-token-img" class="sheet-portrait-img" alt="" />
                  <span id="creator-token-fallback" class="sheet-portrait-fallback">?</span>
                </div>
              </div>
            </div>

            <!-- Point-Buy System Section -->
            <div class="sheet-creator-box">
              <div class="sheet-box-header-row">
                <h4 class="sheet-box-title">Atributos (Point-Buy)</h4>
                <div class="point-buy-badge" id="creator-point-budget">Pontos Restantes: 6 / 6</div>
              </div>
              <p class="sheet-box-desc">
                Base: 18 HP · 3 MP · 1 AP. Cada ponto de orçamento concede <strong>+3 HP</strong> ou <strong>+1 MP</strong>.
              </p>

              <!-- HP Stepper -->
              <div class="sheet-stepper-row">
                <div class="stepper-label-col">
                  <strong>Vida Máxima (HP)</strong>
                  <span class="stepper-subtext" id="creator-hp-cost-text">18 HP (Base)</span>
                </div>
                <div class="stepper-controls">
                  <button type="button" id="btn-hp-minus" class="btn-stepper" title="-3 HP">−</button>
                  <span class="stepper-val" id="creator-hp-display">18</span>
                  <button type="button" id="btn-hp-plus" class="btn-stepper" title="+3 HP">+</button>
                </div>
              </div>

              <!-- MP Stepper -->
              <div class="sheet-stepper-row">
                <div class="stepper-label-col">
                  <strong>Movimento por Turno (MP)</strong>
                  <span class="stepper-subtext" id="creator-mp-cost-text">3 MP (Base)</span>
                </div>
                <div class="stepper-controls">
                  <button type="button" id="btn-mp-minus" class="btn-stepper" title="-1 MP">−</button>
                  <span class="stepper-val" id="creator-mp-display">3</span>
                  <button type="button" id="btn-mp-plus" class="btn-stepper" title="+1 MP">+</button>
                </div>
              </div>

              <!-- AP Static Info -->
              <div class="sheet-stepper-row locked">
                <div class="stepper-label-col">
                  <strong>Pontos de Ação (AP)</strong>
                  <span class="stepper-subtext">Fixo para equilíbrio tático</span>
                </div>
                <div class="stepper-controls">
                  <span class="stepper-val locked">1 AP</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Abilities & Narrative Lore -->
          <div class="sheet-creator-col">
            <!-- Grimório de Habilidades -->
            <div class="sheet-creator-box">
              <div class="sheet-box-header-row">
                <h4 class="sheet-box-title">Grimório de Habilidades</h4>
                <span class="sheet-abilities-counter" id="creator-abilities-counter">3 / 3 Selecionadas</span>
              </div>
              <p class="sheet-box-desc">Escolha de 1 a 3 habilidades para compor o arsenal deste herói.</p>
              <div class="sheet-creator-abilities-grid" id="creator-abilities-grid"></div>
            </div>

            <!-- Camada Narrativa -->
            <div class="sheet-creator-box">
              <h4 class="sheet-box-title">Camada Narrativa (Mestre IA)</h4>
              <div class="form-group">
                <label class="form-label" for="creator-textarea-backstory">História / Antecedentes:</label>
                <textarea
                  id="creator-textarea-backstory"
                  class="form-textarea"
                  rows="3"
                  maxlength="500"
                  placeholder="De onde veio este herói? Qual seu juramento ou busca nas catacumbas?"
                ></textarea>
              </div>
              <div class="form-group">
                <label class="form-label" for="creator-textarea-personality">Traços de Personalidade:</label>
                <textarea
                  id="creator-textarea-personality"
                  class="form-textarea"
                  rows="2"
                  maxlength="300"
                  placeholder="Ex: Cauteloso e metódico; protege os aliados a qualquer custo."
                ></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- Creator Footer & Action Buttons -->
        <div class="sheet-creator-footer">
          <div class="sheet-feedback-msg" id="creator-feedback-msg"></div>
          <div class="sheet-footer-actions">
            <button type="button" id="btn-delete-saved" class="btn-sheet-danger" style="display: none;">
              🗑️ Excluir Ficha
            </button>
            <button type="button" id="btn-save-slot" class="btn-sheet-secondary">
              💾 Salvar Ficha no Grupo
            </button>
            <button type="button" id="btn-save-start-game" class="btn-sheet-primary">
              ⚔️ Salvar e Iniciar Nova Aventura
            </button>
          </div>
        </div>
      </section>
    </div>
  `;

  // Grab element references
  const tabBtnInspect = modalEl.querySelector('#tab-btn-inspect');
  const tabBtnCreator = modalEl.querySelector('#tab-btn-creator');
  const panelInspect = modalEl.querySelector('#panel-sheet-inspect');
  const panelCreator = modalEl.querySelector('#panel-sheet-creator');
  const closeBtn = modalEl.querySelector('#btn-close-sheet-modal');

  // Inspector elements
  const inspectNav = modalEl.querySelector('#sheet-inspect-nav');
  const inspectPortraitFrame = modalEl.querySelector('#inspect-portrait-frame');
  const inspectPortraitImg = modalEl.querySelector('#inspect-portrait-img');
  const inspectPortraitFallback = modalEl.querySelector('#inspect-portrait-fallback');
  const inspectHeroName = modalEl.querySelector('#inspect-hero-name');
  const inspectSeatBadge = modalEl.querySelector('#inspect-seat-badge');
  const inspectAliveBadge = modalEl.querySelector('#inspect-alive-badge');
  const inspectHeroTitle = modalEl.querySelector('#inspect-hero-title');
  const inspectClassBadge = modalEl.querySelector('#inspect-class-badge');
  const inspectAlignBadge = modalEl.querySelector('#inspect-align-badge');
  const inspectHpVal = modalEl.querySelector('#inspect-hp-val');
  const inspectHpBar = modalEl.querySelector('#inspect-hp-bar');
  const inspectMpVal = modalEl.querySelector('#inspect-mp-val');
  const inspectMpSteps = modalEl.querySelector('#inspect-mp-steps');
  const inspectApVal = modalEl.querySelector('#inspect-ap-val');
  const inspectApPips = modalEl.querySelector('#inspect-ap-pips');
  const inspectAbilitiesGrid = modalEl.querySelector('#inspect-abilities-grid');
  const inspectBackstoryText = modalEl.querySelector('#inspect-backstory-text');
  const inspectPersonalityText = modalEl.querySelector('#inspect-personality-text');

  // Creator elements
  const creatorSlotTabs = modalEl.querySelector('#creator-slot-tabs');
  const creatorPresetSelect = modalEl.querySelector('#creator-preset-select');
  const btnRestoreDefaults = modalEl.querySelector('#btn-restore-defaults');
  const inputName = modalEl.querySelector('#creator-input-name');
  const inputTitle = modalEl.querySelector('#creator-input-title');
  const selectClass = modalEl.querySelector('#creator-select-class');
  const selectAlign = modalEl.querySelector('#creator-select-align');
  const selectToken = modalEl.querySelector('#creator-select-token');
  const inputInitial = modalEl.querySelector('#creator-input-initial');
  const swatchesContainer = modalEl.querySelector('#creator-color-swatches');
  const liveTokenImg = modalEl.querySelector('#creator-token-img');
  const liveTokenFallback = modalEl.querySelector('#creator-token-fallback');
  const liveTokenFrame = modalEl.querySelector('#creator-live-token');

  const pointBudgetBadge = modalEl.querySelector('#creator-point-budget');
  const hpCostText = modalEl.querySelector('#creator-hp-cost-text');
  const mpCostText = modalEl.querySelector('#creator-mp-cost-text');
  const hpDisplay = modalEl.querySelector('#creator-hp-display');
  const mpDisplay = modalEl.querySelector('#creator-mp-display');
  const btnHpMinus = modalEl.querySelector('#btn-hp-minus');
  const btnHpPlus = modalEl.querySelector('#btn-hp-plus');
  const btnMpMinus = modalEl.querySelector('#btn-mp-minus');
  const btnMpPlus = modalEl.querySelector('#btn-mp-plus');

  const abilitiesCounter = modalEl.querySelector('#creator-abilities-counter');
  const creatorAbilitiesGrid = modalEl.querySelector('#creator-abilities-grid');
  const textareaBackstory = modalEl.querySelector('#creator-textarea-backstory');
  const textareaPersonality = modalEl.querySelector('#creator-textarea-personality');

  const feedbackMsg = modalEl.querySelector('#creator-feedback-msg');
  const btnSaveSlot = modalEl.querySelector('#btn-save-slot');
  const btnSaveStartGame = modalEl.querySelector('#btn-save-start-game');
  const btnDeleteSaved = modalEl.querySelector('#btn-delete-saved');

  // Populate Alignments
  selectAlign.replaceChildren();
  for (const align of ALIGNMENTS) {
    const opt = document.createElement('option');
    opt.value = align;
    opt.textContent = align;
    selectAlign.appendChild(opt);
  }

  // Populate Color Swatches
  swatchesContainer.replaceChildren();
  for (const color of COLOR_SWATCHES) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'sheet-swatch-btn';
    swatch.style.backgroundColor = color;
    swatch.dataset.color = color;
    swatch.title = `Cor: ${color}`;
    swatchesContainer.appendChild(swatch);
  }

  // Component State
  let currentTab = 'inspect'; // 'inspect' | 'creator'
  let inspectedHeroId = null;
  let activeCreatorSlot = 0; // 0, 1, 2
  let workingParty = loadActivePartyRoster();

  /**
   * Switches modal tabs between Inspector and Creator.
   * @param {'inspect'|'creator'} tab
   */
  function switchTab(tab) {
    currentTab = tab;
    if (tab === 'inspect') {
      tabBtnInspect.classList.add('active');
      tabBtnInspect.setAttribute('aria-selected', 'true');
      tabBtnCreator.classList.remove('active');
      tabBtnCreator.setAttribute('aria-selected', 'false');
      panelInspect.classList.add('active');
      panelCreator.classList.remove('active');
      renderInspector();
    } else {
      tabBtnCreator.classList.add('active');
      tabBtnCreator.setAttribute('aria-selected', 'true');
      tabBtnInspect.classList.remove('active');
      tabBtnInspect.setAttribute('aria-selected', 'false');
      panelCreator.classList.add('active');
      panelInspect.classList.remove('active');
      renderCreator();
    }
  }

  tabBtnInspect.addEventListener('click', () => switchTab('inspect'));
  tabBtnCreator.addEventListener('click', () => switchTab('creator'));

  // --------------------------------------------------------------------------
  // TAB 1: INSPECTOR LOGIC
  // --------------------------------------------------------------------------

  /**
   * Retrieves party hero list from active GameState or saved active roster.
   * @returns {object[]}
   */
  function getPartyHeroList() {
    const state = getState ? getState() : null;
    if (state && state.entities) {
      const heroIds = (state.turnOrder ? state.turnOrder.filter(id => id !== 'ENEMY_PHASE') : null)
        || ['hero_warrior', 'hero_mage', 'hero_rogue'];
      const heroEntities = heroIds.map(id => state.entities[id]).filter(Boolean);
      if (heroEntities.length > 0) return heroEntities;
    }
    return loadActivePartyRoster();
  }

  function renderInspector() {
    const heroList = getPartyHeroList();
    if (!heroList || heroList.length === 0) return;

    // Default inspected hero
    if (!inspectedHeroId || !heroList.some(h => h.id === inspectedHeroId)) {
      const state = getState ? getState() : null;
      inspectedHeroId = (state?.activeId && heroList.some(h => h.id === state.activeId))
        ? state.activeId
        : heroList[0].id;
    }

    // Render Hero Switcher Navigation
    inspectNav.replaceChildren();
    heroList.forEach((hero, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sheet-hero-pill ${hero.id === inspectedHeroId ? 'active' : ''} ${hero.alive === false ? 'dead' : ''}`;
      const cls = CLASSES[hero.classId] || {};

      const iconSpan = document.createElement('span');
      iconSpan.className = 'pill-icon';
      iconSpan.textContent = hero.initial || (hero.name ? hero.name[0] : (cls.initial || '?'));
      iconSpan.style.backgroundColor = hero.color || cls.color || '#C5A059';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'pill-label';
      labelSpan.textContent = `Jogador ${hero.player || index + 1}: ${hero.name || cls.label || 'Herói'}`;

      btn.appendChild(iconSpan);
      btn.appendChild(labelSpan);

      btn.addEventListener('click', () => {
        inspectedHeroId = hero.id;
        renderInspector();
      });

      inspectNav.appendChild(btn);
    });

    const activeHero = heroList.find(h => h.id === inspectedHeroId) || heroList[0];
    if (!activeHero) return;

    const cls = CLASSES[activeHero.classId] || {};
    const heroColor = activeHero.color || cls.color || '#C5A059';

    // 1. Portrait & Emblem
    inspectPortraitFrame.style.borderColor = heroColor;
    inspectPortraitFallback.style.backgroundColor = heroColor;
    inspectPortraitFallback.textContent = activeHero.initial || activeHero.name[0] || cls.initial || '?';

    const tokenUrl = activeHero.tokenUrl || cls.tokenUrl;
    if (tokenUrl) {
      inspectPortraitImg.src = tokenUrl;
      inspectPortraitImg.alt = activeHero.name || '';
      inspectPortraitImg.style.display = 'block';
      inspectPortraitFallback.style.display = 'none';
      inspectPortraitImg.onerror = () => {
        inspectPortraitImg.style.display = 'none';
        inspectPortraitFallback.style.display = 'flex';
      };
    } else {
      inspectPortraitImg.style.display = 'none';
      inspectPortraitFallback.style.display = 'flex';
    }

    // 2. Identity Text (Strictly textContent for security)
    inspectHeroName.textContent = activeHero.name || cls.label || 'Herói Desconhecido';
    inspectHeroTitle.textContent = activeHero.title || `${cls.label || 'Campeão'} das Crônicas`;
    inspectSeatBadge.textContent = `Jogador ${activeHero.player || 1}`;

    const isAlive = activeHero.alive ?? true;
    inspectAliveBadge.textContent = isAlive ? '● Em Combate' : '💀 Abatido';
    inspectAliveBadge.className = isAlive ? 'sheet-badge-alive' : 'sheet-badge-dead';

    inspectClassBadge.textContent = cls.label || activeHero.classId;
    inspectClassBadge.style.backgroundColor = `${heroColor}22`;
    inspectClassBadge.style.color = heroColor;
    inspectClassBadge.style.borderColor = `${heroColor}55`;

    inspectAlignBadge.textContent = activeHero.alignment || 'Neutro e Bom';

    // 3. Vitals & Stats
    const curHp = Math.max(0, activeHero.hp ?? activeHero.maxHp ?? cls.maxHp ?? 18);
    const maxHp = activeHero.maxHp ?? cls.maxHp ?? 18;
    const hpPct = Math.min(100, Math.max(0, Math.round((curHp / maxHp) * 100)));
    inspectHpVal.textContent = `${curHp} / ${maxHp}`;
    inspectHpBar.style.width = `${hpPct}%`;
    if (hpPct <= 25) {
      inspectHpBar.style.backgroundColor = 'var(--accent-red)';
    } else if (hpPct <= 50) {
      inspectHpBar.style.backgroundColor = 'var(--log-combat)';
    } else {
      inspectHpBar.style.backgroundColor = 'var(--accent-green)';
    }

    const curMp = activeHero.mp ?? activeHero.maxMp ?? cls.maxMp ?? 3;
    const maxMp = activeHero.maxMp ?? cls.maxMp ?? 3;
    inspectMpVal.textContent = `${curMp} / ${maxMp}`;
    inspectMpSteps.replaceChildren();
    for (let i = 0; i < maxMp; i++) {
      const step = document.createElement('span');
      step.className = `sheet-mp-step ${i < curMp ? 'filled' : 'empty'}`;
      step.title = `Passo de Movimento ${i + 1}`;
      inspectMpSteps.appendChild(step);
    }

    const curAp = activeHero.ap ?? activeHero.maxAp ?? 1;
    const maxAp = activeHero.maxAp ?? 1;
    inspectApVal.textContent = `${curAp} / ${maxAp}`;
    inspectApPips.replaceChildren();
    for (let i = 0; i < maxAp; i++) {
      const pip = document.createElement('span');
      pip.className = `sheet-ap-pip ${i < curAp ? 'filled' : 'empty'}`;
      pip.title = `Ação ${i + 1}`;
      inspectApPips.appendChild(pip);
    }

    // 4. Equipped Abilities
    inspectAbilitiesGrid.replaceChildren();
    const heroAbilities = activeHero.abilities && activeHero.abilities.length > 0
      ? activeHero.abilities
      : (cls.abilities || ['slash']);

    heroAbilities.forEach(abId => {
      const ab = ABILITIES[abId];
      if (!ab) return;

      const card = document.createElement('div');
      card.className = 'sheet-ability-card';

      const iconWrap = document.createElement('div');
      iconWrap.className = 'ability-card-icon';
      iconWrap.innerHTML = ACTION_ICONS[abId] || ACTION_ICONS.default;

      const infoWrap = document.createElement('div');
      infoWrap.className = 'ability-card-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'ability-card-title-row';

      const abLabel = document.createElement('strong');
      abLabel.className = 'ability-card-label';
      abLabel.textContent = ab.label || abId;

      const apTag = document.createElement('span');
      apTag.className = 'ability-card-tag ap';
      apTag.textContent = `${ab.apCost ?? 1} AP`;

      titleRow.appendChild(abLabel);
      titleRow.appendChild(apTag);

      const tagsRow = document.createElement('div');
      tagsRow.className = 'ability-card-tags';

      const rangeTag = document.createElement('span');
      rangeTag.className = 'ability-card-tag';
      rangeTag.textContent = ab.range === 0 ? 'Alcance: Próprio' : `Alcance: ${ab.range}`;
      tagsRow.appendChild(rangeTag);

      if (ab.effect?.type === 'damage') {
        const dmgTag = document.createElement('span');
        dmgTag.className = 'ability-card-tag damage';
        dmgTag.textContent = `⚔️ ${ab.effect.amount} Dano`;
        tagsRow.appendChild(dmgTag);
      } else if (ab.effect?.type === 'heal') {
        const healTag = document.createElement('span');
        healTag.className = 'ability-card-tag heal';
        healTag.textContent = `💚 ${ab.effect.amount} Cura`;
        tagsRow.appendChild(healTag);
      } else if (ab.effect?.type === 'unlock') {
        const lockTag = document.createElement('span');
        lockTag.className = 'ability-card-tag utility';
        lockTag.textContent = '🗝️ Arrombar Baú';
        tagsRow.appendChild(lockTag);
      }

      if (ab.aoe) {
        const aoeTag = document.createElement('span');
        aoeTag.className = 'ability-card-tag aoe';
        aoeTag.textContent = ab.aoe.shape === 'circle' ? `Área (Raio ${ab.aoe.radius})` : 'Adjacente 360°';
        tagsRow.appendChild(aoeTag);
      }

      infoWrap.appendChild(titleRow);
      infoWrap.appendChild(tagsRow);

      card.appendChild(iconWrap);
      card.appendChild(infoWrap);
      inspectAbilitiesGrid.appendChild(card);
    });

    // 5. Narrative Lore (Sanitized textContent)
    inspectBackstoryText.textContent = activeHero.backstory
      || 'Nenhum antecedente registrado. Este herói adentrou a masmorra buscando glória e tesouros lendários.';
    inspectPersonalityText.textContent = activeHero.personality
      || 'Comportamento sereno e resoluto perante os perigos das profundezas.';
  }

  // --------------------------------------------------------------------------
  // TAB 2: CREATOR & ROSTER EDITOR LOGIC
  // --------------------------------------------------------------------------

  function getCurrentSlotSheet() {
    return workingParty[activeCreatorSlot];
  }

  function setCurrentSlotSheet(sheet) {
    workingParty[activeCreatorSlot] = {
      ...sheet,
      player: activeCreatorSlot + 1
    };
  }

  function updatePointBudgetDisplay() {
    const sheet = getCurrentSlotSheet();
    const hp = sheet.maxHp ?? POINT_BUY_CONFIG.BASE_HP;
    const mp = sheet.maxMp ?? POINT_BUY_CONFIG.BASE_MP;

    const hpPoints = Math.floor((hp - POINT_BUY_CONFIG.BASE_HP) / POINT_BUY_CONFIG.HP_STEP);
    const mpPoints = Math.max(0, mp - POINT_BUY_CONFIG.BASE_MP);
    const spent = hpPoints + mpPoints;
    const remaining = POINT_BUY_CONFIG.BUDGET - spent;

    pointBudgetBadge.textContent = `Pontos Restantes: ${remaining} / ${POINT_BUY_CONFIG.BUDGET}`;
    if (remaining === 0) {
      pointBudgetBadge.className = 'point-buy-badge complete';
    } else if (remaining < 0) {
      pointBudgetBadge.className = 'point-buy-badge overflow';
    } else {
      pointBudgetBadge.className = 'point-buy-badge';
    }

    hpCostText.textContent = `${hp} HP (${hpPoints > 0 ? `+${hpPoints} pts` : 'Base'})`;
    mpCostText.textContent = `${mp} MP (${mpPoints > 0 ? `+${mpPoints} pts` : 'Base'})`;

    hpDisplay.textContent = String(hp);
    mpDisplay.textContent = String(mp);

    btnHpMinus.disabled = hp <= POINT_BUY_CONFIG.MIN_HP;
    btnHpPlus.disabled = hp >= POINT_BUY_CONFIG.MAX_HP || remaining <= 0;

    btnMpMinus.disabled = mp <= POINT_BUY_CONFIG.MIN_MP;
    btnMpPlus.disabled = mp >= POINT_BUY_CONFIG.MAX_MP || remaining <= 0;
  }

  function updateLiveTokenPreview() {
    const sheet = getCurrentSlotSheet();
    const cls = CLASSES[sheet.classId] || {};
    const color = sheet.color || cls.color || '#C5A059';
    const initial = sheet.initial || (sheet.name ? sheet.name[0] : (cls.initial || '?'));

    liveTokenFrame.style.borderColor = color;
    liveTokenFallback.style.backgroundColor = color;
    liveTokenFallback.textContent = initial.toUpperCase();

    if (sheet.tokenUrl) {
      liveTokenImg.src = sheet.tokenUrl;
      liveTokenImg.alt = sheet.name || '';
      liveTokenImg.style.display = 'block';
      liveTokenFallback.style.display = 'none';
      liveTokenImg.onerror = () => {
        liveTokenImg.style.display = 'none';
        liveTokenFallback.style.display = 'flex';
      };
    } else {
      liveTokenImg.style.display = 'none';
      liveTokenFallback.style.display = 'flex';
    }
  }

  function updateAbilitiesGrid() {
    const sheet = getCurrentSlotSheet();
    const selected = new Set(sheet.abilities || []);

    abilitiesCounter.textContent = `${selected.size} / ${POINT_BUY_CONFIG.MAX_ABILITIES} Selecionadas`;
    if (selected.size === POINT_BUY_CONFIG.MAX_ABILITIES) {
      abilitiesCounter.className = 'sheet-abilities-counter full';
    } else if (selected.size === 0) {
      abilitiesCounter.className = 'sheet-abilities-counter empty';
    } else {
      abilitiesCounter.className = 'sheet-abilities-counter';
    }

    creatorAbilitiesGrid.replaceChildren();

    HERO_ABILITY_IDS.forEach(abId => {
      const ab = ABILITIES[abId];
      if (!ab) return;

      const isSelected = selected.has(abId);
      const card = document.createElement('div');
      card.className = `sheet-creator-ability-card ${isSelected ? 'selected' : ''}`;

      const iconWrap = document.createElement('div');
      iconWrap.className = 'creator-ability-icon';
      iconWrap.innerHTML = ACTION_ICONS[abId] || ACTION_ICONS.default;

      const textWrap = document.createElement('div');
      textWrap.className = 'creator-ability-text';

      const title = document.createElement('strong');
      title.className = 'creator-ability-title';
      title.textContent = ab.label || abId;

      const desc = document.createElement('span');
      desc.className = 'creator-ability-desc';
      let effectDesc = '';
      if (ab.effect?.type === 'damage') effectDesc = `${ab.effect.amount} dano`;
      else if (ab.effect?.type === 'heal') effectDesc = `${ab.effect.amount} cura`;
      else if (ab.effect?.type === 'unlock') effectDesc = 'arromba baús';
      desc.textContent = `${ab.range === 0 ? 'Próprio' : `Alcance ${ab.range}`} · ${effectDesc}`;

      textWrap.appendChild(title);
      textWrap.appendChild(desc);

      const checkmark = document.createElement('span');
      checkmark.className = 'creator-ability-check';
      checkmark.textContent = isSelected ? '✓' : '+';

      card.appendChild(iconWrap);
      card.appendChild(textWrap);
      card.appendChild(checkmark);

      card.addEventListener('click', () => {
        if (isSelected) {
          if (selected.size <= 1) {
            showFeedback('O herói precisa ter pelo menos 1 habilidade.', 'warning');
            return;
          }
          selected.delete(abId);
        } else {
          if (selected.size >= POINT_BUY_CONFIG.MAX_ABILITIES) {
            showFeedback(`Limite atingido! Máximo de ${POINT_BUY_CONFIG.MAX_ABILITIES} habilidades permitidas.`, 'warning');
            return;
          }
          selected.add(abId);
        }
        sheet.abilities = Array.from(selected);
        updateAbilitiesGrid();
        showFeedback('');
      });

      creatorAbilitiesGrid.appendChild(card);
    });
  }

  function updateSavedPresetsDropdown() {
    const saved = loadSavedSheets();
    creatorPresetSelect.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Carregar Ficha da Biblioteca --';
    creatorPresetSelect.appendChild(placeholder);

    for (const s of saved) {
      const opt = document.createElement('option');
      opt.value = s.id;
      const cls = CLASSES[s.classId]?.label || s.classId;
      opt.textContent = `${s.name} (${cls} · ${s.maxHp} HP / ${s.maxMp} MP)`;
      creatorPresetSelect.appendChild(opt);
    }
  }

  function showFeedback(text, type = 'info') {
    feedbackMsg.textContent = text;
    feedbackMsg.className = `sheet-feedback-msg ${type}`;
    if (!text) feedbackMsg.style.display = 'none';
    else feedbackMsg.style.display = 'block';
  }

  function renderCreator() {
    updateSavedPresetsDropdown();

    // Render Slot Tab Buttons
    const slotButtons = creatorSlotTabs.querySelectorAll('.sheet-slot-tab');
    slotButtons.forEach((btn, idx) => {
      btn.classList.toggle('active', idx === activeCreatorSlot);
      const sheet = workingParty[idx];
      btn.textContent = `Jogador ${idx + 1}: ${sheet?.name || 'Vazio'}`;
    });

    const sheet = getCurrentSlotSheet();
    const cls = CLASSES[sheet.classId] || {};

    // Populate Fields
    inputName.value = sheet.name || '';
    inputTitle.value = sheet.title || '';
    selectClass.value = sheet.classId || 'warrior';
    selectAlign.value = sheet.alignment || 'Neutro e Bom';
    inputInitial.value = sheet.initial || (sheet.name ? sheet.name[0] : (cls.initial || 'W'));

    // Token preset value
    if (sheet.tokenUrl?.includes('warrior')) {
      selectToken.value = 'sprite_warrior';
    } else if (sheet.tokenUrl?.includes('mage')) {
      selectToken.value = 'sprite_mage';
    } else if (sheet.tokenUrl?.includes('rogue')) {
      selectToken.value = 'sprite_rogue';
    } else {
      selectToken.value = 'emblem';
    }

    // Swatches selection
    const swatches = swatchesContainer.querySelectorAll('.sheet-swatch-btn');
    swatches.forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.color === sheet.color);
    });

    textareaBackstory.value = sheet.backstory || '';
    textareaPersonality.value = sheet.personality || '';

    // Show delete button only if it's a saved custom sheet (not a default canon sheet)
    const isCanonical = ['hero_warrior', 'hero_mage', 'hero_rogue'].includes(sheet.id);
    btnDeleteSaved.style.display = isCanonical ? 'none' : 'inline-block';

    updatePointBudgetDisplay();
    updateAbilitiesGrid();
    updateLiveTokenPreview();
    showFeedback('');
  }

  // --------------------------------------------------------------------------
  // CREATOR INTERACTIVE LISTENERS
  // --------------------------------------------------------------------------

  // Slot Navigation
  creatorSlotTabs.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.sheet-slot-tab');
    if (!btn) return;
    const slotIdx = parseInt(btn.dataset.slot, 10);
    if (!Number.isNaN(slotIdx) && slotIdx >= 0 && slotIdx <= 2) {
      activeCreatorSlot = slotIdx;
      renderCreator();
    }
  });

  // Load Preset
  creatorPresetSelect.addEventListener('change', () => {
    const id = creatorPresetSelect.value;
    if (!id) return;
    const saved = loadSavedSheets();
    const found = saved.find(s => s.id === id);
    if (found) {
      setCurrentSlotSheet({
        ...structuredClone(found),
        id: ['hero_warrior', 'hero_mage', 'hero_rogue'].includes(found.id)
          ? found.id
          : `hero_slot_${activeCreatorSlot + 1}_${Date.now()}`
      });
      renderCreator();
      showFeedback(`Ficha de "${found.name}" carregada no Jogador ${activeCreatorSlot + 1}!`, 'success');
    }
  });

  // Restore Default Roster
  btnRestoreDefaults.addEventListener('click', () => {
    workingParty = structuredClone(DEFAULT_SHEETS).map((s, idx) => ({
      ...s,
      player: idx + 1
    }));
    renderCreator();
    showFeedback('Heróis clássicos (Thorin, Lyra e Vex) restaurados no grupo!', 'info');
  });

  // Field Inputs Live Binding
  inputName.addEventListener('input', () => {
    const sheet = getCurrentSlotSheet();
    sheet.name = inputName.value.trim();
    if (!inputInitial.value.trim() && sheet.name) {
      sheet.initial = sheet.name[0].toUpperCase();
      inputInitial.value = sheet.initial;
    }
    const slotBtn = creatorSlotTabs.querySelector(`.sheet-slot-tab[data-slot="${activeCreatorSlot}"]`);
    if (slotBtn) slotBtn.textContent = `Jogador ${activeCreatorSlot + 1}: ${sheet.name || 'Vazio'}`;
    updateLiveTokenPreview();
  });

  inputTitle.addEventListener('input', () => {
    getCurrentSlotSheet().title = inputTitle.value.trim();
  });

  selectClass.addEventListener('change', () => {
    const sheet = getCurrentSlotSheet();
    sheet.classId = selectClass.value;
    const cls = CLASSES[sheet.classId] || {};
    if (selectToken.value.startsWith('sprite_')) {
      sheet.tokenUrl = cls.tokenUrl || null;
      selectToken.value = `sprite_${sheet.classId}`;
    }
    if (!sheet.color || sheet.color === '#C5A059') {
      sheet.color = cls.color || '#C5A059';
    }
    updateLiveTokenPreview();
  });

  selectAlign.addEventListener('change', () => {
    getCurrentSlotSheet().alignment = selectAlign.value;
  });

  inputInitial.addEventListener('input', () => {
    const sheet = getCurrentSlotSheet();
    sheet.initial = (inputInitial.value || '').trim().slice(0, 2).toUpperCase();
    updateLiveTokenPreview();
  });

  selectToken.addEventListener('change', () => {
    const sheet = getCurrentSlotSheet();
    if (selectToken.value === 'sprite_warrior') {
      sheet.tokenUrl = './assets/tokens/warrior_64.png';
    } else if (selectToken.value === 'sprite_mage') {
      sheet.tokenUrl = './assets/tokens/mage_64.png';
    } else if (selectToken.value === 'sprite_rogue') {
      sheet.tokenUrl = './assets/tokens/rogue_64.png';
    } else {
      sheet.tokenUrl = null;
    }
    updateLiveTokenPreview();
  });

  swatchesContainer.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.sheet-swatch-btn');
    if (!btn) return;
    const color = btn.dataset.color;
    const sheet = getCurrentSlotSheet();
    sheet.color = color;
    swatchesContainer.querySelectorAll('.sheet-swatch-btn').forEach(b => {
      b.classList.toggle('selected', b === btn);
    });
    updateLiveTokenPreview();
  });

  textareaBackstory.addEventListener('input', () => {
    getCurrentSlotSheet().backstory = textareaBackstory.value.trim();
  });

  textareaPersonality.addEventListener('input', () => {
    getCurrentSlotSheet().personality = textareaPersonality.value.trim();
  });

  // Point-Buy Stepper Handlers
  btnHpMinus.addEventListener('click', () => {
    const sheet = getCurrentSlotSheet();
    if ((sheet.maxHp ?? POINT_BUY_CONFIG.BASE_HP) > POINT_BUY_CONFIG.MIN_HP) {
      sheet.maxHp = (sheet.maxHp ?? POINT_BUY_CONFIG.BASE_HP) - POINT_BUY_CONFIG.HP_STEP;
      updatePointBudgetDisplay();
    }
  });

  btnHpPlus.addEventListener('click', () => {
    const sheet = getCurrentSlotSheet();
    const hp = sheet.maxHp ?? POINT_BUY_CONFIG.BASE_HP;
    const mp = sheet.maxMp ?? POINT_BUY_CONFIG.BASE_MP;
    const spent = Math.floor((hp - POINT_BUY_CONFIG.BASE_HP) / POINT_BUY_CONFIG.HP_STEP) + (mp - POINT_BUY_CONFIG.BASE_MP);
    if (hp < POINT_BUY_CONFIG.MAX_HP && spent < POINT_BUY_CONFIG.BUDGET) {
      sheet.maxHp = hp + POINT_BUY_CONFIG.HP_STEP;
      updatePointBudgetDisplay();
    }
  });

  btnMpMinus.addEventListener('click', () => {
    const sheet = getCurrentSlotSheet();
    if ((sheet.maxMp ?? POINT_BUY_CONFIG.BASE_MP) > POINT_BUY_CONFIG.MIN_MP) {
      sheet.maxMp = (sheet.maxMp ?? POINT_BUY_CONFIG.BASE_MP) - POINT_BUY_CONFIG.MP_STEP;
      updatePointBudgetDisplay();
    }
  });

  btnMpPlus.addEventListener('click', () => {
    const sheet = getCurrentSlotSheet();
    const hp = sheet.maxHp ?? POINT_BUY_CONFIG.BASE_HP;
    const mp = sheet.maxMp ?? POINT_BUY_CONFIG.BASE_MP;
    const spent = Math.floor((hp - POINT_BUY_CONFIG.BASE_HP) / POINT_BUY_CONFIG.HP_STEP) + (mp - POINT_BUY_CONFIG.BASE_MP);
    if (mp < POINT_BUY_CONFIG.MAX_MP && spent < POINT_BUY_CONFIG.BUDGET) {
      sheet.maxMp = mp + POINT_BUY_CONFIG.MP_STEP;
      updatePointBudgetDisplay();
    }
  });

  // Save current slot sheet
  btnSaveSlot.addEventListener('click', () => {
    const sheet = getCurrentSlotSheet();
    if (!sheet.id) {
      sheet.id = `hero_custom_${Date.now()}`;
    }
    const validation = validateSheet(sheet);
    if (!validation.valid) {
      showFeedback(`Erro ao salvar: ${validation.errors.join('; ')}`, 'error');
      return;
    }

    try {
      saveSheet(sheet);
      saveActivePartyRoster(workingParty.map(s => s.id));
      updateSavedPresetsDropdown();
      showFeedback(`Ficha de "${sheet.name}" salva com sucesso no grupo!`, 'success');
      btnDeleteSaved.style.display = 'inline-block';
    } catch (err) {
      showFeedback(`Falha ao salvar: ${err.message}`, 'error');
    }
  });

  // Delete saved sheet
  btnDeleteSaved.addEventListener('click', () => {
    const sheet = getCurrentSlotSheet();
    if (['hero_warrior', 'hero_mage', 'hero_rogue'].includes(sheet.id)) {
      showFeedback('Heróis canônicos padrão não podem ser excluídos.', 'warning');
      return;
    }
    if (confirm(`Deseja realmente excluir a ficha de "${sheet.name}"?`)) {
      deleteSheet(sheet.id);
      workingParty = loadActivePartyRoster();
      renderCreator();
      showFeedback('Ficha excluída. O slot retornou ao herói padrão.', 'info');
    }
  });

  // Save and Launch New Adventure
  btnSaveStartGame.addEventListener('click', () => {
    // Validate all 3 active sheets
    for (let i = 0; i < 3; i++) {
      const sheet = workingParty[i];
      if (!sheet.id) sheet.id = `hero_custom_${i + 1}_${Date.now()}`;
      const validation = validateSheet(sheet);
      if (!validation.valid) {
        activeCreatorSlot = i;
        renderCreator();
        showFeedback(`Jogador ${i + 1} (${sheet.name || 'Herói'}): ${validation.errors.join('; ')}`, 'error');
        return;
      }
    }

    try {
      // Save all 3 sheets and persist active roster
      for (const sheet of workingParty) {
        saveSheet(sheet);
      }
      saveActivePartyRoster(workingParty.map(s => s.id));

      close();

      // Emit new game intent with the active custom roster
      bus?.emit('intent:reset');

      bus?.emit('chat:system', {
        level: 'info',
        text: `⚔️ Nova aventura iniciada com ${workingParty.map(h => h.name).join(', ')}! Vez do Jogador 1 (${workingParty[0]?.name || 'Herói'}). Clique no tabuleiro para mover, selecione habilidades no HUD ou digite sua ação no chat.`
      });

      bus?.emit('log:entry', {
        level: 'INFO',
        text: `[GRUPO] Nova aventura iniciada com ${workingParty.map(h => h.name).join(', ')}!`,
        source: 'SYSTEM',
        ts: Date.now()
      });
    } catch (err) {
      showFeedback(`Falha ao iniciar aventura: ${err.message}`, 'error');
    }
  });

  // --------------------------------------------------------------------------
  // MODAL CONTROLS & EVENT BUS HOOKS
  // --------------------------------------------------------------------------

  function open(opts = {}) {
    workingParty = loadActivePartyRoster();

    if (opts.heroId) {
      inspectedHeroId = opts.heroId;
    }

    if (opts.mode === 'creator') {
      switchTab('creator');
    } else {
      switchTab('inspect');
    }

    if (!modalEl.open) {
      modalEl.showModal();
    }
  }

  function close() {
    if (modalEl.open) {
      modalEl.close();
    }
  }

  closeBtn.addEventListener('click', close);

  // Close on backdrop click
  modalEl.addEventListener('click', (ev) => {
    if (ev.target === modalEl) {
      close();
    }
  });

  // Listen to open events from turnBar or HUD
  bus?.on('ui:openSheet', (opts) => {
    open(opts);
  });

  return {
    open,
    close,
    isOpen: () => Boolean(modalEl.open)
  };
}
