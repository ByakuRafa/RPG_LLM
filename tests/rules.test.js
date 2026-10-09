import { describe, it, expect } from './runner.js';
import { createInitialState } from '../src/engine/gameState.js';
import { checkCommand } from '../src/engine/rules.js';

describe('Engine / Rules Legality Checks', () => {
  it('allows valid player movement to a free floor tile', () => {
    const state = createInitialState();
    // player is at (2,2). (3,2) is a floor tile.
    const res = checkCommand(state, { type: 'MOVE', id: 'player', to: { x: 3, y: 2 } });
    expect(res.ok).toBe(true);
    expect(res.path.length).toBe(1);
    expect(res.path[0]).toEqual({ x: 3, y: 2 });
  });

  it('rejects moving into a wall', () => {
    const state = createInitialState();
    const res = checkCommand(state, { type: 'MOVE', id: 'player', to: { x: 0, y: 0 } });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('is a wall');
  });

  it('rejects moving out of map bounds', () => {
    const state = createInitialState();
    const res = checkCommand(state, { type: 'MOVE', id: 'player', to: { x: 25, y: 25 } });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('out of bounds');
  });

  it('rejects moving into an occupied tile', () => {
    const state = createInitialState();
    // goblin_1 is at (8, 2)
    const res = checkCommand(state, { type: 'MOVE', id: 'player', to: { x: 8, y: 2 } });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('occupied by "goblin_1"');
  });

  it('finds path when moving with "target"', () => {
    const state = createInitialState();
    // player at (2,2), door_1 is at (5,3)
    const res = checkCommand(state, { type: 'MOVE', id: 'player', target: 'door_1' });
    expect(res.ok).toBe(true);
    expect(res.path.length).toBeGreaterThan(0);
  });

  it('enforces adjacency for attacks', () => {
    const state = createInitialState();
    // player at (2,2), goblin_1 is at (8,2) -> not adjacent
    const nonAdj = checkCommand(state, { type: 'ATTACK', attacker: 'player', target: 'goblin_1' });
    expect(nonAdj.ok).toBe(false);
    expect(nonAdj.reason).toContain('not adjacent');

    // Teleport player adjacent to goblin_1 (7,2)
    state.entities.player.x = 7;
    state.entities.player.y = 2;
    const adj = checkCommand(state, { type: 'ATTACK', attacker: 'player', target: 'goblin_1' });
    expect(adj.ok).toBe(true);
    expect(adj.amount).toBe(state.entities.player.atk);
  });

  it('rejects looting a closed chest', () => {
    const state = createInitialState();
    state.entities.player.x = 9;
    state.entities.player.y = 10; // chest_1 is at (10,10), closed
    const res = checkCommand(state, { type: 'LOOT', actor: 'player', from: 'chest_1' });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('is closed');
  });

  it('allows looting an opened chest and validates item availability', () => {
    const state = createInitialState();
    state.entities.player.x = 9;
    state.entities.player.y = 10;
    state.entities.chest_1.open = true;

    // Loot valid item
    const valid = checkCommand(state, { type: 'LOOT', actor: 'player', from: 'chest_1', item: { id: 'potion', qty: 1 } });
    expect(valid.ok).toBe(true);

    // Loot non-existent item
    const invalid = checkCommand(state, { type: 'LOOT', actor: 'player', from: 'chest_1', item: { id: 'excalibur' } });
    expect(invalid.ok).toBe(false);
    expect(invalid.reason).toContain('not found');
  });

  it('forbids despawning the player', () => {
    const state = createInitialState();
    const res = checkCommand(state, { type: 'DESPAWN', id: 'player' });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('player cannot be despawned');
  });
});
