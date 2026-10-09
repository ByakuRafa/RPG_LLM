/**
 * HUD component: Player HP, ATK, turn number, game status and inventory.
 * Automatically updates when state:changed or queue status changes.
 */
export function createHud({ container, store, bus }) {
  container.innerHTML = `
    <div class="hud-bar">
      <div class="hud-stat-group">
        <span class="hud-label">TURNO</span>
        <span class="hud-value" id="hud-turn">0</span>
      </div>
      <div class="hud-stat-group">
        <span class="hud-label">STATUS</span>
        <span class="hud-badge status-playing" id="hud-status">EM JOGO</span>
      </div>
      <div class="hud-stat-group hp-group">
        <div class="hp-header">
          <span class="hud-label">VIDA</span>
          <span class="hud-hp-text" id="hud-hp-text">20 / 20</span>
        </div>
        <div class="hp-bar-bg">
          <div class="hp-bar-fill" id="hud-hp-fill" style="width: 100%;"></div>
        </div>
      </div>
      <div class="hud-stat-group">
        <span class="hud-label">ATAQUE</span>
        <span class="hud-value" id="hud-atk">4</span>
      </div>
      <div class="hud-stat-group queue-status-group">
        <span class="hud-label">FILA</span>
        <span class="queue-pill idle" id="hud-queue-pill">Ociosa</span>
      </div>
    </div>
    <div class="inventory-bar">
      <span class="inv-title">Inventario:</span>
      <div class="inv-items" id="hud-inventory">
        <span class="inv-empty">Vazio</span>
      </div>
    </div>
  `;

  const turnEl = container.querySelector('#hud-turn');
  const statusEl = container.querySelector('#hud-status');
  const hpTextEl = container.querySelector('#hud-hp-text');
  const hpFillEl = container.querySelector('#hud-hp-fill');
  const atkEl = container.querySelector('#hud-atk');
  const queuePillEl = container.querySelector('#hud-queue-pill');
  const invEl = container.querySelector('#hud-inventory');

  function render() {
    const s = store.get();
    turnEl.textContent = s.turn;

    // Status
    statusEl.className = 'hud-badge';
    if (s.status === 'playing') {
      statusEl.classList.add('status-playing');
      statusEl.textContent = 'EM JOGO';
    } else if (s.status === 'won') {
      statusEl.classList.add('status-won');
      statusEl.textContent = 'VITORIA';
    } else if (s.status === 'lost') {
      statusEl.classList.add('status-lost');
      statusEl.textContent = 'DERROTA';
    }

    // Player Stats
    const player = s.entities.player;
    if (player) {
      const hp = Math.max(0, player.hp);
      const maxHp = player.maxHp || 20;
      const pct = Math.min(100, Math.max(0, (hp / maxHp) * 100));
      hpTextEl.textContent = `${hp} / ${maxHp}`;
      hpFillEl.style.width = `${pct}%`;
      hpFillEl.className = 'hp-bar-fill';
      if (pct <= 25) hpFillEl.classList.add('critical');
      else if (pct <= 50) hpFillEl.classList.add('warning');

      atkEl.textContent = player.atk ?? 4;

      // Inventory
      if (!player.items || player.items.length === 0) {
        invEl.innerHTML = '<span class="inv-empty">Vazio</span>';
      } else {
        invEl.innerHTML = player.items
          .map(
            (i) => `<span class="inv-item" title="ID: ${i.id}">${escapeHtml(i.name)} <span class="inv-qty">x${i.qty}</span></span>`
          )
          .join('');
      }
    } else {
      hpTextEl.textContent = '0 / 0';
      hpFillEl.style.width = '0%';
      invEl.innerHTML = '<span class="inv-empty">Morto</span>';
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  bus.on('state:changed', render);
  bus.on('queue:step', ({ index, total }) => {
    queuePillEl.className = 'queue-pill busy';
    queuePillEl.textContent = `Ação ${index + 1}/${total}`;
  });
  bus.on('queue:idle', () => {
    queuePillEl.className = 'queue-pill idle';
    queuePillEl.textContent = 'Ociosa';
  });

  render();

  return { render };
}
