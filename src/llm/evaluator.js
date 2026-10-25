/**
 * Academic Evaluator & Benchmark Harness for LLM Game Master (Sprint 4).
 * Tasks 3.1, 3.2, 3.3: createEvaluator, scoreCase, summarize, percentile,
 * toCsv, summaryToCsv, toJson, download.
 *
 * Pure evaluation runner, metrics scorer, and dataset exporter.
 */
import { CONFIG } from '../core/config.js';
import { cloneState } from '../engine/gameState.js';
import { buildSnapshot, withActive } from '../core/fixtures.js';
import { computeReachable, manhattan } from '../engine/pathfinding.js';
import { ABILITIES } from '../engine/catalog.js';

/**
 * State-changing tools that affect game mechanics.
 * All tools except check_inventory change game state.
 */
export const STATE_CHANGING_TOOLS = Object.freeze(
  new Set(['move_character', 'use_ability', 'use_item', 'interact_object', 'end_turn'])
);

/**
 * Helper to compare two string arrays for exact equality.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
export function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Resolves and verifies target_xy_in matcher from game state snapshot.
 * Supports:
 * - 'attack_positions:<ability_id>:<target_id>'
 * - 'adjacent:<object_id_or_entity_id>'
 *
 * @param {string} expVal
 * @param {object} predArgs
 * @param {object} tc
 * @param {object} [meta]
 * @returns {boolean}
 */
export function checkTargetXyIn(expVal, predArgs, tc, meta = {}) {
  if (!predArgs || predArgs.target_x === undefined || predArgs.target_y === undefined) {
    return false;
  }
  const px = Number(predArgs.target_x);
  const py = Number(predArgs.target_y);
  if (isNaN(px) || isNaN(py)) return false;

  let state = meta?.state;
  if (!state && tc?.snapshot) {
    try {
      const seed = meta?.seed || tc.seed || CONFIG.DEFAULT_SEED;
      state = withActive(buildSnapshot(tc.snapshot, seed), tc.active_id);
    } catch {
      return false;
    }
  }
  if (!state) return false;

  const hero = state.entities?.[tc.active_id];
  const mp = hero?.mp ?? 4;
  const reach = computeReachable(state, tc.active_id, mp);

  if (expVal.startsWith('attack_positions:')) {
    const parts = expVal.split(':');
    const abilityId = parts[1];
    const targetId = parts[2];
    const target = state.entities?.[targetId];
    if (!target) return false;
    const ability = ABILITIES[abilityId];
    const maxRange = ability?.range ?? 1;

    for (const [k] of reach.entries()) {
      const [x, y] = k.split(',').map(Number);
      if (manhattan(x, y, target.position.x, target.position.y) <= maxRange) {
        if (x === px && y === py) return true;
      }
    }
    return false;
  }

  if (expVal.startsWith('adjacent:')) {
    const parts = expVal.split(':');
    const objId = parts[1];
    const obj = state.objects?.[objId] || state.entities?.[objId];
    if (!obj) return false;

    for (const [k] of reach.entries()) {
      const [x, y] = k.split(',').map(Number);
      if (manhattan(x, y, obj.position.x, obj.position.y) === 1) {
        if (x === px && y === py) return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * Scores an individual test case execution against expected criteria (Task 3.2).
 * Pure function.
 *
 * @param {object} tc Benchmark test case definition
 * @param {object} trace GameMaster execution trace
 * @param {object} [meta] Metadata { config, rep, seed, model, state }
 * @returns {object} CaseResult
 */
export function scoreCase(tc, trace = {}, meta = {}) {
  const config = meta.config || trace.config || 'B';
  const model = meta.model || trace.model || '';
  const caseId = tc.id;
  const category = tc.category;
  const rep = meta.rep ?? 1;

  const expectedSequences = tc.expected?.tool_sequences ?? [];
  const argsAlternatives = tc.expected?.args_alternatives ?? [];
  const shouldRefuse = Boolean(tc.expected?.should_refuse);

  const predicted = trace.parsed?.tool_calls?.map(c => c.name) ?? [];

  // 1. Tool Sequence Match (find all matching alternatives)
  const matchingIndices = [];
  for (let i = 0; i < expectedSequences.length; i++) {
    if (arraysEqual(expectedSequences[i], predicted)) {
      matchingIndices.push(i);
    }
  }
  const toolCorrect = matchingIndices.length > 0;

  // 2. Argument Precision
  let argMatched = 0;
  let argTotal = 0;
  let chosenAltIndex = -1;

  if (toolCorrect) {
    let highestRatio = -1;

    for (const altIdx of matchingIndices) {
      const expectedCalls = argsAlternatives[altIdx] ?? [];
      let curMatched = 0;
      let curTotal = 0;

      for (let c = 0; c < predicted.length; c++) {
        const expCall = expectedCalls[c] ?? {};
        const predCall = trace.parsed?.tool_calls?.[c];
        const predArgs = predCall?.arguments ?? {};

        for (const [k, expVal] of Object.entries(expCall)) {
          curTotal++;
          if (k === 'target_xy_in') {
            if (checkTargetXyIn(expVal, predArgs, tc, meta)) {
              curMatched++;
            }
          } else {
            if (predArgs[k] !== undefined && String(predArgs[k]) === String(expVal)) {
              curMatched++;
            }
          }
        }
      }

      const ratio = curTotal > 0 ? curMatched / curTotal : 1;
      if (ratio > highestRatio || chosenAltIndex === -1) {
        highestRatio = ratio;
        argMatched = curMatched;
        argTotal = curTotal;
        chosenAltIndex = altIdx;
      }
    }
  }

  // 3. Illegal Handling Evaluation
  const llmRefused = shouldRefuse && predicted.every(n => !STATE_CHANGING_TOOLS.has(n));
  const engineRejected = Boolean(trace.batchResult?.rejected);
  // Simplification documented: a legal partial move before a blocked illegal attack counts as an applied effect
  const illegalEffectApplied =
    shouldRefuse &&
    Boolean(trace.batchResult?.applied?.some(a => STATE_CHANGING_TOOLS.has(a.call?.name)));

  // 4. Schema, Latency & Error tracking
  const jsonValidFirstTry = Boolean(trace.jsonValidFirstTry);
  const repaired = Boolean(trace.repaired);
  const coercedArgs = Boolean(trace.coercedArgs);
  const latencyMs = Number(trace.latencyMs ?? 0);

  let error = null;
  if (trace.error) {
    error = typeof trace.error === 'string' ? trace.error : trace.error.message || trace.error.kind || JSON.stringify(trace.error);
  }

  const expectedTools =
    expectedSequences.length > 0
      ? expectedSequences.map(seq => (seq.length > 0 ? seq.join(';') : '(recusa)')).join(' || ')
      : '(recusa)';
  const predictedTools = predicted.length > 0 ? predicted.join(';') : '(recusa)';
  const narrative = trace.parsed?.narrative || '';

  return {
    config,
    caseId,
    category,
    rep,
    model,
    expectedTools,
    predictedTools,
    toolCorrect,
    argMatched,
    argTotal,
    llmRefused,
    engineRejected,
    illegalEffectApplied,
    jsonValidFirstTry,
    repaired,
    coercedArgs,
    latencyMs,
    error,
    narrative
  };
}

/**
 * Calculates a specific percentile (0-100 or 0-1) from a numeric array.
 * @param {number[]} values
 * @param {number} p Percentile (e.g. 50, 95 or 0.5, 0.95)
 * @returns {number}
 */
export function percentile(values, p) {
  if (!values || values.length === 0) return 0;
  const pct = p > 1 ? p / 100 : p;
  const sorted = [...values].filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const index = (sorted.length - 1) * pct;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

/**
 * Summarizes an array of CaseResults per config (Task 3.2).
 * Computes mean over repetitions and standard deviation of accuracy across repetitions.
 *
 * @param {object[]} results Array of CaseResult objects
 * @returns {object[]} Array of summary objects per config
 */
export function summarize(results = []) {
  if (!Array.isArray(results) || results.length === 0) {
    return [];
  }

  const configs = [...new Set(results.map(r => r.config))];
  const summaries = [];

  for (const config of configs) {
    const confResults = results.filter(r => r.config === config);
    const model = confResults.find(r => r.model)?.model || results[0]?.model || '';
    const uniqueCases = new Set(confResults.map(r => r.caseId)).size;
    const reps = Math.max(1, ...confResults.map(r => r.rep || 1));

    // 1. Legal cases (direct + ambiguous)
    const legalCases = confResults.filter(r => r.category === 'direct' || r.category === 'ambiguous');
    const toolSelectionAccuracy =
      legalCases.length > 0
        ? legalCases.filter(r => r.toolCorrect).length / legalCases.length
        : 0;

    // 2. Accuracy StdDev across repetitions
    const repAccuracies = [];
    for (let rep = 1; rep <= reps; rep++) {
      const repLegal = legalCases.filter(r => (r.rep || 1) === rep);
      if (repLegal.length > 0) {
        repAccuracies.push(repLegal.filter(r => r.toolCorrect).length / repLegal.length);
      }
    }

    let accuracyStdDevAcrossReps = 0;
    if (repAccuracies.length > 1) {
      const meanAcc = repAccuracies.reduce((a, b) => a + b, 0) / repAccuracies.length;
      const variance =
        repAccuracies.reduce((sum, a) => sum + Math.pow(a - meanAcc, 2), 0) /
        (repAccuracies.length - 1);
      accuracyStdDevAcrossReps = Number(Math.sqrt(variance).toFixed(4));
    }

    // 3. Argument precision over cases with toolCorrect === true
    const correctCases = confResults.filter(r => r.toolCorrect);
    const sumArgMatched = correctCases.reduce((s, r) => s + (r.argMatched || 0), 0);
    const sumArgTotal = correctCases.reduce((s, r) => s + (r.argTotal || 0), 0);
    const argumentPrecision =
      sumArgTotal > 0
        ? sumArgMatched / sumArgTotal
        : correctCases.length > 0
          ? 1
          : 0;

    // 4. Illegal cases handling
    const illegalCases = confResults.filter(r => r.category === 'illegal');
    const illegalTotal = illegalCases.length;
    let illegalHandlingRate = 1;
    let llmRefusalRate = 1;
    let engineCatchRate = 0;

    if (illegalTotal > 0) {
      illegalHandlingRate = illegalCases.filter(r => !r.illegalEffectApplied).length / illegalTotal;
      llmRefusalRate = illegalCases.filter(r => r.llmRefused).length / illegalTotal;
      engineCatchRate =
        illegalCases.filter(r => !r.llmRefused && !r.illegalEffectApplied).length / illegalTotal;
    }

    // 5. False rejection rate (legal cases rejected by engine)
    const falseRejectionRate =
      legalCases.length > 0
        ? legalCases.filter(r => r.engineRejected).length / legalCases.length
        : 0;

    // 6. JSON validity and repair rates
    const jsonValidFirstTryRate =
      confResults.length > 0
        ? confResults.filter(r => r.jsonValidFirstTry).length / confResults.length
        : 0;
    const repairRate =
      confResults.length > 0
        ? confResults.filter(r => r.repaired).length / confResults.length
        : 0;

    // 7. Latency percentiles
    const latencies = confResults
      .map(r => r.latencyMs)
      .filter(l => typeof l === 'number' && !isNaN(l));
    const meanLat =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;

    summaries.push({
      config,
      model,
      cases: uniqueCases,
      reps,
      toolSelectionAccuracy: Number(toolSelectionAccuracy.toFixed(4)),
      accuracyStdDevAcrossReps,
      argumentPrecision: Number(argumentPrecision.toFixed(4)),
      illegalHandlingRate: Number(illegalHandlingRate.toFixed(4)),
      llmRefusalRate: Number(llmRefusalRate.toFixed(4)),
      engineCatchRate: Number(engineCatchRate.toFixed(4)),
      falseRejectionRate: Number(falseRejectionRate.toFixed(4)),
      jsonValidFirstTryRate: Number(jsonValidFirstTryRate.toFixed(4)),
      repairRate: Number(repairRate.toFixed(4)),
      latencyMs: {
        mean: meanLat,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95)
      }
    });
  }

  return summaries;
}

/**
 * Escapes values for safe CSV formatting (handling quotes, commas, newlines).
 * @param {any} val
 * @returns {string}
 */
export function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Exports full case results to CSV (Task 3.3).
 * Header: config,case_id,category,rep,expected_tools,predicted_tools,tool_correct,arg_matched,arg_total,llm_refused,engine_rejected,illegal_effect_applied,json_valid_first_try,repaired,coerced_args,latency_ms,error
 *
 * @param {object[]} results
 * @returns {string}
 */
export function toCsv(results = []) {
  const header = [
    'config',
    'case_id',
    'category',
    'rep',
    'expected_tools',
    'predicted_tools',
    'tool_correct',
    'arg_matched',
    'arg_total',
    'llm_refused',
    'engine_rejected',
    'illegal_effect_applied',
    'json_valid_first_try',
    'repaired',
    'coerced_args',
    'latency_ms',
    'error'
  ].join(',');

  const rows = results.map(r =>
    [
      escapeCsv(r.config),
      escapeCsv(r.caseId),
      escapeCsv(r.category),
      r.rep ?? 1,
      escapeCsv(r.expectedTools),
      escapeCsv(r.predictedTools),
      Boolean(r.toolCorrect),
      r.argMatched ?? 0,
      r.argTotal ?? 0,
      Boolean(r.llmRefused),
      Boolean(r.engineRejected),
      Boolean(r.illegalEffectApplied),
      Boolean(r.jsonValidFirstTry),
      Boolean(r.repaired),
      Boolean(r.coercedArgs),
      r.latencyMs ?? 0,
      escapeCsv(r.error || '')
    ].join(',')
  );

  return [header, ...rows].join('\n');
}

/**
 * Exports summary metrics to CSV (Task 3.3).
 * @param {object[]} summaries
 * @returns {string}
 */
export function summaryToCsv(summaries = []) {
  const header = [
    'config',
    'model',
    'cases',
    'reps',
    'tool_selection_accuracy',
    'accuracy_std_dev',
    'argument_precision',
    'illegal_handling_rate',
    'llm_refusal_rate',
    'engine_catch_rate',
    'false_rejection_rate',
    'json_valid_first_try_rate',
    'repair_rate',
    'latency_mean_ms',
    'latency_p50_ms',
    'latency_p95_ms'
  ].join(',');

  const rows = summaries.map(s =>
    [
      escapeCsv(s.config),
      escapeCsv(s.model),
      s.cases,
      s.reps,
      s.toolSelectionAccuracy,
      s.accuracyStdDevAcrossReps,
      s.argumentPrecision,
      s.illegalHandlingRate,
      s.llmRefusalRate,
      s.engineCatchRate,
      s.falseRejectionRate,
      s.jsonValidFirstTryRate,
      s.repairRate,
      s.latencyMs?.mean ?? 0,
      s.latencyMs?.p50 ?? 0,
      s.latencyMs?.p95 ?? 0
    ].join(',')
  );

  return [header, ...rows].join('\n');
}

/**
 * Serializes evaluation data into structured JSON (Task 3.3).
 * @param {{ results: object[], summary: object[], meta: object, traces?: object[] }} data
 * @returns {string}
 */
export function toJson(data) {
  return JSON.stringify(data, null, 2);
}

/**
 * Downloads text content as a file via temporary anchor tag (Task 3.3).
 * @param {string} filename
 * @param {string} text
 * @param {string} [mime='text/csv;charset=utf-8;']
 */
export function download(filename, text, mime = 'text/csv;charset=utf-8;') {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Creates an evaluation runner for benchmarks (Task 3.1).
 * Preserves and restores game state before/after runs, disables queue animations during runs,
 * and executes cases deterministically.
 *
 * @param {object} options
 * @param {object} options.store GameState store
 * @param {object} options.queue ActionQueue
 * @param {object} options.gm GameMaster service
 * @param {Function} options.getSettings Function returning current settings
 * @returns {{ runSuite: Function }}
 */
export function createEvaluator({ store, queue, gm, getSettings = () => ({}) }) {
  const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new DOMException('aborted', 'AbortError'));
          },
          { once: true }
        );
      }
    });

  /**
   * Runs the benchmark test suite.
   *
   * @param {object} params
   * @param {object} params.suite Test suite JSON object
   * @param {string[]} [params.configs=['A', 'B']] Configs to evaluate
   * @param {number} [params.reps=1] Number of repetitions per case
   * @param {AbortSignal} [params.signal] AbortController signal
   * @param {Function} [params.onProgress] Progress callback
   * @returns {Promise<{ results: object[], summary: object[], meta: object, traces: object[] }>}
   */
  async function runSuite({
    suite,
    configs = ['A', 'B'],
    reps = 1,
    signal = null,
    onProgress = null
  } = {}) {
    if (!suite || !Array.isArray(suite.cases)) {
      throw new Error('Suite de benchmark inválida.');
    }

    const saved = cloneState(store.getState());
    const savedAnimator = queue?.getAnimator ? queue.getAnimator() : null;
    const savedStepDelay = queue?.getStepDelay ? queue.getStepDelay() : CONFIG.QUEUE_STEP_DELAY_MS;

    queue?.setAnimator?.(null);
    queue?.setStepDelay?.(0);

    const results = [];
    const traces = [];
    const total = configs.length * reps * suite.cases.length;

    try {
      for (const config of configs) {
        for (let rep = 1; rep <= reps; rep++) {
          for (const tc of suite.cases) {
            if (signal?.aborted) {
              throw new DOMException('aborted', 'AbortError');
            }

            // Restore known snapshot with active hero configured
            const snapshotState = buildSnapshot(tc.snapshot, suite.seed);
            const activeState = withActive(snapshotState, tc.active_id);
            store.reset(activeState);

            // Clean memory between cases to eliminate cross-case leakage
            gm.resetMemory();

            // Execute input with source: 'BENCHMARK' (forces temp=0, bypasses chat emissions)
            const trace = await gm.handleInput({
              text: tc.prompt_pt,
              tag: tc.ui_tag,
              source: 'BENCHMARK',
              configOverride: config,
              recordPrompt: true
            });

            const settings = typeof getSettings === 'function' ? getSettings() : {};
            const scored = scoreCase(tc, trace, {
              config,
              rep,
              seed: suite.seed,
              model: settings?.model || trace.model || 'gemini-3.8-flash'
            });

            results.push(scored);
            traces.push(trace);

            onProgress?.({
              config,
              rep,
              caseId: tc.id,
              done: results.length,
              total,
              currentResult: scored
            });

            const delay = settings?.benchmarkDelayMs ?? 4000;
            if (delay > 0) {
              await sleep(delay, signal);
            }
          }
        }
      }
    } finally {
      if (queue?.setAnimator) queue.setAnimator(savedAnimator);
      if (queue?.setStepDelay) queue.setStepDelay(savedStepDelay);
      store.reset(saved);
      gm.resetMemory();
    }

    const settings = typeof getSettings === 'function' ? getSettings() : {};
    return {
      results,
      summary: summarize(results),
      meta: {
        model: settings?.model || 'gemini-3.8-flash',
        seed: suite.seed,
        temperature: 0,
        date: new Date().toISOString()
      },
      traces
    };
  }

  return { runSuite };
}
