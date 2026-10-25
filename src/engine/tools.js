/**
 * Tools registry mapping tool calls to validators and reducers.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */
import {
  validateMove,
  validateUseAbility,
  validateUseItem,
  validateInteract,
  validateCheckInventory,
  validateEndTurn
} from './rules.js';
import {
  applyMove,
  applyAbility,
  applyUseItem,
  applyInteract,
  applyCheckInventory,
  applyEndTurn
} from './gameState.js';

export const TOOLS = Object.freeze({
  move_character: Object.freeze({
    validate: validateMove,
    apply: (s, a, r) => applyMove(s, a.character_id, { x: a.target_x, y: a.target_y }, r.cost)
  }),
  use_ability: Object.freeze({
    validate: validateUseAbility,
    apply: applyAbility
  }),
  use_item: Object.freeze({
    validate: validateUseItem,
    apply: applyUseItem
  }),
  interact_object: Object.freeze({
    validate: validateInteract,
    apply: applyInteract
  }),
  check_inventory: Object.freeze({
    validate: validateCheckInventory,
    apply: applyCheckInventory
  }),
  end_turn: Object.freeze({
    validate: validateEndTurn,
    apply: applyEndTurn
  })
});

export const TOOL_NAMES = Object.freeze(Object.keys(TOOLS));
