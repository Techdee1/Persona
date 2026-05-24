# PERSONA

**Psychological and Experiential Reasoning for Simulating Online Nigerian Agents**

PERSONA is a user modeling and recommendation system built for the **DSN × Bluechip Tech LLM Agent Challenge** (Data & AI Summit Hackathon 3.0). It constructs a structured psychological profile from each user's review history and uses it to power two competition tasks:

| Task | Input | Output |
|---|---|---|
| **A — Review Simulation** | User history + target item | Predicted star rating · reasoning trace · generated review in the user's voice |
| **B — Agentic Recommendation** | User history or cold-start answers | Ranked items with per-item explanations · full agent step trace |

Live demo: **https://persona-eight-flax.vercel.app** · API: **https://personabackend.duckdns.org/docs**

Solution papers: [Task A PDF](docs/PERSONA_Task_A_Solution_Paper.pdf) · [Task B PDF](docs/PERSONA_Task_B_Solution_Paper.pdf)

---

## How It Works

### Psychological Profile (shared foundation for both tasks)

Every user is represented by a **five-layer behavioral twin** built from their review history:

| Layer | Module | What it captures |
|---|---|---|
| Rating Calibration | `rating_calibration.py` | User mean vs population mean; confidence bands by history depth |
| Vocabulary Fingerprint | `signal_extraction.py` | Review length, Type-Token Ratio, avg sentence length |
| Value Priority Graph | `signal_extraction.py` | Mention frequency across food / service / price / atmosphere |
| Cultural Register | `cultural_signals.py` | Nigerian English index, pidgin term hits, code-switching flag |
| Living Trajectory | `trajectory.py` | Early-vs-recent rating drift and review length drift |

### Task A — Review Simulation

Given a user profile and a target item, the system:
1. Predicts a star rating calibrated against the user's historical mean (confidence band scales with history depth)
2. Builds a reasoning trace explaining which profile signals drove the prediction
3. Generates a review matching the user's vocabulary, priorities, and cultural register (template path or GPT-4o LLM path)

For users with Nigerian English / pidgin signals, the LLM prompt instructs GPT-4o to preserve the user's code-switching patterns. Example output for a detected pidgin user: *"Food dey okay, but price no too friendly. Na wa for service."*

### Task B — Agentic Recommendation

A **four-step agentic pipeline** delivers personalized recommendations:

```
build_profile → extract_axes → retrieve_candidates → score_candidates
```

1. **build_profile** — construct the PsychologicalProfile (cached by SHA-256 content hash)
2. **extract_axes** — derive weighted PreferenceAxis objects (value, rating bias, cultural register)
3. **retrieve_candidates** — cosine similarity search over 200,192 Yelp review embeddings
4. **score_candidates** — deliberative reranking: `score = cosine_sim + Σ axis.weight − Σ penalties`

Every recommendation includes a human-readable explanation of which axes fired. The pipeline runs deterministically by default; optionally GPT-4o generates the tool-call plan (with a deterministic fallback for any omitted steps).

For full agentic workflow documentation, see **[AGENTS.md](AGENTS.md)**.

---

## Architecture

```
User Input
    │
    ▼
FastAPI Layer ────────────────────────────────────────────────────────────
    │                                                                     │
    ▼                                                                     ▼
Profile Engine                                               Cold-Start Engine
  ├── signal_extraction.py  (rating stats, stylometry, value keywords)     └── 4-question elicitation
  ├── cultural_signals.py   (Nigerian English / pidgin detection)               → bootstrap_profile()
  ├── trajectory.py         (early-vs-recent drift)
  └── PsychologicalProfile
         │
    ┌────┴───────────────────────────────────────────┐
    ▼                                                ▼
Task A Engine                                  Task B Agent
├── rating_calibration.py                      ├── preference_axes.py
├── task_a_service.py                          ├── agent_orchestrator.py   ← $ref wiring
├── review_generator.py (template path)        ├── agent_tool_defs.py      ← 4 registered tools
└── llm_prompts.py (LLM path)                 ├── deliberative_scoring.py
                                               ├── task_b_agent_service.py
                                               └── vector_store_service.py
                                                      │
                                              VectorStoreService
                                              └── 200k Yelp embeddings
                                                  (all-MiniLM-L6-v2, 384-d)
```

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/Techdee02/Persona.git
cd Persona
pip install -r backend/requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — minimum required: nothing (all features have defaults)
# To enable LLM: set ENABLE_LLM=true and OPENAI_API_KEY=sk-...
```

Key environment variables:

| Variable | Default | Description |
|---|---|---|
| `ENABLE_LLM` | `false` | Enable OpenAI LLM for review generation and agent planning |
| `OPENAI_API_KEY` | — | Required when `ENABLE_LLM=true` |
| `OPENAI_MODEL` | `gpt-4o` | Model used for LLM paths |
| `VECTOR_STORE_PATH` | — | Path to a pre-built JSONL vector store (enables real recommendations) |
| `DETERMINISTIC_MODE` | `false` | Seed all randomness for reproducible demo outputs |
| `PROFILE_CACHE_TTL_SECONDS` | `3600` | Profile cache TTL |
| `PROFILE_CACHE_MAX_SIZE` | `1000` | LRU eviction limit |

### 3a. Run directly

```bash
uvicorn backend.app:app --reload
# API:     http://localhost:8000
# Swagger: http://localhost:8000/docs
```

### 3b. Run with Docker Compose

```bash
docker compose up --build
# Backend:  http://localhost:8000
# The ./data directory is volume-mounted for vector store access
```

### 4. Run tests

```bash
python -m pytest backend/tests -v
# 114 tests, all passing
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/cold-start/questions` | Return the 4 elicitation questions |
| `POST` | `/cold-start/answer` | Bootstrap a profile from elicitation answers |
| `POST` | `/profile/build` | Build a profile from interaction history |
| `POST` | `/profile/update` | Append new records and rebuild profile |
| `POST` | `/task-a/simulate` | Predict rating + reasoning trace + generated review |
| `POST` | `/task-b/recommend` | Rank items using profile axes, deliberative scoring, session state |
| `POST` | `/task-b/agent` | Agentic Task B — 4-step tool-call pipeline with optional LLM planning |

Full request/response schemas: `http://localhost:8000/docs`

### Example: Task A simulation

```bash
curl -X POST http://localhost:8000/task-a/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "u1",
    "records": [
      {"item_id": "b1", "rating": 5, "review_text": "Abeg the jollof rice dey sweet, omo the suya too nice!", "timestamp": "2024-01-01"},
      {"item_id": "b2", "rating": 4, "review_text": "Service was attentive and food was fresh", "timestamp": "2024-02-01"}
    ],
    "item_id": "b3",
    "item_name": "Nando'\''s Lagos",
    "use_llm": false
  }'
```

### Example: Task B agentic recommendation

```bash
curl -X POST http://localhost:8000/task-b/agent \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "u1",
    "records": [
      {"item_id": "b1", "rating": 4.5, "review_text": "Great spicy food, abeg the pepper soup was on point!", "timestamp": "2024-01-01"}
    ],
    "query_text": "spicy Nigerian food with good vibes",
    "top_k": 5,
    "use_llm": false
  }'
```

---

## Vector Store

The live deployment uses a **200,192-item Yelp vector store** built from the Yelp Academic Dataset (6.99M reviews) using `sentence-transformers/all-MiniLM-L6-v2`. To build your own from a JSONL dataset:

```bash
python -m backend.cli \
  --dataset    yelp \
  --input      /path/to/yelp_academic_dataset_review.json \
  --output     /path/to/vector_store.jsonl \
  --limit      50000      # optional cap; omit for full dataset
```

Then set `VECTOR_STORE_PATH=/path/to/vector_store.jsonl` in `.env`. The API loads it at startup.

Without a vector store, all profile-based features (Task A rating prediction, Task B with explicit candidates) work fine — only the semantic retrieval step in Task B requires it.

---

## Evaluation

Run against any JSONL file using the same record schema:

```bash
# Task A: RMSE and ROUGE-L
python -m backend.evaluation.task_a_eval --records data/records.jsonl --split 0.8

# Task B: NDCG@10 and Hit Rate@10
python -m backend.evaluation.task_b_eval --records data/records.jsonl --store data/vector_store.jsonl --k 10

# Ablation: zero each profile layer and report metric deltas
python -m backend.evaluation.ablation --records data/records.jsonl --store data/vector_store.jsonl
```

---

## Repo Layout

```
backend/
  app.py                    FastAPI app, all endpoint handlers, middleware
  config.py                 Typed AppConfig; all settings from env vars via python-dotenv
  profile.py                PsychologicalProfile schema + build_profile()
  cold_start.py             4-question elicitation + bootstrap_profile()
  signal_extraction.py      Rating stats, stylometry, value keyword counters
  cultural_signals.py       Nigerian English / pidgin detection (NEI, code-switching)
  trajectory.py             Early-vs-recent rating and length drift
  preference_axes.py        PreferenceAxis extraction from profile
  rating_calibration.py     User vs population z-score calibration
  review_generator.py       Template-based review generation from profile signals
  deliberative_scoring.py   Per-candidate axis-weighted + penalty scoring
  retrieval.py              multi_angle_retrieve() — weighted cosine over multiple queries
  vector_store.py           InMemoryVectorStore (add, query by cosine similarity)
  vector_store_persist.py   save / load JSONL vector store (streaming)
  vector_store_service.py   Embedding + store facade; deduplicates by business_id
  multi_vector_store.py     MultiVectorStoreService — cross-domain fan-out + merge
  embeddings.py             sentence-transformers encode wrapper
  ingest_embeddings.py      Dataset JSONL → embed → InMemoryVectorStore
  ingest_datasets.py        Dataset-specific field mapping (Yelp / Amazon / Goodreads)
  cli.py                    Ingestion CLI entry point
  agent_orchestrator.py     run_agent(): $ref resolution + step recording  ← AGENTIC CORE
  agent_tools.py            ToolCall, ToolResult, ToolRegistry primitives   ← AGENTIC CORE
  agent_tool_defs.py        4 registered tools: build_profile, extract_axes,← AGENTIC CORE
                            retrieve_candidates, score_candidates
  task_b_agent_service.py   LLM vs deterministic plan selection + fallback  ← AGENTIC CORE
  llm_prompts.py            Culturally-calibrated prompt builders (Task A + B)
  session.py                SessionState + SessionStore (multi-turn Task B)
  task_a_service.py         Task A: calibration + reasoning trace + review generation
  task_b_service.py         Task B: retrieval + deliberative scoring + session
  llm_client.py             OpenAI chat completion with retry + exponential backoff
  llm_factory.py            Client factory (returns None when ENABLE_LLM=false)
  logging_utils.py          Structured logging + trace-ID middleware
  cache.py                  Generic TTL + LRU OrderedDict cache
  services/
    profile_service.py      Profile builder with TTL+LRU cache layer
  data/
    schema.py               InteractionRecord dataclass
    loaders.py              Yelp / Amazon / Goodreads loaders with row validation
    split.py                Per-user temporal train/test split
  evaluation/
    metrics.py              RMSE, ROUGE-L, NDCG@k, Hit Rate@k, baselines
    task_a_eval.py          Task A evaluation runner (CLI)
    task_b_eval.py          Task B evaluation runner with per-user breakdown
    ablation.py             Ablation runner: zero each profile layer, report deltas
  tests/                    114 tests (pytest), all passing
backend/Dockerfile
docker-compose.yml
AGENTS.md                   Agentic workflow documentation (tools, orchestrator, $ref wiring)
docs/
  Backend-Architecture.md   Comprehensive system design and module reference
  DEPLOYMENT.md             Production deployment guide (DigitalOcean, SSL, Docker)
  solution_paper_task_a.md  Task A solution paper (markdown source)
  solution_paper_task_b.md  Task B solution paper (markdown source)
  PERSONA_Task_A_Solution_Paper.pdf
  PERSONA_Task_B_Solution_Paper.pdf
```

---

## Deployment

The backend is live at **https://personabackend.duckdns.org** on a DigitalOcean droplet (Ubuntu 22.04, 2 GB RAM) running Docker Compose with Nginx + Let's Encrypt SSL. The Yelp vector store is hosted on DigitalOcean Spaces and downloaded to a persistent volume at container startup.

For full deployment instructions: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## License

MIT
