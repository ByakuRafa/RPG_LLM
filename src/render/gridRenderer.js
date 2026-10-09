/**
 * Canvas 2D grid renderer. Draws the authoritative state every frame and
 * overlays short animations (≤ ~450 ms). `play(events)` resolves via timers,
 * not rAF, so the Action Queue never stalls if the tab is hidden.
 */
const TILE = 40;
const PAD = 20;
const MOVE_MS_PER_STEP = 110;
const MOVE_MS_MAX = 450;
const HIT_MS = 200;
const FADE_MS = 200;
const SPAWN_MS = 200;
const OPEN_MS = 120;
const LOOT_MS = 160;

const COLORS = {
  bg: '#12141a',
  floor: '#1d2129',
  floorLine: '#262b35',
  wall: '#3b4150',
  wallTop: '#4a5163',
  coord: '#5c6475',
  select: '#ffd54f',
  hover: 'rgba(255,255,255,0.06)',
  player: '#4fc3f7',
  goblin: '#8bc34a',
  skeleton: '#e0e0e0',
  dead: '#555',
  chest: '#b8860b',
  chestDark: '#6b4f12',
  door: '#8d6e63',
  doorDark: '#5d4037',
  bag: '#ffca28',
};

const GLYPH = { player: '@', goblin: 'g', skeleton: 's' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lerp = (a, b, t) => a + (b - a) * t;

export function createGridRenderer({ canvas, store, bus, infoEl = null }) {
  const ctx = canvas.getContext('2d');
  const anims = [];
  const hidden = new Set();
  let selected = null;
  let hover = null;
  let speed = 1;

  function resize() {
    const { width, height } = store.get().map;
    const cssW = PAD + width * TILE;
    const cssH = PAD + height * TILE;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const px = (x) => PAD + x * TILE;
  const py = (y) => PAD + y * TILE;

  /* ------------------------------ animation ------------------------------ */

  function addAnim(a, duration) {
    anims.push({ ...a, start: performance.now(), duration: duration / speed });
    return duration / speed;
  }

  async function playOne(ev) {
    switch (ev.type) {
      case 'move': {
        const steps = ev.path.length - 1;
        const dur = Math.min(MOVE_MS_PER_STEP * steps, MOVE_MS_MAX);
        return sleep(addAnim({ kind: 'move', id: ev.id, path: ev.path }, dur));
      }
      case 'hit': {
        const pos = { x: ev.entity.x, y: ev.entity.y };
        addAnim({ kind: 'float', id: ev.id, pos, text: `-${ev.amount}`, color: '#ff5252' }, 700);
        // Killing blow: entity is already gone from state; hold a flashing ghost.
        if (!store.get().entities[ev.id]) return sleep(addAnim({ kind: 'ghost', entity: ev.entity, hold: true, flash: true }, HIT_MS));
        return sleep(addAnim({ kind: 'hit', id: ev.id }, HIT_MS));
      }
      case 'death':
        if (ev.keep) return sleep(addAnim({ kind: 'hit', id: ev.entity.id }, FADE_MS));
        return sleep(addAnim({ kind: 'ghost', entity: ev.entity, tint: '#ff5252' }, FADE_MS));
      case 'despawn':
        return sleep(addAnim({ kind: 'ghost', entity: ev.entity }, FADE_MS));
      case 'spawn':
        return sleep(addAnim({ kind: 'spawn', id: ev.id }, SPAWN_MS));
      case 'open':
        return sleep(OPEN_MS / speed);
      case 'loot': {
        const label = ev.items.map((i) => `+${i.qty} ${i.name}`).join(', ');
        addAnim({ kind: 'float', id: ev.actor, text: label, color: '#ffd54f' }, 900);
        return sleep(LOOT_MS / speed);
      }
      default:
        return undefined;
    }
  }

  /** Plays the visual events of one command sequentially. */
  async function play(events) {
    for (const ev of events) if (ev.type === 'spawn') hidden.add(ev.id);
    try {
      for (const ev of events) {
        if (ev.type === 'spawn') hidden.delete(ev.id);
        await playOne(ev);
      }
    } finally {
      for (const ev of events) if (ev.type === 'spawn') hidden.delete(ev.id);
    }
  }

  function activeAnim(kind, id, now) {
    return anims.find((a) => a.kind === kind && a.id === id && now - a.start < a.duration);
  }

  function visualPos(e, now) {
    const a = activeAnim('move', e.id, now);
    if (!a) return { x: e.x, y: e.y };
    const t = Math.min(1, (now - a.start) / a.duration);
    const seg = t * (a.path.length - 1);
    const i = Math.min(Math.floor(seg), a.path.length - 2);
    const f = seg - i;
    return { x: lerp(a.path[i].x, a.path[i + 1].x, f), y: lerp(a.path[i].y, a.path[i + 1].y, f) };
  }

  /* -------------------------------- drawing ------------------------------ */

  function drawTiles(map) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, PAD + map.width * TILE, PAD + map.height * TILE);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = COLORS.coord;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let x = 0; x < map.width; x++) ctx.fillText(String(x), px(x) + TILE / 2, PAD / 2);
    for (let y = 0; y < map.height; y++) ctx.fillText(String(y), PAD / 2, py(y) + TILE / 2);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.tiles[y][x] === '#') {
          ctx.fillStyle = COLORS.wall;
          ctx.fillRect(px(x), py(y), TILE, TILE);
          ctx.fillStyle = COLORS.wallTop;
          ctx.fillRect(px(x), py(y), TILE, 6);
        } else {
          ctx.fillStyle = COLORS.floor;
          ctx.fillRect(px(x), py(y), TILE, TILE);
          ctx.strokeStyle = COLORS.floorLine;
          ctx.strokeRect(px(x) + 0.5, py(y) + 0.5, TILE - 1, TILE - 1);
        }
      }
    }
  }

  function drawObject(e, x, y, alpha = 1) {
    const cx = px(x);
    const cy = py(y);
    ctx.globalAlpha = alpha;
    if (e.kind === 'door') {
      if (e.open) {
        ctx.strokeStyle = COLORS.door;
        ctx.lineWidth = 3;
        ctx.strokeRect(cx + 4, cy + 4, TILE - 8, TILE - 8);
        ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = COLORS.door;
        ctx.fillRect(cx + 3, cy + 3, TILE - 6, TILE - 6);
        ctx.fillStyle = COLORS.doorDark;
        for (let i = 1; i < 4; i++) ctx.fillRect(cx + 3 + i * ((TILE - 6) / 4), cy + 3, 2, TILE - 6);
        ctx.fillStyle = '#ffd54f';
        ctx.fillRect(cx + TILE - 12, cy + TILE / 2 - 2, 4, 4);
      }
    } else if (e.kind === 'chest') {
      ctx.fillStyle = e.open ? COLORS.chestDark : COLORS.chest;
      ctx.fillRect(cx + 7, cy + 13, TILE - 14, TILE - 20);
      ctx.fillStyle = COLORS.chest;
      if (e.open) ctx.fillRect(cx + 7, cy + 6, TILE - 14, 5);
      else ctx.fillRect(cx + 7, cy + 11, TILE - 14, 4);
      ctx.fillStyle = '#ffe082';
      if (!e.open) ctx.fillRect(cx + TILE / 2 - 2, cy + 17, 4, 5);
    } else if (e.kind === 'bag') {
      ctx.fillStyle = COLORS.bag;
      ctx.beginPath();
      ctx.arc(cx + TILE / 2, cy + TILE / 2 + 4, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx + TILE / 2 - 3, cy + TILE / 2 - 8, 6, 6);
    }
    ctx.globalAlpha = 1;
  }

  function drawCreature(e, x, y, { alpha = 1, scale = 1, flash = false, tint = null } = {}) {
    const cx = px(x) + TILE / 2;
    const cy = py(y) + TILE / 2;
    const dead = e.hp <= 0;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = tint ?? (dead ? COLORS.dead : COLORS[e.kind] ?? '#ccc');
    ctx.beginPath();
    ctx.arc(cx, cy, (TILE / 2 - 5) * scale, 0, Math.PI * 2);
    ctx.fill();
    if (flash) {
      ctx.fillStyle = 'rgba(255,82,82,0.75)';
      ctx.beginPath();
      ctx.arc(cx, cy, (TILE / 2 - 3) * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0d0f14';
    ctx.font = `bold ${Math.round(18 * scale)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dead ? 'x' : GLYPH[e.kind] ?? '?', cx, cy + 1);

    if (!dead && typeof e.maxHp === 'number') {
      const w = TILE - 10;
      const ratio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = '#000a';
      ctx.fillRect(px(x) + 5, py(y) + 1, w, 4);
      ctx.fillStyle = ratio > 0.5 ? '#66bb6a' : ratio > 0.25 ? '#ffa726' : '#ef5350';
      ctx.fillRect(px(x) + 5, py(y) + 1, w * ratio, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawEntity(e, now, opts = {}) {
    const pos = opts.pos ?? visualPos(e, now);
    if (typeof e.hp === 'number') drawCreature(e, pos.x, pos.y, opts);
    else drawObject(e, pos.x, pos.y, opts.alpha ?? 1);
  }

  const Z = { bag: 0, door: 1, chest: 1 };

  function draw(now) {
    const state = store.get();
    drawTiles(state.map);

    if (hover) {
      ctx.fillStyle = COLORS.hover;
      ctx.fillRect(px(hover.x), py(hover.y), TILE, TILE);
    }

    const ents = Object.values(state.entities).sort((a, b) => (Z[a.kind] ?? 2) - (Z[b.kind] ?? 2) || (a.id === 'player') - (b.id === 'player'));
    for (const e of ents) {
      if (hidden.has(e.id)) continue;
      const sp = activeAnim('spawn', e.id, now);
      const t = sp ? Math.min(1, (now - sp.start) / sp.duration) : 1;
      drawEntity(e, now, { alpha: t, scale: 0.4 + 0.6 * t, flash: !!activeAnim('hit', e.id, now) });
    }

    for (const a of anims) {
      const t = (now - a.start) / a.duration;
      if (t >= 1 || t < 0) continue;
      if (a.kind === 'ghost') {
        const alpha = a.hold ? 1 : 1 - t;
        const scale = a.hold ? 1 : 1 - 0.3 * t;
        drawEntity(a.entity, now, { pos: a.entity, alpha, scale, tint: a.tint, flash: !!a.flash });
      } else if (a.kind === 'float') {
        const e = state.entities[a.id];
        if (!e) continue;
        const pos = visualPos(e, now);
        ctx.globalAlpha = 1 - t;
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        const fx = px(pos.x) + TILE / 2;
        const fy = py(pos.y) - 4 - t * 18;
        ctx.strokeText(a.text, fx, fy);
        ctx.fillStyle = a.color;
        ctx.fillText(a.text, fx, fy);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
      }
    }
    for (let i = anims.length - 1; i >= 0; i--) if (now - anims[i].start > anims[i].duration) anims.splice(i, 1);

    if (selected) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(px(selected.x) + 1, py(selected.y) + 1, TILE - 2, TILE - 2);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
  }

  function loop(now) {
    draw(now);
    requestAnimationFrame(loop);
  }

  /* -------------------------------- input -------------------------------- */

  function tileFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left - PAD) / TILE);
    const y = Math.floor((ev.clientY - rect.top - PAD) / TILE);
    const { map } = store.get();
    return x >= 0 && y >= 0 && x < map.width && y < map.height ? { x, y } : null;
  }

  function describeTile(t) {
    if (!t) return '';
    const state = store.get();
    const wall = state.map.tiles[t.y][t.x] === '#';
    const here = Object.values(state.entities).filter((e) => e.x === t.x && e.y === t.y);
    const what = here.map((e) => (typeof e.hp === 'number' ? `${e.id} (${e.hp}/${e.maxHp} HP)` : `${e.id}${e.open !== undefined && e.kind !== 'bag' ? (e.open ? ' aberto' : ' fechado') : ''}`));
    return `(${t.x},${t.y}) ${wall ? 'parede' : 'chão'}${what.length ? ' · ' + what.join(', ') : ''}`;
  }

  canvas.addEventListener('mousemove', (ev) => {
    hover = tileFromEvent(ev);
    if (infoEl) infoEl.textContent = describeTile(hover) || ' ';
  });
  canvas.addEventListener('mouseleave', () => {
    hover = null;
    if (infoEl) infoEl.textContent = ' ';
  });
  canvas.addEventListener('click', (ev) => {
    const t = tileFromEvent(ev);
    if (!t) return;
    selected = t;
    const ent = Object.values(store.get().entities).find((e) => e.x === t.x && e.y === t.y && e.kind !== 'bag')
      ?? Object.values(store.get().entities).find((e) => e.x === t.x && e.y === t.y);
    bus.emit('grid:select', { ...t, entityId: ent?.id ?? null });
  });

  resize();
  requestAnimationFrame(loop);

  return {
    play,
    resize,
    setSpeed(s) {
      speed = s;
    },
    clearSelection() {
      selected = null;
    },
  };
}
