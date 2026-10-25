/**
 * PT-BR message templates and event describer.
 * Zero DOM, Zero Canvas, 100% pure JS logic.
 */

export const MSG = Object.freeze({
  moveOk: (e, to, cost, mp) => `${e?.name || e?.id} moveu-se para (${to.x},${to.y}) gastando ${cost} MP (restam ${mp}).`,
  turnStart: (e, round) => `Rodada ${round} · Vez de: ${e?.name || e?.id}`,
  enemyPhase: (round) => `Rodada ${round} · Fase Inimiga`,
  abilityOk: (caster, ability, target) => `${caster?.name || caster?.id} usou ${ability?.label || ability?.id} em ${target?.name || target?.id}.`,
  damage: (target, amount, hp) => `${target?.name || target?.id} sofreu ${amount} de dano (HP: ${hp}).`,
  heal: (target, amount, hp) => `${target?.name || target?.id} recuperou ${amount} de vida (HP: ${hp}).`,
  push: (target, from, to) => `${target?.name || target?.id} foi empurrado para (${to.x},${to.y}).`,
  pushBlocked: (target, reason) => `${target?.name || target?.id} não pôde ser empurrado (${reason === 'wall' ? 'parede no caminho' : reason === 'occupied' ? 'espaço ocupado' : 'limite do mapa'}).`,
  death: (target) => `${target?.name || target?.id} foi derrotado!`,
  unlocked: (obj, actor) => `${actor?.name || actor?.id} destrancou ${obj?.name || obj?.id || 'o objeto'}.`,
  chestOpened: (obj, actor, lootStr) => `${actor?.name || actor?.id} abriu ${obj?.name || obj?.id || 'o baú'}${lootStr ? ` e encontrou: ${lootStr}` : '.'}`,
  itemUsed: (actor, item, target) => `${actor?.name || actor?.id} usou ${item?.label || item?.id} em ${target?.name || target?.id}.`,
  inventory: (actor, itemsStr) => `Inventário da equipe [consultado por ${actor?.name || actor?.id}]: ${itemsStr || 'vazio'}.`,
  endTurn: (e) => `${e?.name || e?.id} encerrou o turno.`,
  gameOverWon: () => 'Vitória! Todos os inimigos foram derrotados.',
  gameOverLost: () => 'Derrota! Todos os heróis caíram.'
});

export const REJECT = Object.freeze({
  GAME_OVER: () => 'O jogo já terminou.',
  UNKNOWN_TOOL: (d) => `Tool desconhecida: "${d?.name || d}".`,
  UNKNOWN_ENTITY: (d) => `Entidade desconhecida: ${d?.id || d}.`,
  ENTITY_DEAD: (d) => `${d?.name || d?.id || 'Entidade'} está derrotada.`,
  NOT_YOUR_TURN: (d) => `Não é a vez de ${d?.name || d?.id || 'este personagem'}.`,
  WRONG_PHASE: (d) => `Ação não permitida na fase atual (${d?.phase || 'inválida'}).`,
  OUT_OF_BOUNDS: () => 'Destino fora dos limites do mapa.',
  SAME_TILE: () => 'O personagem já está nesta posição.',
  TARGET_IS_WALL: () => 'Destino é uma parede.',
  TARGET_OCCUPIED: () => 'Destino está ocupado por outra entidade ou objeto.',
  NO_MP: (d) => `${d?.name || 'Personagem'} não tem MP suficiente.`,
  TOO_FAR: () => 'Destino muito distante para o movimento disponível.',
  UNREACHABLE: () => 'Destino inalcançável (bloqueado por obstáculos).',
  NO_AP: (d) => `${d?.name || 'Personagem'} não tem AP suficiente.`,
  UNKNOWN_ABILITY: (d) => `Habilidade desconhecida: ${d?.abilityId || d}.`,
  ABILITY_NOT_OWNED: (d) => `Habilidade ${d?.abilityId || d} não pertence a ${d?.name || 'este personagem'}.`,
  UNKNOWN_TARGET: (d) => `Alvo desconhecido: ${d?.targetId || d}.`,
  TARGET_DEAD: (d) => `Alvo ${d?.name || d?.targetId || 'já'} está derrotado.`,
  INVALID_TARGET_TYPE: () => 'Tipo de alvo inválido para esta ação.',
  OUT_OF_RANGE: (d) => `Alvo fora de alcance (alcance máx: ${d?.range ?? '?'}, distância: ${d?.distance ?? '?'}).`,
  NOT_LOCKED: (d) => `O objeto ${d?.name || d?.objectId || ''} não está trancado.`,
  UNKNOWN_ITEM: (d) => `Item desconhecido: ${d?.itemId || d}.`,
  ITEM_NOT_IN_INVENTORY: (d) => `Item ${d?.itemId || d} não está no inventário.`,
  ITEM_NOT_USABLE: (d) => `Item ${d?.itemId || d} não pode ser usado diretamente.`,
  UNKNOWN_OBJECT: (d) => `Objeto desconhecido: ${d?.objectId || d}.`,
  NOT_ADJACENT: () => 'Personagem precisa estar adjacente ao objeto.',
  OBJECT_LOCKED: () => 'O objeto está trancado. Use a habilidade de arrombar primeiro.',
  ALREADY_OPENED: () => 'O objeto já foi aberto.',
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

    case 'heal': {
      const target = state?.entities?.[event.id] || { name: event.id };
      return {
        level: 'COMBAT',
        text: MSG.heal(target, event.amount, event.hp)
      };
    }

    case 'push': {
      const target = state?.entities?.[event.id] || { name: event.id };
      return {
        level: 'COMBAT',
        text: MSG.push(target, event.from, event.to)
      };
    }

    case 'push_blocked': {
      const target = state?.entities?.[event.id] || { name: event.id };
      return {
        level: 'INFO',
        text: MSG.pushBlocked(target, event.reason)
      };
    }

    case 'death': {
      const target = state?.entities?.[event.id] || { name: event.id };
      return {
        level: 'COMBAT',
        text: MSG.death(target)
      };
    }

    case 'unlocked': {
      const obj = state?.objects?.[event.objectId] || { name: event.objectId };
      const actor = state?.entities?.[event.byId] || { name: event.byId };
      return {
        level: 'SUCCESS',
        text: MSG.unlocked(obj, actor)
      };
    }

    case 'chest_opened': {
      const obj = state?.objects?.[event.objectId] || { name: event.objectId };
      const actor = state?.entities?.[event.byId] || { name: event.byId };
      const lootStr = Array.isArray(event.loot) && event.loot.length > 0
        ? event.loot.map(l => `${l.qty}x ${l.id === 'health_potion' ? 'Poção de Vida' : l.id === 'gold_coins' ? 'Moedas de Ouro' : l.id}`).join(', ')
        : '';
      return {
        level: 'SUCCESS',
        text: MSG.chestOpened(obj, actor, lootStr)
      };
    }

    case 'item_used': {
      const actor = state?.entities?.[event.byId] || { name: event.byId };
      const target = state?.entities?.[event.targetId] || { name: event.targetId };
      const itemLabel = event.itemId === 'health_potion' ? 'Poção de Vida' : event.itemId === 'gold_coins' ? 'Moedas de Ouro' : event.itemId;
      const item = { id: event.itemId, label: itemLabel };
      return {
        level: 'SUCCESS',
        text: MSG.itemUsed(actor, item, target)
      };
    }

    case 'inventory': {
      const actor = state?.entities?.[event.byId] || { name: event.byId };
      const itemsStr = Array.isArray(event.items) && event.items.length > 0
        ? event.items.map(it => `${it.qty}x ${it.id === 'health_potion' ? 'Poção de Vida' : it.id === 'gold_coins' ? 'Moedas de Ouro' : it.id}`).join(', ')
        : 'vazio';
      return {
        level: 'INFO',
        text: MSG.inventory(actor, itemsStr)
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
      const isWon = event.status === 'won' || event.result === 'won';
      return {
        level: 'SYSTEM',
        text: isWon ? MSG.gameOverWon() : MSG.gameOverLost()
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
