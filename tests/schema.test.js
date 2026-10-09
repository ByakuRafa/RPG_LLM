import { describe, it, expect } from './runner.js';
import { validatePayload, validateCommand, normalizePayload, MAX_COMMANDS } from '../src/core/schema.js';

describe('Core / Schema Validator', () => {
  it('accepts a fully valid payload with multiple commands', () => {
    const raw = {
      narrative: 'O goblin avança!',
      commands: [
        { type: 'MOVE', id: 'player', to: { x: 3, y: 3 } },
        { type: 'ATTACK', attacker: 'player', target: 'goblin_1' },
      ],
    };
    const res = validatePayload(raw);
    expect(res.ok).toBe(true);
    expect(res.payload.commands.length).toBe(2);
    expect(res.errors.length).toBe(0);
  });

  it('rejects missing or empty narrative', () => {
    const res1 = validatePayload({ narrative: '', commands: [] });
    expect(res1.ok).toBe(false);
    expect(res1.errors.length).toBeGreaterThan(0);

    const res2 = validatePayload({ commands: [] });
    expect(res2.ok).toBe(false);
  });

  it('rejects non-array commands', () => {
    const res = validatePayload({ narrative: 'Olá', commands: 'MOVE' });
    expect(res.ok).toBe(false);
  });

  it('normalizes case and array coordinates', () => {
    const raw = {
      narrative: 'Normalização teste',
      commands: [
        { type: 'move', id: 'player', to: [4, 5] },
        { type: 'loot', actor: 'player', from: 'chest_1', item: 'potion' },
      ],
    };
    const res = validatePayload(raw);
    expect(res.ok).toBe(true);
    expect(res.payload.commands[0].type).toBe('MOVE');
    expect(res.payload.commands[0].to).toEqual({ x: 4, y: 5 });
    expect(res.payload.commands[1].item).toEqual({ id: 'potion' });
  });

  it('enforces MOVE requiring exactly one of "to" or "target"', () => {
    // Both
    const both = validateCommand({ type: 'MOVE', id: 'player', to: { x: 1, y: 1 }, target: 'goblin_1' });
    expect(both.length).toBeGreaterThan(0);

    // Neither
    const neither = validateCommand({ type: 'MOVE', id: 'player' });
    expect(neither.length).toBeGreaterThan(0);

    // Valid "to"
    const validTo = validateCommand({ type: 'MOVE', id: 'player', to: { x: 1, y: 1 } });
    expect(validTo.length).toBe(0);

    // Valid "target"
    const validTarget = validateCommand({ type: 'MOVE', id: 'player', target: 'goblin_1' });
    expect(validTarget.length).toBe(0);
  });

  it('rejects unknown command types', () => {
    const errs = validateCommand({ type: 'TELEPORT', id: 'player' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('unknown command type');
  });

  it('caps commands at MAX_COMMANDS', () => {
    const excessive = Array.from({ length: MAX_COMMANDS + 2 }, (_, i) => ({
      type: 'DAMAGE',
      target: 'goblin_1',
      amount: 1,
    }));
    const res = validatePayload({ narrative: 'Muitos comandos', commands: excessive });
    expect(res.ok).toBe(false);
    expect(res.payload.commands.length).toBe(MAX_COMMANDS);
    expect(res.commandErrors.length).toBe(2);
  });
});
