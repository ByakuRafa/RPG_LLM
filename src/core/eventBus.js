/**
 * Minimal pub/sub bus. The only coupling point between engine, renderer,
 * UI, GM panel and LLM pipeline.
 */
export function createEventBus() {
  const handlers = new Map();

  function on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return () => off(event, fn);
  }

  function off(event, fn) {
    handlers.get(event)?.delete(fn);
  }

  function emit(event, data) {
    for (const fn of handlers.get(event) ?? []) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[eventBus] handler for "${event}" failed`, err);
      }
    }
    for (const fn of handlers.get('*') ?? []) {
      try {
        fn({ event, data });
      } catch (err) {
        console.error('[eventBus] wildcard handler failed', err);
      }
    }
  }

  return { on, off, emit };
}
