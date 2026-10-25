/**
 * Canvas 2D Grid Renderer for 12x12 RPG Virtual Tabletop.
 * Pure consumer of state & injected animator.
 * Zero DOM (except canvas context & click listener), Zero engine mutation.
 */
import { CONFIG, TILE } from '../core/config.js';

const TILE_SIZE = CONFIG.TILE_SIZE || 64;

export function createGridRenderer(canvas, bus, { tileSize = TILE_SIZE } = {}) {
  const ctx = canvas.getContext('2d');
  let view = { state: null, activeId: null, reachable: null };
  const visualPos = new Map(); // id -> { x: pixelX, y: pixelY }
  const effects = []; // Reserved for S2 flashes / floating numbers
  const sprites = new Map();

  function setView(nextView) {
    view = nextView || { state: null, activeId: null, reachable: null };
  }

  /* ------------------------------- Drawing ------------------------------- */

  function drawTiles(map) {
    if (!map || !map.tiles) return;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const isWall = map.tiles[y][x] === TILE.WALL;
        const px = x * tileSize;
        const py = y * tileSize;

        if (isWall) {
          // Wall tile
          ctx.fillStyle = '#1e2633';
          ctx.fillRect(px, py, tileSize, tileSize);

          // Top bevel
          ctx.fillStyle = '#2c3545';
          ctx.fillRect(px, py, tileSize, 6);

          // Dark border
          ctx.strokeStyle = '#0f131a';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
        } else {
          // Floor tile
          ctx.fillStyle = '#13171f';
          ctx.fillRect(px, py, tileSize, tileSize);

          // Subtle grid line
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
        }
      }
    }
  }

  function drawHighlights(reachable) {
    if (!reachable || !(reachable instanceof Map) || reachable.size === 0) return;

    ctx.fillStyle = 'rgba(30, 136, 229, 0.35)';
    ctx.strokeStyle = 'rgba(30, 136, 229, 0.7)';
    ctx.lineWidth = 1;

    for (const keyStr of reachable.keys()) {
      const parts = keyStr.split(',');
      if (parts.length !== 2) continue;
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const px = x * tileSize;
      const py = y * tileSize;

      ctx.fillRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
      ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
    }
  }

  function drawObjects(objects) {
    if (!objects) return;

    const list = Array.isArray(objects) ? objects : Object.values(objects);
    for (const obj of list) {
      if (!obj || !obj.position) continue;
      const px = obj.position.x * tileSize;
      const py = obj.position.y * tileSize;

      if (obj.type === 'chest' || obj.kind === 'chest') {
        const cx = px + 12;
        const cy = py + 16;
        const cw = tileSize - 24; // 40
        const ch = tileSize - 28; // 36

        // Wood chest body
        ctx.fillStyle = (obj.opened || obj.open) ? '#5d4037' : '#8d5b28';
        ctx.beginPath();
        ctx.roundRect(cx, cy, cw, ch, 4);
        ctx.fill();

        // Iron bands
        ctx.fillStyle = '#37474f';
        ctx.fillRect(cx + 6, cy, 4, ch);
        ctx.fillRect(cx + cw - 10, cy, 4, ch);

        // Chest lid trim
        ctx.fillStyle = '#4e342e';
        ctx.fillRect(cx, cy + ((obj.opened || obj.open) ? 6 : 10), cw, 4);

        // Lock / Latch
        if (obj.locked) {
          // Gold lock
          ctx.fillStyle = '#ffd54f';
          ctx.beginPath();
          ctx.arc(cx + cw / 2, cy + 12, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#212121';
          ctx.fillRect(cx + cw / 2 - 1, cy + 12, 2, 3);
        } else {
          // Silver latch
          ctx.fillStyle = '#cfd8dc';
          ctx.fillRect(cx + cw / 2 - 3, cy + 10, 6, 5);
        }
      }
    }
  }

  function drawHpBar(e, px, py) {
    const maxHp = e.maxHp || 10;
    const currentHp = Math.max(0, e.hp ?? maxHp);
    const ratio = Math.max(0, Math.min(1, currentHp / maxHp));

    const barW = 48;
    const barH = 5;
    const barX = px + (tileSize - barW) / 2;
    const barY = py + 2;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(barX, barY, barW, barH);

    // Health Fill (green > 50%, amber > 25%, red otherwise)
    let fillColor = '#f85149';
    if (ratio > 0.5) {
      fillColor = '#3fb950';
    } else if (ratio > 0.25) {
      fillColor = '#d29922';
    }

    const fillW = Math.round(barW * ratio);
    if (fillW > 0) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(barX, barY, fillW, barH);
    }

    // Border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
  }

  function drawTokens(entities) {
    if (!entities) return;

    const list = Object.values(entities).filter(e => e && e.alive);
    // Sort by y coordinate so lower tokens render on top
    list.sort((a, b) => {
      const aPos = visualPos.get(a.id) || { y: (a.position?.y ?? 0) * tileSize };
      const bPos = visualPos.get(b.id) || { y: (b.position?.y ?? 0) * tileSize };
      return aPos.y - bPos.y;
    });

    for (const e of list) {
      const pos = visualPos.get(e.id) || {
        x: (e.position?.x ?? 0) * tileSize,
        y: (e.position?.y ?? 0) * tileSize
      };

      const tokenSize = 48;
      const offset = (tileSize - tokenSize) / 2;
      const tx = pos.x + offset;
      const ty = pos.y + offset;

      // Draw HP Bar above token
      drawHpBar(e, pos.x, pos.y);

      // Token square
      ctx.fillStyle = e.color || '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(tx, ty, tokenSize, tokenSize, 8);
      ctx.fill();

      // Border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Centered Initial
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const initial = e.initial || e.name?.[0] || '?';
      ctx.fillText(initial, tx + tokenSize / 2, ty + tokenSize / 2 + 1);
    }
  }

  function drawActiveRing(entities, activeId, now) {
    if (!activeId || !entities) return;

    const active = entities[activeId];
    if (!active || !active.alive || active.role !== 'player') return;

    const pos = visualPos.get(activeId) || {
      x: (active.position?.x ?? 0) * tileSize,
      y: (active.position?.y ?? 0) * tileSize
    };

    const pulse = 0.5 + 0.5 * Math.sin(now / 180);
    const alpha = 0.4 + 0.6 * pulse;

    ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(pos.x + 6, pos.y + 6, tileSize - 12, tileSize - 12, 10);
    ctx.stroke();
  }

  function drawGridLines(map) {
    if (!map) return;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.width; x++) {
      ctx.moveTo(x * tileSize + 0.5, 0);
      ctx.lineTo(x * tileSize + 0.5, map.height * tileSize);
    }
    for (let y = 0; y <= map.height; y++) {
      ctx.moveTo(0, y * tileSize + 0.5);
      ctx.lineTo(map.width * tileSize, y * tileSize + 0.5);
    }
    ctx.stroke();
  }

  function render(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!view || !view.state || !view.state.map) {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const state = view.state;
    drawTiles(state.map);
    drawHighlights(view.reachable);
    drawObjects(state.objects);
    drawTokens(state.entities);
    drawActiveRing(state.entities, view.activeId, now);
    drawGridLines(state.map);
  }

  /* ------------------------------- Animation ------------------------------- */

  const animator = {
    play(events) {
      if (!Array.isArray(events) || events.length === 0) {
        return Promise.resolve();
      }

      const moveEvents = events.filter(e => e.type === 'move' && e.from && e.to);
      if (moveEvents.length === 0) {
        return Promise.resolve();
      }

      return new Promise(resolve => {
        const startTime = performance.now();
        const duration = CONFIG.MOVE_ANIM_MS || 250;
        const easeOut = t => 1 - (1 - t) ** 2;

        function step(now) {
          const elapsed = now - startTime;
          const t = Math.min(1, elapsed / duration);
          const eased = easeOut(t);

          for (const ev of moveEvents) {
            const fromPx = { x: ev.from.x * tileSize, y: ev.from.y * tileSize };
            const toPx = { x: ev.to.x * tileSize, y: ev.to.y * tileSize };
            const curX = fromPx.x + (toPx.x - fromPx.x) * eased;
            const curY = fromPx.y + (toPx.y - fromPx.y) * eased;
            visualPos.set(ev.id, { x: curX, y: curY });
          }

          if (t < 1) {
            requestAnimationFrame(step);
          } else {
            for (const ev of moveEvents) {
              visualPos.delete(ev.id);
            }
            resolve();
          }
        }

        requestAnimationFrame(step);
      });
    }
  };

  /* --------------------------------- Input --------------------------------- */

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (ev.clientX - rect.left) * scaleX;
    const canvasY = (ev.clientY - rect.top) * scaleY;
    const x = Math.floor(canvasX / tileSize);
    const y = Math.floor(canvasY / tileSize);

    const mapW = view?.state?.map?.width || CONFIG.GRID_W || 12;
    const mapH = view?.state?.map?.height || CONFIG.GRID_H || 12;

    if (x >= 0 && x < mapW && y >= 0 && y < mapH) {
      bus?.emit('board:tileClicked', { x, y });
    }
  });

  /* ------------------------------- Render Loop ------------------------------- */

  let isRunning = true;
  function loop(now) {
    if (!isRunning) return;
    render(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    setView,
    animator,
    loadSprites: async () => sprites,
    destroy: () => { isRunning = false; }
  };
}
