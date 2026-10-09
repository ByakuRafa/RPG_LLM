/**
 * LLM provider adapters. Interface: { name, send(request) => Promise<{text, latencyMs, usage?}> }
 * request = { system, contents:[{role:'user'|'model', text}], meta }
 */
import { RESPONSE_SCHEMA } from './promptBuilder.js';
import { manhattan } from '../engine/rules.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const REQUEST_TIMEOUT_MS = 90000; // 90 seconds default (up from 30s)

export class LLMError extends Error {
  constructor(message, { status = null, kind = 'unknown' } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.kind = kind;
  }
}

function thinkingConfigFor(model) {
  if (/2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3/.test(model)) return { thinkingLevel: 'low' };
  return null;
}

function buildGeminiBody(request, settings, { minimal = false, noMime = false } = {}) {
  const isGemma = /gemma/i.test(settings.model || '');
  const generationConfig = {
    temperature: settings.temperature ?? 0.7,
    // Thinking models budget thought tokens within maxOutputTokens.
    // 8192 gives ample headroom for reasoning (600-1200 tokens) + JSON response without hitting MAX_TOKENS.
    maxOutputTokens: isGemma ? 2048 : 8192,
  };
  if (!noMime && !isGemma) {
    generationConfig.responseMimeType = 'application/json';
  }
  if (!minimal && !isGemma) {
    generationConfig.responseSchema = RESPONSE_SCHEMA;
    const thinking = thinkingConfigFor(settings.model);
    if (thinking) generationConfig.thinkingConfig = thinking;
  }
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: request.contents.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    generationConfig,
  };
}

async function postJson(url, body, apiKey, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  let abortListener = null;

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      throw new LLMError('Requisicao cancelada antes de iniciar.', { kind: 'canceled' });
    }
    abortListener = () => controller.abort('canceled');
    externalSignal.addEventListener('abort', abortListener, { once: true });
  }

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }
    return { res, data };
  } catch (err) {
    if (controller.signal.aborted) {
      if (externalSignal?.aborted || controller.signal.reason === 'canceled') {
        throw new LLMError('Requisicao cancelada pelo jogador.', { kind: 'canceled' });
      }
      const secs = Math.round(timeoutMs / 1000);
      throw new LLMError(
        `Tempo limite esgotado apos ${secs}s. O modelo esta demorando no Google AI Studio. Aumente o Tempo Limite nas Configuracoes (ex: 180s) ou use 'gemini-3.8-flash' para respostas rapidas.`,
        { kind: 'timeout' }
      );
    }
    throw new LLMError(`Falha de rede: ${err.message}`, { kind: 'network' });
  } finally {
    clearTimeout(timer);
    if (externalSignal && abortListener) {
      externalSignal.removeEventListener('abort', abortListener);
    }
  }
}

function mapHttpError(status, data) {
  const apiMsg = data?.error?.message ?? '';
  if (status === 400) return new LLMError(`Requisicao invalida (400): ${apiMsg}`, { status, kind: 'bad_request' });
  if (status === 401 || status === 403) return new LLMError(`Chave de API invalida ou sem permissao (${status}). ${apiMsg}`, { status, kind: 'auth' });
  if (status === 404) return new LLMError(`Modelo nao encontrado (404). Verifique o nome do modelo. ${apiMsg}`, { status, kind: 'model' });
  if (status === 429) return new LLMError(`Limite de requisicoes atingido (429). Aguarde e tente novamente. ${apiMsg}`, { status, kind: 'rate_limit' });
  if (status >= 500) return new LLMError(`Erro no servidor do Gemini (${status}). ${apiMsg}`, { status, kind: 'server' });
  return new LLMError(`Erro HTTP ${status}. ${apiMsg}`, { status, kind: 'http' });
}

function extractText(data) {
  if (data?.promptFeedback?.blockReason) {
    throw new LLMError(`Prompt bloqueado pelo filtro de seguranca: ${data.promptFeedback.blockReason}`, { kind: 'blocked' });
  }
  const cand = data?.candidates?.[0];
  if (!cand) throw new LLMError('Resposta sem candidatos', { kind: 'empty' });
  const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  if (!text) {
    if (cand.finishReason === 'MAX_TOKENS') {
      throw new LLMError('Geracao interrompida: MAX_TOKENS (raciocinio excedeu o limite de tokens).', { kind: 'finish' });
    }
    if (cand.finishReason && cand.finishReason !== 'STOP') {
      throw new LLMError(`Geracao interrompida: ${cand.finishReason}`, { kind: 'finish' });
    }
  }
  return text;
}

/**
 * Google Gemini (AI Studio) REST adapter. Called directly from the browser.
 * Supports configurable timeout (120-180s for Gemma) and multi-stage fallback.
 */
export function createGeminiAdapter({ getSettings, fetchImpl = (...a) => fetch(...a) }) {
  return {
    name: 'gemini',
    getModel() {
      return getSettings().model || DEFAULT_MODEL;
    },
    getTimeoutSeconds() {
      const settings = getSettings();
      const isGemma = /gemma/i.test(settings.model || '');
      return settings.timeoutSeconds ? Number(settings.timeoutSeconds) : (isGemma ? 120 : 60);
    },
    async send(request, { signal = null } = {}) {
      const settings = getSettings();
      if (!settings.apiKey) throw new LLMError('Configure sua chave de API do Google AI Studio em Configuracoes.', { kind: 'auth' });
      const model = settings.model || DEFAULT_MODEL;
      const isGemma = /gemma/i.test(model);
      const defaultTimeoutMs = isGemma ? 120000 : 60000;
      const timeoutMs = settings.timeoutSeconds ? Number(settings.timeoutSeconds) * 1000 : defaultTimeoutMs;
      const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
      const t0 = performance.now();

      let { res, data } = await postJson(url, buildGeminiBody(request, { ...settings, model }), settings.apiKey, fetchImpl, timeoutMs, signal);
      // Auto-retry once on transient 500 / 503 Google AI Studio server hiccups
      if ((res.status === 500 || res.status === 503) && !signal?.aborted) {
        await new Promise((r) => setTimeout(r, 600));
        ({ res, data } = await postJson(url, buildGeminiBody(request, { ...settings, model }), settings.apiKey, fetchImpl, timeoutMs, signal));
      }

      let degraded = false;
      if (res.status === 400 && !isGemma) {
        ({ res, data } = await postJson(url, buildGeminiBody(request, { ...settings, model }, { minimal: true }), settings.apiKey, fetchImpl, timeoutMs, signal));
        degraded = true;
      }
      if (res.status === 400) {
        ({ res, data } = await postJson(url, buildGeminiBody(request, { ...settings, model }, { minimal: true, noMime: true }), settings.apiKey, fetchImpl, timeoutMs, signal));
        degraded = true;
      }
      if (!res.ok) throw mapHttpError(res.status, data);
      return { text: extractText(data), latencyMs: Math.round(performance.now() - t0), usage: data.usageMetadata ?? null, degraded };
    },
  };
}

/** Lists models available to the key that support generateContent. */
export async function listGeminiModels(apiKey, fetchImpl = (...a) => fetch(...a)) {
  const res = await fetchImpl(`${GEMINI_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw mapHttpError(res.status, data);
  return (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
}

/* ------------------------------------------------------------------------ */
/* Mock adapter: keyword-driven, state-aware with complete Enemy GM Turns.  */
/* ------------------------------------------------------------------------ */

function nearest(list, from) {
  return [...list].sort((a, b) => manhattan(a, from) - manhattan(b, from))[0] ?? null;
}

const DIRECTIONS = [
  { re: /norte|cima|north|up/, dx: 0, dy: -1, pt: 'norte' },
  { re: /sul|baixo|south|down/, dx: 0, dy: 1, pt: 'sul' },
  { re: /leste|direita|east|right/, dx: 1, dy: 0, pt: 'leste' },
  { re: /oeste|esquerda|west|left/, dx: -1, dy: 0, pt: 'oeste' },
];

export function mockRespond(state, action) {
  const a = action.toLowerCase().trim();
  const ents = Object.values(state.entities);
  const p = state.entities.player;
  const initialEnemies = ents.filter((e) => e.faction === 'enemy' && e.hp > 0);
  const commands = [];
  const narrativeParts = [];

  // Phase 1: Player Action
  let playerActed = false;

  // Direct tile coordinates (e.g. "mover para (5, 3)" or "5, 3")
  const coordMatch = a.match(/\(?(\d{1,2})\s*,\s*(\d{1,2})\)?/);
  if (coordMatch && /andar|mover|ir|passo|tile/.test(a)) {
    const targetX = parseInt(coordMatch[1], 10);
    const targetY = parseInt(coordMatch[2], 10);
    commands.push({ type: 'MOVE', id: 'player', to: { x: targetX, y: targetY } });
    narrativeParts.push(`Voce se desloca com cuidado ate a coordenada (${targetX}, ${targetY}).`);
    playerActed = true;
  } else if (/atac|attack|golpe|lut|mat[ao]|bat[eo]/.test(a)) {
    const foe = nearest(initialEnemies, p);
    if (!foe) {
      narrativeParts.push('Nao ha inimigos a vista para atacar.');
    } else {
      if (manhattan(p, foe) !== 1) {
        commands.push({ type: 'MOVE', id: 'player', target: foe.id });
      }
      commands.push({ type: 'ATTACK', attacker: 'player', target: foe.id });
      narrativeParts.push(`Voce investe com sua arma e golpeia ${foe.name.toLowerCase()}!`);
    }
    playerActed = true;
  } else if (/abr|open|porta|door|ba[uú]|chest/.test(a)) {
    const wantsDoor = /porta|door/.test(a);
    const pool = ents.filter((e) => (wantsDoor ? e.kind === 'door' : e.kind === 'chest' || e.kind === 'door') && !e.open);
    const t = nearest(pool, p);
    if (!t) {
      narrativeParts.push('Nao ha objetos fechados ao seu alcance.');
    } else {
      if (manhattan(p, t) > 1) {
        commands.push({ type: 'MOVE', id: 'player', target: t.id });
      }
      commands.push({ type: 'INTERACT', actor: 'player', target: t.id });
      narrativeParts.push(`Voce se aproxima e abre ${t.name.toLowerCase()}.`);
    }
    playerActed = true;
  } else if (/peg|lot|loot|saque|take|colet|recolh/.test(a)) {
    const pool = ents.filter((e) => (e.kind === 'bag' || e.kind === 'chest') && e.open && e.items.length);
    const t = nearest(pool, p);
    if (!t) {
      narrativeParts.push('Nao ha espolios ou itens abertos para recolher por aqui.');
    } else {
      if (manhattan(p, t) > 1) {
        commands.push({ type: 'MOVE', id: 'player', target: t.id });
      }
      commands.push({ type: 'LOOT', actor: 'player', from: t.id });
      narrativeParts.push(`Voce recolhe os itens de ${t.name.toLowerCase()} para sua bolsa.`);
    }
    playerActed = true;
  } else {
    const dir = DIRECTIONS.find((d) => d.re.test(a));
    if (dir) {
      const to = { x: p.x + dir.dx * 2, y: p.y + dir.dy * 2 };
      commands.push({ type: 'MOVE', id: 'player', to });
      narrativeParts.push(`Voce da alguns passos em direcao ao ${dir.pt}.`);
      playerActed = true;
    }
  }

  if (!playerActed) {
    narrativeParts.push('O Mestre observa sua hesitacao. Tente comandos diretos como: atacar, abrir porta, saquear bau, ou andar para norte, sul, leste, oeste.');
  }

  // Phase 2: Game Master / Enemy Turn
  // Enemies act: if adjacent to player, attack; if nearby (<= 4 tiles), advance toward player!
  const playerDmgDealt = commands.filter((c) => c.type === 'ATTACK' && c.attacker === 'player').length * (p.atk || 4);
  const targetFoe = commands.find((c) => c.type === 'ATTACK' && c.attacker === 'player')?.target;

  const enemyTurnNarratives = [];
  for (const enemy of initialEnemies) {
    const currentHp = enemy.id === targetFoe ? enemy.hp - playerDmgDealt : enemy.hp;
    if (currentHp <= 0) continue; // Enemy died this turn

    const dist = manhattan(enemy, p);
    if (dist <= 1 || (commands.some((c) => c.type === 'MOVE' && c.id === 'player') && dist <= 2)) {
      // Enemy is adjacent: counterattack or attack!
      commands.push({ type: 'ATTACK', attacker: enemy.id, target: 'player' });
      enemyTurnNarratives.push(`${enemy.name} ataca voce ferozmente com suas garras!`);
    } else if (dist <= 4) {
      // Enemy is nearby: move toward player
      commands.push({ type: 'MOVE', id: enemy.id, target: 'player' });
      enemyTurnNarratives.push(`${enemy.name} nota sua presenca e avanca em sua direcao!`);
    }
  }

  if (enemyTurnNarratives.length > 0) {
    narrativeParts.push(`[Turno dos Inimigos] ${enemyTurnNarratives.join(' ')}`);
  }

  return JSON.stringify({
    narrative: narrativeParts.join(' '),
    commands,
  });
}

/**
 * Mock LLM. Typing "quebrado"/"invalid" returns garbage first so the repair
 * path can be exercised; the repair request gets a valid answer.
 */
export function createMockAdapter({ getState, latencyMs = 250 }) {
  return {
    name: 'mock',
    async send(request) {
      await new Promise((r) => setTimeout(r, latencyMs));
      const action = request.meta?.action ?? '';
      if (/quebrad|invalid/i.test(action) && !request.meta?.repair) {
        return { text: 'Claro! Aqui esta: {"narrative": "resposta quebrada", "commands": [ {"type": "MOVE"', latencyMs };
      }
      return { text: mockRespond(getState(), action), latencyMs };
    },
  };
}
