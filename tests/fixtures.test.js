import { describe, it, expect, assert } from './runner.js';
import { SNAPSHOTS, buildSnapshot, patch, assertValidPositions, withActive } from '../src/core/fixtures.js';
import { TOOLS } from '../src/engine/tools.js';
import { computeReachable, manhattan } from '../src/engine/pathfinding.js';

describe('Sprint 4 Step 10: Benchmark Snapshots & Position Validation', () => {
  it('patch correctly applies top-level and nested dotted paths on a clone', () => {
    const s0 = buildSnapshot('default');
    const patched = patch(s0, {
      'entities.goblin_1.position': { x: 3, y: 9 },
      'activeId': 'hero_mage',
      'turnIndex': 1
    });

    // Original must remain untouched
    expect(s0.entities.goblin_1.position.x).toBe(9);
    expect(s0.entities.goblin_1.position.y).toBe(2);
    expect(s0.activeId).toBe('hero_warrior');

    // Patched must have new values
    expect(patched.entities.goblin_1.position.x).toBe(3);
    expect(patched.entities.goblin_1.position.y).toBe(9);
    expect(patched.activeId).toBe('hero_mage');
    expect(patched.turnIndex).toBe(1);
  });

  it('assertValidPositions passes on valid default and named snapshots', () => {
    for (const name of Object.keys(SNAPSHOTS)) {
      const snap = buildSnapshot(name);
      expect(assertValidPositions(snap)).toBe(true);
    }
  });

  it('assertValidPositions throws when an entity is positioned on a wall', () => {
    const s0 = buildSnapshot('default');
    const bad = patch(s0, { 'entities.hero_warrior.position': { x: 0, y: 0 } });
    let threw = false;
    try {
      assertValidPositions(bad);
    } catch (e) {
      threw = true;
      assert(e.message.includes('parede'));
    }
    expect(threw).toBe(true);
  });

  it('assertValidPositions throws when an entity is out of map bounds', () => {
    const s0 = buildSnapshot('default');
    const bad = patch(s0, { 'entities.hero_warrior.position': { x: 15, y: 15 } });
    let threw = false;
    try {
      assertValidPositions(bad);
    } catch (e) {
      threw = true;
      assert(e.message.includes('limites'));
    }
    expect(threw).toBe(true);
  });

  it('assertValidPositions throws when two entities collide on the same tile', () => {
    const s0 = buildSnapshot('default');
    // Thorin moves to Lyra's position (1, 10)
    const bad = patch(s0, { 'entities.hero_warrior.position': { x: 1, y: 10 } });
    let threw = false;
    try {
      assertValidPositions(bad);
    } catch (e) {
      threw = true;
      assert(e.message.includes('Colisão'));
    }
    expect(threw).toBe(true);
  });

  it('assertValidPositions throws when an entity collides with a blocking object', () => {
    const s0 = buildSnapshot('default');
    // Thorin moves to chest_1 position (2, 7)
    const bad = patch(s0, { 'entities.hero_warrior.position': { x: 2, y: 7 } });
    let threw = false;
    try {
      assertValidPositions(bad);
    } catch (e) {
      threw = true;
      assert(e.message.includes('Colisão'));
    }
    expect(threw).toBe(true);
  });

  it('buildSnapshot builds all 5 required named snapshots with correct properties', () => {
    const snapNames = ['default', 'warrior_near_goblin', 'mage_wounded', 'rogue_next_to_chest2', 'warrior_no_ap'];
    for (const name of snapNames) {
      expect(SNAPSHOTS[name] !== undefined).toBe(true);
    }

    const sDef = buildSnapshot('default');
    expect(sDef.entities.hero_warrior.position.x).toBe(2);
    expect(sDef.entities.hero_warrior.position.y).toBe(10);

    const sNear = buildSnapshot('warrior_near_goblin');
    expect(sNear.entities.goblin_1.position.x).toBe(3);
    expect(sNear.entities.goblin_1.position.y).toBe(9);

    const sMage = buildSnapshot('mage_wounded');
    expect(sMage.entities.hero_mage.hp).toBe(6);
    expect(sMage.activeId).toBe('hero_mage');
    expect(sMage.turnIndex).toBe(1);

    const sRogue = buildSnapshot('rogue_next_to_chest2');
    expect(sRogue.entities.hero_rogue.position.x).toBe(3);
    expect(sRogue.entities.hero_rogue.position.y).toBe(3);
    expect(sRogue.activeId).toBe('hero_rogue');
    expect(sRogue.turnIndex).toBe(2);

    const sNoAp = buildSnapshot('warrior_no_ap');
    expect(sNoAp.entities.hero_warrior.ap).toBe(0);
  });

  it('buildSnapshot throws on unknown snapshot name', () => {
    let threw = false;
    try {
      buildSnapshot('non_existent_snapshot');
    } catch (e) {
      threw = true;
      assert(e.message.includes('Snapshot desconhecido'));
    }
    expect(threw).toBe(true);
  });

  it('withActive sets phase, activeId, turnIndex, and preserves overridden AP', () => {
    const sNoAp = buildSnapshot('warrior_no_ap');
    const activated = withActive(sNoAp, 'hero_warrior');
    expect(activated.phase).toBe('HERO');
    expect(activated.activeId).toBe('hero_warrior');
    expect(activated.turnIndex).toBe(0);
    expect(activated.entities.hero_warrior.ap).toBe(0); // preserved AP=0

    const sMage = withActive(buildSnapshot('default'), 'hero_mage');
    expect(sMage.activeId).toBe('hero_mage');
    expect(sMage.turnIndex).toBe(1);
    expect(sMage.entities.hero_mage.ap).toBe(1);
  });
});

describe('Sprint 4 Step 10: 30-Case Benchmark Dataset (tests/testSuite.json)', () => {
  it('loads testSuite.json and validates version, seed, and case distribution', async () => {
    const res = await fetch('/tests/testSuite.json');
    expect(res.ok).toBe(true);
    const suite = await res.json();

    expect(suite.version).toBe(1);
    expect(suite.seed).toBe('IA2_DUNGEON_01');
    expect(suite.cases.length).toBe(30);

    const counts = { direct: 0, ambiguous: 0, illegal: 0 };
    for (const c of suite.cases) {
      expect(counts[c.category] !== undefined).toBe(true);
      counts[c.category]++;
      expect(SNAPSHOTS[c.snapshot] !== undefined).toBe(true);
      expect(typeof c.prompt_pt).toBe('string');
      expect(c.prompt_pt.length > 5).toBe(true);
    }

    expect(counts.direct).toBe(10);
    expect(counts.ambiguous).toBe(10);
    expect(counts.illegal).toBe(10);
  });

  it('validates that every illegal case specifies should_refuse: true and empty tool sequence', async () => {
    const res = await fetch('/tests/testSuite.json');
    const suite = await res.json();
    const illegalCases = suite.cases.filter(c => c.category === 'illegal');

    expect(illegalCases.length).toBe(10);
    for (const c of illegalCases) {
      expect(c.expected.should_refuse).toBe(true);
      expect(c.expected.tool_sequences.length).toBe(1);
      expect(c.expected.tool_sequences[0].length).toBe(0);
      expect(c.expected.args_alternatives.length).toBe(1);
      expect(c.expected.args_alternatives[0].length).toBe(0);
    }
  });

  it('validates that an oracle fake LLM satisfies 100% of direct and ambiguous cases', async () => {
    const res = await fetch('/tests/testSuite.json');
    const suite = await res.json();
    const legalCases = suite.cases.filter(c => c.category !== 'illegal');

    expect(legalCases.length).toBe(20);

    for (const tc of legalCases) {
      expect(tc.expected.should_refuse).toBe(false);
      const snap = withActive(buildSnapshot(tc.snapshot, suite.seed), tc.active_id);
      let state = structuredClone(snap);

      const tools = tc.expected.tool_sequences[0];
      const argsList = tc.expected.args_alternatives[0];
      expect(tools.length > 0).toBe(true);
      expect(tools.length).toBe(argsList.length);

      for (let i = 0; i < tools.length; i++) {
        const toolName = tools[i];
        const argObj = { ...argsList[i] };

        // Resolve target_xy_in matcher if present
        if (argObj.target_xy_in) {
          if (argObj.target_xy_in.startsWith('attack_positions:')) {
            const [, abilityId, targetId] = argObj.target_xy_in.split(':');
            const target = state.entities[targetId];
            const reach = computeReachable(state, tc.active_id, state.entities[tc.active_id].mp);
            let found = null;
            for (const [k] of reach.entries()) {
              const [x, y] = k.split(',').map(Number);
              if (manhattan(x, y, target.position.x, target.position.y) === 1) {
                found = { x, y };
                break;
              }
            }
            assert(found !== null, `${tc.id}: No reachable attack tile for target_xy_in: ${argObj.target_xy_in}`);
            argObj.target_x = found.x;
            argObj.target_y = found.y;
            delete argObj.target_xy_in;
          } else if (argObj.target_xy_in.startsWith('adjacent:')) {
            const [, objId] = argObj.target_xy_in.split(':');
            const obj = state.objects[objId] || state.entities[objId];
            const reach = computeReachable(state, tc.active_id, state.entities[tc.active_id].mp);
            let found = null;
            for (const [k] of reach.entries()) {
              const [x, y] = k.split(',').map(Number);
              if (manhattan(x, y, obj.position.x, obj.position.y) === 1) {
                found = { x, y };
                break;
              }
            }
            assert(found !== null, `${tc.id}: No reachable tile adjacent to ${objId}`);
            argObj.target_x = found.x;
            argObj.target_y = found.y;
            delete argObj.target_xy_in;
          }
        }

        const toolDef = TOOLS[toolName];
        assert(toolDef !== undefined, `Unknown tool ${toolName}`);
        const check = toolDef.validate(state, argObj);
        assert(check.ok, `${tc.id}: Tool ${toolName} failed engine validation: ${check.code} - ${check.reason}`);

        // Update state using tool's apply reducer
        const res = toolDef.apply(state, argObj, check);
        state = res.state || res;
      }
    }
  });
});
