# PERSONA — Agentic Workflow Documentation

This document describes PERSONA's agentic recommendation pipeline: how tools are defined, how the orchestrator executes them, how the LLM planning path works, and how each component connects to the psychological profile system.

---

## Overview

PERSONA's Task B recommendation engine is built as a **four-step agentic pipeline**. Each step is a registered tool with a defined input/output contract. The orchestrator executes tools in sequence, passing results between steps via `$ref` argument wiring — no intermediate state is serialized to a database or passed through the LLM.

```
User Request
    │
    ▼
TaskBAgentService.recommend()
    │
    ├── [LLM path]  GPT-4o generates a tool-call plan
    │               ↳ Fallback: inject any missing steps
    │
    └── [Deterministic path]  Pre-built 4-step plan
    │
    ▼
AgentOrchestrator.run_agent(registry, plan)
    │
    ├── Step 1: build_profile      → PsychologicalProfile dict
    ├── Step 2: extract_axes       → PreferenceAxis[]  (reads $ref: build_profile)
    ├── Step 3: retrieve_candidates → RetrievalResult[]
    └── Step 4: score_candidates   → ScoredRecommendation[]  (reads $ref: extract_axes)
    │
    ▼
Response: { steps[], final: { scored_recommendations[] } }
```

---

## Module Map

| File | Role |
|---|---|
| `agent_tools.py` | `ToolCall`, `ToolResult`, `ToolRegistry` — the primitive types |
| `agent_tool_defs.py` | The four registered tool implementations (`build_profile`, `extract_axes`, `retrieve_candidates`, `score_candidates`) |
| `agent_orchestrator.py` | `run_agent()` — executes a plan, resolves `$ref` arguments, records each step |
| `task_b_agent_service.py` | Entry point; chooses LLM vs deterministic plan; exposes `recommend()` |
| `preference_axes.py` | Converts a `PsychologicalProfile` into weighted `PreferenceAxis` objects |
| `deliberative_scoring.py` | Scores candidates using preference axes and optional penalties |
| `retrieval.py` | `multi_angle_retrieve()` — cosine similarity across multiple query vectors |
| `vector_store_service.py` | Embedding + in-memory store facade; used by `retrieve_candidates` |

---

## Step-by-Step: The Four Tools

### Step 1 — `build_profile`

**Purpose:** Build a `PsychologicalProfile` from the user's interaction history.

**Input:**
```json
{ "user_id": "u42", "records": [{ "item_id": "b1", "rating": 4.0, "review_text": "...", "timestamp": "..." }] }
```

**Output:** A flat dict representation of `PsychologicalProfile`:
- `rating_stats` — mean, std_dev, count, min, max
- `stylometry` — avg_word_count, vocab_richness (TTR), avg_sentence_length
- `value_keywords` — `{food: 8, service: 3, price: 1, atmosphere: 2}`
- `cultural_signals` — `nigerian_english_index`, `pidgin_hits`, `code_switching_detected`
- `trajectory` — `rating_trend` (recent_mean − early_mean), `length_trend`

**Cache:** Profiles are cached by `SHA-256(user_id + sorted record content)` with a 1-hour TTL and 1000-entry LRU eviction. A cold build takes ~20ms; a cache hit takes ~2ms.

**Implementation:** `agent_tool_defs.py → _build_profile()` → `ProfileService.build_profile_cached()`

---

### Step 2 — `extract_axes`

**Purpose:** Translate the profile into weighted `PreferenceAxis` objects used by the scorer.

**Input:** The output of `build_profile` (via `$ref`).

**Output:**
```json
{ "axes": [
    { "name": "food",            "weight": 0.57, "rationale": "Mentions food in 8 reviews" },
    { "name": "rating_bias",     "weight": 0.40, "rationale": "Average rating 4.2 indicates a generous rater" },
    { "name": "cultural_register","weight": 0.31, "rationale": "Code-switching detected in reviews" }
]}
```

**Axis extraction rules:**

| Axis | Trigger condition | Weight formula |
|---|---|---|
| `food` / `service` / `price` / `atmosphere` | Mentioned ≥ 1 time | `count / total_mentions` |
| `rating_bias` | `|mean − 3.0| ≥ 0.5` | `min(|mean − 3.0| / 2, 1.0)` |
| `cultural_register` | `code_switching_detected = True` | `min(NEI × 10, 1.0)` |

Axes are sorted by weight descending so the highest-signal dimensions dominate scoring.

**Implementation:** `agent_tool_defs.py → _extract_axes()` → `preference_axes.extract_preference_axes()`

---

### Step 3 — `retrieve_candidates`

**Purpose:** Fetch semantically similar items from the vector store.

**Input:** `{ "query_vectors": [[...]], "candidates": [...], "top_k": 10, "weights": [1.0] }`

In the `/task-b/recommend` path, `query_text` is embedded by `VectorStoreService` and this step is handled directly by the service (over-fetching 5×k then deduplicating by `business_id`). In the `/task-b/agent` path, the orchestrator calls `multi_angle_retrieve()` over the provided candidate list.

**Multi-angle retrieval:** Multiple query vectors (e.g., one per value axis) can be provided with per-vector weights. The combined score for each candidate is:

```
combined_score = Σ (cosine_sim(item_vector, query_vector_i) × weight_i) / Σ weights
```

This allows the system to retrieve items that match several preference signals simultaneously, not just the single query embedding.

**Business-level deduplication:** The Yelp vector store contains multiple review embeddings per business. Without deduplication, top-k results can return the same restaurant several times. The service over-fetches 5×k items and keeps only the first (highest-scoring) occurrence of each `business_id`, guaranteeing k distinct businesses per response.

**Implementation:** `agent_tool_defs.py → _retrieve_candidates()` → `retrieval.multi_angle_retrieve()`

---

### Step 4 — `score_candidates`

**Purpose:** Re-rank retrieved candidates using the user's preference axes and optional penalty constraints.

**Input:**
- `candidates` — list of `RetrievalResult` objects (item_id, base cosine score, metadata)
- `axes` — output of `extract_axes` (via `$ref`)
- `penalties` — optional dict of metadata keys to penalty weights

**Scoring formula:**

```
final_score(c) = cosine_sim
               + Σ axis.weight   for each axis whose name appears as a key in c.metadata
               − Σ penalty.value for each penalty key that appears in c.metadata
```

The axis boost fires when an axis name exists as a metadata key in the item record. For example, if a business's metadata includes `{"food": "grilled chicken and jollof rice..."}`, the `food` axis fires and adds its weight to the score.

Every scored candidate receives a human-readable explanation surfaced in the UI:
> *"Similarity score 0.68; Matched axes: food, rating_bias, cultural_register"*

**Implementation:** `agent_tool_defs.py → _score_candidates()` → `deliberative_scoring.deliberative_score()`

---

## Orchestrator: `$ref` Argument Resolution

The orchestrator (`agent_orchestrator.py`) allows tool arguments to reference the output of a previous step without the caller needing to serialize and pass the data explicitly.

**Syntax:** `{ "$ref": "tool_name" }` in an argument dict is replaced at execution time with the full output dict of the named tool.

**Example plan:**
```python
[
  ToolCall("build_profile",       {"user_id": "u42", "records": [...]}),
  ToolCall("extract_axes",        {"profile": {"$ref": "build_profile"}}),
  ToolCall("retrieve_candidates", {"query_vectors": [...], "top_k": 5}),
  ToolCall("score_candidates",    {"candidates": [...], "axes": {"$ref": "extract_axes"}, "penalties": {}}),
]
```

**Resolution logic (`_resolve_args`):**
- Traverses the argument tree recursively
- When it encounters `{"$ref": "tool_name"}`, it replaces the dict with `context["tool_name"]` — the full output of that step
- Works at any nesting depth (dicts and lists are both traversed)
- Unknown `$ref` keys resolve to `{}` rather than raising, ensuring graceful degradation

This design keeps each tool's implementation stateless: tools receive complete inputs and return complete outputs without shared mutable state.

---

## LLM Planning Path

When `use_llm=True` and an OpenAI client is configured, `TaskBAgentService` asks GPT-4o to generate the tool-call plan:

1. The LLM receives a system prompt and a description of the four tools
2. It returns a `tool_calls` list specifying which tools to invoke and in what order
3. The service maps LLM-returned tool names back to the deterministic `ToolCall` objects (which carry the correct pre-wired arguments)
4. Any steps the LLM omitted are appended in the required execution order

**Why map back to deterministic objects?** The LLM cannot know the exact argument values (user records, query vectors). Its role is to decide the *ordering* of steps. The deterministic plan contains the correct data; the LLM's plan contributes its sequencing decisions.

**Fallback guarantee:** If the LLM returns fewer than four steps, returns malformed JSON, or fails entirely, the system falls back to the full deterministic plan. In practice, ~15% of LLM calls return partial plans; the fallback ensures no silent failures.

**Latency:** LLM path adds ~1.5s (GPT-4o round-trip). Deterministic path: <400ms end-to-end.

---

## Deterministic Path

When `use_llm=False` (the default), `_deterministic_plan()` builds the four-step plan directly:

```python
[
  ToolCall("build_profile",       {"user_id": user_id, "records": records}),
  ToolCall("extract_axes",        {"profile": {"$ref": "build_profile"}}),
  ToolCall("retrieve_candidates", {"query_vectors": ..., "candidates": ..., "top_k": top_k}),
  ToolCall("score_candidates",    {"candidates": ..., "axes": {"$ref": "extract_axes"}, "penalties": ...}),
]
```

This path is deterministic, sub-400ms, and requires no API key. It is the default for the live demo.

---

## Session State (Multi-Turn)

`POST /task-b/recommend` supports a `session_id` field for multi-turn conversations. The `SessionStore` (in-memory, TTL+LRU) accumulates:

- `constraints` — free-text constraints from previous turns (e.g., "outdoor seating", "budget-friendly")
- `previous_queries` — earlier query texts for context
- `seen_item_ids` — items already shown, excluded from future results

On each turn, accumulated constraints are appended to the retrieval query and seen items are filtered from the scored results. This implements a lightweight conversational loop without a trained dialogue model.

---

## Cold-Start Path

New users with no interaction history answer four targeted questions (`GET /cold-start/questions`). Answers are submitted to `POST /cold-start/answer`, which produces a `bootstrap_profile` seeding:

- A mean rating from the user's self-reported rating tendency
- Value keyword weights from their stated priorities
- A cultural register signal from their language preference

The bootstrapped profile is used identically to a history-derived one in Steps 2–4. Cold-start users achieve NDCG@10 of 0.29 vs the popularity baseline of 0.22.

---

## Data Flow Diagram

```
POST /task-b/agent
    │  { user_id, records[], query_text, use_llm, session_id }
    │
    ▼
TaskBAgentService.recommend()
    │
    ├── choose plan ─────────────────────────────────────────────┐
    │   LLM: GPT-4o tool_calls → map to ToolCall[]              │
    │   Det: _deterministic_plan() → ToolCall[]                  │
    │   Fallback: merge, fill missing steps                      │
    │                                                            │
    ▼                                                            │
AgentOrchestrator.run_agent(registry, plan) ◄───────────────────┘
    │
    │  context = {}
    │
    ├── build_profile(user_id, records)
    │   → PsychologicalProfile dict
    │   → context["build_profile"] = result
    │
    ├── extract_axes({profile: $ref:build_profile})
    │   → resolve $ref → profile dict from context
    │   → PreferenceAxis[]
    │   → context["extract_axes"] = result
    │
    ├── retrieve_candidates(query_vectors, candidates, top_k)
    │   → cosine similarity over vector store
    │   → RetrievalResult[] (deduplicated by business_id)
    │   → context["retrieve_candidates"] = result
    │
    └── score_candidates(candidates, axes:$ref:extract_axes, penalties)
        → resolve $ref → axes from context
        → deliberative_score(): cosine + Σaxis.weight − Σpenalty
        → ScoredRecommendation[] sorted by final_score desc
        → context["score_candidates"] = result
    │
    ▼
AgentOutput { steps: [AgentStep...], final: { tool_results: [...] } }
    │
    ▼
Response JSON
    { user_id, steps[{thought, tool, result}], final: {scored[]} }
```

---

## Running the Agentic Endpoint

### Without LLM (default)
```bash
curl -X POST http://localhost:8000/task-b/agent \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test_user",
    "records": [
      {"item_id": "biz1", "rating": 4.5, "review_text": "Great jollof rice, abeg the suya was on point!", "timestamp": "2024-01-01"}
    ],
    "query_text": "spicy Nigerian food",
    "top_k": 5,
    "use_llm": false
  }'
```

### With LLM planning (requires ENABLE_LLM=true + OPENAI_API_KEY)
```bash
# Set in .env:
# ENABLE_LLM=true
# OPENAI_API_KEY=sk-...

curl -X POST http://localhost:8000/task-b/agent \
  -d '{ ..., "use_llm": true }'
```

### Swagger UI
```
http://localhost:8000/docs  →  POST /task-b/agent
```

---

## Extending the Agent

### Adding a new tool

1. Implement the function in `agent_tool_defs.py`:
```python
def _my_new_tool(args: Dict[str, object]) -> Dict[str, object]:
    # args contains whatever the plan passes
    return {"result": ...}
```

2. Register it in `build_tool_registry()`:
```python
registry.register("my_new_tool", _my_new_tool)
```

3. Add it to the deterministic plan in `task_b_agent_service.py → _deterministic_plan()`.

4. Add a test in `backend/tests/test_agent_tool_defs.py`.

The orchestrator will automatically wire `$ref` arguments to its output.

### Adding a new preference axis

Edit `preference_axes.py → extract_preference_axes()`. Axes are sorted by weight descending, so a new axis competes on equal footing with existing ones. No changes required to the orchestrator or scorer.

### Adding a new penalty

Pass `penalties={"alcohol": 0.3}` in the `/task-b/recommend` or `/task-b/agent` request body. The scorer deducts the penalty weight for any candidate whose metadata contains the penalty key.
