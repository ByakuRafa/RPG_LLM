/**
 * PT-BR message templates and event describer.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */

export const MSG = Object.freeze({
  moveOk: (e, to, cost, mp) => `${e.name} moveu-se para (${to.x},${to.y}) gastando ${cost} MP (restam ${mp}).`,
  turnStart: (e, round) => `Rodada ${round} · Vez de: ${e.name}`,
  enemyPhase: (round) => `Rodada ${round} · Fase Inimiga`,
  abilityOk: (caster, ability, target) => `${caster.name} usou ${ability.label || ability.id} em ${target.name}.`,
  damage: (target, amount, hp) => `${target.name} sofreu ${amount} de dano (HP: ${hp}).`,
  endTurn: (e) => `${e.name} encerrou o turno.`,
  gameOverWon: () => 'Vitória! Todos os inimigos foram derrotados.',
  gameOverLost: () => 'Derrota! Todos os heróis caíram.'
});

export const REJECT = Object.freeze({
  GAME_OVER: () => 'O jogo já terminou.',
  UNKNOWN_ENTITY: (d) => `Entidade desconhecida: ${d?.id || d}.`,
  ENTITY_DEAD: (d) => `${d?.name || d?.id} está derrotado.`,
  NOT_YOUR_TURN: (d) => `Não é a vez de ${d?.name || d?.id || 'este personagem'}.`,
  OUT_OF_BOUNDS: () => 'Destino fora dos limites do mapa.',
  SAME_TILE: () => 'O personagem já está nesta posição.',
  TARGET_IS_WALL: () => 'Destino é uma parede.',
  TARGET_OCCUPIED: () => 'Destino está ocupado por outra entidade ou objeto.',
  NO_MP: (d) => `${d?.name || 'Personagem'} não tem MP suficiente.`,
  TOO_FAR: () => 'Destino muito distante para o movimento disponível.',
  UNREACHABLE: () => 'Destino inalcançável (bloqueado por obstáculos).',
  NO_AP: (d) => `${d?.name || 'Personagem'} não tem AP suficiente.`,
  ABILITY_NOT_OWNED: (d) => `Habilidade ${d?.abilityId} não pertence a ${d?.name || 'este personagem'}.`,
  UNKNOWN_TARGET: (d) => `Alvo desconhecido: ${d?.targetId || d}.`,
  UNKNOWN_TOOL: (d) => `Tool desconhecida: ${d?.name || d}.`,
  TOO_MANY_CALLS: () => 'Número excessivo de ações em um único lote.'
});

/**
 * Converts engine reducer events into formatted PT-BR log descriptions.
 * Single place for event-to-log mapping.
 *
 * @param {object} event
 * @param {object} state
 * @returns {{ level: string, text: string } | null}
 */
export function describeEvent(event, state) {
  if (!event || typeof event !== 'object') return null;

  switch (event.type) {
    case 'move': {
      const e = state?.entities?.[event.id] || { name: event.id, mp: 0 };
      return {
        level: 'SUCCESS',
        text: MSG.moveOk(e, event.to, event.cost, e.mp)
      };
    }

    case 'turn': {
      if (event.phase === 'HERO') {
        const e = state?.entities?.[event.activeId] || { name: event.activeId };
        return {
          level: 'TURN',
          text: MSG.turnStart(e, event.round)
        };
      } else {
        return {
          level: 'TURN',
          text: MSG.enemyPhase(event.round)
        };
      }
    }

    case 'damage': {
      const target = state?.entities?.[event.id] || { name: event.id };
      return {
        level: 'COMBAT',
        text: MSG.damage(target, event.amount, event.hp)
      };
    }

    case 'end_turn_requested': {
      const e = state?.entities?.[event.id] || { name: event.id };
      return {
        level: 'TURN',
        text: MSG.endTurn(e)
      };
    }

    case 'game_over': {
      return {
        level: 'SYSTEM',
        text: event.result === 'won' ? MSG.gameOverWon() : MSG.gameOverLost()
      };
    }

    case 'reset': {
      return {
        level: 'SYSTEM',
        text: 'Jogo reiniciado.'
      };
    }

    default:
      return null;
  }
}
