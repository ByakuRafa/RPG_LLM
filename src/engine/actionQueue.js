/**
 * Action Queue: executes payloads strictly one command at a time.
 * For each command: rules check → reducer → store update → await animation.
 * The next command never starts before the previous animation resolves, so a
 * MOVE → ATTACK → LOOT chain always plays in order.
 *
 * The animator is injected ({ play(events) => Promise }) so the queue has no
 * knowledge of Canvas; tests pass a fake animator or none at all.
 */
import { executeCommand } from './gameState.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createActionQueue({ store, bus, animator = null, stepDelayMs = 0 }) {
  const jobs = [];
  let running = false;

  function enqueue(payload, opts = {}) {
    return new Promise((resolve) => {
      jobs.push({ payload, opts, resolve });
      bus?.emit('queue:size', { size: jobs.length + (running ? 1 : 0) });
      pump();
    });
  }

  async function pump() {
    if (running) return;
    running = true;
    bus?.emit('queue:busy', true);
    while (jobs.length) {
      const job = jobs.shift();
      let result;
      try {
        result = await runJob(job);
      } catch (err) {
        console.error('[actionQueue] job crashed', err);
        result = { applied: [], rejected: [], source: job.opts.source, error: String(err) };
      }
      job.resolve(result);
    }
    running = false;
    bus?.emit('queue:busy', false);
    bus?.emit('queue:idle');
  }

  async function runJob({ payload, opts }) {
    const source = opts.source ?? 'unknown';
    const animate = opts.animate !== false;
    const commands = payload.commands ?? [];
    const applied = [];
    const rejected = [];

    bus?.emit('job:start', { payload, source, meta: opts.meta });
    if (payload.narrative) bus?.emit('narrative', { text: payload.narrative, source });

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      bus?.emit('queue:step', { index: i, total: commands.length, cmd, source });
      const res = executeCommand(store.get(), cmd);
      if (!res.ok) {
        rejected.push({ cmd, reason: res.reason });
        bus?.emit('command:rejected', { cmd, reason: res.reason, source, stage: 'rules' });
        continue;
      }
      store.set(res.state, { cmd, events: res.events, source });
      applied.push(cmd);
      bus?.emit('command:applied', { cmd, events: res.events, source });
      if (animate && animator) await animator.play(res.events);
      if (animate && stepDelayMs) await sleep(stepDelayMs);
    }

    const s = store.get();
    store.set({ ...s, turn: s.turn + 1 }, { source, turnEnd: true });

    const result = { applied, rejected, source };
    bus?.emit('job:end', result);
    if (s.status !== 'playing') bus?.emit('game:over', { status: s.status });
    return result;
  }

  return {
    enqueue,
    get busy() {
      return running;
    },
    get pending() {
      return jobs.length;
    },
  };
}
