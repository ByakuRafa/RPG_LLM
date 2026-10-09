/**
 * LLM provider adapters. Interface: { name, send(request) => Promise<{text, latencyMs, usage?}> }
 * request = { system, contents:[{role:'user'|'model', text}], meta }
 */
import { RESPONSE_SCHEMA } from './promptBuilder.js';
import { manhattan } from '../engine/rules.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-2.5-flash';
export const REQUEST_TIMEOUT_MS = 30000;

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

function buildGeminiBody(request, settings, { minimal = false } = {}) {
  const generationConfig = {
    temperature: settings.temperature ?? 0.7,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
  };
  if (!minimal) {
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

async function postJson(url, body, apiKey, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
    if (err.name === 'AbortError') throw new LLMError(`Tempo esgotado após ${REQUEST_TIMEOUT_MS / 1000}s`, { kind: 'timeout' });
    throw new LLMError(`Falha de rede: ${err.message}`, { kind: 'network' });
  } finally {
    clearTimeout(timer);
  }
}

function mapHttpError(status, data) {
  const apiMsg = data?.error?.message ?? '';
  if (status === 400) return new LLMError(`Requisição inválida (400): ${apiMsg}`, { status, kind: 'bad_request' });
  if (status === 401 || status === 403) return new LLMError(`Chave de API inválida ou sem permissão (${status}). ${apiMsg}`, { status, kind: 'auth' });
  if (status === 404) return new LLMError(`Modelo não encontrado (404). Verifique o nome do modelo. ${apiMsg}`, { status, kind: 'model' });
  if (status === 429) return new LLMError(`Limite de requisições atingido (429). Aguarde e tente novamente. ${apiMsg}`, { status, kind: 'rate_limit' });
  if (status >= 500) return new LLMError(`Erro no servidor do Gemini (${status}). ${apiMsg}`, { status, kind: 'server' });
  return new LLMError(`Erro HTTP ${status}. ${apiMsg}`, { status, kind: 'http' });
}

function extractText(data) {
  if (data?.promptFeedback?.blockReason) {
    throw new LLMError(`Prompt bloqueado pelo filtro de segurança: ${data.promptFeedback.blockReason}`, { kind: 'blocked' });
  }
  const cand = data?.candidates?.[0];
  if (!cand) throw new LLMError('Resposta sem candidatos', { kind: 'empty' });
  const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  if (!text && cand.finishReason && cand.finishReason !== 'STOP') {
    throw new LLMError(`Geração interrompida: ${cand.finishReason}`, { kind: 'finish' });
  }
  return text;
}

/**
 * Google Gemini (AI Studio) REST adapter. Called directly from the browser.
 * On HTTP 400 it retries once with a minimal config (no responseSchema /
 * thinkingConfig) to stay compatible with models that reject those fields.
 */
export function createGeminiAdapter({ getSettings, fetchImpl = (...a) => fetch(...a) }) {
  return {
    name: 'gemini',
    async send(request) {
      const settings = getSettings();
      if (!settings.apiKey) throw new LLMError('Configure sua chave de API do Gemini em ⚙ Configurações.', { kind: 'auth' });
      const model = settings.model || DEFAULT_MODEL;
      const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
      const t0 = performance.now();

      let { res, data } = await postJson(url, buildGeminiBody(request, { ...settings, model }), settings.apiKey, fetchImpl);
      let degraded = false;
      if (res.status === 400) {
        ({ res, data } = await postJson(url, buildGeminiBody(request, { ...settings, model }, { minimal: true }), settings.apiKey, fetchImpl));
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
/* Mock adapter: keyword-driven, state-aware. Zero cost, used for UI tests.  */
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
  const a = action.toLowerCase();
  const ents = Object.values(state.entities);
  const p = state.entities.player;
  const enemies = ents.filter((e) => e.faction === 'enemy');
  const say = (narrative, commands = []) => JSON.stringify({ narrative, commands });

  if (/atac|attack|golpe|lut|mat[ao]|bat[eo]/.test(a)) {
    const foe = nearest(enemies, p);
    if (!foe) return say('Não há inimigos à vista. O silêncio da masmorra responde ao seu desafio.');
    const cmds = [];
    if (manhattan(p, foe) !== 1) cmds.push({ type: 'MOVE', id: 'player', target: foe.id });
    cmds.push({ type: 'ATTACK', attacker: 'player', target: foe.id });
    if (foe.hp - p.atk > 0) cmds.push({ type: 'ATTACK', attacker: foe.id, target: 'player' });
    return say(`(mock) Você investe contra ${foe.name.toLowerCase()} e desfere um golpe!`, cmds);
  }
  if (/abr|open|porta|door|ba[uú]|chest/.test(a)) {
    const wantsDoor = /porta|door/.test(a);
    const pool = ents.filter((e) => (wantsDoor ? e.kind === 'door' : e.kind === 'chest' || e.kind === 'door') && !e.open);
    const t = nearest(pool, p);
    if (!t) return say('(mock) Não há nada fechado por perto para abrir.');
    const cmds = [];
    if (manhattan(p, t) > 1) cmds.push({ type: 'MOVE', id: 'player', target: t.id });
    cmds.push({ type: 'INTERACT', actor: 'player', target: t.id });
    return say(`(mock) Você se aproxima e abre ${t.name.toLowerCase()}.`, cmds);
  }
  if (/peg|lot|loot|saque|take|colet|recolh/.test(a)) {
    const pool = ents.filter((e) => (e.kind === 'bag' || e.kind === 'chest') && e.open && e.items.length);
    const t = nearest(pool, p);
    if (!t) return say('(mock) Não há nada para pegar por aqui.');
    const cmds = [];
    if (manhattan(p, t) > 1) cmds.push({ type: 'MOVE', id: 'player', target: t.id });
    cmds.push({ type: 'LOOT', actor: 'player', from: t.id });
    return say(`(mock) Você recolhe tudo o que encontra em ${t.name.toLowerCase()}.`, cmds);
  }
  const dir = DIRECTIONS.find((d) => d.re.test(a));
  if (dir) {
    const to = { x: p.x + dir.dx * 2, y: p.y + dir.dy * 2 };
    return say(`(mock) Você caminha para o ${dir.pt}.`, [{ type: 'MOVE', id: 'player', to }]);
  }
  return say('(mock) O Mestre pondera, mas nada acontece. Tente: atacar, abrir, pegar, ir para o norte/sul/leste/oeste.');
}

/**
 * Mock LLM. Typing "quebrado"/"invalid" returns garbage first so the repair
 * path can be exercised; the repair request gets a valid answer.
 */
export function createMockAdapter({ getState, latencyMs = 350 }) {
  return {
    name: 'mock',
    async send(request) {
      await new Promise((r) => setTimeout(r, latencyMs));
      const action = request.meta?.action ?? '';
      if (/quebrad|invalid/i.test(action) && !request.meta?.repair) {
        return { text: 'Claro! Aqui está: {"narrative": "resposta quebrada", "commands": [ {"type": "MOVE"', latencyMs };
      }
      return { text: mockRespond(getState(), action), latencyMs };
    },
  };
}
