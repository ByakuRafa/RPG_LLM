# Tactical Party RPG with LLM Game Master — Master Design & Implementation Plan

## 1. Executive Summary & Project Scope
A turn-based tactical RPG Proof of Concept (PoC) inspired by *Baldur's Gate* and Virtual Tabletops (VTT), built for the **Artificial Intelligence II** postgraduate course. 

Three human players control a party of distinct hero classes in a local **Hotseat** setup (single screen / shared session via screen share), typing their desired actions in **Brazilian Portuguese (PT-BR)**. An LLM acts as the Game Master (GM), interpreting natural language intentions and UI ability tags to invoke strict **Function Calling / Tool Use**. A deterministic JavaScript Rules Engine validates every action, enforces movement and action limits, updates the 2D board, and logs all outcomes.

- **Tech Stack:** Pure static web (HTML5 + CSS3 + Vanilla JavaScript ES Modules + Canvas 2D). Zero build steps, zero external npm dependencies.
- **Timeline:** 4 Weeks (4 Agile Sprints).
- **Academic Core:** Quantitative evaluation of LLM Function Calling (Tool Selection Accuracy, Argument Precision, and Illegal Action Handling) comparing two prompting strategies over a reproducible seeded dungeon.

---

## 2. Core Gameplay Loop & Party Mechanics

### 2.1. Three-Player Hotseat Party
Players take turns sequentially on the same client instance. Each player controls one specific hero class with fixed base attributes and 2 unique abilities:

| Player | Class | Token Color (Fallback) | HP | Step Limit (MP) | Range | Unique Abilities (`ability_id`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Player 1** | **Warrior** (*Guerreiro*) | Red (`#E53935`) | 30 | 4 tiles | 1 (Melee) | `slash` (6 dmg, melee)<br>`shield_bash` (4 dmg + push 1 tile) |
| **Player 2** | **Mage** (*Mago*) | Blue (`#1E88E5`) | 18 | 3 tiles | 4 (Ranged) | `firebolt` (7 dmg, ranged)<br>`heal_pulse` (+8 HP to ally within 3 tiles) |
| **Player 3** | **Rogue** (*Ladino*) | Green (`#43A047`) | 22 | 5 tiles | 2 (Short) | `backstab` (8 dmg melee)<br>`lockpick` (open locked chests/doors) |

### 2.2. Turn Economy & Action Limits
The engine enforces a strict initiative cycle:
`Player 1 (Warrior)` $\rightarrow$ `Player 2 (Mage)` $\rightarrow$ `Player 3 (Rogue)` $\rightarrow$ `Enemy Phase`.

At the start of a hero's turn, the engine restores their resources:
- **Movement Points (MP):** Equal to the class Step Limit (e.g., 4 steps for Warrior).
- **Action Points (AP):** `1 AP` per turn (spent by calling `use_ability`, `use_item`, or `interact_object`).
- **Free Actions:** `check_inventory` costs `0 AP` and `0 MP`.

---

## 3. Specialized Systems Architecture

### 3.1. Chess-Like Movement & Lightweight Reachability (BFS)
To create a clean, chess-like board experience where the system already limits where a player can walk and moves the token directly from Point A to Point B without clipping through walls:
- **Reachable Tile Calculation:** At the start of a player's turn (and after each move), a lightweight 25-line **Breadth-First Search (BFS) flood-fill** (`pathfinding.js`) calculates the exact step distance to all tiles on the $12 \times 12$ grid, accounting for walls and occupied tiles.
- **Chess-Style Visual Highlight:** `gridRenderer.js` highlights all valid reachable tiles (`distance <= remaining_MP`) with a semi-transparent blue overlay on the Canvas. Players immediately see where they are allowed to go.
- **Direct A-to-B Execution:** When the LLM invokes `move_character(id, target_x, target_y)`, the engine checks if `(target_x, target_y)` is inside the valid reachable set. If valid, the token glides directly from Point A to Point B via linear interpolation (`lerp` over 250ms) and deducts the exact step cost from `remaining_MP`.

### 3.2. UI Ability Tags + Natural Language Input (PT-BR)
The player never moves pieces manually on the board; all actions flow through the LLM Game Master:
1. **Selecting an Ability Tag:** On their turn, a player can click an ability button on the HUD (e.g., `[Firebolt]`) or an item (`[Health Potion]`). This does **not** immediately execute the action. Instead, it attaches a visible semantic badge above the chat input: `[Tag Ativa: firebolt]`.
2. **Natural Language Description (PT-BR):** The player types their intention in Portuguese in the chat box (e.g., *"Vou caminhar até ficar alinhado com o goblin perto do baú e lançar minha bola de fogo nele!"*).
3. **Prompt Injection:** `promptBuilder.js` packages the active player's state, the Portuguese text, and the explicit UI tag (`selected_ui_tag: "firebolt"`) into the LLM context.
4. **LLM Execution:** The LLM translates the Portuguese intention and UI tag into sequential tool calls (`move_character` followed by `use_ability`), while generating the response narrative in **Portuguese**.

### 3.3. Dual-Mode Enemy Phase (JS Heuristic Default + LLM Hook)
To keep turns fast and save API quota during initial development while allowing future LLM monster control:
- **Strategy Pattern (`enemyController.js`):** During the `Enemy Phase`, the Turn Tracker invokes `enemyController.executeTurn(gameState)`.
- **Mode 1: Deterministic JS AI (Default):** Pure JavaScript logic iterates over alive monsters. Each monster calculates the shortest path toward the nearest hero, moves up to its step limit (3 tiles), and executes a basic melee attack if adjacent (`distance == 1`). It emits standard command objects directly into `actionQueue.js`.
- **Mode 2: LLM Monster Master (Stretch Goal Hook):** By toggling a single flag (`enemyAIMode: "LLM"`), `enemyController.js` sends the monster coordinates to the LLM using the exact same Function Calling pipeline, allowing the AI Game Master to tactically maneuver monsters and narrate their turn.

### 3.4. VTT Token System (Colored Squares $\rightarrow$ Custom Sprites)
The grid uses a standard Virtual Tabletop tile size (`64x64px` on a `768x768px` Canvas for a $12 \times 12$ dungeon). Every entity is configured via an asset dictionary:
```javascript
{
  id: "hero_warrior",
  name: "Thorin",
  role: "player",
  color: "#E53935",                  // Phase 1: Colored square fallback
  tokenUrl: null,                    // Phase 2: e.g., "./assets/tokens/warrior_64.png"
  position: { x: 2, y: 10 },
  hp: 30, maxHp: 30, mp: 4, maxMp: 4, ap: 1
}
```
- **Fallback Rendering:** When `tokenUrl` is `null`, `gridRenderer.js` draws a stylized colored square with rounded borders, class initials (`W`, `M`, `R`, `G`), and an overhead HP bar.
- **Plug-and-Play Sprite Upgrade:** Replacing `tokenUrl` with a valid image path (`64x64px` or `128x128px` PNG/WebP) automatically switches rendering to `ctx.drawImage()` clipped to the tile bounds.

---

## 4. LLM Function Calling Contract & Rules Engine

### 4.1. Architecture Flow
```
[Player Input (PT-BR) + UI Tag] 
       │
       ▼
[llm/promptBuilder.js] ──(State Snapshot + Tool Schemas)──► [LLM API (Gemini)]
                                                                   │
       ◄───────────(JSON: Narrative PT-BR + tool_calls[])──────────┘
       │
       ▼
[core/schema.js] ──(Invalid Syntax)──► [Activity Log + 1x Repair Retry]
       │ (Valid Schema)
       ▼
[engine/actionQueue.js] ──(Step-by-step)──► [engine/rules.js (Authority)]
                                                   │
                    ┌──────────────────────────────┴──────────────────────────────┐
                    ▼ (Rule Passed)                                               ▼ (Rule Violated)
        [engine/gameState.js]                                         [Reject Action & Halt Sequence]
        Update coords, HP, MP, AP                                     Log Warning in Activity Log (PT-BR)
        Render on Canvas + Log Success                                Notify Player/LLM of Illegal Action
```

### 4.2. Tool Schemas (Exposed to LLM)
All tool names and parameters remain in English for maximum LLM accuracy:

| Tool Name | Arguments | Engine Validation Rules (`rules.js`) |
| :--- | :--- | :--- |
| `move_character` | `character_id`, `target_x`, `target_y` | 1. Is `character_id` the active character?<br>2. Is `(target_x, target_y)` inside the BFS valid reachable tiles (`cost <= remaining_MP`)? |
| `use_ability` | `caster_id`, `ability_id`, `target_id` | 1. Does caster have `AP >= 1`?<br>2. Does `ability_id` belong to caster?<br>3. Is Manhattan distance to `target_id` $\le$ ability range? |
| `use_item` | `character_id`, `item_id`, `target_id` | 1. Does character have `AP >= 1`?<br>2. Does party inventory contain `item_id` with `qty >= 1`? |
| `interact_object`| `character_id`, `object_id` | 1. Does character have `AP >= 1`?<br>2. Is character adjacent (`distance == 1`) to `object_id` (chest/door)? |
| `check_inventory`| `character_id` | Always valid (`0 AP`, `0 MP`). Outputs current items to Activity Log. |
| `end_turn` | `character_id` | Always valid for active character. Advances Turn Tracker to next entity. |

### 4.3. JSON Response Envelope
```json
{
  "narrative": "Thorin avança com passos pesados pelas pedras úmidas e desfere um golpe brutal com sua espada no Goblin!",
  "tool_calls": [
    {
      "name": "move_character",
      "arguments": { "character_id": "hero_warrior", "target_x": 4, "target_y": 8 }
    },
    {
      "name": "use_ability",
      "arguments": { "caster_id": "hero_warrior", "ability_id": "slash", "target_id": "goblin_1" }
    }
  ]
}
```

---

## 5. Project Directory Structure

```text
rpg-llm-poc/
├── index.html                  # Main layout: Top Turn Bar, Left Canvas, Right Chat/Logs, Bottom HUD
├── styles.css                  # Dark fantasy VTT theme + layout grid
├── assets/
│   └── tokens/                 # Optional 64x64 PNG sprites (warrior.png, mage.png, etc.)
├── src/
│   ├── main.js                 # Application bootstrap & module wiring
│   ├── core/
│   │   ├── eventBus.js         # Pub/Sub event emitter for decoupled UI/Engine updates
│   │   ├── prng.js             # Mulberry32 seeded random generator for reproducible dungeons
│   │   ├── schema.js           # Tool call JSON contract validator
│   │   └── fixtures.js         # Mock JSON payloads for Human GM Mode & tests
│   ├── engine/
│   │   ├── mapGenerator.js     # Seeded 12x12 dungeon generator (walls, floor, chests, spawns)
│   │   ├── pathfinding.js      # BFS flood-fill for Chess-style valid movement tiles
│   │   ├── gameState.js        # Immutable state container & state mutators
│   │   ├── turnTracker.js      # Initiative cycle (P1 -> P2 -> P3 -> Enemy Phase)
│   │   ├── rules.js            # Strict legality validator for the 6 tools
│   │   ├── actionQueue.js      # Sequential async processor with 250ms animation delay
│   │   └── enemyController.js  # Strategy controller: JS Heuristic AI (default) + LLM AI hook
│   ├── render/
│   │   └── gridRenderer.js     # Canvas 2D renderer (grid, BFS highlights, squares/sprites, HP bars)
│   ├── ui/
│   │   ├── hud.js              # Active hero stats, MP/AP counters, Ability/Item tag buttons
│   │   ├── chat.js             # PT-BR natural language input, Active Tag badge, GM narrative box
│   │   ├── activityLog.js      # Structured system log ([SUCCESS], [REJECTED], [TURN], [COMBAT])
│   │   └── gmPanel.js          # Human GM Mode testing dashboard (manual tool triggers + raw JSON)
│   └── llm/
│       ├── llmClient.js        # Gemini API fetch wrapper (CORS-compatible, JSON schema enforcement)
│       ├── promptBuilder.js    # Builds System Prompt (Config A vs Config B) + State Snapshot
│       ├── responseParser.js   # Sanitizes LLM text, extracts JSON, handles 1-shot repair
│       └── evaluator.js        # Automated academic benchmark runner (testSuite execution & metrics)
└── tests/
    ├── index.html              # Browser-based unit test runner
    ├── runner.js               # Lightweight assertion library
    └── testSuite.json          # 30 PT-BR evaluation commands (Direct, Ambiguous, Illegal)
```

---

## 6. 4-Week Agile Development Plan

### Sprint 1: Seeded Dungeon, Chess Movement & Human GM Mode
- **Goal:** Build the visual $12 \times 12$ board, 3-player Turn Tracker, BFS Chess-like movement highlighting, and Human GM testing panel without calling any external LLM API.
- **Deliverables:**
  - Seeded procedural map generator (`mapGenerator.js`) producing a deterministic dungeon layout via seed `"IA2_DUNGEON_01"`.
  - Canvas renderer (`gridRenderer.js`) drawing the grid, colored class squares (with sprite loader ready), HP bars, and blue Chess-like reachable tile highlights.
  - Turn Tracker cycling through Warrior, Mage, Rogue, and Enemy Phase, resetting MP and AP.
  - **Human GM Mode Panel:** Developer drawer allowing manual execution of `move_character`, `use_ability`, `end_turn`, or raw JSON injection into `actionQueue.js`.
  - Activity Log panel displaying executed actions in PT-BR.
- **Technical Tasks:**
  - *Frontend:* Build 3-column VTT interface in `index.html` and `styles.css`. Implement `gridRenderer.js` with `requestAnimationFrame` interpolation for smooth A-to-B token movement. Build `gmPanel.js` and `activityLog.js`.
  - *Backend/Engine:* Implement `prng.js`, `mapGenerator.js`, `pathfinding.js` (BFS reachable set), `gameState.js`, `turnTracker.js`, and `actionQueue.js`.
- **Integration Check:** Clicking "Next Turn" cycles active heroes and updates the blue reachable movement zone on the grid; clicking "Move Warrior" in the Human GM panel smoothly glides the red square to the target tile and deducts MP.

### Sprint 2: Rules Engine, Class Abilities & Deterministic Enemy AI
- **Goal:** Enforce all game rules (step limits, range checks, AP costs, inventory) and implement the deterministic JavaScript Enemy Phase.
- **Deliverables:**
  - Complete implementation of all 6 tools (`move_character`, `use_ability`, `use_item`, `interact_object`, `check_inventory`, `end_turn`) validated by `rules.js`.
  - Bottom HUD (`hud.js`) showing active player class, HP, remaining MP/AP, inventory items, and clickable Ability Tag buttons.
  - Deterministic JS Enemy Phase (`enemyController.js`) where goblins move toward the nearest hero and attack at the end of the party round.
  - Preset buttons in Human GM Mode for testing **illegal actions** (e.g., walking beyond MP limit, attacking out of range, moving into a wall).
- **Technical Tasks:**
  - *Frontend:* Implement `hud.js` with interactive ability/item tag buttons that attach `[Tag Ativa: ...]` to `chat.js`. Add visual hit flashes on tokens when damage is taken.
  - *Backend/Engine:* Code all validation predicates in `rules.js`. Implement combat damage resolution, chest looting, and `HeuristicEnemyStrategy` in `enemyController.js`. Write unit tests for legal and illegal tool calls.
- **Integration Check:** A complete dungeon encounter can be played from start to finish using the Human GM Panel; illegal commands are strictly blocked by `rules.js` and logged in red in the Activity Log without corrupting game state.

### Sprint 3: LLM Function Calling Pipeline (PT-BR Input $\rightarrow$ Tool Execution)
- **Goal:** Connect the Google Gemini API with structured Function Calling so players can play via natural language in Portuguese alongside UI ability tags.
- **Deliverables:**
  - `llmClient.js` integrated with Gemini REST API (`responseMimeType: "application/json"` / `responseSchema`), with API key stored safely in `localStorage`.
  - `promptBuilder.js` supporting two selectable prompting strategies for academic comparison:
    - **Config A (Zero-Shot Baseline):** Role instructions + tool schemas + raw state coordinates.
    - **Config B (Few-Shot + Spatial Context):** Role instructions + pre-computed valid BFS moves list + distance table to enemies + 3 PT-BR few-shot examples (including how to refuse illegal requests).
  - End-to-end chat flow: Player selects UI tag + types PT-BR action $\rightarrow$ LLM outputs PT-BR narrative + `tool_calls` $\rightarrow$ Engine validates and animates on board.
- **Technical Tasks:**
  - *Frontend:* Wire `chat.js` form submission, loading spinner (*"O Mestre está pensando..."*), and API Settings modal (Key, Model selector, Config A/B switch).
  - *Backend/LLM:* Implement `llmClient.js`, `promptBuilder.js`, and `responseParser.js` (including 1-shot automatic error recovery if JSON is malformed). Feed engine rule rejections back into the chat/log so the player knows why an impossible action failed.
- **Integration Check:** All 3 players can play a full round typing naturally in Portuguese (e.g., *"Ando 3 casas para o norte e uso corte no goblin_1"*); if a player asks to walk 10 tiles, the system blocks the move and warns the player clearly.

### Sprint 4: Academic Evaluation Harness, VTT Sprites & Final Polish
- **Goal:** Execute the quantitative experiments required for the IA II technical report, add custom $64 \times 64$ character images, and prepare the 8-minute live presentation build.
- **Deliverables:**
  - Benchmark dataset (`testSuite.json`) with 30 standardized PT-BR test prompts divided into:
    1. *10 Direct Commands* (e.g., *"Mova o guerreiro para x=4, y=8"*).
    2. *10 Ambiguous/Contextual Commands* (e.g., *"Estou muito ferido, quero recuperar vida"* $\rightarrow$ must call `use_item` with `health_potion` or `heal_pulse`).
    3. *10 Adversarial/Illegal Commands* (e.g., *"Atravesso a parede e mato todos os monstros de uma vez"*).
  - Automated Evaluation Runner (`evaluator.js`) that runs all 30 prompts against **Config A** and **Config B**, exporting a CSV/JSON summary table with:
    - **Tool Selection Accuracy (%)**
    - **Argument Precision (%)**
    - **Illegal Action Handling / Rejection Rate (%)**
    - **Average Latency (ms)**
  - Custom `64x64px` VTT token sprites loaded for Warrior, Mage, Rogue, Goblin, and Chest.
  - Optional toggle for LLM-driven Enemy Phase if time permits.
- **Technical Tasks:**
  - *Frontend:* Add "Run Academic Benchmark" button in the GM Panel displaying real-time progress and a final comparison table. Drop PNG sprites into `assets/tokens/` and update `tokenUrl` in entity configs.
  - *Backend/LLM:* Build `evaluator.js` to reset `gameState` to a known snapshot before each test case in `testSuite.json`, record LLM outputs, and compute scores.
- **Integration Check:** Benchmark runner completes all 30 test cases for both Prompt Config A and Config B and exports the metrics table for the report; the live game runs smoothly in the browser for the 8-minute group presentation.