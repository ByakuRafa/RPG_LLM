---
trigger: always_on
---

# Ground Rules & Permanent Workspace Constraints (implementation_sprints.md §0)

1. **Stack**: Pure Vanilla JS (ES6 modules), HTML5 Canvas 2D, and CSS3. Zero npm packages, zero build tools or bundlers. Served via any static HTTP server.
2. **Strict Layering (§0.1)**:
   - `src/core/*`: 100% pure JS. No DOM (`document`/`window`), no Canvas, no `fetch`. May only import other `src/core/*`.
   - `src/engine/*`: 100% pure JS logic. No DOM, no Canvas, no `fetch`, no UI/render/LLM imports. May import `src/core/*` and other `src/engine/*`.
   - `src/render/*`: Canvas rendering only. May import `src/core/config.js`. Pure consumer of state & injected animator.
   - `src/ui/*`: DOM only. May import `src/core/*` and read-only catalogs. Never directly mutates state.
   - `src/llm/*`: Network & prompt generation. May import `src/core/*` and read-only engine selectors/pathfinding/map toAscii. Never mutates state.
   - `src/main.js`: Composition root where layers are wired together.
   - Engine authority: The engine (`rules.js` / `actionQueue.js`) is the absolute authority; UI and LLM layers only propose actions/intents.
3. **Determinism**: Never use `Math.random()` inside `src/core` or `src/engine`. Always use seeded PRNG from `src/core/prng.js`.
4. **Security & Sanitization**: Never use `innerHTML` for player or LLM strings; always use `textContent` (or safe DOM element construction).
