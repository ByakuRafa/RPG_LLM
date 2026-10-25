export const CONFIG = Object.freeze({
  GRID_W: 12,
  GRID_H: 12,
  TILE_SIZE: 64,                 // canvas = 768 x 768
  DEFAULT_SEED: 'IA2_DUNGEON_01',
  MOVE_ANIM_MS: 250,
  HIT_FLASH_MS: 300,
  QUEUE_STEP_DELAY_MS: 250,      // pause between tool calls of one batch
  MOVEMENT_MODE: 'BFS',          // 'BFS' | 'MANHATTAN'
  MAX_TOOL_CALLS: 4,
  LOG_MAX_ENTRIES: 300,
  ENEMY_AI_MODE: 'HEURISTIC'     // 'HEURISTIC' | 'LLM'
});

export const TILE = Object.freeze({ FLOOR: 0, WALL: 1 });
export const PHASE = Object.freeze({ HERO: 'HERO', ENEMY: 'ENEMY', GAME_OVER: 'GAME_OVER' });
export const ENEMY_PHASE_ID = 'ENEMY_PHASE';
export const TURN_ORDER = Object.freeze(['hero_warrior', 'hero_mage', 'hero_rogue', ENEMY_PHASE_ID]);
