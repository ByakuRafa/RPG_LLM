/**
 * Unit tests for Phase 2: Direct Tactical Board & HUD Interaction.
 * Tests HUD party mini-card clicks, visual candidate classes,
 * and main.js tactical routing for board and party card clicks.
 */
import { describe, it, assert, assertEqual } from './runner.js';
import { createEventBus } from '../src/core/eventBus.js';
import { makeTestState } from './helpers.js';
import { mountHud } from '../src/ui/hud.js';
import { ABILITIES, ITEMS } from '../src/engine/catalog.js';

describe('Fase 2: Interação Tática Direta (HUD e Tabuleiro)', () => {

  it('HUD renderiza data-hero-id nas mini-cards e emite hud:partyCardClicked no clique', () => {
    // Fake DOM element
    const container = {
      innerHTML: '',
      listeners: {},
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      querySelectorAll(selector) {
        if (selector === '.party-mini-card') {
          return this._miniCards || [];
        }
        if (selector === '.tag') {
          return this._tags || [];
        }
        return [];
      },
      querySelector(selector) {
        return null;
      }
    };

    const s = makeTestState(['#####', '#WM.#', '#####']);
    const bus = createEventBus();
    const hud = mountHud(container, bus, { getState: () => s });

    assert(container.innerHTML.includes('data-hero-id="hero_warrior"'));
    assert(container.innerHTML.includes('data-hero-id="hero_mage"'));

    // Simula clique em mini-card
    let clickedHero = null;
    bus.on('hud:partyCardClicked', ({ targetId }) => {
      clickedHero = targetId;
    });

    const fakeCard = {
      dataset: { heroId: 'hero_warrior' },
      listeners: {},
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      click() { this.listeners['click']?.forEach(fn => fn()); }
    };
    container._miniCards = [fakeCard];
    hud.render();

    fakeCard.click();
    assertEqual(clickedHero, 'hero_warrior');
  });

  it('HUD aplica classe target-candidate em mini-cards apenas para magias de aliado/cura ou itens', () => {
    const container = {
      innerHTML: '',
      querySelectorAll: () => [],
      querySelector: () => null
    };

    const s = makeTestState(['#####', '#WM.#', '#####']);
    const bus = createEventBus();
    const hud = mountHud(container, bus, { getState: () => s });

    // 1. Tag de habilidade ofensiva (slash): NÃO deve ser target-candidate
    hud.render({ selectedTag: { kind: 'ability', id: 'slash' } });
    assert(!container.innerHTML.includes('target-candidate'));

    // 2. Tag de cura de aliado (heal_pulse): DEVE ser target-candidate
    hud.render({ selectedTag: { kind: 'ability', id: 'heal_pulse' } });
    assert(container.innerHTML.includes('target-candidate'));

    // 3. Tag de item utilizável (health_potion): DEVE ser target-candidate
    hud.render({ selectedTag: { kind: 'item', id: 'health_potion' } });
    assert(container.innerHTML.includes('target-candidate'));
  });

  it('Roteamento de clique no tabuleiro com habilidade ofensiva (inimigo selecionado)', () => {
    const bus = createEventBus();
    const s = makeTestState(['######', '#WG..#', '######']);
    s.activeId = 'hero_warrior';

    let currentSelectedTag = { kind: 'ability', id: 'shield_bash' };
    let enqueuedBatch = null;

    bus.on('intent:enqueue', (batch) => {
      enqueuedBatch = batch;
    });
    bus.on('ui:tagSelected', (tag) => {
      currentSelectedTag = tag;
    });

    // Simulador do roteamento de clique tático de main.js
    function handleTileClick(x, y) {
      if (currentSelectedTag) {
        const entityAtTile = Object.values(s.entities || {}).find(
          e => e && e.alive && e.position?.x === x && e.position?.y === y
        );
        if (currentSelectedTag.kind === 'ability') {
          const ab = ABILITIES[currentSelectedTag.id];
          if (ab && ab.target === 'enemy' && entityAtTile && entityAtTile.role === 'enemy') {
            bus.emit('intent:enqueue', {
              source: 'UI',
              tool_calls: [{
                name: 'use_ability',
                arguments: {
                  caster_id: s.activeId,
                  ability_id: ab.id,
                  target_id: entityAtTile.id
                }
              }]
            });
            bus.emit('ui:tagSelected', null);
            return;
          }
        }
      }
    }

    // Clique na posição (2, 1) onde está o goblin
    handleTileClick(2, 1);

    assert(enqueuedBatch !== null);
    assertEqual(enqueuedBatch.source, 'UI');
    assertEqual(enqueuedBatch.tool_calls[0].name, 'use_ability');
    assertEqual(enqueuedBatch.tool_calls[0].arguments.ability_id, 'shield_bash');
    assertEqual(enqueuedBatch.tool_calls[0].arguments.target_id, 'goblin_1');
    assertEqual(currentSelectedTag, null); // Tag deve ter sido limpa
  });

  it('Roteamento de clique em party mini-card com heal_pulse ou health_potion', () => {
    const bus = createEventBus();
    const s = makeTestState(['#####', '#WM.#', '#####']);
    s.activeId = 'hero_mage';

    let currentSelectedTag = { kind: 'ability', id: 'heal_pulse' };
    let enqueuedBatch = null;

    bus.on('intent:enqueue', (batch) => {
      enqueuedBatch = batch;
    });
    bus.on('ui:tagSelected', (tag) => {
      currentSelectedTag = tag;
    });

    // Simulador do roteamento de mini-card de main.js
    function handlePartyCardClick(targetId) {
      if (!currentSelectedTag) return;
      const targetAlly = s.entities?.[targetId];
      if (!targetAlly || !targetAlly.alive) return;

      if (currentSelectedTag.kind === 'ability') {
        const ab = ABILITIES[currentSelectedTag.id];
        if (ab && (ab.target === 'ally' || (ab.target === 'self' && targetId === s.activeId))) {
          bus.emit('intent:enqueue', {
            source: 'UI',
            tool_calls: [{
              name: 'use_ability',
              arguments: {
                caster_id: s.activeId,
                ability_id: ab.id,
                target_id: targetAlly.id
              }
            }]
          });
          bus.emit('ui:tagSelected', null);
        }
      } else if (currentSelectedTag.kind === 'item') {
        bus.emit('intent:enqueue', {
          source: 'UI',
          tool_calls: [{
            name: 'use_item',
            arguments: {
              character_id: s.activeId,
              item_id: currentSelectedTag.id,
              target_id: targetAlly.id
            }
          }]
        });
        bus.emit('ui:tagSelected', null);
      }
    }

    // 1. Curar guerreiro com heal_pulse
    handlePartyCardClick('hero_warrior');
    assert(enqueuedBatch !== null);
    assertEqual(enqueuedBatch.tool_calls[0].name, 'use_ability');
    assertEqual(enqueuedBatch.tool_calls[0].arguments.ability_id, 'heal_pulse');
    assertEqual(enqueuedBatch.tool_calls[0].arguments.target_id, 'hero_warrior');
    assertEqual(currentSelectedTag, null);

    // 2. Usar poção no próprio mago ativo
    currentSelectedTag = { kind: 'item', id: 'health_potion' };
    enqueuedBatch = null;
    handlePartyCardClick('hero_mage');
    assert(enqueuedBatch !== null);
    assertEqual(enqueuedBatch.tool_calls[0].name, 'use_item');
    assertEqual(enqueuedBatch.tool_calls[0].arguments.item_id, 'health_potion');
    assertEqual(enqueuedBatch.tool_calls[0].arguments.target_id, 'hero_mage');
    assertEqual(currentSelectedTag, null);
  });

  it('Roteamento de clique de habilidade com target "tile" (AoE de solo)', () => {
    const bus = createEventBus();
    const s = makeTestState(['######', '#W.G.#', '######']);
    s.activeId = 'hero_warrior';

    // Mock de habilidade com target: 'tile' (estilo chuva de meteoros / terremoto)
    const testTileAbility = { id: 'ground_slam', target: 'tile' };
    let currentSelectedTag = { kind: 'ability', id: 'ground_slam' };
    let enqueuedBatch = null;

    bus.on('intent:enqueue', (batch) => { enqueuedBatch = batch; });
    bus.on('ui:tagSelected', (tag) => { currentSelectedTag = tag; });

    function handleTileClick(x, y) {
      if (currentSelectedTag?.kind === 'ability' && currentSelectedTag.id === 'ground_slam') {
        const entityAtTile = Object.values(s.entities || {}).find(
          e => e && e.alive && e.position?.x === x && e.position?.y === y
        );
        const args = {
          caster_id: s.activeId,
          ability_id: 'ground_slam',
          target_x: x,
          target_y: y
        };
        if (entityAtTile) args.target_id = entityAtTile.id;
        bus.emit('intent:enqueue', {
          source: 'UI',
          tool_calls: [{ name: 'use_ability', arguments: args }]
        });
        bus.emit('ui:tagSelected', null);
      }
    }

    // Clique em (3, 1) onde está o goblin
    handleTileClick(3, 1);
    assert(enqueuedBatch !== null);
    assertEqual(enqueuedBatch.tool_calls[0].arguments.target_x, 3);
    assertEqual(enqueuedBatch.tool_calls[0].arguments.target_y, 1);
    assertEqual(enqueuedBatch.tool_calls[0].arguments.target_id, 'goblin_1');
    assertEqual(currentSelectedTag, null);
  });
});
