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
  const visualPos = new Map();     // id -> { x: pixelX, y: pixelY }
  const shakeOffsets = new Map();  // id -> { x: offsetX, y: offsetY }
  const tokenAlpha = new Map();    // id -> alpha (for death fade)
  const dyingEntities = new Map(); // id -> entity snapshot
  const activeEffects = [];        // active flashes & floating texts
  const sprites = new Map();

  function setView(next) {
    view = next;
  }

  /* ------------------------------- Drawing ------------------------------- */

  function drawTiles(map) {
    if (!map || !map.grid) return;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const t = map.grid[y][x];
        const px = x * tileSize;
        const py = y * tileSize;

        if (t === TILE.WALL) {
          ctx.fillStyle = '#21262d';
          ctx.fillRect(px, py, tileSize, tileSize);

          ctx.strokeStyle = '#30363d';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);

          ctx.fillStyle = '#161b22';
          ctx.fillRect(px + 4, py + 4, tileSize - 8, tileSize - 8);
        } else {
          const isEven = (x + y) % 2 === 0;
          ctx.fillStyle = isEven ? '#0f141c' : '#141923';
          ctx.fillRect(px, py, tileSize, tileSize);

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
        }
      }
    }
  }

  function drawHighlights(reachable) {
    if (!reachable || !(reachable instanceof Map)) return;

    ctx.fillStyle = 'rgba(88, 166, 255, 0.22)';
    ctx.strokeStyle = 'rgba(88, 166, 255, 0.5)';
    ctx.lineWidth = 1.5;

    for (const [coordKey] of reachable.entries()) {
      const [x, y] = coordKey.split(',').map(Number);
      const px = x * tileSize;
      const py = y * tileSize;

      ctx.fillRect(px + 2, py + 2, tileSize - 4, tileSize - 4);
      ctx.strokeRect(px + 2.5, py + 2.5, tileSize - 5, tileSize - 5);
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

        const isOpened = !!(obj.opened || obj.open);
        const isLocked = !!obj.locked;

        ctx.save();

        if (isOpened) {
          // Opened chest: faded fill and tilted lid
          ctx.globalAlpha = 0.65;
          ctx.fillStyle = '#4e342e';
          ctx.beginPath();
          ctx.roundRect(cx, cy + 8, cw, ch - 8, 4);
          ctx.fill();

          // Dark interior cavity
          ctx.fillStyle = '#211714';
          ctx.fillRect(cx + 4, cy + 9, cw - 8, 8);

          // Lid drawn swung back
          ctx.fillStyle = '#6d4c41';
          ctx.fillRect(cx - 2, cy + 2, cw + 4, 6);

          // Iron bands
          ctx.fillStyle = '#37474f';
          ctx.fillRect(cx + 6, cy + 8, 4, ch - 8);
          ctx.fillRect(cx + cw - 10, cy + 8, 4, ch - 8);
        } else {
          // Closed chest body
          ctx.fillStyle = '#8d5b28';
          ctx.beginPath();
          ctx.roundRect(cx, cy, cw, ch, 4);
          ctx.fill();

          // Iron bands
          ctx.fillStyle = '#37474f';
          ctx.fillRect(cx + 6, cy, 4, ch);
          ctx.fillRect(cx + cw - 10, cy, 4, ch);

          // Lid trim
          ctx.fillStyle = '#5d4037';
          ctx.fillRect(cx, cy + 10, cw, 4);

          if (isLocked) {
            // Locked chest: Padlock glyph (gold body + shackle arc + keyhole)
            const lockX = cx + cw / 2;
            const lockY = cy + 12;

            // Shackle loop (drawn above lock body)
            ctx.strokeStyle = '#ffe082';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(lockX, lockY, 4, Math.PI, 0, false);
            ctx.stroke();

            // Lock body
            ctx.fillStyle = '#ffd54f';
            ctx.beginPath();
            ctx.roundRect(lockX - 5, lockY, 10, 8, 2);
            ctx.fill();
            ctx.strokeStyle = '#ffb300';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Keyhole slot
            ctx.fillStyle = '#212121';
            ctx.beginPath();
            ctx.arc(lockX, lockY + 3, 1.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(lockX - 0.75, lockY + 3, 1.5, 3);
          } else {
            // Unlocked chest: Padlock removed, clean silver latch
            const latchX = cx + cw / 2 - 4;
            const latchY = cy + 10;
            ctx.fillStyle = '#cfd8dc';
            ctx.fillRect(latchX, latchY, 8, 6);
            ctx.fillStyle = '#90a4ae';
            ctx.fillRect(latchX + 2, latchY + 2, 4, 2);
          }
        }

        ctx.restore();
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

    // Render living entities plus any entities undergoing death fade
    const living = Object.values(entities).filter(e => e && e.alive);
    const dying = Array.from(dyingEntities.values());
    const list = [...living, ...dying];

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
      const shake = shakeOffsets.get(e.id) || { x: 0, y: 0 };
      const alpha = tokenAlpha.has(e.id) ? tokenAlpha.get(e.id) : 1;

      if (alpha <= 0) continue;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

      const tokenSize = 48;
      const offset = (tileSize - tokenSize) / 2;
      const tx = pos.x + shake.x + offset;
      const ty = pos.y + shake.y + offset;

      // Draw HP Bar above token
      drawHpBar(e, pos.x + shake.x, pos.y + shake.y);

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

      ctx.restore();
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
    const shake = shakeOffsets.get(activeId) || { x: 0, y: 0 };

    const pulse = 0.5 + 0.5 * Math.sin(now / 180);
    const alpha = 0.4 + 0.6 * pulse;

    ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(pos.x + shake.x + 6, pos.y + shake.y + 6, tileSize - 12, tileSize - 12, 10);
    ctx.stroke();
  }

  function drawEffects(now) {
    for (let i = activeEffects.length - 1; i >= 0; i--) {
      const eff = activeEffects[i];
      const elapsed = now - eff.startTime;
      const progress = Math.max(0, Math.min(1, elapsed / eff.duration));

      if (progress >= 1) {
        activeEffects.splice(i, 1);
        continue;
      }

      ctx.save();
      if (eff.type === 'flash') {
        // Red / green damage flash overlay: alpha maxAlpha -> 0
        const alpha = (1 - progress) * (eff.maxAlpha || 0.6);
        ctx.fillStyle = `rgba(${eff.rgb}, ${alpha})`;
        ctx.fillRect(eff.x, eff.y, eff.w, eff.h);
      } else if (eff.type === 'floatText') {
        // Floating number rising 20px
        const currentY = eff.startY - (eff.dy || 20) * progress;
        const alpha = 1 - progress * 0.4;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = eff.color;
        ctx.font = 'bold 20px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(eff.text, eff.x, currentY);
      }
      ctx.restore();
    }
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
    drawEffects(now);
    drawGridLines(state.map);
  }

  /* ------------------------------- Animation ------------------------------- */

  function tweenMove(id, from, to, duration) {
    return new Promise(resolve => {
      const startTime = performance.now();
      const easeOut = t => 1 - (1 - t) ** 2;

      function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = easeOut(t);

        const fromPx = { x: from.x * tileSize, y: from.y * tileSize };
        const toPx = { x: to.x * tileSize, y: to.y * tileSize };
        const curX = fromPx.x + (toPx.x - fromPx.x) * eased;
        const curY = fromPx.y + (toPx.y - fromPx.y) * eased;
        visualPos.set(id, { x: curX, y: curY });

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          visualPos.delete(id);
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  function shakeEntity(id, duration = 80) {
    return new Promise(resolve => {
      const startTime = performance.now();

      function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / duration);
        // High frequency shake decaying over duration
        const amplitude = (1 - t) * 5;
        const offsetX = Math.sin(t * Math.PI * 8) * amplitude;
        shakeOffsets.set(id, { x: offsetX, y: 0 });

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          shakeOffsets.delete(id);
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  function fadeDeath(id, entity, duration = 300) {
    dyingEntities.set(id, entity);
    return new Promise(resolve => {
      const startTime = performance.now();

      function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / duration);
        const alpha = Math.max(0, 1 - t);
        tokenAlpha.set(id, alpha);

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          tokenAlpha.delete(id);
          dyingEntities.delete(id);
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  function flashAndFloat({ pos, rgb, maxAlpha, text, textColor, duration }) {
    const px = pos.x * tileSize;
    const py = pos.y * tileSize;
    const now = performance.now();

    activeEffects.push({
      type: 'flash',
      x: px,
      y: py,
      w: tileSize,
      h: tileSize,
      rgb,
      maxAlpha,
      startTime: now,
      duration
    });

    if (text) {
      activeEffects.push({
        type: 'floatText',
        x: px + tileSize / 2,
        y: py + tileSize / 2,
        startY: py + tileSize / 2,
        text,
        color: textColor,
        dy: 20,
        startTime: now,
        duration
      });
    }

    return new Promise(resolve => setTimeout(resolve, duration));
  }

  async function playSingleEvent(ev) {
    if (!ev) return;

    if (ev.type === 'move') {
      if (ev.from && ev.to) {
        await tweenMove(ev.id, ev.from, ev.to, CONFIG.MOVE_ANIM_MS || 250);
      }
    } else if (ev.type === 'push') {
      if (ev.from && ev.to) {
        await tweenMove(ev.id, ev.from, ev.to, 150);
      }
    } else if (ev.type === 'push_blocked') {
      await shakeEntity(ev.id, 80);
    } else if (ev.type === 'damage') {
      const target = view?.state?.entities?.[ev.id];
      const pos = target?.position;
      if (pos) {
        const hitFlashMs = CONFIG.HIT_FLASH_MS || 300;
        await flashAndFloat({
          pos,
          rgb: '248, 81, 73',
          maxAlpha: 0.6,
          text: `-${ev.amount ?? 0}`,
          textColor: '#f85149',
          duration: hitFlashMs
        });
      }
    } else if (ev.type === 'heal') {
      const target = view?.state?.entities?.[ev.id];
      const pos = target?.position;
      if (pos) {
        const hitFlashMs = CONFIG.HIT_FLASH_MS || 300;
        await flashAndFloat({
          pos,
          rgb: '63, 185, 80',
          maxAlpha: 0.4,
          text: `+${ev.amount ?? 0}`,
          textColor: '#3fb950',
          duration: hitFlashMs
        });
      }
    } else if (ev.type === 'death') {
      const entity = view?.state?.entities?.[ev.id];
      if (entity) {
        await fadeDeath(ev.id, entity, 300);
      }
    } else if (ev.type === 'chest_opened') {
      const obj = view?.state?.objects?.[ev.objectId];
      if (obj?.position) {
        await flashAndFloat({
          pos: obj.position,
          rgb: '210, 153, 34',
          maxAlpha: 0.35,
          text: '+Espólios',
          textColor: '#d29922',
          duration: 200
        });
      }
    } else if (ev.type === 'unlocked') {
      const obj = view?.state?.objects?.[ev.objectId];
      if (obj?.position) {
        await flashAndFloat({
          pos: obj.position,
          rgb: '88, 166, 255',
          maxAlpha: 0.35,
          text: 'Destrancado!',
          textColor: '#58a6ff',
          duration: 200
        });
      }
    }
  }

  const animator = {
    async play(events) {
      if (!Array.isArray(events) || events.length === 0) {
        return;
      }
      for (const ev of events) {
        await playSingleEvent(ev);
      }
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
