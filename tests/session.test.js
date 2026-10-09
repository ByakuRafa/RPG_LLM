import { describe, it, expect } from './runner.js';
import { createInitialState, createStore, hashState } from '../src/engine/gameState.js';
import { createEventBus } from '../src/core/eventBus.js';
import { createActionQueue } from '../src/engine/actionQueue.js';
import { createSessionRecorder, replaySession } from '../src/core/session.js';
import { submitRaw } from '../src/core/ingest.js';
import { SCRIPTED_SCENARIO } from '../src/core/fixtures.js';

describe('Core / Session Recorder & Replay Determinism', () => {
  it('guarantees deterministic state hashes when replaying a session', async () => {
    const bus = createEventBus();
    const store = createStore(createInitialState(), bus);
    const queue = createActionQueue({ store, bus, stepDelayMs: 0 });
    const session = createSessionRecorder({ bus, store });

    // Execute first 3 turns of the scripted scenario
    for (let i = 0; i < 3; i++) {
      await submitRaw(SCRIPTED_SCENARIO[i], { queue, bus, source: 'human_gm', animate: false });
    }

    const exportedLog = session.export();
    expect(exportedLog.entries.length).toBe(3);
    const originalHash = hashState(store.get());
    expect(exportedLog.finalStateHash).toBe(originalHash);

    // Reset state to turn 0
    store.set(createInitialState());
    expect(hashState(store.get())).not.toBe(originalHash);

    // Replay log
    const replayRes = await replaySession(exportedLog, { queue, bus, store, animate: false });
    expect(replayRes.match).toBe(true);
    expect(replayRes.hash).toBe(originalHash);
  });
});
