/**
 * Session recorder + deterministic replay. Every payload that reaches the
 * queue is recorded (source + payload). Replaying the log from the initial
 * state through the GM path must reproduce the same final state hash.
 */
import { hashState } from '../engine/gameState.js';
import { submitRaw } from './ingest.js';

export const SESSION_VERSION = 1;

export function createSessionRecorder({ bus, store }) {
  let entries = [];
  let llmRaw = [];

  bus.on('job:start', ({ payload, source }) => {
    if (source === 'replay') return;
    entries.push({ source, payload });
  });
  bus.on('llm:response', ({ text, attempt }) => {
    llmRaw.push({ attempt, text });
  });

  return {
    clear() {
      entries = [];
      llmRaw = [];
    },
    get entries() {
      return entries;
    },
    export() {
      return {
        version: SESSION_VERSION,
        createdAt: new Date().toISOString(),
        entries,
        llmRaw,
        finalTurn: store.get().turn,
        finalStateHash: hashState(store.get()),
      };
    },
  };
}

/**
 * Replays a session log. Caller must reset the state first.
 * @returns {Promise<{hash: string, expected: string|undefined, match: boolean}>}
 */
export async function replaySession(log, { queue, bus, store, animate = false }) {
  if (!log || !Array.isArray(log.entries)) throw new Error('Arquivo de sessão inválido: "entries" ausente');
  for (const entry of log.entries) {
    await submitRaw(entry.payload, { queue, bus, source: 'replay', animate });
  }
  const hash = hashState(store.get());
  return { hash, expected: log.finalStateHash, match: hash === log.finalStateHash };
}
