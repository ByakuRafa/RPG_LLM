/**
 * Test and GM panel fixtures for Sprint 1, 2, and 3.
 * Pure data structures.
 */

export const FIXTURES = Object.freeze({
  'LLM · mover+atacar': Object.freeze({
    narrative: 'Thorin avança com bravura pelo corredor e atinge o goblin com sua espada afiada.',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_warrior', target_x: 2, target_y: 8 })
      }),
      Object.freeze({
        name: 'use_ability',
        arguments: Object.freeze({ caster_id: 'hero_warrior', ability_id: 'slash', target_id: 'goblin_1' })
      })
    ])
  }),
  'LLM · andar 10 casas': Object.freeze({
    narrative: 'Thorin tenta correr 10 casas direto até o fim da masmorra.',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_warrior', target_x: 2, target_y: 1 })
      })
    ])
  }),
  'LLM · recusa': Object.freeze({
    narrative: 'Não é possível voar ou atravessar paredes de pedra sólida nesta masmorra.',
    tool_calls: Object.freeze([])
  }),
  'S1 · Mover Guerreiro 3 casas': Object.freeze({
    source: 'HUMAN_GM',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_warrior', target_x: 2, target_y: 7 })
      })
    ])
  }),
  'S1 · Mover para parede': Object.freeze({
    source: 'HUMAN_GM',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_warrior', target_x: 0, target_y: 10 })
      })
    ])
  }),
  'S1 · Fora da vez (Mago)': Object.freeze({
    source: 'HUMAN_GM',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_mage', target_x: 1, target_y: 9 })
      })
    ])
  }),
  'S1 · Mover + Encerrar': Object.freeze({
    source: 'HUMAN_GM',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'move_character',
        arguments: Object.freeze({ character_id: 'hero_warrior', target_x: 2, target_y: 8 })
      }),
      Object.freeze({
        name: 'end_turn',
        arguments: Object.freeze({ character_id: 'hero_warrior' })
      })
    ])
  }),
  'S1 · Tool desconhecida': Object.freeze({
    source: 'HUMAN_GM',
    tool_calls: Object.freeze([
      Object.freeze({
        name: 'teleport',
        arguments: Object.freeze({})
      })
    ])
  })
});
