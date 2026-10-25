/**
 * Academic Benchmark Panel Component (Sprint 4, Task 3.4).
 * Evaluator UI mounted inside the GM drawer.
 * Pure DOM layer, zero direct state mutation. Uses safe textContent only.
 */
import { createEvaluator, toCsv, summaryToCsv, toJson, download } from '../llm/evaluator.js';

/**
 * Mounts the Benchmark Panel inside rootEl.
 *
 * @param {HTMLElement} rootEl Container element inside GM drawer
 * @param {object} bus Event bus
 * @param {object} options
 * @param {object} options.store Store instance
 * @param {object} options.queue ActionQueue instance
 * @param {object} [options.gm] GameMaster service or getter
 * @param {Function} [options.getGameMaster] GameMaster getter function
 * @param {object} [options.evaluator] Optional pre-created Evaluator instance
 * @param {Function} [options.getSettings] Function returning settings
 * @returns {{ abort: Function, isRunning: () => boolean }}
 */
export function mountBenchmarkPanel(rootEl, bus, {
  store,
  queue,
  gm,
  getGameMaster,
  evaluator = null,
  getSettings = () => ({})
} = {}) {
  let isRunning = false;
  let abortController = null;
  let cachedSuite = null;
  let currentResults = [];
  let currentSummary = [];
  let currentMeta = null;
  let currentTraces = [];

  const getGmInstance = () => {
    if (typeof getGameMaster === 'function') return getGameMaster();
    return gm;
  };

  rootEl.innerHTML = `
    <div class="benchmark-panel-header">
      <h4>Avaliação Acadêmica & Benchmark</h4>
      <span class="bench-badge-version">Sprint 4 · 30 Casos</span>
    </div>

    <!-- Controls Row -->
    <div class="bench-controls">
      <div id="bench-configs" class="bench-configs-group">
        <label class="bench-checkbox-label">
          <input type="checkbox" id="bench-cfg-a" value="A" checked />
          <span>Config A</span>
        </label>
        <label class="bench-checkbox-label">
          <input type="checkbox" id="bench-cfg-b" value="B" checked />
          <span>Config B</span>
        </label>
      </div>

      <div class="bench-reps-group">
        <label for="bench-reps" style="font-size:11px; color:var(--text-muted);">Reps:</label>
        <select id="bench-reps" class="bench-select-reps">
          <option value="1">1x</option>
          <option value="2">2x</option>
          <option value="3">3x</option>
          <option value="4">4x</option>
          <option value="5">5x</option>
        </select>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="bench-action-row">
      <button id="btn-bench-run" class="btn-bench-run">Executar Benchmark Acadêmico</button>
      <button id="btn-bench-abort" class="btn-bench-abort" disabled>Abortar</button>
    </div>

    <!-- Progress & Status -->
    <div class="bench-status-box">
      <div class="bench-status-meta">
        <span id="bench-current" class="bench-status-current">Pronto para iniciar</span>
        <span id="bench-eta" class="bench-status-eta">ETA: --</span>
      </div>
      <progress id="bench-progress" value="0" max="100" class="bench-progress-bar"></progress>
    </div>

    <!-- Live Results Table (Case x Config) -->
    <div class="bench-table-wrapper">
      <div class="bench-table-title">Resultados por Caso (Tempo Real)</div>
      <div class="bench-scroll-container">
        <table id="bench-table" class="bench-data-table">
          <thead>
            <tr>
              <th style="width:50px;">ID</th>
              <th style="width:65px;">Tipo</th>
              <th>Comando PT-BR</th>
              <th style="width:55px;">Cfg A</th>
              <th style="width:55px;">Cfg B</th>
            </tr>
          </thead>
          <tbody id="bench-table-body">
            <tr>
              <td colspan="5" style="text-align:center; color:var(--text-dim); padding:12px;">
                Nenhum benchmark executado ainda. Clique em 'Executar' ou 'Carregar JSON'.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Final Summary Table (Metrics x Configs) -->
    <div class="bench-summary-wrapper" style="margin-top:12px;">
      <div class="bench-table-title">Resumo Comparativo de Métricas</div>
      <div class="bench-scroll-container">
        <table id="bench-summary" class="bench-data-table">
          <thead>
            <tr>
              <th>Métrica Avaliada</th>
              <th style="width:80px;">Config A</th>
              <th style="width:80px;">Config B</th>
            </tr>
          </thead>
          <tbody id="bench-summary-body">
            <tr>
              <td colspan="3" style="text-align:center; color:var(--text-dim); padding:10px;">
                Aguardando conclusão do benchmark...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Export / Import Buttons -->
    <div class="bench-export-row">
      <button id="btn-bench-csv" class="btn-bench-export" disabled>CSV Detalhado</button>
      <button id="btn-bench-summary-csv" class="btn-bench-export" disabled>CSV Resumo</button>
      <button id="btn-bench-json" class="btn-bench-export" disabled>Salvar JSON</button>
      <button id="btn-bench-load-json" class="btn-bench-export">Carregar JSON</button>
      <input type="file" id="bench-file-input" accept=".json" style="display:none;" />
    </div>
  `;

  // Element references
  const cfgACheckbox = rootEl.querySelector('#bench-cfg-a');
  const cfgBCheckbox = rootEl.querySelector('#bench-cfg-b');
  const repsSelect = rootEl.querySelector('#bench-reps');
  const btnRun = rootEl.querySelector('#btn-bench-run');
  const btnAbort = rootEl.querySelector('#btn-bench-abort');
  const progressEl = rootEl.querySelector('#bench-progress');
  const benchCurrentEl = rootEl.querySelector('#bench-current');
  const benchEtaEl = rootEl.querySelector('#bench-eta');
  const tableBody = rootEl.querySelector('#bench-table-body');
  const summaryBody = rootEl.querySelector('#bench-summary-body');
  const btnExportCsv = rootEl.querySelector('#btn-bench-csv');
  const btnExportSummaryCsv = rootEl.querySelector('#btn-bench-summary-csv');
  const btnExportJson = rootEl.querySelector('#btn-bench-json');
  const btnLoadJson = rootEl.querySelector('#btn-bench-load-json');
  const fileInput = rootEl.querySelector('#bench-file-input');

  async function loadSuite() {
    if (cachedSuite) return cachedSuite;
    try {
      const res = await fetch('/tests/testSuite.json');
      if (!res.ok) throw new Error('Não foi possível carregar /tests/testSuite.json');
      cachedSuite = await res.json();
      return cachedSuite;
    } catch (err) {
      throw new Error(`Falha ao obter testSuite.json: ${err.message}`);
    }
  }

  function getSelectedConfigs() {
    const list = [];
    if (cfgACheckbox?.checked) list.push('A');
    if (cfgBCheckbox?.checked) list.push('B');
    return list;
  }

  function setBenchmarkingState(active) {
    isRunning = active;
    if (btnRun) btnRun.disabled = active;
    if (btnAbort) btnAbort.disabled = !active;
    if (cfgACheckbox) cfgACheckbox.disabled = active;
    if (cfgBCheckbox) cfgBCheckbox.disabled = active;
    if (repsSelect) repsSelect.disabled = active;

    bus?.emit('chat:disable', active);
    bus?.emit('hud:disable', active);
  }

  function initLiveTable(cases = []) {
    tableBody.textContent = '';
    for (const tc of cases) {
      const tr = document.createElement('tr');
      tr.id = `bench-row-${tc.id}`;

      const tdId = document.createElement('td');
      tdId.textContent = tc.id;
      tdId.style.fontWeight = '600';

      const tdCat = document.createElement('td');
      tdCat.textContent = tc.category === 'direct' ? 'Direto' : tc.category === 'ambiguous' ? 'Ambíguo' : 'Ilegal';
      tdCat.className = `bench-cat-${tc.category}`;

      const tdPrompt = document.createElement('td');
      tdPrompt.textContent = tc.prompt_pt;
      tdPrompt.className = 'bench-prompt-cell';
      tdPrompt.title = tc.prompt_pt;

      const tdA = document.createElement('td');
      tdA.id = `bench-res-${tc.id}-A`;
      tdA.textContent = '-';
      tdA.className = 'bench-cell-center';

      const tdB = document.createElement('td');
      tdB.id = `bench-res-${tc.id}-B`;
      tdB.textContent = '-';
      tdB.className = 'bench-cell-center';

      tr.appendChild(tdId);
      tr.appendChild(tdCat);
      tr.appendChild(tdPrompt);
      tr.appendChild(tdA);
      tr.appendChild(tdB);

      tableBody.appendChild(tr);
    }
  }

  function updateLiveTableCell(caseId, config, caseResult) {
    const cell = rootEl.querySelector(`#bench-res-${caseId}-${config}`);
    if (!cell) return;

    let isSuccess = false;
    let detail = '';

    if (caseResult.category === 'illegal') {
      isSuccess = !caseResult.illegalEffectApplied;
      detail = caseResult.llmRefused ? 'Recusa LLM' : caseResult.engineRejected ? 'Bloqueio Motor' : 'Efeito Ilegal';
    } else {
      isSuccess = caseResult.toolCorrect;
      detail = `Tool: ${caseResult.predictedTools} | Args: ${caseResult.argMatched}/${caseResult.argTotal}`;
    }

    cell.textContent = isSuccess ? '✔' : '✘';
    cell.className = `bench-cell-center ${isSuccess ? 'bench-pass' : 'bench-fail'}`;
    cell.title = `${detail} (${caseResult.latencyMs}ms)`;
  }

  function renderSummaryTable(summaries = []) {
    summaryBody.textContent = '';
    if (!Array.isArray(summaries) || summaries.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'Sem métricas para exibir.';
      td.style.textAlign = 'center';
      tr.appendChild(td);
      summaryBody.appendChild(tr);
      return;
    }

    const sA = summaries.find(s => s.config === 'A') || null;
    const sB = summaries.find(s => s.config === 'B') || null;

    const rows = [
      {
        label: 'Modelo',
        valA: sA?.model || '-',
        valB: sB?.model || '-'
      },
      {
        label: 'Acurácia de Ferramenta (Tool Accuracy)',
        valA: sA ? `${(sA.toolSelectionAccuracy * 100).toFixed(1)}%` : '-',
        valB: sB ? `${(sB.toolSelectionAccuracy * 100).toFixed(1)}%` : '-',
        highlight: true
      },
      {
        label: 'Precisão de Argumentos (Arg Precision)',
        valA: sA ? `${(sA.argumentPrecision * 100).toFixed(1)}%` : '-',
        valB: sB ? `${(sB.argumentPrecision * 100).toFixed(1)}%` : '-',
        highlight: true
      },
      {
        label: 'Tratamento de Ações Ilegais (Segurança)',
        valA: sA ? `${(sA.illegalHandlingRate * 100).toFixed(1)}%` : '-',
        valB: sB ? `${(sB.illegalHandlingRate * 100).toFixed(1)}%` : '-',
        highlight: true
      },
      {
        label: '↳ Recusa pelo LLM (Refusal Rate)',
        valA: sA ? `${(sA.llmRefusalRate * 100).toFixed(1)}%` : '-',
        valB: sB ? `${(sB.llmRefusalRate * 100).toFixed(1)}%` : '-'
      },
      {
        label: '↳ Bloqueio pelo Motor (Engine Catch)',
        valA: sA ? `${(sA.engineCatchRate * 100).toFixed(1)}%` : '-',
        valB: sB ? `${(sB.engineCatchRate * 100).toFixed(1)}%` : '-'
      },
      {
        label: 'Falsa Rejeição de Ações Válidas',
        valA: sA ? `${(sA.falseRejectionRate * 100).toFixed(1)}%` : '-',
        valB: sB ? `${(sB.falseRejectionRate * 100).toFixed(1)}%` : '-'
      },
      {
        label: 'Validade JSON na 1ª Tentativa',
        valA: sA ? `${(sA.jsonValidFirstTryRate * 100).toFixed(1)}%` : '-',
        valB: sB ? `${(sB.jsonValidFirstTryRate * 100).toFixed(1)}%` : '-'
      },
      {
        label: 'Taxa de Reparo Automático (1-shot)',
        valA: sA ? `${(sA.repairRate * 100).toFixed(1)}%` : '-',
        valB: sB ? `${(sB.repairRate * 100).toFixed(1)}%` : '-'
      },
      {
        label: 'Desvio Padrão (Entre Repetições)',
        valA: sA && sA.reps > 1 ? sA.accuracyStdDevAcrossReps.toFixed(4) : 'N/A (1 rep)',
        valB: sB && sB.reps > 1 ? sB.accuracyStdDevAcrossReps.toFixed(4) : 'N/A (1 rep)'
      },
      {
        label: 'Latência Média',
        valA: sA ? `${sA.latencyMs?.mean ?? 0} ms` : '-',
        valB: sB ? `${sB.latencyMs?.mean ?? 0} ms` : '-'
      },
      {
        label: 'Latência P50 / P95',
        valA: sA ? `${sA.latencyMs?.p50 ?? 0} / ${sA.latencyMs?.p95 ?? 0} ms` : '-',
        valB: sB ? `${sB.latencyMs?.p50 ?? 0} / ${sB.latencyMs?.p95 ?? 0} ms` : '-'
      }
    ];

    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.highlight) tr.className = 'bench-row-highlight';

      const tdLabel = document.createElement('td');
      tdLabel.textContent = r.label;

      const tdA = document.createElement('td');
      tdA.textContent = r.valA;
      tdA.className = 'bench-cell-center';

      const tdB = document.createElement('td');
      tdB.textContent = r.valB;
      tdB.className = 'bench-cell-center';

      tr.appendChild(tdLabel);
      tr.appendChild(tdA);
      tr.appendChild(tdB);
      summaryBody.appendChild(tr);
    }
  }

  function renderLiveTableFromResults(results = []) {
    const seen = new Map();
    for (const r of results) {
      if (!seen.has(r.caseId)) {
        seen.set(r.caseId, {
          id: r.caseId,
          category: r.category,
          prompt_pt: r.prompt_pt || `Caso ${r.caseId}`
        });
      }
    }
    initLiveTable([...seen.values()]);

    for (const r of results) {
      updateLiveTableCell(r.caseId, r.config, r);
    }
  }

  // --- Run Benchmark ---
  async function handleRun() {
    const configs = getSelectedConfigs();
    if (configs.length === 0) {
      alert('Selecione pelo menos uma configuração (Config A ou Config B).');
      return;
    }

    const reps = parseInt(repsSelect?.value, 10) || 1;
    let suite;
    try {
      suite = await loadSuite();
    } catch (err) {
      alert(err.message);
      return;
    }

    initLiveTable(suite.cases);
    summaryBody.textContent = '';
    const emptyRow = document.createElement('tr');
    const emptyTd = document.createElement('td');
    emptyTd.colSpan = 3;
    emptyTd.textContent = 'Executando benchmark...';
    emptyTd.style.textAlign = 'center';
    emptyRow.appendChild(emptyTd);
    summaryBody.appendChild(emptyRow);

    const total = configs.length * reps * suite.cases.length;
    progressEl.max = total;
    progressEl.value = 0;
    benchCurrentEl.textContent = 'Iniciando bateria acadêmica...';
    benchEtaEl.textContent = 'Calculando ETA...';

    setBenchmarkingState(true);
    abortController = new AbortController();

    const t0 = Date.now();
    let completedRuns = 0;

    btnExportCsv.disabled = true;
    btnExportSummaryCsv.disabled = true;
    btnExportJson.disabled = true;

    try {
      const activeGm = getGmInstance();
      const activeRunner = evaluator || createEvaluator({
        store,
        queue,
        gm: activeGm,
        getSettings
      });

      const outcome = await activeRunner.runSuite({
        suite,
        configs,
        reps,
        signal: abortController.signal,
        onProgress: ({ config, rep, caseId, done, total: totalCases, currentResult }) => {
          completedRuns = done;
          progressEl.value = done;
          benchCurrentEl.textContent = `${config} · rep ${rep} · ${caseId}`;

          updateLiveTableCell(caseId, config, currentResult);

          const elapsedSec = (Date.now() - t0) / 1000;
          const avgPerCase = elapsedSec / done;
          const remainingCases = totalCases - done;
          const remainingSec = Math.round(remainingCases * avgPerCase);

          benchEtaEl.textContent = remainingCases > 0 ? `ETA: ${remainingSec}s` : 'Finalizando...';
        }
      });

      currentResults = outcome.results;
      currentSummary = outcome.summary;
      currentMeta = outcome.meta;
      currentTraces = outcome.traces || [];

      renderSummaryTable(currentSummary);

      const totalElapsed = Math.round((Date.now() - t0) / 1000);
      benchCurrentEl.textContent = `Concluído: ${completedRuns}/${total} testes.`;
      benchEtaEl.textContent = `Tempo total: ${totalElapsed}s`;

      btnExportCsv.disabled = false;
      btnExportSummaryCsv.disabled = false;
      btnExportJson.disabled = false;

      bus?.emit('log:entry', {
        level: 'INFO',
        text: `[BENCHMARK] Avaliação concluída com sucesso (${completedRuns} execuções em ${totalElapsed}s).`,
        source: 'BENCHMARK',
        ts: Date.now()
      });
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        benchCurrentEl.textContent = `Benchmark abortado pelo usuário (${completedRuns}/${total}).`;
        benchEtaEl.textContent = 'Cancelado';
        bus?.emit('log:entry', {
          level: 'WARN',
          text: `[BENCHMARK] Execução abortada pelo operador na execução ${completedRuns}.`,
          source: 'BENCHMARK',
          ts: Date.now()
        });
      } else {
        benchCurrentEl.textContent = `Erro: ${err.message}`;
        benchEtaEl.textContent = 'Falha';
        bus?.emit('log:entry', {
          level: 'ERROR',
          text: `[BENCHMARK] Erro durante execução: ${err.message}`,
          source: 'BENCHMARK',
          ts: Date.now()
        });
      }
    } finally {
      abortController = null;
      setBenchmarkingState(false);
    }
  }

  // --- Abort Handler ---
  btnAbort?.addEventListener('click', () => {
    if (abortController) {
      abortController.abort();
    }
  });

  // --- Run Handler ---
  btnRun?.addEventListener('click', () => {
    handleRun();
  });

  function getTimestampString() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  // --- Export Handlers ---
  btnExportCsv?.addEventListener('click', () => {
    if (!currentResults.length) return;
    const model = currentMeta?.model || 'model';
    const filename = `benchmark_${model}_${getTimestampString()}.csv`;
    download(filename, toCsv(currentResults), 'text/csv;charset=utf-8;');
  });

  btnExportSummaryCsv?.addEventListener('click', () => {
    if (!currentSummary.length) return;
    const model = currentMeta?.model || 'model';
    const filename = `benchmark_summary_${model}_${getTimestampString()}.csv`;
    download(filename, summaryToCsv(currentSummary), 'text/csv;charset=utf-8;');
  });

  btnExportJson?.addEventListener('click', () => {
    if (!currentResults.length) return;
    const model = currentMeta?.model || 'model';
    const filename = `benchmark_${model}_${getTimestampString()}.json`;
    download(
      filename,
      toJson({
        meta: currentMeta,
        summary: currentSummary,
        results: currentResults,
        traces: currentTraces
      }),
      'application/json;charset=utf-8;'
    );
  });

  // --- Load JSON Handler ---
  btnLoadJson?.addEventListener('click', () => {
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  });

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.results || !data.summary) {
        alert('Formato de benchmark inválido. Arquivo deve conter { results, summary, meta }.');
        return;
      }

      currentResults = data.results;
      currentSummary = data.summary;
      currentMeta = data.meta || {};
      currentTraces = data.traces || [];

      renderLiveTableFromResults(currentResults);
      renderSummaryTable(currentSummary);

      benchCurrentEl.textContent = `Carregado: ${file.name}`;
      benchEtaEl.textContent = `Modelo: ${currentMeta.model || 'desconhecido'}`;
      progressEl.value = 100;
      progressEl.max = 100;

      btnExportCsv.disabled = false;
      btnExportSummaryCsv.disabled = false;
      btnExportJson.disabled = false;

      bus?.emit('log:entry', {
        level: 'INFO',
        text: `[BENCHMARK] Dados offline carregados: ${file.name} (${currentResults.length} casos).`,
        source: 'BENCHMARK',
        ts: Date.now()
      });
    } catch (err) {
      alert(`Falha ao ler arquivo JSON: ${err.message}`);
    }
  });

  return {
    abort: () => {
      if (abortController) abortController.abort();
    },
    isRunning: () => isRunning
  };
}
