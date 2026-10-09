/**
 * Debug Log component: technical inspector for commands, raw LLM payloads,
 * validation errors, schema failures and real-time session metrics.
 */
export function createDebugLog({ container, bus, metrics }) {
  container.innerHTML = `
    <div class="debug-header">
      <div class="debug-title-group">
        <span class="debug-title">🛠 Console & Auditoria Técnica</span>
      </div>
      <div class="debug-actions">
        <button class="dbg-btn" id="dbg-clear-btn" title="Limpar console">Limpar</button>
      </div>
    </div>
    <div class="debug-metrics" id="dbg-metrics">
      <div class="metric-card"><span class="m-val" id="m-valid-rate">100%</span><span class="m-lbl">JSON Válido</span></div>
      <div class="metric-card"><span class="m-val" id="m-rejections">0%</span><span class="m-lbl">Rejeição Regras</span></div>
      <div class="metric-card"><span class="m-val" id="m-latency">0ms</span><span class="m-lbl">Latência Média</span></div>
      <div class="metric-card"><span class="m-val" id="m-applied">0</span><span class="m-lbl">Comandos Ok</span></div>
    </div>
    <div class="debug-filter-bar">
      <button class="dbg-filter active" data-filter="all">Todos</button>
      <button class="dbg-filter" data-filter="cmd">Comandos</button>
      <button class="dbg-filter" data-filter="llm">Payloads LLM</button>
      <button class="dbg-filter" data-filter="err">Erros / Rejeições</button>
    </div>
    <div class="debug-stream" id="dbg-stream"></div>
  `;

  const streamEl = container.querySelector('#dbg-stream');
  const clearBtn = container.querySelector('#dbg-clear-btn');
  const validRateEl = container.querySelector('#m-valid-rate');
  const rejectionsEl = container.querySelector('#m-rejections');
  const latencyEl = container.querySelector('#m-latency');
  const appliedEl = container.querySelector('#m-applied');
  const filterBtns = container.querySelectorAll('.dbg-filter');

  let currentFilter = 'all';

  function updateMetrics(snap) {
    validRateEl.textContent = snap.jsonValidRate;
    rejectionsEl.textContent = snap.rejectionRate;
    latencyEl.textContent = `${snap.avgLatencyMs}ms`;
    appliedEl.textContent = `${snap.commandsApplied} / ${snap.commandsApplied + snap.commandsRejectedRules + snap.commandsRejectedSchema}`;
  }

  function addLogItem({ tag, label, details, type = 'info', filterType = 'cmd' }) {
    const item = document.createElement('div');
    item.className = `debug-item ${type} filter-${filterType}`;
    item.dataset.filter = filterType;
    if (currentFilter !== 'all' && currentFilter !== filterType) {
      item.style.display = 'none';
    }

    const time = new Date().toLocaleTimeString();
    item.innerHTML = `
      <div class="dbg-item-header">
        <span class="dbg-tag tag-${tag.toLowerCase()}">${escapeHtml(tag)}</span>
        <span class="dbg-label">${escapeHtml(label)}</span>
        <span class="dbg-time">${time}</span>
      </div>
      ${details ? `<pre class="dbg-details">${escapeHtml(typeof details === 'string' ? details : JSON.stringify(details, null, 2))}</pre>` : ''}
    `;

    streamEl.appendChild(item);
    streamEl.scrollTop = streamEl.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  clearBtn.addEventListener('click', () => {
    streamEl.innerHTML = '';
  });

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      streamEl.querySelectorAll('.debug-item').forEach((item) => {
        if (currentFilter === 'all' || item.dataset.filter === currentFilter) {
          item.style.display = 'block';
        } else {
          item.style.display = 'none';
        }
      });
    });
  });

  // Listen to bus events
  bus.on('metrics:changed', updateMetrics);

  bus.on('command:applied', ({ cmd, source }) => {
    addLogItem({
      tag: 'APPLIED',
      label: `[${source}] ${cmd.type} aprovado e executado`,
      details: cmd,
      type: 'success',
      filterType: 'cmd',
    });
  });

  bus.on('command:rejected', ({ cmd, reason, source, stage }) => {
    addLogItem({
      tag: stage === 'schema' ? 'SCHEMA_ERR' : 'RULE_REJECT',
      label: `[${source}] ${cmd?.type || 'CMD'} REJEITADO (${stage}): ${reason}`,
      details: cmd,
      type: 'warning',
      filterType: 'err',
    });
  });

  bus.on('llm:request', ({ adapter, attempt, request }) => {
    addLogItem({
      tag: 'REQ',
      label: `Chamada LLM (${adapter}) - Tentativa #${attempt}`,
      details: { action: request.meta?.action, repair: request.meta?.repair, contentsCount: request.contents.length },
      type: 'info',
      filterType: 'llm',
    });
  });

  bus.on('llm:response', ({ adapter, attempt, text, latencyMs }) => {
    addLogItem({
      tag: 'RESP',
      label: `Resposta LLM (${adapter}) em ${latencyMs}ms (Tentativa #${attempt})`,
      details: text,
      type: 'info',
      filterType: 'llm',
    });
  });

  bus.on('llm:repaired', ({ attempt }) => {
    addLogItem({
      tag: 'REPAIRED',
      label: `Payload corrigido com sucesso pelo LLM na tentativa #${attempt}!`,
      type: 'success',
      filterType: 'llm',
    });
  });

  bus.on('payload:invalid', ({ errors, raw, source, stage }) => {
    addLogItem({
      tag: 'INVALID',
      label: `[${source}] Payload descartado no estágio "${stage}"`,
      details: { errors, raw },
      type: 'danger',
      filterType: 'err',
    });
  });

  bus.on('llm:error', ({ message, kind }) => {
    addLogItem({
      tag: 'ERROR',
      label: `Erro na camada LLM [${kind}]: ${message}`,
      type: 'danger',
      filterType: 'err',
    });
  });

  // Initial metric draw
  if (metrics) updateMetrics(metrics.snapshot());

  return { addLogItem };
}
