/**
 * Human GM Mode Panel: Developer dashboard to bypass the LLM and manually
 * push mocked JSON payloads via UI buttons or raw JSON editor.
 * Guarantees that any payload working here works identically when emitted by the LLM.
 */
import { presets, ILLEGAL_PRESETS, COMBO_FROM_START, SCRIPTED_SCENARIO } from '../core/fixtures.js';
import { submitRaw } from '../core/ingest.js';
import { parseLLMResponse, describeParseErrors } from '../llm/responseParser.js';
import { createInitialState } from '../engine/gameState.js';
import { replaySession } from '../core/session.js';

export function createGmPanel({ container, store, queue, bus, sessionRecorder }) {
  let selectedTile = null;

  container.innerHTML = `
    <div class="gm-panel-header">
      <div class="gm-title-badge">
        <span class="gm-icon">⚡</span>
        <span class="gm-title">HUMAN GM MODE</span>
        <span class="gm-mode-tag">Bypass LLM</span>
      </div>
      <button class="gm-collapse-btn" id="gm-toggle-btn" title="Minimizar / Expandir Painel [Tecla G]">—</button>
    </div>

    <div class="gm-panel-content" id="gm-content">
      <!-- Target info -->
      <div class="gm-section target-info-box">
        <div class="target-row">
          <span class="target-lbl">Alvo Selecionado no Mapa:</span>
          <span class="target-val" id="gm-sel-coords">Nenhum (clique no mapa)</span>
        </div>
      </div>

      <!-- Quick Action Presets -->
      <div class="gm-section">
        <h4 class="gm-sec-title">Ações Rápidas (Presets GM)</h4>
        <div class="gm-button-grid">
          <button class="gm-btn action-btn" id="btn-spawn-goblin">Spawn Goblin</button>
          <button class="gm-btn action-btn" id="btn-spawn-skel">Spawn Esqueleto</button>
          <button class="gm-btn action-btn" id="btn-move-player">Mover Herói p/ Alvo</button>
          <button class="gm-btn action-btn" id="btn-atk-goblin">Herói Ataca Goblin 1</button>
          <button class="gm-btn action-btn" id="btn-goblin-atk">Goblin Ataca Herói</button>
          <button class="gm-btn action-btn" id="btn-dmg-goblin">Dar 5 Dano em Goblin 1</button>
          <button class="gm-btn action-btn" id="btn-open-door">Abrir Porta</button>
          <button class="gm-btn action-btn" id="btn-open-chest">Abrir Baú</button>
          <button class="gm-btn action-btn" id="btn-loot-chest">Saquear Baú</button>
          <button class="gm-btn action-btn combo-btn" id="btn-combo-start">Executar Combo 6-Ações</button>
        </div>
      </div>

      <!-- Test Scenarios & Illegal Cases -->
      <div class="gm-section">
        <h4 class="gm-sec-title">Harness de Testes & Casos Inválidos</h4>
        <div class="form-group-compact">
          <label class="gm-lbl">Testar Rejeição de Regra / Schema:</label>
          <select id="gm-illegal-select" class="gm-select">
            <option value="">Selecione um caso de erro para testar...</option>
            ${ILLEGAL_PRESETS.map((p, idx) => `<option value="${idx}">[${p.expect.toUpperCase()}] ${p.label}</option>`).join('')}
          </select>
          <button class="gm-btn warning-btn" id="btn-run-illegal">Injetar Caso Inválido</button>
        </div>
        <div class="scenario-actions">
          <button class="gm-btn scenario-btn" id="btn-run-scenario">▶ Executar Cenário Completo (8 Turnos)</button>
        </div>
      </div>

      <!-- Raw JSON Payload Editor -->
      <div class="gm-section">
        <div class="raw-editor-header">
          <h4 class="gm-sec-title">Injetor de Payload JSON Bruto</h4>
          <button class="gm-tiny-btn" id="btn-paste-sample">Exemplo</button>
        </div>
        <textarea id="gm-json-input" class="gm-json-textarea" spellcheck="false" rows="7" placeholder='{\n  "narrative": "...",\n  "commands": []\n}'></textarea>
        <div class="gm-raw-actions">
          <button class="gm-btn" id="btn-validate-json">Validar Schema</button>
          <button class="gm-btn push-btn" id="btn-push-payload">🚀 Empurrar Payload (Push)</button>
        </div>
        <div id="gm-validation-feedback" class="gm-feedback"></div>
      </div>

      <!-- Session & Engine Management -->
      <div class="gm-section session-tools">
        <h4 class="gm-sec-title">Gerenciador de Sessão & Replay</h4>
        <div class="gm-session-btns">
          <button class="gm-btn" id="btn-export-session">📥 Exportar Sessão</button>
          <button class="gm-btn" id="btn-replay-session">🔄 Reproduzir Sessão</button>
          <button class="gm-btn danger-btn" id="btn-reset-game">⚡ Reiniciar Jogo</button>
        </div>
      </div>
    </div>
  `;

  // UI bindings
  const contentEl = container.querySelector('#gm-content');
  const toggleBtn = container.querySelector('#gm-toggle-btn');
  const selCoordsEl = container.querySelector('#gm-sel-coords');
  const illegalSelect = container.querySelector('#gm-illegal-select');
  const runIllegalBtn = container.querySelector('#btn-run-illegal');
  const runScenarioBtn = container.querySelector('#btn-run-scenario');
  const jsonInput = container.querySelector('#gm-json-input');
  const pasteSampleBtn = container.querySelector('#btn-paste-sample');
  const validateJsonBtn = container.querySelector('#btn-validate-json');
  const pushPayloadBtn = container.querySelector('#btn-push-payload');
  const validationFeedback = container.querySelector('#gm-validation-feedback');
  const exportSessionBtn = container.querySelector('#btn-export-session');
  const replaySessionBtn = container.querySelector('#btn-replay-session');
  const resetGameBtn = container.querySelector('#btn-reset-game');

  // Push helper
  async function pushPayload(payload, label = 'Ação GM') {
    validationFeedback.textContent = `Enviando "${label}" para a Fila de Ações...`;
    validationFeedback.className = 'gm-feedback info';
    try {
      const res = await submitRaw(payload, { queue, bus, source: 'human_gm', animate: true });
      if (!res) {
        validationFeedback.textContent = 'Payload rejeitado pelo Schema Validator!';
        validationFeedback.className = 'gm-feedback error';
        return;
      }
      validationFeedback.textContent = `Sucesso: ${res.applied.length} comandos aplicados, ${res.rejected.length} rejeitados.`;
      validationFeedback.className = res.rejected.length ? 'gm-feedback warning' : 'gm-feedback success';
    } catch (err) {
      validationFeedback.textContent = `Erro ao processar: ${err.message}`;
      validationFeedback.className = 'gm-feedback error';
    }
  }

  // Preset Handlers
  container.querySelector('#btn-spawn-goblin').addEventListener('click', () => {
    const x = selectedTile ? selectedTile.x : 6;
    const y = selectedTile ? selectedTile.y : 3;
    const id = `goblin_${Date.now().toString().slice(-4)}`;
    pushPayload(presets.spawn(id, 'goblin', x, y), `Spawn ${id}`);
  });

  container.querySelector('#btn-spawn-skel').addEventListener('click', () => {
    const x = selectedTile ? selectedTile.x : 7;
    const y = selectedTile ? selectedTile.y : 4;
    const id = `skel_${Date.now().toString().slice(-4)}`;
    pushPayload(presets.spawn(id, 'skeleton', x, y), `Spawn ${id}`);
  });

  container.querySelector('#btn-move-player').addEventListener('click', () => {
    if (!selectedTile) {
      alert('Clique primeiro em uma casa do mapa para selecionar o destino!');
      return;
    }
    pushPayload(presets.movePlayer(selectedTile.x, selectedTile.y), `Mover p/ (${selectedTile.x},${selectedTile.y})`);
  });

  container.querySelector('#btn-atk-goblin').addEventListener('click', () => {
    pushPayload(presets.playerAttack('goblin_1'), 'Herói ataca goblin_1');
  });

  container.querySelector('#btn-goblin-atk').addEventListener('click', () => {
    pushPayload(presets.enemyAttack('goblin_1'), 'Goblin_1 ataca herói');
  });

  container.querySelector('#btn-dmg-goblin').addEventListener('click', () => {
    pushPayload(presets.damage('goblin_1', 5), 'Dano 5 em goblin_1');
  });

  container.querySelector('#btn-open-door').addEventListener('click', () => {
    pushPayload(presets.interact('door_1'), 'Interagir door_1');
  });

  container.querySelector('#btn-open-chest').addEventListener('click', () => {
    pushPayload(presets.interact('chest_1'), 'Interagir chest_1');
  });

  container.querySelector('#btn-loot-chest').addEventListener('click', () => {
    pushPayload(presets.lootAll('chest_1'), 'Saquear chest_1');
  });

  container.querySelector('#btn-combo-start').addEventListener('click', () => {
    pushPayload(COMBO_FROM_START, 'Combo 6-Comandos');
  });

  // Illegal presets
  runIllegalBtn.addEventListener('click', () => {
    const idx = illegalSelect.value;
    if (idx === '') return;
    const item = ILLEGAL_PRESETS[parseInt(idx, 10)];
    if (!item) return;
    pushPayload(item.raw ?? item.payload, `Teste de Erro: ${item.label}`);
  });

  // Scenario execution
  runScenarioBtn.addEventListener('click', async () => {
    if (!confirm('Executar o cenário completo de 8 turnos sequencialmente?')) return;
    runScenarioBtn.disabled = true;
    for (let i = 0; i < SCRIPTED_SCENARIO.length; i++) {
      const step = SCRIPTED_SCENARIO[i];
      await pushPayload(step, `Cenário Passo ${i + 1}/${SCRIPTED_SCENARIO.length}`);
      await new Promise((r) => setTimeout(r, 600));
    }
    runScenarioBtn.disabled = false;
  });

  // Raw JSON Editor
  pasteSampleBtn.addEventListener('click', () => {
    jsonInput.value = JSON.stringify(
      {
        narrative: '[Mestre Humano] Um relâmpago atinge a masmorra!',
        commands: [
          { type: 'DAMAGE', target: 'goblin_1', amount: 4 },
          { type: 'MOVE', id: 'player', target: 'door_1' }
        ]
      },
      null,
      2
    );
  });

  validateJsonBtn.addEventListener('click', () => {
    const text = jsonInput.value.trim();
    if (!text) {
      validationFeedback.textContent = 'Digite ou cole um JSON para validar.';
      validationFeedback.className = 'gm-feedback warning';
      return;
    }
    const parsed = parseLLMResponse(text);
    if (parsed.ok) {
      validationFeedback.textContent = `✓ JSON válido! ${parsed.payload.commands.length} comandos reconhecidos.`;
      validationFeedback.className = 'gm-feedback success';
    } else {
      const errs = describeParseErrors(parsed);
      validationFeedback.textContent = `✗ Erros (${parsed.stage}): ${errs.join('; ')}`;
      validationFeedback.className = 'gm-feedback error';
    }
  });

  pushPayloadBtn.addEventListener('click', () => {
    const text = jsonInput.value.trim();
    if (!text) return;
    pushPayload(text, 'Payload Manual');
  });

  // Session & Reset
  exportSessionBtn.addEventListener('click', () => {
    const data = sessionRecorder.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rpg_llm_session_turn${data.finalTurn}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  replaySessionBtn.addEventListener('click', async () => {
    const input = prompt('Cole o JSON da sessão para reproduzir (ou deixe em branco para cancelar):');
    if (!input) return;
    try {
      const log = JSON.parse(input);
      // Reset state first
      store.set(createInitialState());
      sessionRecorder.clear();
      const res = await replaySession(log, { queue, bus, store, animate: true });
      alert(`Replay concluído!\nHash Final: ${res.hash}\nHash Esperado: ${res.expected}\nDeterminismo Confirmado: ${res.match ? 'SIM ✓' : 'NÃO ✗'}`);
    } catch (err) {
      alert(`Falha ao reproduzir: ${err.message}`);
    }
  });

  resetGameBtn.addEventListener('click', () => {
    if (!confirm('Reiniciar o jogo para o estado inicial?')) return;
    store.set(createInitialState());
    sessionRecorder.clear();
    bus.emit('narrative', { text: '[Sistema] Jogo reiniciado para o estado inicial.', source: 'system' });
  });

  // Panel collapse/expand
  let collapsed = false;
  function togglePanel() {
    collapsed = !collapsed;
    contentEl.style.display = collapsed ? 'none' : 'block';
    toggleBtn.textContent = collapsed ? '+' : '—';
  }
  toggleBtn.addEventListener('click', togglePanel);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'g' || e.key === 'G') {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      togglePanel();
    }
  });

  // Grid Selection listener
  bus.on('grid:select', ({ x, y, entityId }) => {
    selectedTile = { x, y };
    selCoordsEl.textContent = `(${x}, ${y})${entityId ? ` [${entityId}]` : ''}`;
  });

  return { togglePanel };
}
