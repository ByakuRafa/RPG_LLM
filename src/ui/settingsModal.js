/**
 * Settings Modal component (Sprint 3, Task 3.8).
 * Pure DOM layer, zero direct state mutation.
 * Configures API key, model selection, prompt config A/B, temperature, timeout, and connection testing.
 */
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../core/settings.js';
import { createLlmClient } from '../llm/llmClient.js';

export function mountSettingsModal(bus = null) {
  let modalEl = document.getElementById('settings-modal');

  if (!modalEl) {
    modalEl = document.createElement('dialog');
    modalEl.id = 'settings-modal';
    modalEl.className = 'settings-modal';
    document.body.appendChild(modalEl);
  }

  modalEl.innerHTML = `
    <div class="settings-modal-box">
      <div class="modal-header">
        <h3>Configurações do Mestre de Jogo (LLM)</h3>
        <button type="button" id="btn-close-settings" class="btn-sm" title="Fechar">✕</button>
      </div>

      <div class="modal-body">
        <!-- API Key Field -->
        <div class="form-group">
          <label class="form-label" for="set-api-key">Chave de API (Google AI Studio):</label>
          <div class="input-password-wrapper">
            <input
              type="password"
              id="set-api-key"
              class="form-input"
              placeholder="Cole sua chave AI Studio (AIzaSy...)"
              autocomplete="off"
            />
            <button type="button" id="set-toggle-key" class="btn-toggle-vis">Ver</button>
          </div>
          <span class="form-hint">Sua chave é armazenada exclusivamente no <code>localStorage</code> do seu navegador e nunca é enviada a servidores intermediários.</span>
        </div>

        <!-- Model Selection -->
        <div class="form-group">
          <label class="form-label" for="set-model">Modelo LLM:</label>
          <div class="model-select-wrapper">
            <select id="set-model" class="form-select">
              <option value="gemini-3.8-flash">gemini-3.8-flash (Padrão Recomendado · Alta precisão)</option>
              <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Ultra Rápido · Baixa latência)</option>
              <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Raciocínio tático profundo)</option>
              <option value="gemma-4-26b-a4b-it">gemma-4-26b-a4b-it (Gemma 4 Instruct)</option>
              <option value="custom">Outro (Inserir identificador customizado...)</option>
            </select>
            <input
              type="text"
              id="set-model-custom"
              class="form-input"
              placeholder="Nome do modelo (ex: gemini-2.5-flash)"
              style="display: none; margin-top: 6px;"
            />
            <button type="button" id="btn-test-connection" class="btn-secondary" style="margin-top: 8px;">Testar Conexão</button>
          </div>
          <div id="set-test-result" class="test-result-msg" style="display: none;"></div>
        </div>

        <!-- Prompt Config A vs B -->
        <div class="form-group">
          <label class="form-label">Estratégia de Prompt (Benchmark Acadêmico):</label>
          <div class="config-radio-group">
            <label class="radio-label">
              <input type="radio" name="set-prompt-config" id="set-config-b" value="B" checked />
              <div>
                <strong>Configuração B (Otimizada) [Recomendada]</strong>
                <div class="radio-desc">Contexto espacial pré-computado (reachable_tiles, attack_positions) + 3 Few-Shot em PT-BR.</div>
              </div>
            </label>
            <label class="radio-label" style="margin-top: 8px;">
              <input type="radio" name="set-prompt-config" id="set-config-a" value="A" />
              <div>
                <strong>Configuração A (Baseline)</strong>
                <div class="radio-desc">Apenas regras textuais, mapa ASCII e estado base sem pré-cálculos de movimento ou alcance.</div>
              </div>
            </label>
          </div>
        </div>

        <!-- Temperature -->
        <div class="form-group">
          <label class="form-label" for="set-temperature">Temperatura: <span id="set-temp-val">0.2</span></label>
          <input type="range" id="set-temperature" min="0.0" max="1.0" step="0.05" value="0.2" class="form-range" />
          <span class="form-hint">Valores baixos (0.1–0.3) garantem alta fidelidade ao contrato JSON e regras táticas.</span>
        </div>

        <!-- Timeout -->
        <div class="form-group">
          <label class="form-label" for="set-timeout">Tempo Limite de Resposta (Timeout):</label>
          <select id="set-timeout" class="form-select">
            <option value="15000">15 segundos (Rápido)</option>
            <option value="30000">30 segundos (Padrão Gemini)</option>
            <option value="60000">60 segundos (Recomendado para conexões lentas)</option>
            <option value="120000">120 segundos (Modelos Gemma)</option>
          </select>
        </div>

        <!-- Enemy AI Mode -->
        <div class="form-group">
          <label class="form-label" for="set-enemy-ai-mode">Inteligência Artificial Inimiga (Goblins):</label>
          <select id="set-enemy-ai-mode" class="form-select">
            <option value="HEURISTIC">Heurística Determinística (Rápida, sem API)</option>
            <option value="LLM">LLM Tática (Gemini 3.8 Flash com fallback automático)</option>
          </select>
          <span class="form-hint">No modo LLM, caso ocorra timeout (8s) ou erro de conexão, a criatura executa a heurística determinística.</span>
        </div>

        <!-- Benchmark Delay -->
        <div class="form-group">
          <label class="form-label" for="set-benchmark-delay">Intervalo entre Requisições no Benchmark:</label>
          <select id="set-benchmark-delay" class="form-select">
            <option value="0">0 ms (Mínimo, para fake LLM / mock)</option>
            <option value="1000">1.000 ms (1 segundo)</option>
            <option value="2000">2.000 ms (2 segundos)</option>
            <option value="4000">4.000 ms (Recomendado para evitar Rate Limit 429)</option>
          </select>
        </div>

        <!-- VTT Sprites Toggle -->
        <div class="form-group">
          <label class="form-label">Renderização Visual (Virtual Tabletop):</label>
          <label class="radio-label">
            <input type="checkbox" id="set-use-sprites" checked />
            <div>
              <strong>Usar Sprites VTT (Tokens PNG e Baús)</strong>
              <div class="radio-desc">Exibe tokens circulares ilustrados e baús gráficos. Se desmarcado, reverte instantaneamente para quadrados coloridos.</div>
            </div>
          </label>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" id="btn-cancel-settings" class="btn-secondary">Cancelar</button>
        <button type="button" id="btn-save-settings" class="btn-primary">Salvar Configurações</button>
      </div>
    </div>
  `;

  // Element references
  const closeBtn = modalEl.querySelector('#btn-close-settings');
  const cancelBtn = modalEl.querySelector('#btn-cancel-settings');
  const saveBtn = modalEl.querySelector('#btn-save-settings');
  const apiKeyInput = modalEl.querySelector('#set-api-key');
  const toggleKeyBtn = modalEl.querySelector('#set-toggle-key');
  const modelSelect = modalEl.querySelector('#set-model');
  const modelCustomInput = modalEl.querySelector('#set-model-custom');
  const configRadioA = modalEl.querySelector('#set-config-a');
  const configRadioB = modalEl.querySelector('#set-config-b');
  const tempRange = modalEl.querySelector('#set-temperature');
  const tempValSpan = modalEl.querySelector('#set-temp-val');
  const timeoutSelect = modalEl.querySelector('#set-timeout');
  const testConnBtn = modalEl.querySelector('#btn-test-connection');
  const testResultEl = modalEl.querySelector('#set-test-result');
  const enemyAiModeSelect = modalEl.querySelector('#set-enemy-ai-mode');
  const benchDelaySelect = modalEl.querySelector('#set-benchmark-delay');
  const useSpritesCheckbox = modalEl.querySelector('#set-use-sprites');

  function getEffectiveModel() {
    if (modelSelect.value === 'custom') {
      return modelCustomInput.value.trim() || 'gemini-3.8-flash';
    }
    return modelSelect.value;
  }

  function syncFormWithSettings() {
    const s = loadSettings();
    apiKeyInput.value = s.apiKey || '';

    const knownModels = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemma-4-26b-a4b-it'];
    if (knownModels.includes(s.model)) {
      modelSelect.value = s.model;
      modelCustomInput.style.display = 'none';
      modelCustomInput.value = '';
    } else {
      modelSelect.value = 'custom';
      modelCustomInput.style.display = 'block';
      modelCustomInput.value = s.model || '';
    }

    if (s.promptConfig === 'A') {
      configRadioA.checked = true;
    } else {
      configRadioB.checked = true;
    }

    tempRange.value = s.temperature ?? 0.2;
    tempValSpan.textContent = String(tempRange.value);

    timeoutSelect.value = String(s.timeoutMs || 30000);
    if (enemyAiModeSelect) enemyAiModeSelect.value = s.enemyAIMode || 'HEURISTIC';
    if (benchDelaySelect) benchDelaySelect.value = String(s.benchmarkDelayMs ?? 4000);
    if (useSpritesCheckbox) useSpritesCheckbox.checked = s.useSprites !== false;
    testResultEl.style.display = 'none';
    testResultEl.textContent = '';
  }

  function open() {
    syncFormWithSettings();
    if (typeof modalEl.showModal === 'function') {
      if (!modalEl.open) modalEl.showModal();
    } else {
      modalEl.style.display = 'block';
    }
  }

  function close() {
    if (typeof modalEl.close === 'function') {
      if (modalEl.open) modalEl.close();
    } else {
      modalEl.style.display = 'none';
    }
  }

  // Model select change -> toggle custom input
  modelSelect.addEventListener('change', () => {
    if (modelSelect.value === 'custom') {
      modelCustomInput.style.display = 'block';
      modelCustomInput.focus();
    } else {
      modelCustomInput.style.display = 'none';
    }
  });

  // Toggle key visibility
  toggleKeyBtn.addEventListener('click', () => {
    const isPw = apiKeyInput.type === 'password';
    apiKeyInput.type = isPw ? 'text' : 'password';
    toggleKeyBtn.textContent = isPw ? 'Ocultar' : 'Ver';
  });

  // Temperature display
  tempRange.addEventListener('input', () => {
    tempValSpan.textContent = String(tempRange.value);
  });

  // Test Connection Handler
  testConnBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      testResultEl.style.display = 'block';
      testResultEl.textContent = 'Insira uma chave de API antes de testar a conexão.';
      testResultEl.className = 'test-result-msg error';
      return;
    }

    testResultEl.style.display = 'block';
    testResultEl.textContent = 'Testando conexão com a API Gemini...';
    testResultEl.className = 'test-result-msg info';

    const testClient = createLlmClient({
      getSettings: () => ({
        apiKey: key,
        model: getEffectiveModel(),
        timeoutMs: 10000
      })
    });

    const res = await testClient.testConnection();
    if (res.ok) {
      testResultEl.textContent = `✓ Conexão OK (${res.latencyMs}ms)`;
      testResultEl.className = 'test-result-msg success';
    } else {
      testResultEl.textContent = `✗ Falha: ${res.error}`;
      testResultEl.className = 'test-result-msg error';
    }
  });

  // Save Settings Handler
  saveBtn.addEventListener('click', () => {
    const patch = {
      apiKey: apiKeyInput.value.trim(),
      model: getEffectiveModel(),
      promptConfig: configRadioB.checked ? 'B' : 'A',
      temperature: parseFloat(tempRange.value),
      timeoutMs: parseInt(timeoutSelect.value, 10),
      enemyAIMode: enemyAiModeSelect ? enemyAiModeSelect.value : 'HEURISTIC',
      benchmarkDelayMs: benchDelaySelect ? parseInt(benchDelaySelect.value, 10) : 4000,
      useSprites: useSpritesCheckbox ? useSpritesCheckbox.checked : true
    };

    saveSettings(patch);
    close();
  });

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);

  // Close on backdrop click
  modalEl.addEventListener('click', (ev) => {
    if (ev.target === modalEl) {
      close();
    }
  });

  // Global listener for opening settings modal
  bus?.on('ui:openSettings', () => {
    open();
  });

  document.getElementById('btn-settings')?.addEventListener('click', () => {
    open();
  });

  return {
    open,
    close,
    isOpen: () => Boolean(modalEl.open)
  };
}
