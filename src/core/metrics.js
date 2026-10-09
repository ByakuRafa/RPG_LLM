/**
 * Session metrics: JSON validity, repair, rejection rates and LLM latency.
 */
export function createMetrics(bus) {
  const m = {
    llmTurns: 0,
    llmRequests: 0,
    validFirstTry: 0,
    repaired: 0,
    failed: 0,
    errors: 0,
    commandsApplied: 0,
    commandsRejectedRules: 0,
    commandsRejectedSchema: 0,
    latencies: [],
  };
  let firstAttemptInvalid = false;
  const changed = () => bus.emit('metrics:changed', snapshot());

  bus.on('llm:request', ({ attempt }) => {
    m.llmRequests++;
    if (attempt === 1) {
      m.llmTurns++;
      firstAttemptInvalid = false;
    }
    changed();
  });
  bus.on('llm:response', ({ latencyMs }) => {
    if (typeof latencyMs === 'number') m.latencies.push(latencyMs);
    changed();
  });
  bus.on('llm:invalid', ({ attempt }) => {
    if (attempt === 1) firstAttemptInvalid = true;
  });
  bus.on('llm:turn', () => {
    if (!firstAttemptInvalid) m.validFirstTry++;
    changed();
  });
  bus.on('llm:repaired', () => {
    m.repaired++;
    changed();
  });
  bus.on('llm:failed', () => {
    m.failed++;
    changed();
  });
  bus.on('llm:error', () => {
    m.errors++;
    changed();
  });
  bus.on('command:applied', () => {
    m.commandsApplied++;
    changed();
  });
  bus.on('command:rejected', ({ stage }) => {
    if (stage === 'schema') m.commandsRejectedSchema++;
    else m.commandsRejectedRules++;
    changed();
  });

  function snapshot() {
    const totalCmds = m.commandsApplied + m.commandsRejectedRules + m.commandsRejectedSchema;
    const avg = m.latencies.length ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length) : 0;
    const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
    return {
      ...m,
      latencies: undefined,
      avgLatencyMs: avg,
      jsonValidRate: pct(m.validFirstTry, m.llmTurns),
      rejectionRate: pct(m.commandsRejectedRules + m.commandsRejectedSchema, totalCmds),
    };
  }

  return { snapshot };
}
