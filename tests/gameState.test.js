import { describe, it, expect } from './runner.js';
import { createInitialState, executeCommand } from '../src/engine/gameState.js';

describe('Engine / GameState Reducer', () => {
  it('applies MOVE without mutating the input state', () => {
    const s0 = createInitialState();
    const res = executeCommand(s0, { type: 'MOVE', id: 'player', to: { x: 3, y: 2 } });
    expect(res.ok).toBe(true);
    expect(s0.entities.player.x).toBe(2); // s0 unchanged
    expect(res.state.entities.player.x).toBe(3); // new state updated
    expect(res.events.length).toBe(1);
    expect(res.events[0].type).toBe('move');
  });

  it('deals damage and automatically drops loot bag upon creature death', () => {
    let s = createInitialState();
    // goblin_1 has 8 HP and drops gold x5
    s.entities.player.x = 8;
    s.entities.player.y = 3; // adjacent to goblin_1 at (8,2)

    // First attack: 4 damage -> 4 HP left
    const r1 = executeCommand(s, { type: 'ATTACK', attacker: 'player', target: 'goblin_1' });
    expect(r1.ok).toBe(true);
    expect(r1.state.entities.goblin_1.hp).toBe(4);
    s = r1.state;

    // Second attack: 4 damage -> 0 HP (death!)
    const r2 = executeCommand(s, { type: 'ATTACK', attacker: 'player', target: 'goblin_1' });
    expect(r2.ok).toBe(true);
    expect(r2.state.entities.goblin_1).toBe(undefined); // removed!

    // Verify loot bag was created at (8,2) with the goblin's items
    const bag = r2.state.entities['bag_goblin_1'];
    expect(bag).toBeTruthy();
    expect(bag.x).toBe(8);
    expect(bag.y).toBe(2);
    expect(bag.items[0].id).toBe('gold');
    expect(bag.items[0].qty).toBe(5);
  });

  it('transfers items upon LOOT', () => {
    let s = createInitialState();
    s.entities.player.x = 10;
    s.entities.player.y = 9; // adjacent to chest_1 at (10,10)
    s.entities.chest_1.open = true;

    const r = executeCommand(s, { type: 'LOOT', actor: 'player', from: 'chest_1' });
    expect(r.ok).toBe(true);
    expect(r.state.entities.chest_1.items.length).toBe(0);
    expect(r.state.entities.player.items.length).toBe(2);
    expect(r.state.entities.player.items.find((i) => i.id === 'potion')).toBeTruthy();
  });

  it('triggers defeat when player HP reaches 0', () => {
    const s = createInitialState();
    const r = executeCommand(s, { type: 'DAMAGE', target: 'player', amount: 20 });
    expect(r.ok).toBe(true);
    expect(r.state.status).toBe('lost');
  });

  it('triggers victory when all enemies are eliminated', () => {
    let s = createInitialState();
    delete s.entities.goblin_1;
    delete s.entities.goblin_2;
    // Check status triggers on next command
    const r = executeCommand(s, { type: 'MOVE', id: 'player', to: { x: 3, y: 2 } });
    expect(r.ok).toBe(true);
    expect(r.state.status).toBe('won');
  });
});
