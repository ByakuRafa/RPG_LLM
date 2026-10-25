/**
 * Action Queue for sequential processing and validation of tool call batches.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { normalizeBatch, validateBatch } from '../core/schema.js';
import { describeEvent } from '../core/messages.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Creates an action queue that processes tool calls sequentially with validation,
 * halting on the first rejected action and optionally coordinating animations.
 *
 * @param {{
 *   store: object,
 *   bus?: object,
 *   tools: object,
 *   animator?: object|null,
 *   stepDelayMs?: number
 * }} options
 * @returns {{
 *   enqueue: (batch: object) => Promise<object>,
 *   isBusy: () => boolean,
 *   clear: () => void,
 *   setAnimator: (a: object|null) => void,
 *   setStepDelay: (ms: number) => void
 * }}
 */
export function createActionQueue({ store, bus, tools, animator = null, stepDelayMs = 0 }) {
  const jobs = [];
  let running = false;

  function log(level, text, source) {
    bus?.emit('log:entry', {
      level,
      text: `[${level}] ${text}`,
      source: source || 'SYSTEM',
      ts: Date.now()
    });
  }

  function logEvent(ev, state, source) {
    const desc = describeEvent(ev, state);
    if (desc) {
      bus?.emit('log:entry', {
        level: desc.level,
        text: `[${desc.level}] ${desc.text}`,
        source: source || 'SYSTEM',
        ts: Date.now()
      });
    }
  }

  function enqueue(batch) {
    return new Promise(resolve => {
      jobs.push({ batch, resolve });
      pump();
    });
  }

  async function pump() {
    if (running) return;
    running = true;
    bus?.emit('queue:busy', true);

    while (jobs.length) {
      const { batch, resolve } = jobs.shift();
      const r = await runJob(batch);
      bus?.emit('queue:batchDone', r);
      resolve(r);
    }

    running = false;
    bus?.emit('queue:busy', false);
  }

  async function runJob(batch) {
    const applied = [];
    const source = batch?.source || 'UNKNOWN';
    const normalized = normalizeBatch(batch);
    const v = validateBatch(normalized);

    if (!v.ok) {
      log('REJECTED', v.errors.join('; '), source);
      return {
        source,
        applied,
        rejected: null,
        skipped: [],
        schemaErrors: v.errors
      };
    }

    for (let i = 0; i < v.calls.length; i++) {
      const call = v.calls[i];
      const ctx = { source };
      const tool = tools?.[call.name];

      if (!tool) {
        const errorMsg = `Tool desconhecida: "${call.name}".`;
        log('REJECTED', errorMsg, source);
        return {
          source,
          applied,
          rejected: { call, index: i, result: { ok: false, code: 'UNKNOWN_TOOL', message: errorMsg } },
          skipped: v.calls.slice(i + 1),
          schemaErrors: []
        };
      }

      const res = tool.validate(store.getState(), call.arguments, ctx);
      if (!res.ok) {
        log('REJECTED', res.message, source);
        return {
          source,
          applied,
          rejected: { call, index: i, result: res },
          skipped: v.calls.slice(i + 1),
          schemaErrors: []
        };
      }

      const { state, events } = tool.apply(store.getState(), call.arguments, res.resolved);
      store.commit(state, events);

      if (Array.isArray(events)) {
        events.forEach(ev => logEvent(ev, state, source));
      }

      if (animator && typeof animator.play === 'function' && Array.isArray(events) && events.length > 0) {
        await animator.play(events);
      }

      if (stepDelayMs > 0 && i < v.calls.length - 1) {
        await sleep(stepDelayMs);
      }

      applied.push({ call, events: events || [] });
    }

    return {
      source,
      applied,
      rejected: null,
      skipped: [],
      schemaErrors: []
    };
  }

  return {
    enqueue,
    isBusy: () => running,
    clear: () => { jobs.length = 0; },
    setAnimator: a => { animator = a; },
    setStepDelay: ms => { stepDelayMs = ms; }
  };
}
