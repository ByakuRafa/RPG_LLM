/**
 * Settings Modal: manages Gemini API Key, model selector, temperature
 * and mock toggle. Stores settings securely in localStorage.
 */
import { DEFAULT_MODEL, listGeminiModels } from '../llm/llmClient.js';

const STORAGE_KEY = 'rpg_llm_settings_v1';

export const DEFAULT_SETTINGS = {
  provider: 'mock', // default to mock so user can play immediately out of the box!
  apiKey: '',
  model: DEFAULT_MODEL,
  temperature: 0.7,
  timeoutSeconds: 120, // 120s recommended for open models like Gemma
  animationSpeed: 1.0,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

export function createSettingsModal({ container, onSave, bus }) {
  let settings = loadSettings();

  container.innerHTML = `
    <div class="modal-backdrop" id="settings-backdrop" style="display: none;">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3 class="modal-title">Configuracoes de IA e Motor</h3>
          <button class="modal-close-btn" id="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label" for="cfg-provider">Provedor Ativo:</label>
            <select id="cfg-provider" class="form-select">
              <option value="mock">Simulador Mock (Sem custo / Testes)</option>
              <option value="gemini">Google Gemini / Gemma (Google AI Studio)</option>
            </select>
            <span class="form-hint">O simulador Mock permite testar toda a mecanica sem precisar de chave de API.</span>
          </div>

          <div id="gemini-fields" style="display: none;">
            <div class="form-group">
              <label class="form-label" for="cfg-apikey">Chave de API do Google AI Studio:</label>
              <div class="input-password-wrapper">
                <input type="password" id="cfg-apikey" class="form-input" placeholder="Cole sua chave AI Studio aqui (AIzaSy...)" />
                <button type="button" id="cfg-toggle-key" class="btn-toggle-vis">Ver</button>
              </div>
              <span class="form-hint">Sua chave fica salva apenas no <code>localStorage</code> do seu navegador e nunca e enviada a servidores externos.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="cfg-model">Modelo (Gemini / Gemma):</label>
              <div class="model-select-wrapper">
                <input type="text" id="cfg-model" class="form-input" list="gemini-models-list" value="${DEFAULT_MODEL}" />
                <datalist id="gemini-models-list">
                  <option value="gemini-3.8-flash">gemini-3.8-flash (Recomendado / Mais recente)</option>
                  <option value="gemma-4-26b-a4b-it">gemma-4-26b-a4b-it (Gemma 4 Instruct)</option>
                  <option value="gemini-3.7-flash">gemini-3.7-flash (Flash 3.7)</option>
                  <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ultra rapido)</option>
                </datalist>
                <button type="button" id="cfg-test-key-btn" class="btn-secondary">Testar Chave</button>
              </div>
              <div id="cfg-test-result" class="test-result-msg"></div>
            </div>

            <div class="form-group">
              <label class="form-label" for="cfg-timeout">Tempo Limite de Espera (Timeout):</label>
              <select id="cfg-timeout" class="form-select">
                <option value="30">30 segundos (Gemini Flash rapido)</option>
                <option value="60">60 segundos (Padrao Gemini)</option>
                <option value="90">90 segundos</option>
                <option value="120">120 segundos (Recomendado para Gemma)</option>
                <option value="180">180 segundos (Gemma em horarios de pico)</option>
                <option value="240">240 segundos (4 minutos - maximo)</option>
              </select>
              <span class="form-hint">Modelos abertos grandes como <code>gemma-4-26b-a4b-it</code> levam mais tempo para responder no Google AI Studio. Recomendamos 120s ou 180s.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="cfg-temp">Temperatura: <span id="cfg-temp-val">0.7</span></label>
              <input type="range" id="cfg-temp" min="0" max="1" step="0.1" value="0.7" class="form-range" />
              <span class="form-hint">Valores menores (0.2-0.5) produzem respostas mais precisas e aderentes as regras; valores maiores dao mais criatividade narrativa.</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg-speed">Velocidade das Animacoes:</label>
            <select id="cfg-speed" class="form-select">
              <option value="1.0">Normal (1x ~200ms)</option>
              <option value="1.5">Rapida (1.5x)</option>
              <option value="2.5">Turbo (2.5x)</option>
              <option value="10.0">Instantanea (sem delay)</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" id="cfg-cancel-btn" class="btn-secondary">Cancelar</button>
          <button type="button" id="cfg-save-btn" class="btn-primary">Salvar Configuracoes</button>
        </div>
      </div>
    </div>
  `;

  const backdrop = container.querySelector('#settings-backdrop');
  const closeBtn = container.querySelector('#modal-close');
  const cancelBtn = container.querySelector('#cfg-cancel-btn');
  const saveBtn = container.querySelector('#cfg-save-btn');
  const providerSelect = container.querySelector('#cfg-provider');
  const geminiFields = container.querySelector('#gemini-fields');
  const apiKeyInput = container.querySelector('#cfg-apikey');
  const toggleKeyBtn = container.querySelector('#cfg-toggle-key');
  const modelInput = container.querySelector('#cfg-model');
  const timeoutSelect = container.querySelector('#cfg-timeout');
  const tempRange = container.querySelector('#cfg-temp');
  const tempVal = container.querySelector('#cfg-temp-val');
  const speedSelect = container.querySelector('#cfg-speed');
  const testKeyBtn = container.querySelector('#cfg-test-key-btn');
  const testResultMsg = container.querySelector('#cfg-test-result');

  function updateUiFromSettings() {
    providerSelect.value = settings.provider;
    geminiFields.style.display = settings.provider === 'gemini' ? 'block' : 'none';
    apiKeyInput.value = settings.apiKey || '';
    modelInput.value = settings.model || DEFAULT_MODEL;
    timeoutSelect.value = String(settings.timeoutSeconds || 120);
    tempRange.value = settings.temperature ?? 0.7;
    tempVal.textContent = tempRange.value;
    speedSelect.value = String(settings.animationSpeed || 1.0);
    testResultMsg.textContent = '';
    testResultMsg.className = 'test-result-msg';
  }

  function open() {
    settings = loadSettings();
    updateUiFromSettings();
    backdrop.style.display = 'flex';
  }

  function close() {
    backdrop.style.display = 'none';
  }

  providerSelect.addEventListener('change', () => {
    geminiFields.style.display = providerSelect.value === 'gemini' ? 'block' : 'none';
  });

  modelInput.addEventListener('input', () => {
    const val = modelInput.value.toLowerCase();
    if (val.includes('gemma') && parseInt(timeoutSelect.value, 10) < 120) {
      timeoutSelect.value = '120';
    }
  });

  toggleKeyBtn.addEventListener('click', () => {
    const isPw = apiKeyInput.type === 'password';
    apiKeyInput.type = isPw ? 'text' : 'password';
    toggleKeyBtn.textContent = isPw ? 'Ocultar' : 'Ver';
  });

  tempRange.addEventListener('input', () => {
    tempVal.textContent = tempRange.value;
  });

  testKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      testResultMsg.textContent = 'Digite uma chave antes de testar.';
      testResultMsg.className = 'test-result-msg error';
      return;
    }
    testResultMsg.textContent = 'Verificando chave junto a API do Google...';
    testResultMsg.className = 'test-result-msg info';
    try {
      const models = await listGeminiModels(key);
      testResultMsg.textContent = `[OK] Chave valida! ${models.length} modelos disponiveis para geracao.`;
      testResultMsg.className = 'test-result-msg success';
    } catch (err) {
      testResultMsg.textContent = `[Erro] Falha: ${err.message}`;
      testResultMsg.className = 'test-result-msg error';
    }
  });

  saveBtn.addEventListener('click', () => {
    settings.provider = providerSelect.value;
    settings.apiKey = apiKeyInput.value.trim();
    settings.model = modelInput.value.trim() || DEFAULT_MODEL;
    settings.timeoutSeconds = parseInt(timeoutSelect.value, 10) || 120;
    settings.temperature = parseFloat(tempRange.value);
    settings.animationSpeed = parseFloat(speedSelect.value);
    saveSettings(settings);
    close();
    onSave(settings);
    bus?.emit('settings:updated', settings);
  });

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  return { open, close, getSettings: () => settings };
}
