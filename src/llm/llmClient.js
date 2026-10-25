/**
 * REST fetch client for Google Gemini generateContent API.
 * Handles timeouts with AbortController, transient retries (429/500/503),
 * error classification into typed LLMErrors, and Gemma fallback formatting.
 */
import { RESPONSE_SCHEMA } from '../core/schema.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_TIMEOUT_MS = 30000;

export class LLMError extends Error {
  constructor(message, { kind = 'unknown', status = null, originalError = null } = {}) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind; // 'auth' | 'model' | 'rate_limit' | 'server' | 'timeout' | 'network' | 'blocked' | 'truncated' | 'canceled' | 'unknown'
    this.status = status;
    this.originalError = originalError;
  }
}

/**
 * Maps HTTP status codes and error payloads to user-friendly PT-BR LLMErrors.
 * @param {number} status
 * @param {object|null} data
 * @returns {LLMError}
 */
export function mapHttpError(status, data = null) {
  const apiMsg = data?.error?.message ? ` (${data.error.message})` : '';

  if (status === 401 || status === 403) {
    return new LLMError(`Chave de API inválida ou sem permissão (código ${status}). Verifique suas configurações.${apiMsg}`, {
      kind: 'auth',
      status
    });
  }

  if (status === 404) {
    return new LLMError(`Modelo não encontrado ou indisponível (código 404). Verifique o nome do modelo nas configurações.${apiMsg}`, {
      kind: 'model',
      status
    });
  }

  if (status === 429) {
    return new LLMError(`Limite de requisições excedido na API Gemini (código 429). Aguarde alguns instantes.${apiMsg}`, {
      kind: 'rate_limit',
      status
    });
  }

  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new LLMError(`Erro temporário nos servidores do Gemini (código ${status}).${apiMsg}`, {
      kind: 'server',
      status
    });
  }

  return new LLMError(`Erro na requisição à API Gemini (código ${status}).${apiMsg}`, {
    kind: 'server',
    status
  });
}

/**
 * Checks if the specified model is a Gemma family model.
 * @param {string} model
 * @returns {boolean}
 */
export function isGemmaModel(model = '') {
  return /gemma/i.test(model);
}

/**
 * Normalizes input contents into the standard Gemini REST contents structure:
 * Array of { role: 'user'|'model', parts: [{ text: string }] }
 * @param {Array} contents
 * @returns {Array}
 */
function normalizeContents(contents = []) {
  return contents.map((item) => {
    if (!item) return { role: 'user', parts: [{ text: '' }] };
    const role = item.role === 'model' ? 'model' : 'user';

    if (Array.isArray(item.parts)) {
      return {
        role,
        parts: item.parts.map((p) => (typeof p === 'string' ? { text: p } : { text: p?.text ?? '' }))
      };
    }

    if (typeof item.text === 'string') {
      return {
        role,
        parts: [{ text: item.text }]
      };
    }

    return { role, parts: [{ text: '' }] };
  });
}

/**
 * Builds the request body for Gemini REST API generateContent.
 * Handles Gemma fallback (no systemInstruction or responseSchema).
 * @param {object} params
 * @returns {object}
 */
function buildRequestBody({ system = '', contents = [], schema = null, settings = {} }) {
  const model = settings.model || DEFAULT_MODEL;
  const isGemma = isGemmaModel(model);
  const normalizedContents = normalizeContents(contents);

  if (isGemma) {
    // Gemma fallback: prepend system instruction to the first user message
    const sysPrefix = system ? `${system}\n\nResponda estritamente com o objeto JSON contendo narrative e tool_calls.\n\n` : '';
    const adaptedContents = [...normalizedContents];

    if (adaptedContents.length > 0) {
      const first = adaptedContents[0];
      const existingText = first.parts?.[0]?.text ?? '';
      adaptedContents[0] = {
        ...first,
        parts: [{ text: `${sysPrefix}${existingText}` }]
      };
    } else if (sysPrefix) {
      adaptedContents.push({ role: 'user', parts: [{ text: sysPrefix }] });
    }

    return {
      contents: adaptedContents,
      generationConfig: {
        temperature: settings.temperature ?? 0.2,
        maxOutputTokens: settings.maxOutputTokens ?? 2048
      }
    };
  }

  // Standard Gemini configuration with structured outputs
  const generationConfig = {
    temperature: settings.temperature ?? 0.2,
    maxOutputTokens: settings.maxOutputTokens ?? 2048,
    responseMimeType: 'application/json',
    responseSchema: schema || RESPONSE_SCHEMA
  };

  // Thinking configuration for Gemini 2.5 / 3 models
  if (/2\.5-flash/.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  } else if (/^gemini-3/.test(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  }

  const body = {
    contents: normalizedContents,
    generationConfig
  };

  if (system && system.trim().length > 0) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  return body;
}

/**
 * Creates an LLM client for Gemini REST API.
 * @param {object} options
 * @param {Function} [options.getSettings] Function returning current settings
 * @param {Function} [options.fetchImpl] Fetch implementation (defaults to global fetch)
 * @returns {{ generate: Function, testConnection: Function }}
 */
export function createLlmClient({ getSettings = null, fetchImpl = fetch } = {}) {
  /**
   * Generates content from the Gemini API.
   * @param {object} params
   * @param {string} [params.system] System prompt
   * @param {Array} [params.contents] History / turns
   * @param {object} [params.schema] Optional schema override
   * @param {AbortSignal} [params.signal] External cancellation signal
   * @param {object} [params.overrides] Setting overrides
   * @returns {Promise<{ text: string, finishReason: string, usage: object, latencyMs: number }>}
   */
  async function generate({ system = '', contents = [], schema = null, signal = null, overrides = {} } = {}) {
    const activeSettings = {
      ...(getSettings ? getSettings() : {}),
      ...overrides
    };

    const apiKey = activeSettings.apiKey || '';
    const model = activeSettings.model || DEFAULT_MODEL;
    const timeoutMs = activeSettings.timeoutMs ? Number(activeSettings.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
    const body = buildRequestBody({ system, contents, schema, settings: activeSettings });

    const abortController = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      abortController.abort(new Error('timeout'));
    }, timeoutMs);

    let onExternalAbort = null;
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        throw new LLMError('Requisição cancelada.', { kind: 'canceled' });
      }
      onExternalAbort = () => {
        abortController.abort(new Error('canceled'));
      };
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    try {
      let res = null;
      let attempt = 0;

      while (attempt < 2) {
        attempt++;
        try {
          res = await fetchImpl(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey
            },
            body: JSON.stringify(body),
            signal: abortController.signal
          });
        } catch (fetchErr) {
          if (signal?.aborted || abortController.signal.reason?.message === 'canceled') {
            throw new LLMError('Requisição cancelada.', { kind: 'canceled' });
          }
          if (timedOut || abortController.signal.reason?.message === 'timeout' || fetchErr.name === 'AbortError') {
            throw new LLMError(`Tempo limite esgotado (${timeoutMs / 1000}s) ao aguardar resposta do Mestre de Jogo. Verifique sua conexão ou aumente o limite nas Configurações.`, { kind: 'timeout' });
          }
          throw new LLMError(`Falha de conexão com a API Gemini: ${fetchErr.message}`, { kind: 'network', originalError: fetchErr });
        }

        // Retry once on 429, 500, or 503 if not canceled
        if (attempt === 1 && (res.status === 429 || res.status === 500 || res.status === 503)) {
          if (signal?.aborted) {
            throw new LLMError('Requisição cancelada.', { kind: 'canceled' });
          }

          let delay = 1500;
          if (res.status === 429 && res.headers?.get) {
            const retryHeader = res.headers.get('retry-after');
            if (retryHeader) {
              const sec = parseInt(retryHeader, 10);
              if (!isNaN(sec) && sec > 0) delay = sec * 1000;
            }
          }

          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, delay);
            if (signal) {
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new LLMError('Requisição cancelada.', { kind: 'canceled' }));
              }, { once: true });
            }
          });

          continue;
        }

        break;
      }

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw mapHttpError(res.status, data);
      }

      if (!data) {
        throw new LLMError('Resposta vazia recebida da API Gemini.', { kind: 'server', status: res.status });
      }

      const candidate = data.candidates?.[0];
      const finishReason = candidate?.finishReason ?? 'STOP';

      if (finishReason === 'SAFETY') {
        throw new LLMError('A resposta foi bloqueada pelos filtros de segurança do modelo Gemini (SAFETY).', { kind: 'blocked' });
      }

      if (finishReason === 'MAX_TOKENS') {
        throw new LLMError('A resposta foi truncada por exceder o limite máximo de tokens (MAX_TOKENS).', { kind: 'truncated' });
      }

      const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const usage = data.usageMetadata ?? { promptTokens: 0, outputTokens: 0 };
      const latencyMs = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);

      return {
        text,
        finishReason,
        usage,
        latencyMs
      };
    } finally {
      clearTimeout(timeoutId);
      if (signal && onExternalAbort) {
        signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  /**
   * Performs a lightweight connectivity test with the current API key and model.
   * @returns {Promise<{ ok: boolean, latencyMs: number, error: string|null, kind?: string }>}
   */
  async function testConnection() {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      const res = await generate({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        overrides: { timeoutMs: 10000, maxOutputTokens: 10 }
      });
      return { ok: true, latencyMs: res.latencyMs, error: null };
    } catch (err) {
      const latencyMs = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
      return {
        ok: false,
        latencyMs,
        error: err.message,
        kind: err.kind ?? 'unknown'
      };
    }
  }

  return {
    generate,
    testConnection
  };
}

/**
 * Legacy adapter wrapper for backwards compatibility with test fixtures.
 * @param {object} opts
 */
export function createGeminiAdapter({ getSettings = null, fetchImpl = fetch } = {}) {
  const client = createLlmClient({ getSettings, fetchImpl });
  return {
    name: 'gemini',
    getTimeoutSeconds() {
      const s = getSettings ? getSettings() : {};
      if (s.timeoutSeconds) return Number(s.timeoutSeconds);
      const isGemma = isGemmaModel(s.model || '');
      return isGemma ? 120 : (s.timeoutMs ? s.timeoutMs / 1000 : 60);
    },
    async send(request, { signal } = {}) {
      const timeoutMs = (request?.overrides?.timeoutMs) || (getSettings?.().timeoutSeconds ? getSettings().timeoutSeconds * 1000 : undefined);
      const overrides = timeoutMs ? { timeoutMs } : {};
      return client.generate({
        system: request.system,
        contents: request.contents,
        signal,
        overrides
      });
    }
  };
}
