# ⬡ OMNI-SCRAPER

> The world's most advanced AI-powered web scraping system.
> A distributed swarm of LLM agents that browse the web as humans do.

---

## Architecture

```
ORCHESTRATOR → PLANNER → TASK DAG → CELERY WORKER POOL
                                           ↓
                               LANGGRAPH AGENT LOOP
                                 Perceive → Reason → Act → Extract
                                           ↓
                               COLLECTIVE MEMORY (Qdrant)
```

## LLM Engines (choose one)

| Provider | Model | Source | Vision |
|----------|-------|--------|--------|
| Anthropic | `claude-sonnet-4-5` | Closed | ✓ |
| OpenAI | `gpt-4o` | Closed | ✓ |
| Moonshot | `moonshotai/kimi-k2.5` | Open | ✓ |
| Alibaba | `qwen/qwen3.5-397b-a17b` | Open | — |

## Quick Start (GitHub Codespaces)

```bash
# 1. Open in Codespaces — setup runs automatically
# 2. Add API keys to .env
# 3. Terminal 1:
uvicorn backend.api.server:app --reload --port 8000

# 4. Terminal 2:
cd frontend && npm run dev

# 5. Open http://localhost:3000
```

## Manual Setup

```bash
bash setup.sh
cp .env.example .env   # add your API keys
```

## Key Features

- **LLM Decision Engine** — LangGraph agent loop with 4 provider options
- **Human Behavior Simulation** — Bézier mouse, biometric typing, scroll physics
- **AIMD + PID Rate Control** — Self-tuning congestion control, no manual config needed
- **Distributed Swarm** — 100+ Celery workers with shared Qdrant memory
- **Semantic NLP** — spaCy NER + LLM schema mapping for unstructured text
- **Real-time UI** — WebSocket streaming, animated mission log, one-click export
- **Export** — JSON, CSV, TSV with instant download

## Project Structure

```
omni-scraper/
├── backend/
│   ├── core/         # LLM router (4 providers)
│   ├── behavior/     # Human simulation engine
│   ├── control/      # AIMD + PID rate controller
│   ├── cognition/    # LangGraph agent loop
│   ├── semantics/    # NLP pipeline
│   ├── swarm/        # Celery orchestration
│   └── api/          # FastAPI + WebSocket server
├── frontend/         # React + Vite UI
├── infra/            # Docker Compose (Redis + Qdrant)
└── config/           # Settings + targets
```

## Environment Variables

See `.env.example` for full configuration reference.

Required: At least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`.

---

*Built as an engineering learning project. Use responsibly on public data only.*
