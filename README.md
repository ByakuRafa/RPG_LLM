# RPG_LLM — AI Game Master PoC

> **Proof of Concept (PoC)** de RPG 2D por turnos onde um Modelo de Linguagem (LLM) atua como Mestre de Jogo (Game Master), interpretando comandos em linguagem natural e emitindo um contrato estrito em JSON (`narrative` + `commands`). Um motor desacoplado no frontend valida regras e atualiza o estado visual via **Fila de Ações (Action Queue)** sobre um canvas 2D.

Construído sob a restrição estrita: **Web pura estática, sem servidor de backend (zero-server), zero dependências de build ou npm.**

---

## 🚀 Como Executar Localmente

Como o projeto utiliza **JavaScript ES Modules nativos** para garantir o isolamento e modularidade de código, os navegadores exigem que a aplicação seja servida via HTTP (não via `file://`).

### Opção 1: VS Code Live Server (Recomendado)
1. Abra a pasta `RPG_LLM` no VS Code.
2. Clique com o botão direito no arquivo `index.html` e selecione **"Open with Live Server"**.
3. O jogo abrirá no seu navegador em `http://127.0.0.1:5500/index.html`.

### Opção 2: Node.js (Sem instalar nada no projeto)
No terminal do projeto, execute qualquer servidor estático rápido:
```bash
npx serve .
# ou
python -m http.server 8000
```

---

## 🧪 Como Executar os Testes

O projeto conta com uma suíte de 32 testes unitários e de regressão com 100% de cobertura das regras, schema e motor:

- **Pelo Navegador:** Abra `tests/index.html` no Live Server ou clique no botão **"🧪 Executar Testes"** no topo da tela do jogo.
- **Pelo Terminal (Node.js):**
  ```bash
  node tests/runNode.js
  ```

---

## 🕹 Recursos Principais e Arquitetura

### 1. "Human GM Mode" (Painel do Mestre Humano)
Localizado na coluna direita (ou minimizado pela tecla **G**), este painel permite **ignorar completamente a IA** e injetar payloads mockados diretamente na Fila de Ações:
- **Botões de Ação Rápida:** `Spawn Goblin`, `Mover Herói`, `Atacar`, `Causar Dano`, `Interagir (Porta/Baú)`, `Saquear (Loot)`.
- **Harness de Casos Inválidos:** Botões para testar rejeição de regras (andar na parede, sair do mapa, atacar sem alcance, abrir baú já aberto, comandos malformados).
- **Injetor de JSON Bruto:** Permite colar qualquer objeto JSON manual e enviá-lo ao motor após validação em tempo real.
- **Gravador e Replay Determinístico:** Exporta a sessão completa em `.json` e permite reproduzi-la verificando o hash exato do estado final.

### 2. Integração com IA (Google Gemini & Simulador Mock)
- **Simulador Mock (Padrão):** Já vem ativado por padrão! Não gasta tokens e permite testar comandos naturais como *"abro a porta"*, *"ataco o goblin"*, *"pego o que está no baú"* imediatamente.
- **Google Gemini (Google AI Studio):**
  1. Clique em **"⚙ Configurações"** no topo.
  2. Mude o provedor para **Google Gemini**.
  3. Cole sua chave gratuita do Google AI Studio (`AIzaSy...`).
  4. Selecione o modelo (ex: `gemini-2.5-flash` ou `gemini-3.8-flash`).
  5. A chave é salva apenas no seu `localStorage` local e as requisições REST são feitas **diretamente do seu navegador**, sem nenhum servidor intermediário (graças ao suporte nativo a CORS do Gemini).

### 3. Fila de Ações Desacoplada (Action Queue)
Quando o Mestre (IA ou Humano) envia múltiplos comandos encadeados (ex: `Mover` → `Atacar` → `Saquear`):
- O motor valida as regras de cada comando antes de aplicar.
- O redutor aplica o comando no estado do jogo.
- A fila **aguarda a animação linear curta (lerp ≤ 450ms)** do Canvas 2D antes de iniciar o próximo comando.

---

## 📜 Contrato JSON v1

```json
{
  "narrative": "Você avança sorrateiramente e atinge o goblin em cheio!",
  "commands": [
    { "type": "MOVE", "id": "player", "target": "goblin_1" },
    { "type": "ATTACK", "attacker": "player", "target": "goblin_1" },
    { "type": "ATTACK", "attacker": "goblin_1", "target": "player" }
  ]
}
```

### Comandos Suportados pelo Motor:
| Tipo | Campos | Validação do Motor |
|---|---|---|
| `MOVE` | `id`, `to: {x,y}` ou `target: string` | Caminho desobstruído (BFS), sem colisão com paredes ou criaturas |
| `ATTACK` | `attacker`, `target` | Criaturas devem ser adjacentes (distância Manhattan = 1) |
| `DAMAGE` | `target`, `amount` | Aplica dano direto; remove criaturas e cria `bag_<id>` com espólio se HP ≤ 0 |
| `INTERACT` | `actor`, `target` | Adjacente; abre portas ou baús fechados |
| `LOOT` | `actor`, `from`, `item?` | Adjacente; container deve estar aberto; transfere itens |
| `SPAWN` | `id`, `kind`, `at: {x,y}` | Casa livre e dentro do mapa |
| `DESPAWN` | `id` | Remove entidade (jogador não pode ser removido) |

---

## 📁 Estrutura de Arquivos

```
RPG_LLM/
├── index.html              # Layout principal da aplicação
├── styles.css              # Tema escuro e responsivo (zero dependências)
├── README.md               # Documentação técnica e instruções
├── src/
│   ├── main.js             # Ponto de entrada e bootstrap
│   ├── core/
│   │   ├── eventBus.js     # Barramento desacoplador (Pub/Sub)
│   │   ├── schema.js       # Validador estrutural de contrato JSON v1
│   │   ├── fixtures.js     # Presets canônicos compartilhados (GM e testes)
│   │   ├── ingest.js       # Ponto de ingestão comum para IA e GM Humano
│   │   ├── metrics.js      # Métricas de latência, taxa de erro e rejeição
│   │   └── session.js      # Gravação de sessão e replay determinístico
│   ├── engine/
│   │   ├── map.js          # Mapa estático 12x12 e lógica de coordenadas
│   │   ├── entities.js     # Catálogo de entidades (herói, goblin, baú, porta)
│   │   ├── rules.js        # Motor de regras e pathfinding BFS
│   │   ├── gameState.js    # Redutor puro de estado e hash determinístico
│   │   └── actionQueue.js  # Fila de ações sequencial com sincronia de animações
│   ├── render/
│   │   └── gridRenderer.js # Renderizador Canvas 2D com interpolação (lerp)
│   ├── ui/
│   │   ├── hud.js          # Barra de vida, ataque, turno e inventário
│   │   ├── chat.js         # Crônica narrativa e entrada de texto do jogador
│   │   ├── debugLog.js     # Console de auditoria técnica e métricas ao vivo
│   │   └── settingsModal.js# Modal de configurações (Gemini API, modelos)
│   ├── gm/
│   │   └── gmPanel.js      # Painel do Mestre Humano (Human GM Mode)
│   └── llm/
│       ├── promptBuilder.js# System prompt (EN) + Narrativa (PT-BR) + Snapshot
│       ├── responseParser.js # Extrator resiliente de JSON e reparador
│       ├── llmClient.js    # Adaptador REST Google Gemini + Mock Simulator
│       └── gameMaster.js   # Orquestrador de turnos com auto-repair
└── tests/
    ├── index.html          # Executor gráfico de testes no navegador
    ├── runner.js           # Framework de testes unitários minimalista
    ├── runNode.js          # Executor de testes no terminal via Node
    ├── schema.test.js      # Testes do validador de schema
    ├── rules.test.js       # Testes do motor de regras
    ├── gameState.test.js   # Testes do redutor de estado
    ├── actionQueue.test.js # Testes da fila de ações
    ├── responseParser.test.js # Testes do parser de JSON da IA
    ├── session.test.js     # Testes de replay e determinismo
    └── goldenFixtures.test.js # Testes de regressão de fixtures
```
