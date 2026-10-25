/**
 * Tools registry mapping tool calls to validators and reducers.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import { validateMove, validateUseAbilityBasic, validateEndTurn } from './rules.js';
import { applyMove, applyAbilityBasic, applyEndTurn } from './gameState.js';

export const TOOLS = Object.freeze({
  move_character: Object.freeze({
    validate: validateMove,
    apply: (s, a, r) => applyMove(s, a.character_id, { x: a.target_x, y: a.target_y }, r.cost)
  }),
  use_ability: Object.freeze({
    validate: validateUseAbilityBasic,
    apply: (s, a) => applyAbilityBasic(s, a)
  }),
  end_turn: Object.freeze({
    validate: validateEndTurn,
    apply: (s, a) => applyEndTurn(s, a)
  })
});
