import { describe, it, expect } from './runner.js';
import { createInitialState, createStore } from '../src/engine/gameState.js';
import { createActionQueue } from '../src/engine/actionQueue.js';
import { createEventBus } from '../src/core/eventBus.js';

describe('Engine / Action Queue', () => {
  it('executes commands in strict sequence and awaits animations', async () => {
    const bus = createEventBus();
    const store = createStore(createInitialState(), bus);

    const animationOrder = [];
    const fakeAnimator = {
      async play(events) {
        for (const ev of events) {
          animationOrder.push(ev.type);
          await new Promise((r) => setTimeout(r, 20)); // simulated short lerp
        }
      },
    };

    const queue = createActionQueue({ store, bus, animator: fakeAnimator, stepDelayMs: 5 });

    // Payload: move adjacent to door, then interact
    const payload = {
      narrative: 'Avanço e abro a porta.',
      commands: [
        { type: 'MOVE', id: 'player', target: 'door_1' },
        { type: 'INTERACT', actor: 'player', target: 'door_1' },
      ],
    };

    const res = await queue.enqueue(payload, { source: 'test' });
    expect(res.applied.length).toBe(2);
    expect(res.rejected.length).toBe(0);
    expect(animationOrder).toEqual(['move', 'open']);
    expect(store.get().entities.door_1.open).toBe(true);
  });

  it('drops illegal commands without aborting subsequent valid commands', async () => {
    const bus = createEventBus();
    const store = createStore(createInitialState(), bus);
    const queue = createActionQueue({ store, bus });

    const payload = {
      narrative: 'Comando inválido no meio.',
      commands: [
        { type: 'MOVE', id: 'player', to: { x: 3, y: 2 } }, // valid
        { type: 'MOVE', id: 'player', to: { x: 0, y: 0 } }, // invalid (wall)
        { type: 'MOVE', id: 'player', to: { x: 4, y: 2 } }, // valid
      ],
    };

    const res = await queue.enqueue(payload, { source: 'test' });
    expect(res.applied.length).toBe(2);
    expect(res.rejected.length).toBe(1);
    expect(res.rejected[0].reason).toContain('is a wall');
    expect(store.get().entities.player.x).toBe(4);
  });
});
