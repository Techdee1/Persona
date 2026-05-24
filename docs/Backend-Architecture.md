# Persona — Backend & AI/ML Architecture

Owner: Backend AI/ML  
Last updated: 2026-05-23  
Test suite: 114 tests, all passing  
Vector store: 200,192 Yelp items (1.6 GB JSONL), end-to-end validated

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Data Layer](#3-data-layer)
   - 3.1 InteractionRecord schema
   - 3.2 Dataset loaders and row validation
   - 3.3 Temporal split
4. [Profile Engine](#4-profile-engine)
   - 4.1 Rating stats
   - 4.2 Stylometry
   - 4.3 Value keywords
   - 4.4 Living trajectory
   - 4.5 Cultural signals
   - 4.6 PsychologicalProfile assembly
5. [Cold-Start System](#5-cold-start-system)
6. [Task A Pipeline — Review Simulation](#6-task-a-pipeline--review-simulation)
   - 6.1 Rating calibration
   - 6.2 Richer reasoning trace
   - 6.3 Template-based review generation
   - 6.4 Structured LLM prompts
   - 6.5 LLM review path
7. [Task B Pipeline — Agentic Recommendation](#7-task-b-pipeline--agentic-recommendation)
   - 7.1 Preference axis extraction
   - 7.2 Multi-angle retrieval
   - 7.3 Deliberative scoring
   - 7.4 Non-LLM path (TaskBService)
   - 7.5 Session state (multi-turn)
8. [Agent System](#8-agent-system)
   - 8.1 Tool registry
   - 8.2 Agent orchestrator and $ref resolution
   - 8.3 Registered tools
   - 8.4 LLM planning path (TaskBAgentService)
9. [Vector Store System](#9-vector-store-system)
   - 9.1 InMemoryVectorStore
   - 9.2 Embedding model
   - 9.3 VectorStoreService facade
   - 9.4 JSON persistence
   - 9.5 Dataset ingestion pipeline
   - 9.6 CLI
   - 9.7 Cross-domain retrieval (MultiVectorStoreService)
10. [Evaluation System](#10-evaluation-system)
    - 10.1 Metrics
    - 10.2 Task A evaluation runner
    - 10.3 Task B evaluation runner
    - 10.4 Ablation study runner
    - 10.5 Baselines
11. [API Layer](#11-api-layer)
    - 11.1 Endpoint contracts
    - 11.2 Trace-ID middleware
12. [Infrastructure](#12-infrastructure)
    - 12.1 Configuration
    - 12.2 TTL + LRU cache
    - 12.3 Profile service caching
    - 12.4 LLM client and retry policy
    - 12.5 Structured logging and request tracing
    - 12.6 Docker and Compose
13. [Design Decisions](#13-design-decisions)
14. [Extension Points](#14-extension-points)

---

## 1. System Overview

Persona builds a **psychological profile** from a user's review history and uses it as a
shared foundation for two outputs:

- **Task A**: Given a new item, predict the rating the user would assign and generate a
  review in their authentic voice, with Nigerian cultural calibration where signals are
  present.
- **Task B**: Given a user profile and an optional query, retrieve and rank candidate items
  with explicit per-item reasoning grounded in the user's preference axes.

The system is designed to work in two modes:

| Mode | Data available | How profile is built |
|---|---|---|
| **History mode** | User has prior reviews | `build_profile()` over full history |
| **Cold-start mode** | New user, no history | `bootstrap_profile()` from 4 elicitation answers |

All outputs include a reasoning trace so judges and users can audit decisions.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Client (frontend / evaluation scripts / curl)                          │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │ HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  FastAPI  (backend/app.py)                                              │
│  ├── Trace-ID middleware (X-Trace-Id header)                            │
│  ├── GET  /health                                                       │
│  ├── GET  /cold-start/questions                                         │
│  ├── POST /cold-start/answer    ──► ColdStartEngine                    │
│  ├── POST /profile/build        ──► ProfileService                     │
│  ├── POST /profile/update       ──► ProfileService (append + rebuild)  │
│  ├── POST /task-a/simulate      ──► TaskAService                       │
│  ├── POST /task-b/recommend     ──► TaskBService + SessionStore        │
│  └── POST /task-b/agent         ──► TaskBAgentService                  │
└──────────────┬──────────────────────────────────────────────────────────┘
               │
   ┌───────────┴──────────────────────────────────────────┐
   │                                                      │
   ▼                                                      ▼
ProfileEngine                                  VectorStoreService / MultiVectorStoreService
  signal_extraction.py                           embeddings.py
  cultural_signals.py                            vector_store.py
  trajectory.py                                  vector_store_persist.py
  profile.py                                     multi_vector_store.py (cross-domain)
  services/profile_service.py                    (loaded from VECTOR_STORE_PATH[_*])
  (SHA-256 keyed TTL+LRU cache)
   │
   ├──────────────────────────────┐
   ▼                              ▼
TaskAService                  TaskBService / TaskBAgentService
  rating_calibration.py         preference_axes.py
  _build_reasoning()            retrieval.py
  review_generator.py           deliberative_scoring.py
  llm_prompts.py (opt)          session.py (multi-turn state)
  llm_client.py (opt)           agent_orchestrator.py (agent path)
                                agent_tool_defs.py
                                llm_prompts.py (opt)
                                llm_client.py (opt)
```

---

## 3. Data Layer

### 3.1 InteractionRecord Schema

**File:** `backend/data/schema.py`

```python
@dataclass(frozen=True)
class InteractionRecord:
    user_id:     str
    item_id:     str
    rating:      float
    review_text: str
    timestamp:   Optional[str]   # ISO date or unix epoch string
    source:      str             # "yelp" | "amazon" | "goodreads"
    metadata:    Dict[str, Any]  # remaining fields from source row
```

`InteractionRecord` is the canonical unit passed through every pipeline stage. It is
frozen (immutable) to prevent accidental mutation inside extractors.

`timestamp` is intentionally kept as a string; the split utility parses it on-demand
using `timestamp_key()` which handles ISO dates, unix epoch strings, and falls back
to `0.0` for unparseable values so sort order degrades gracefully rather than crashing.

### 3.2 Dataset Loaders and Row Validation

**File:** `backend/data/loaders.py`

Three public functions share one private implementation:

```
load_yelp_reviews(path)      → List[InteractionRecord]
load_amazon_reviews(path)    → List[InteractionRecord]
load_goodreads_reviews(path) → List[InteractionRecord]
```

Each maps source-specific field names to canonical names via a `FieldMap` dict:

| Dataset | user_id field | item_id field | rating field | text field | timestamp field |
|---|---|---|---|---|---|
| Yelp | `user_id` | `business_id` | `stars` | `text` | `date` |
| Amazon | `reviewerID` | `asin` | `overall` | `reviewText` | `unixReviewTime` |
| Goodreads | `user_id` | `book_id` | `rating` | `review_text` | `date` |

**Row validation** (added Phase 3, Task 16):

`_row_to_record()` returns `(InteractionRecord, None)` on success or `(None, error_str)`
on failure. Invalid rows are skipped, not raised:

| Validation rule | Action on failure |
|---|---|
| `user_id` is non-empty after strip | Skip, log debug |
| `item_id` is non-empty after strip | Skip, log debug |
| `rating` parseable as `float` | Skip, log debug |
| `rating` in `[0.0, 5.0]` | Skip, log debug |

A single `WARNING` log line per file summarises how many rows were skipped:
```
WARNING Skipped 12 invalid rows from /data/yelp.jsonl
```

Supported file formats: `.jsonl` / `.json` (newline-delimited), `.csv`.

### 3.3 Temporal Split

**File:** `backend/data/split.py`

```python
temporal_split(
    records: Iterable[InteractionRecord],
    train_ratio: float = 0.8,
    min_user_records: int = 2,
) -> Tuple[List[InteractionRecord], List[InteractionRecord]]
```

The split is **per-user** to avoid data leakage:

1. Group records by `user_id`.
2. For users with fewer than `min_user_records` records, place all in train.
3. For qualifying users, sort by `timestamp_key()` and take the first 80 % as train,
   the rest as test.

This ensures the model is always tested on future reviews it has not seen, matching the
production inference scenario.

`timestamp_key(record)` resolution order:
- `None` → `0.0`
- Digit-only string → `float(value)` (unix epoch)
- ISO date `%Y-%m-%d` or `%Y-%m-%d %H:%M:%S` → `datetime.timestamp()`
- Anything else → `0.0` (stable sort fallback)

---

## 4. Profile Engine

**Files:** `backend/profile.py`, `backend/signal_extraction.py`,
`backend/cultural_signals.py`, `backend/trajectory.py`

### 4.1 Rating Stats

**Extractor:** `extract_rating_stats(records) → RatingStats`

```python
@dataclass(frozen=True)
class RatingStats:
    count:      int
    mean:       float
    std_dev:    float    # population std dev (pstdev)
    min_rating: float
    max_rating: float
```

- Empty records → all zeros (safe default; downstream code handles `count == 0`).
- `std_dev` uses population std dev (`pstdev`) since user histories are the full
  population, not a sample.

### 4.2 Stylometry

**Extractor:** `extract_stylometry(records) → StylometryStats`

```python
@dataclass(frozen=True)
class StylometryStats:
    avg_review_length:   float   # characters
    avg_word_count:      float
    vocab_richness:      float   # unique words / total words (TTR)
    avg_sentence_length: float   # words per sentence
```

- Words matched by `[A-Za-z']+` (captures contractions).
- Sentences split on `[.!?]+` with `max(1, count)` to avoid divide-by-zero.
- `vocab_richness` is **type-token ratio** (TTR) across the entire review corpus
  for the user, not per-review, so longer histories produce more stable estimates.

### 4.3 Value Keywords

**Extractor:** `extract_value_keywords(records) → Dict[str, int]`

Four domain categories with fixed keyword sets:

| Category | Keywords |
|---|---|
| `food` | food, taste, flavor, fresh, spicy, grill |
| `service` | service, staff, wait, server, attentive |
| `price` | price, cheap, expensive, value, cost |
| `atmosphere` | ambience, atmosphere, music, decor, vibe |

Count semantics: the count for a category increments by 1 per review that contains
**any** keyword from that category (not per keyword occurrence). This measures
*topic breadth* across reviews rather than word frequency.

### 4.4 Living Trajectory

**Extractor:** `extract_trajectory(records) → TrajectoryStats`

```python
@dataclass(frozen=True)
class TrajectoryStats:
    early_mean_rating:        float
    recent_mean_rating:       float
    delta_rating:             float    # recent - early
    early_avg_review_length:  float
    recent_avg_review_length: float
    delta_review_length:      float    # recent - early
```

Records are sorted by `timestamp_key()` and split at the midpoint into early and
recent halves. Requires at least 4 records; fewer returns all-zero stats.

`delta_rating > 0` means the user has become more generous over time.
`delta_review_length > 0` means reviews are getting longer (more detailed).

Both deltas are features that preference axis extraction and downstream LLM prompts
can use to characterise a *changing* user, not a static one.

### 4.5 Cultural Signals

**Extractor:** `extract_cultural_signals(records) → CulturalSignals`

```python
@dataclass(frozen=True)
class CulturalSignals:
    nigerian_english_index:  float    # pidgin_hits / total_words
    code_switching_detected: bool     # True if any pidgin hit
    pidgin_term_hits:        int
```

Detected pidgin/Nigerian English terms (case-insensitive, full-word match):

```
abeg  abi  dey  na  oga  sef  sha  wahala  jollof  suya  wah  omo
```

`nigerian_english_index` is a density score (hits per total word), not a binary flag,
allowing downstream components to scale their response proportionally.

`code_switching_detected = pidgin_term_hits > 0` is a convenience flag for boolean
branching in the review generator and preference axis extractor.

### 4.6 PsychologicalProfile Assembly

**File:** `backend/profile.py`

```python
@dataclass(frozen=True)
class PsychologicalProfile:
    user_id:         str
    rating_stats:    RatingStats
    stylometry:      StylometryStats
    value_keywords:  Dict[str, int]
    trajectory:      TrajectoryStats
    cultural_signals: CulturalSignals
```

`build_profile(user_id, records)` calls all five extractors and assembles the profile.
The profile is frozen; it is never mutated after construction.

`to_dict()` and `profile_from_dict()` provide serialisation round-trips for caching,
API responses, and agent tool argument passing.

---

## 5. Cold-Start System

**File:** `backend/cold_start.py`

Handles new users who have no review history.

### Elicitation Questions

Four fixed questions targeting the most important profile dimensions:

| Question ID | Dimension targeted | Options |
|---|---|---|
| `rating_tendency` | `RatingStats.mean`, `std_dev` | `top_marks`, `reserve_top` |
| `value_priority` | `value_keywords` | `food_quality`, `service`, `price_value`, `atmosphere` |
| `review_style` | `StylometryStats.avg_review_length` | `brief_and_direct`, `detailed_and_thorough` |
| `cultural_register` | `CulturalSignals` | `yes_often`, `sometimes`, `rarely` |

### Signal Mapping

Each answer maps to concrete overrides applied to default profile values:

```
rating_tendency=top_marks   → mean=4.5, std_dev=0.5
rating_tendency=reserve_top → mean=3.5, std_dev=0.8

value_priority=food_quality → value_keywords={food:3, service:0, price:0, atmosphere:0}

review_style=brief           → avg_review_length=80,  avg_word_count=16
review_style=detailed        → avg_review_length=300, avg_word_count=60

cultural_register=yes_often → nigerian_english_index=0.06, code_switching=True
cultural_register=sometimes → nigerian_english_index=0.02, code_switching=True
cultural_register=rarely    → nigerian_english_index=0.0,  code_switching=False
```

Unknown question IDs or answer values are silently ignored; the profile falls back to
defaults for unmapped dimensions. This makes the endpoint safe for partial submissions.

### bootstrap_profile()

Returns a complete `PsychologicalProfile` with:
- `rating_stats.count = 0` (signals it is a bootstrapped profile)
- `TrajectoryStats` all zeros (no temporal data available)
- All other fields set from answer signal map

The bootstrapped profile is compatible with all downstream consumers:
`extract_preference_axes()`, `TaskAService`, `TaskBService`. They all handle
`count == 0` or zero-trajectory gracefully.

---

## 6. Task A Pipeline — Review Simulation

**File:** `backend/task_a_service.py`

### Inputs

```json
{
  "user_id": "string",
  "records": [ InteractionRecord, ... ],
  "target_item": { "name": "...", "description": "...", ... },
  "population_records": [ InteractionRecord, ... ],   // optional
  "use_llm": false
}
```

### Pipeline steps

```
records
  └─► build_profile_cached()     →  PsychologicalProfile
                                           │
population_records (or records as fallback)
  └─► build_rating_calibration() →  RatingCalibration
                                           │
profile.rating_stats.mean
  └─► calibration.calibrate()   →  predicted_rating (float, clamped 1–5)
                                           │
                                           ├─► _build_reasoning()  →  reasoning string
                                           │
                                           ├── use_llm=False → generate_review(profile, target_item)
                                           └── use_llm=True  → _generate_review_with_llm(...)
                                                                    uses build_task_a_prompt()
```

### 6.1 Rating Calibration

**File:** `backend/rating_calibration.py`

```python
@dataclass(frozen=True)
class RatingCalibration:
    user_mean:       float
    user_std:        float
    population_mean: float
    population_std:  float

    def calibrate(self, rating: float) -> float:
        z = (rating - user_mean) / user_std
        calibrated = population_mean + z * population_std
        return max(1.0, min(5.0, calibrated))
```

Z-score rescaling maps the user's personal scale to the population scale:
- A user who habitually rates 4.5 in a population that averages 3.8 will have their
  predicted 4.5 pulled down to a more typical value.
- If either `user_std` or `population_std` is zero (single-record history), the raw
  rating is returned unchanged.

When `population_records` is not provided the endpoint falls back to using the user's
own records as the population, making calibration a no-op in that case.

### 6.2 Richer Reasoning Trace

**Function:** `_build_reasoning(profile, calibration, calibrated_rating) → str`

The reasoning trace is a structured natural-language string that records the key signals
used to arrive at the predicted rating and review. It is always included in the Task A
response so judges and users can audit every decision.

**Components (in order):**

1. **Rating calibration narrative** — states the user's mean rating, std dev, history size,
   and the direction of calibration against the population mean:
   ```
   User mean rating is 4.20 (σ=0.50, n=12); calibrated downward to 3.80 against population mean 3.50.
   ```

2. **Top preference axes** — lists the top 2 axes by weight (e.g. food, service) with their
   normalised weights:
   ```
   Top preference axes: food (w=0.62), service (w=0.25).
   ```

3. **Trajectory drift** — included only when |delta_rating| ≥ 0.3; states direction and magnitude:
   ```
   Rating trajectory has improved by 0.40 (early avg 3.60 → recent 4.00).
   ```

4. **Stylometry fingerprint** — approximate word count and vocab richness:
   ```
   Review style: ~80 words, vocab richness 0.62.
   ```

5. **Cultural register** — included only when code-switching is detected:
   ```
   Nigerian English detected (index=0.04, pidgin hits=3); cultural register applied.
   ```

When `use_llm=True` an additional clause is appended: `"Review generated via LLM using structured prompt."`

### 6.3 Template-Based Review Generation

**File:** `backend/review_generator.py`

Produces a review string without any LLM call, driven entirely by profile signals.

**Sentiment bucket** (from `profile.rating_stats.mean`):

| Mean | Bucket |
|---|---|
| ≥ 4.0 | `positive` |
| ≥ 2.5 | `neutral` |
| < 2.5 | `negative` |

**Assembly:**

1. Pick a sentiment-appropriate **opener** from a curated list.
2. For up to the **top 2 value categories** by count, pick a sentiment-appropriate
   phrase for that category (food/service/price/atmosphere).
3. If `target_item` contains a `name` or `title` field, add an item-specific sentence.
4. **Cultural closer**: if `code_switching_detected`, pick a pidgin closer
   (`"Abeg, try am yourself"`, `"Na so e be sha"`, `"Omo, e get as e be"`);
   otherwise pick a standard English closer.
5. Trim to `1.5 × avg_review_length` characters if the result exceeds the user's
   typical length. Trim on a word boundary.

**Determinism**: pass `seed=int` to `generate_review()` for reproducible output. The
review generator uses `random.Random(seed)` internally and does not touch the global
random state.

### 6.4 Structured LLM Prompts

**File:** `backend/llm_prompts.py`

```python
build_task_a_prompt(profile: Dict, target_item: Dict) → List[Dict[str, str]]
build_task_b_prompt(profile, axes, candidates, session_context=None) → List[Dict[str, str]]
```

Both functions return a list of OpenAI-compatible chat message dicts. Cultural calibration
is applied automatically.

**Task A system prompt** adapts based on cultural signals:
- When `code_switching_detected` or `nigerian_english_index > 0.2`: instructs the model to
  incorporate Nigerian English and Pidgin at the user's typical frequency ("do not exaggerate
  or stereotype").
- Always instructs: write only the review, match typical review length, focus on the user's
  top value dimensions.

**Task A user message** includes a structured USER PROFILE SUMMARY block with all five signal
dimensions (rating mean/σ/n, stylometry, top value priorities, trajectory drift note, cultural
index) followed by a TARGET ITEM block.

**Task B system prompt** instructs the model to return a JSON object `{ranked_items: [{item_id, explanation}]}`
and adds a cultural context note when code-switching is detected.

**Task B user message** includes profile summary, formatted preference axes (top 5), optional
session context (turn count, excluded IDs, constraints), and the full candidate list with
retrieval scores.

### 6.5 LLM Review Path

When `use_llm=True` and an `OpenAIClient` is configured:

```python
messages = build_task_a_prompt(profile.to_dict(), target_item)
response = llm_client.chat_completion(messages, temperature=0.2)
```

`temperature=0.2` keeps output near-deterministic for scoring consistency.
The structured prompt gives the model all five signal dimensions so it can calibrate
length, tone, vocabulary richness, and cultural register independently.

### Output

```json
{
  "user_id": "u1",
  "target_item": { ... },
  "predicted_rating": 3.8,
  "reasoning": "User mean rating is 4.20 (σ=0.50, n=12); calibrated downward to 3.80 against population mean 3.50. Top preference axes: food (w=0.62), service (w=0.25). Review style: ~80 words, vocab richness 0.62.",
  "review_text": "Really enjoyed this. The food was the highlight. Kilimanjaro Restaurant delivered what I was looking for. Abeg, try am yourself."
}
```

---

## 7. Task B Pipeline — Agentic Recommendation

**File:** `backend/task_b_service.py`

### Inputs

```json
{
  "user_id":      "string",
  "records":      [ InteractionRecord, ... ],
  "query_vectors": [[1.0, 0.0], ...],      // optional if query_text provided
  "candidates":   [{"item_id":"...", "vector":[...], "metadata":{...}}, ...],
  "top_k":        10,
  "weights":      [1.0, ...],              // optional, per query_vector
  "penalties":    {"category_name": 0.4}, // optional
  "query_text":   "spicy grilled food"    // optional; triggers vector store path
}
```

### 7.1 Preference Axis Extraction

**File:** `backend/preference_axes.py`

Converts a `PsychologicalProfile` into a list of `PreferenceAxis` objects used to
steer scoring.

```python
@dataclass(frozen=True)
class PreferenceAxis:
    name:      str
    rationale: str
    weight:    float
```

Three types of axes are produced:

**Value axes** (one per non-zero value keyword category):
```
weight = category_count / total_mentions
name   = "food" | "service" | "price" | "atmosphere"
```

**Rating bias axis** (added when |mean - 3.0| ≥ 0.5):
```
bias_label = "generous" if mean > 3.0 else "harsh"
weight = min(|mean - 3.0| / 2.0, 1.0)
```

**Cultural register axis** (added when code-switching detected):
```
weight = min(nigerian_english_index × 10, 1.0)
```

Axes are sorted by weight descending. The top axes represent what the user cares about
most and are used by the deliberative scorer to boost matching items.

### 7.2 Multi-Angle Retrieval

**File:** `backend/retrieval.py`

```python
multi_angle_retrieve(
    items:         Iterable[RetrievalItem],
    query_vectors: Sequence[np.ndarray],
    top_k:         int = 10,
    weights:       Sequence[float] | None = None,
) -> List[RetrievalResult]
```

For each candidate item, computes a weighted average cosine similarity across all
query vectors:

```
score(item) = Σ (cosine(item.vector, qᵢ) × wᵢ) / Σ wᵢ
```

This allows multiple angles of the user's preference to be expressed simultaneously
(e.g. `q₁ = "spicy food"`, `q₂ = "budget-friendly"`) with independent weights.

**Cosine similarity** is computed as:
```
cos(a, b) = dot(a, b) / (‖a‖ × ‖b‖)
```
Returns `0.0` when either vector is empty or either norm is zero.

Results are sorted by score descending and truncated to `top_k`.

**Vector store path**: when `query_text` is supplied and a `VectorStoreService` is
attached, items are fetched directly from the vector store using embedding similarity.
The `multi_angle_retrieve` call is bypassed in this case; the vector store's own
ranked results (already cosine-sorted) are used as `RetrievalResult` objects directly.
This preserves the correct ordering without redundant computation.

### 7.3 Deliberative Scoring

**File:** `backend/deliberative_scoring.py`

```python
deliberative_score(
    candidates: List[RetrievalResult],
    axes:       List[PreferenceAxis],
    penalties:  Dict[str, float] | None = None,
) -> List[ScoredRecommendation]
```

For each candidate:

```
axis_score    = Σ axis.weight  for each axis where axis.name ∈ candidate.metadata
penalty_score = Σ penalty_val  for each key   where key       ∈ candidate.metadata
final_score   = candidate.score + axis_score - penalty_score
```

The metadata-matching design means scoring is **item-specific**: an item tagged
`{"food": true}` receives the food-axis boost; an item without that key does not.
This is the mechanism by which the user's preference axes translate into differentiated
ranking.

**Explanation generation** per item:
```
"Similarity score 0.82; Matched axes: food, service; Conflicts: slow_service"
```

Results are sorted by `final_score` descending.

### 7.4 Non-LLM Path Output

```json
{
  "user_id": "u1",
  "axes": [
    {"name": "food", "rationale": "Mentions food in 4 reviews", "weight": 0.8},
    {"name": "rating_bias", "rationale": "Average rating 4.2 indicates a generous rater", "weight": 0.6}
  ],
  "recommendations": [
    {
      "item_id": "biz_01",
      "score": 1.62,
      "explanation": "Similarity score 0.82; Matched axes: food",
      "metadata": {"name": "Chicken Republic", "categories": "fast food"}
    }
  ]
}
```

### 7.5 Session State (Multi-Turn)

**File:** `backend/session.py`

Enables multi-turn recommendation conversations where each turn excludes already-recommended
items and accumulates user constraints.

```python
@dataclass
class SessionState:
    session_id: str
    user_id:    str
    excluded_ids:  Set[str]          # item IDs already recommended in this session
    constraints:   Dict[str, object] # e.g. {"cuisine": "Nigerian", "budget": "cheap"}
    turn:          int               # incremented on each recommendation call
    last_accessed: float             # for TTL eviction
```

**`SessionStore`** manages sessions in memory with TTL + LRU eviction (default 3600s TTL,
10 000 session cap). Key operations:

```python
store.create(user_id, session_id=None) → SessionState     # new or fixed-id session
store.get(session_id)                  → Optional[SessionState]
store.get_or_create(user_id, session_id) → SessionState   # resumable sessions
store.delete(session_id)               → bool
```

**Integration in `/task-b/recommend`:**

If `session_id` is present in the request:
1. `get_or_create(user_id, session_id)` loads or creates the session.
2. Any `constraints` dict from the request is merged into `session.constraints`.
3. `top_k` is inflated by `len(session.excluded_ids)` to account for filtering.
4. After recommendation, the result is filtered to remove `excluded_ids`, trimmed to
   the requested `top_k`, and the session's `excluded_ids` is updated.
5. The `session_id` is echoed back in the response.

**`context_summary()`** returns a sentence describing the session's current state
(turn number, excluded items, active constraints) for injection into the LLM prompt
via `build_task_b_prompt(..., session_context=session.context_summary())`.

---

## 8. Agent System

**Files:** `backend/agent_tools.py`, `backend/agent_orchestrator.py`,
`backend/agent_tool_defs.py`, `backend/task_b_agent_service.py`

The agent system implements a structured tool-calling loop that allows the Task B
pipeline to be driven by an LLM ordering its own steps.

### 8.1 Tool Registry

```python
class ToolRegistry:
    def register(name: str, func: Callable[[Dict], Dict]) -> None
    def run(call: ToolCall) -> ToolResult
    def has(name: str) -> bool
    def list_tools() -> List[str]
```

Tools are plain functions `Dict[str, object] → Dict[str, object]`. The registry decouples
tool definitions from the orchestrator and makes it easy to add or replace tools without
touching the planning logic.

### 8.2 Agent Orchestrator and $ref Resolution

**File:** `backend/agent_orchestrator.py`

`run_agent(registry, plan)` executes a list of `ToolCall` objects in order:

1. For each call, run `_resolve_args(call.arguments, context)` to substitute `$ref`
   placeholders with results from earlier tool calls.
2. Execute the tool via `registry.run(call)`.
3. Store the result in `context[call.name]`.

**`$ref` argument resolution:**

```python
{"$ref": "build_profile"}
```

resolves to the full output dict of the `build_profile` tool call.
References are resolved recursively so nested argument structures work:

```python
{"profile": {"$ref": "build_profile"}}
# → {"profile": {"user_id": "u1", "rating_stats": {...}, ...}}
```

This forms the data pipeline between steps: `extract_axes` receives the profile dict
produced by `build_profile`, and `score_candidates` receives the axes dict produced by
`extract_axes`.

`AgentOutput` contains the full step trace:
```python
@dataclass
class AgentOutput:
    steps: List[AgentStep]    # thought + tool_call + tool_result per step
    final: Dict[str, object]  # aggregated tool_results
```

### 8.3 Registered Tools

**File:** `backend/agent_tool_defs.py`

| Tool name | Function | Input | Output |
|---|---|---|---|
| `build_profile` | `_build_profile(profile_service, args)` | `{user_id, records}` | `PsychologicalProfile.to_dict()` |
| `extract_axes` | `_extract_axes(args)` | `{profile}` | `{axes: [PreferenceAxis.__dict__, ...]}` |
| `retrieve_candidates` | `_retrieve_candidates(args)` | `{candidates, query_vectors, top_k, weights}` | `{retrieved: [RetrievalResult.__dict__, ...]}` |
| `score_candidates` | `_score_candidates(args)` | `{candidates, axes, penalties}` | `{scored: [ScoredRecommendation.__dict__, ...]}` |

`_score_candidates` accepts axes in two forms:
- A plain list of `PreferenceAxis` objects (deterministic plan path)
- A dict `{"axes": [...]}` from a `$ref` to `extract_axes` output

In both cases it converts to `PreferenceAxis` objects before calling `deliberative_score`.

### 8.4 LLM Planning Path (TaskBAgentService)

**File:** `backend/task_b_agent_service.py`

When `use_llm=True`:

1. Build a list of four tool schemas with `additionalProperties: True` (permissive,
   since the LLM provides no useful arguments — just ordering).
2. Send a chat completion with `tool_choice="auto"`.
3. Parse the returned `tool_calls` list to extract the tool name ordering.
4. Map LLM-returned names to their deterministic `ToolCall` objects (system-defined
   arguments). This uses the LLM's **ordering** but the system's **arguments**.
5. Append any required steps the LLM omitted, in canonical execution order
   (`build_profile → extract_axes → retrieve_candidates → score_candidates`).
   This guarantees all 4 steps always run, even if the LLM returns a partial plan.
6. If the LLM returns no tool calls or only unrecognised names, fall back to the
   deterministic plan entirely.

**Why fill in omitted steps?** In practice, OpenAI's `tool_choice="auto"` may return
only the first 1–2 tool calls in a single response. Without the fill-in logic, the
agent silently stops after those steps — `retrieve_candidates` and `score_candidates`
never run and the response returns no ranked items. The guarantee that all 4 steps
execute regardless of LLM output makes the agent path as reliable as the deterministic
path.

**Why this design**: the LLM's value is in deciding which steps to run and in what
order based on the context, not in generating correct arguments (it cannot, since it
has no access to the user data). The system provides correct arguments for any step
the LLM selects.

**Deterministic plan** (used directly when `use_llm=False`):

```
ToolCall("build_profile", {user_id, records})
    ↓
ToolCall("extract_axes",  {profile: {$ref: "build_profile"}})
    ↓
ToolCall("retrieve_candidates", {candidates, query_vectors, top_k, weights})
    ↓
ToolCall("score_candidates", {candidates, axes: {$ref: "extract_axes"}, penalties})
```

The `$ref` wiring ensures axes extracted from the user's profile flow automatically
into the scoring step.

---

## 9. Vector Store System

### 9.1 InMemoryVectorStore

**File:** `backend/vector_store.py`

```python
@dataclass
class InMemoryVectorStore:
    items: List[RetrievalItem]

    def add(item_id, vector, metadata) -> None
    def query(query_vector, top_k=10) -> List[RetrievalResult]
```

`query()` computes cosine similarity between `query_vector` and every stored vector,
sorts descending, returns the top `top_k`. O(n) per query — adequate for demo-scale
datasets; ChromaDB or FAISS can replace this for production scale.

Vectors are stored as `np.ndarray(dtype=float)` and added via the shared
`_cosine_similarity()` in `retrieval.py`.

### 9.2 Embedding Model

**File:** `backend/embeddings.py`

```python
@dataclass(frozen=True)
class EmbeddingModel:
    name:  str
    model: SentenceTransformer

load_embedding_model(model_name="all-MiniLM-L6-v2") → EmbeddingModel
embed_texts(embedding_model, texts: Iterable[str]) → List[List[float]]
```

`SentenceTransformer("all-MiniLM-L6-v2")` produces 384-dimensional unit vectors.
`show_progress_bar=False` suppresses tqdm output in API and test contexts.

The model is loaded once at `VectorStoreService.create()` time and reused for all
subsequent embed calls.

### 9.3 VectorStoreService Facade

**File:** `backend/vector_store_service.py`

```python
@dataclass
class VectorStoreService:
    store:           InMemoryVectorStore
    embedding_model: EmbeddingModel

    @classmethod
    def create(cls, model_name="all-MiniLM-L6-v2", store_path="") -> VectorStoreService

    def add_text_items(items: List[Dict], text_field: str) -> None
    def query(query_text: str, top_k=10) -> List[Dict]
```

`create()` behaviour:
- If `store_path` is set **and the file exists**: load via `load_vector_store(store_path)`.
  Logs: `INFO Loaded vector store from ... (N items)`.
- If `store_path` is set **but file is missing**: logs a `WARNING` and starts empty.
- If `store_path` is empty: starts empty with no log.

`query(query_text)` embeds the query string on-the-fly using the loaded model, runs
`store.query()`, and returns a list of `{item_id, score, metadata}` dicts sorted by
score descending.

### 9.4 JSONL Persistence

**File:** `backend/vector_store_persist.py`

```python
save_vector_store(store: InMemoryVectorStore, path: str) -> None
load_vector_store(path: str) -> InMemoryVectorStore
```

**Serialisation format — JSONL (one object per line):**

```
{"item_id": "biz_01", "vector": [0.12, -0.34, ...], "metadata": {"stars": 4.0}}
{"item_id": "biz_02", "vector": [...], "metadata": {...}}
```

**Why JSONL instead of a single JSON array?** The previous implementation called
`json.dumps()` on the entire store payload. For a 50k-item store (384-dim vectors per
item) this produced an ~800MB Python string before writing anything — causing a silent
OOM. The output file was 0 bytes. Streaming one line at a time keeps memory use O(1)
relative to store size.

**`save_vector_store`:** opens the file in write mode and streams one `json.dumps()`
call per item, each followed by a newline. No in-memory aggregation.

**`load_vector_store`:** reads the first character to detect format:
- First char is `[` → legacy single-array JSON. Reads the whole file (small files only;
  acceptable for backward compatibility with tiny test stores).
- Otherwise → JSONL. Reconstructs the first line from the already-consumed character
  and iterates line-by-line via `_add_line()`, calling `store.add()` for each parsed
  object.

Memory use during load is bounded to one parsed record at a time plus the accumulated
store (the store's vector arrays themselves must live in memory for querying).

### 9.5 Dataset Ingestion Pipeline

**Files:** `backend/ingest_embeddings.py`, `backend/ingest_datasets.py`

```python
ingest_dataset(
    dataset_path:    str,
    text_field:      str,
    id_field:        str,
    metadata_fields: List[str],
    model_name:      str = "all-MiniLM-L6-v2",
    batch_size:      int = 512,
    limit:           Optional[int] = None,
) -> InMemoryVectorStore
```

**Streaming batch algorithm** (memory-bounded regardless of dataset size):

1. `_stream_batches(path, batch_size, limit)` yields successive `List[Dict]` batches
   by reading the JSONL file line by line. Stops after `limit` records if set.
2. For each batch: extract `text_field` values and call `embed_texts()` (one GPU/CPU
   pass per batch).
3. For each (record, vector) pair: call `store.add()` with `id_field` as item_id and
   `metadata_fields` as the metadata dict. Records with an empty id_field are skipped.
4. Progress logged every batch: `INFO Ingested N records so far …`

**Why batched streaming?** The original implementation called `_load_jsonl()` which read
all 2.85M Yelp records into a Python list before embedding — exhausting available memory
for large datasets. Batching caps memory to roughly `batch_size × avg_record_size`.

Dataset-specific helpers in `ingest_datasets.py` pre-fill the field names and forward
`batch_size` and `limit`:

```python
ingest_yelp_reviews(path, batch_size=512, limit=None)
  # text="text",        id="business_id",  metadata=["name","categories","stars"]

ingest_amazon_reviews(path, batch_size=512, limit=None)
  # text="reviewText",  id="asin",          metadata=["summary","overall"]

ingest_goodreads_reviews(path, batch_size=512, limit=None)
  # text="review_text", id="book_id",        metadata=["rating"]
```

### 9.6 CLI

**File:** `backend/cli.py`

```bash
python -m backend.cli \
  --dataset    yelp|amazon|goodreads \
  --input      /path/to/dataset.jsonl \
  --output     /path/to/vector_store.jsonl \
  --limit      50000   \   # optional: cap records ingested (dev/demo stores)
  --batch-size 512          # optional: embedding batch size (default 512)
```

Calls the appropriate `ingest_*` helper then `save_vector_store()`. Suitable for a
one-time pre-processing step or a scheduled job when the dataset is refreshed.

**Multi-checkpoint ingestion** (`ingest_checkpoints.py` at repo root):

For large production runs, use the multi-checkpoint script instead of the CLI. It
performs a **single streaming pass** through the dataset and saves independent JSONL
snapshots at 50k, 100k, 150k, and 200k records — so a crash or restart never loses
all progress.

```bash
python ingest_checkpoints.py
# Checkpoint stores saved to /tmp/persona_checkpoints/
# Monitor live: tail -f /tmp/persona_checkpoints/ingest.log
```

Progress output (every 10k records to log file, every batch to terminal):
```
[13:05:12]  50,176 / 200,000 records    37/s  ETA 01:07  /tmp free 110.0 GB
  ┌─ CHECKPOINT 50k  [13:05:12]  ─────────────────────────────────────────
  │  File     : /tmp/persona_checkpoints/yelp_50k.jsonl
  │  Items    : 50,176  |  Size: 409 MB  |  Save time: 13.5s
  └────────────────────────────────────────────────────────────────────────
```

The 200k store was built this way in **89 minutes** at 37–38 records/s on CPU.
The `/tmp` volume (typically 110+ GB) is used for intermediate files; copy the
final store to `backend/data/` before the next codespace restart.

### 9.7 Cross-Domain Retrieval (MultiVectorStoreService)

**File:** `backend/multi_vector_store.py`

When multiple per-domain vector stores are configured, `MultiVectorStoreService` fans the
query out across all stores, normalises scores within each domain, and merges results.

```python
class MultiVectorStoreService:
    def __init__(self, stores: Dict[str, VectorStoreService])
    def query(query_text, top_k=10, domain_weights=None) → List[Dict]
    def add_store(domain, store) → None
    def remove_store(domain) → bool
```

**Algorithm:**

```
For each domain store:
  1. Call store.query(query_text, top_k=top_k) → raw results
  2. Min-max normalise scores within the domain:
       norm_score = (score - min_score) / (max_score - min_score)
  3. Apply optional domain_weight multiplier
  4. Tag each result with its domain name

Merge all results:
  5. Deduplicate by item_id, keeping the highest normalised score
  6. Sort by score descending, return top_k
```

**Why per-domain normalisation?** Embedding score distributions differ across datasets
(Yelp restaurant descriptions vs Amazon product reviews have different centring). Raw cosine
scores are not comparable across domains; normalising within each domain before merging
prevents any single dataset from dominating due to distributional differences.

**Configuration:** Three env vars activate the multi-domain path:

```
VECTOR_STORE_PATH_YELP=/data/yelp.json
VECTOR_STORE_PATH_AMAZON=/data/amazon.json
VECTOR_STORE_PATH_GOODREADS=/data/goodreads.json
```

If none are set, the single `VECTOR_STORE_PATH` path is used instead. The `MultiVectorStoreService`
instance is only created when at least one per-domain path is configured.

Faulty stores (connection errors, corrupt JSON) are skipped with an `ERROR` log; the query
returns results from the remaining healthy stores.

---

## 10. Evaluation System

**Package:** `backend/evaluation/`

### 10.1 Metrics

**File:** `backend/evaluation/metrics.py`

All metrics are implemented in pure Python — no external scoring libraries required.

#### RMSE (Task A)

```
RMSE = sqrt( Σ (predicted_i - ground_truth_i)² / N )
```

Measures rating prediction error. Lower is better. Compared against the
mean-rating baseline to report `rmse_improvement`.

#### ROUGE-L (Task A)

Sentence-level F1 via Longest Common Subsequence (LCS):

```
precision = LCS_length / |hypothesis_tokens|
recall    = LCS_length / |reference_tokens|
F1        = 2 × precision × recall / (precision + recall)
```

The LCS is computed with a rolling two-row dynamic programming implementation
(`O(m × n)` time, `O(n)` space).

`rouge_l_corpus()` returns the mean F1 over all (hypothesis, reference) pairs.

#### NDCG@k (Task B)

Binary-relevance Discounted Cumulative Gain:

```
DCG  = Σ rel_i / log₂(rank + 2)         (for rank 0..k-1)
IDCG = DCG of ideal ordering
NDCG = DCG / IDCG
```

`rel_i = 1` if `ranked_items[i] ∈ relevant_items`, else `0`.

#### Hit Rate@k (Task B)

```
HR@k = 1  if any item in ranked_items[:k] is in relevant_items
       0  otherwise
```

Per-user binary metric; caller averages over the user set.

### 10.2 Task A Evaluation Runner

**File:** `backend/evaluation/task_a_eval.py`

```bash
python -m backend.evaluation.task_a_eval \
  --records   data/records.jsonl \
  --split     0.8 \
  --bertscore          # optional; requires bert-score package
```

Algorithm:
1. Temporal split (default 80/20).
2. For each test record:
   - Build profile from the user's train records.
   - Build `RatingCalibration(user_records, all_train_records)`.
   - Calibrate the user's mean rating → predicted rating.
   - Generate a template review.
3. Compute `persona_rmse` and `baseline_rmse` (global mean).
4. Compute `rouge_l` over (generated, reference) pairs where reference is non-empty.
5. If `--bertscore`: compute BERTScore F1 via `bert_score` (optional import, graceful
   warning if not installed).

**Per-user breakdown** (always computed):

| Breakdown | Labels |
|---|---|
| by history length | `sparse` (1–5), `medium` (6–20), `dense` (>20) |
| by cultural signal | `with_nigerian_english`, `without_nigerian_english` |

Output:
```json
{
  "test_size": 1102,
  "persona_rmse": 1.08,
  "baseline_rmse": 1.11,
  "rmse_improvement": 0.03,
  "rouge_l": 0.31,
  "breakdown": {
    "by_history_length": {
      "sparse": {"rmse": 1.23, "users": 186},
      "medium": {"rmse": 1.13, "users": 463},
      "dense":  {"rmse": 1.03, "users": 453}
    },
    "by_cultural_signal": {
      "with_nigerian_english":    {"rmse": 0.97, "users": 81},
      "without_nigerian_english": {"rmse": 1.12, "users": 1021}
    }
  }
}
```

### 10.3 Task B Evaluation Runner

**File:** `backend/evaluation/task_b_eval.py`

```bash
python -m backend.evaluation.task_b_eval \
  --records data/records.jsonl \
  --store   data/vector_store.json \
  --k       10
```

Supports an optional `ablate_layer` parameter (used by the ablation runner) that zeroes
out one profile layer before scoring.

Algorithm:
1. Temporal split (default 80/20).
2. For each user who has train records:
   - Build profile from train records (optionally ablated).
   - Extract preference axes.
   - Embed the user's most recent review text as the query vector.
   - Query the vector store for top-k candidates.
   - Apply deliberative scoring.
   - Compare ranked list against the user's test-set item IDs (relevant set).
   - Record NDCG@k and Hit Rate@k.
3. Also compute baseline NDCG@k and Hit Rate@k using the popularity baseline.

Output includes the same per-user breakdown as Task A eval (by history length and
cultural signal), plus `ndcg_improvement`.

### 10.4 Ablation Study Runner

**File:** `backend/evaluation/ablation.py`

```bash
python -m backend.evaluation.ablation \
  --records data/records.jsonl \
  --store   data/vector_store.json \
  --k       10 \
  --split   0.8
```

Systematically measures the contribution of each profile layer by replacing it with a
zero/neutral value and re-running both Task A and Task B evaluation.

**Layers ablated:**

| Layer | Zero value |
|---|---|
| `rating_stats` | count=0, mean=3.0, std\_dev=0.0 |
| `stylometry` | all lengths and vocab richness = 0.0 |
| `value_keywords` | all categories = 0 |
| `trajectory` | all deltas and means = 0.0 |
| `cultural_signals` | index=0.0, code\_switching=False, hits=0 |

Output:
```json
{
  "full_model": {
    "task_a": {"rmse": 1.08, "rouge_l": 0.31},
    "task_b": {"ndcg": null, "hit_rate": null}
  },
  "ablations": {
    "cultural_signals": {
      "task_a":       {"rmse": 1.09, "rouge_l": 0.26},
      "task_a_delta": {"rmse_delta": 0.01, "rouge_l_delta": -0.05},
      "task_b":       {"ndcg": null, "hit_rate": null},
      "task_b_delta": {"ndcg_delta": null, "hit_rate_delta": null}
    },
    ...
  }
}
```

A large positive `rmse_delta` means removing that layer hurt Task A; a large negative
`ndcg_delta` means it hurt Task B. These figures feed directly into the solution paper's
feature importance analysis.

### 10.5 Baselines

```python
mean_rating_baseline(ratings)           → float      # global mean
popularity_baseline(item_counts, k=10)  → List[str]  # top-k by interaction count
```

These are the minimum bars the system must beat. Both baselines are parameter-free
and serve as the denominator for improvement claims in the solution paper.

---

## 11. API Layer

**File:** `backend/app.py`

### 11.0 Record Parsing

All endpoints that accept a `records` array pass through `_parse_records()`, which maps
raw JSON dicts to `InteractionRecord` dataclasses. The `review_text` field accepts two
source keys to accommodate different caller conventions:

```python
review_text = r.get("review_text") or r.get("text", "")
```

`review_text` takes precedence when present; `text` is the fallback. This matters because:
- Evaluation scripts and the data loaders use `review_text` (canonical field name).
- Direct API callers and Yelp-style payloads often use `text`.
- All downstream signal extractors (stylometry, value keywords, cultural signals,
  trajectory) operate on `review_text`; an empty string produces all-zero signals
  and suppresses cultural register detection.

### 11.1 Endpoint Contracts

#### GET /health

```json
{ "status": "ok" }
```

#### GET /cold-start/questions

Returns the static elicitation question list.

```json
{
  "questions": [
    {
      "id": "rating_tendency",
      "question": "When you enjoy something...",
      "options": ["top_marks", "reserve_top"]
    },
    ...
  ]
}
```

#### POST /cold-start/answer

**Request:**
```json
{
  "user_id": "u_new",
  "answers": [
    {"question_id": "rating_tendency",   "answer": "top_marks"},
    {"question_id": "value_priority",    "answer": "food_quality"},
    {"question_id": "review_style",      "answer": "brief_and_direct"},
    {"question_id": "cultural_register", "answer": "sometimes"}
  ]
}
```

**Response:** `PsychologicalProfile.to_dict()` — identical schema to `/profile/build`.

**Errors:** 400 if `user_id` is empty or `answers` is empty.

#### POST /profile/build

**Request:**
```json
{
  "user_id": "u1",
  "records": [
    {
      "item_id": "biz_01",
      "rating": 4.0,
      "review_text": "The jollof rice was excellent.",
      "timestamp": "2023-06-15",
      "source": "yelp"
    }
  ]
}
```

**Response:**
```json
{
  "user_id": "u1",
  "rating_stats":    { "count": 1, "mean": 4.0, "std_dev": 0.0, "min_rating": 4.0, "max_rating": 4.0 },
  "stylometry":      { "avg_review_length": 29.0, "avg_word_count": 5.0, "vocab_richness": 1.0, "avg_sentence_length": 5.0 },
  "value_keywords":  { "food": 1, "service": 0, "price": 0, "atmosphere": 0 },
  "trajectory":      { "early_mean_rating": 0.0, "recent_mean_rating": 0.0, "delta_rating": 0.0, ... },
  "cultural_signals":{ "nigerian_english_index": 0.0025, "code_switching_detected": false, "pidgin_term_hits": 0 }
}
```

**Errors:** 400 if `user_id` is empty.

#### POST /profile/update

Appends new interaction records to a user's existing history and returns the rebuilt profile.
The profile cache uses a content hash of all records, so passing a superset always produces
a fresh computation and the new profile is automatically cached.

**Request:**
```json
{
  "user_id": "u1",
  "existing_records": [ { "item_id": "biz_01", "rating": 4.0, ... } ],
  "new_records":      [ { "item_id": "biz_02", "rating": 3.5, ... } ]
}
```

**Response:**
```json
{
  "updated": true,
  "profile": { ... }    // full PsychologicalProfile dict, same schema as /profile/build
}
```

**Errors:** 400 if `user_id` is empty; 400 if `new_records` is empty.

#### POST /task-a/simulate

**Request:**
```json
{
  "user_id": "u1",
  "records": [ ... ],
  "target_item": { "name": "Kilimanjaro Restaurant", "description": "Nigerian cuisine" },
  "population_records": [ ... ],
  "use_llm": false
}
```

**Response:**
```json
{
  "user_id": "u1",
  "target_item": { "name": "Kilimanjaro Restaurant", "description": "Nigerian cuisine" },
  "predicted_rating": 3.9,
  "reasoning": "User mean rating is 4.20 (σ=0.50, n=12); calibrated downward to 3.90 against population mean 3.50. Top preference axes: food (w=0.62). Review style: ~80 words, vocab richness 0.62. Nigerian English detected (index=0.04, pidgin hits=2); cultural register applied.",
  "review_text": "Really enjoyed this. The food was the highlight. Kilimanjaro Restaurant delivered what I was looking for. Abeg, try am yourself and see."
}
```

**Errors:** 400 if `user_id` or `target_item` is missing.

#### POST /task-b/recommend

**Request:**
```json
{
  "user_id": "u1",
  "records": [ ... ],
  "query_text": "spicy grilled food Lagos",
  "top_k": 10,
  "session_id": "sess-abc123",      // optional: enables multi-turn state
  "constraints": {"cuisine": "Nigerian"}  // optional: merged into session constraints
}
```

or with explicit vectors:

```json
{
  "user_id": "u1",
  "records": [ ... ],
  "query_vectors": [[0.12, -0.34, ...]],
  "candidates": [{"item_id": "c1", "vector": [...], "metadata": {"food": true}}],
  "top_k": 5,
  "weights": [1.0],
  "penalties": {"slow_service": 0.3}
}
```

**Response (without session):**
```json
{
  "user_id": "u1",
  "axes": [
    {"name": "food", "rationale": "Mentions food in 4 reviews", "weight": 0.8}
  ],
  "recommendations": [
    {
      "item_id": "biz_01",
      "score": 1.62,
      "explanation": "Similarity score 0.82; Matched axes: food",
      "metadata": { "name": "Chicken Republic", "food": true }
    }
  ]
}
```

**Response (with session):** same structure plus `"session_id": "sess-abc123"` at the top
level; previously recommended items are excluded from `recommendations`.

**Errors:** 400 if `user_id` is missing; 400 if neither `query_text` nor `query_vectors`
is provided; 400 if `candidates` is missing when `query_text` is not provided.

#### POST /task-b/agent

Identical request shape to `/task-b/recommend` (without `query_text`). Additional field:

```json
{ "use_llm": false }
```

**Response:**
```json
{
  "user_id": "u1",
  "steps": [
    {"thought": "Calling build_profile", "tool": "build_profile", "result": { ... }},
    {"thought": "Calling extract_axes",   "tool": "extract_axes",  "result": { ... }},
    {"thought": "Calling retrieve_candidates", ...},
    {"thought": "Calling score_candidates",    ...}
  ],
  "final": {
    "tool_results": [ {...}, {...}, {...}, {...} ]
  }
}
```

**Errors:** 400 if `user_id`, `query_vectors`, or `candidates` is missing.

### 11.2 Trace-ID Middleware

Every request gets a `X-Trace-Id` header (UUID v4, or forwarded from the caller):

```python
@app.middleware("http")
async def add_trace_id(request, call_next):
    trace_id = request.headers.get("X-Trace-Id") or str(uuid.uuid4())
    request.state.trace_id = trace_id
    response = await call_next(request)
    response.headers["X-Trace-Id"] = trace_id
    logger.info("request_completed", extra={"trace_id": trace_id})
    return response
```

The trace ID is included in all log lines via `TraceIdFilter` in `logging_utils.py`,
enabling full request correlation in log aggregation systems.

---

## 12. Infrastructure

### 12.1 Configuration

**File:** `backend/config.py`

All settings are read from environment variables at import time via `app_config_from_env()`.

**Automatic `.env` loading**: `config.py` imports `python-dotenv` at module level and
calls `load_dotenv(override=False)` before any `os.getenv()` calls. This means placing
variables in a `.env` file at the repo root is sufficient — no manual `export` step is
required. If a variable is already set in the process environment it takes precedence
(`override=False`). If `python-dotenv` is not installed the import is silently skipped
and the app continues using the process environment only.

```python
@dataclass(frozen=True)
class AppConfig:
    deterministic_mode:           bool
    profile_cache_ttl_seconds:    int
    profile_cache_max_size:       int
    enable_llm:                   bool
    openai_api_key:               str
    openai_model:                 str
    vector_store_path:            str   # single-domain store
    vector_store_path_yelp:       str   # per-domain stores for cross-domain retrieval
    vector_store_path_amazon:     str
    vector_store_path_goodreads:  str
```

`MultiVectorStoreService` is instantiated at startup if any of the three per-domain paths
are non-empty; a single `VectorStoreService` is used otherwise.

Helper functions handle type coercion with defaults:
- `_get_bool_env(name, default)` — recognises `"1"`, `"true"`, `"yes"`, `"y"`.
- `_get_int_env(name, default)` — falls back to `default` on empty string.
- `os.getenv(name, "").strip()` — for optional string fields.

`_get_env(name)` raises `ValueError` for missing required env vars (used for dataset
paths when the loaders are called, not at app startup).

**`DatasetPaths`** is a separate frozen dataclass constructed by `dataset_paths_from_env()`
and only needed when the data loaders are called directly (evaluation scripts, CLI).

### 12.2 TTL + LRU Cache

**File:** `backend/cache.py`

```python
class TTLCache(Generic[K, V]):
    def __init__(self, max_size: int, ttl_seconds: int)
    def get(key: K) -> Optional[V]
    def set(key: K, value: V) -> None
    def size() -> int
```

Implemented on `collections.OrderedDict` with two eviction policies:
- **TTL**: entries expire `ttl_seconds` after insertion. Checked on `get()`; expired
  entries are removed lazily.
- **LRU**: when `len > max_size`, the oldest entry (front of the ordered dict) is
  evicted. `set()` and successful `get()` both move entries to the end (most-recent).

Both policies interact safely: an expired entry that is also the LRU candidate is
removed by the TTL check before LRU eviction would need to consider it.

### 12.3 Profile Service Caching

**File:** `backend/services/profile_service.py`

`ProfileService.build_profile_cached(user_id, records)` caches profiles keyed by a
SHA-256 hash of the serialised `(user_id, records)` payload. This means:
- Same user with same records → cache hit.
- Same user with any change in records → cache miss (recomputes).

The hash payload includes `item_id`, `rating`, `review_text`, `timestamp`, and `source`
for each record (not `metadata`, which is considered non-semantic for profiling).

Default cache: 1000 entries, 1-hour TTL (both configurable via env vars).

### 12.4 LLM Client and Retry Policy

**File:** `backend/llm_client.py`

```python
class OpenAIClient:
    def chat_completion(messages, tools=None, tool_choice=None, temperature=0.2) -> Dict
```

**Retry policy** (wrapped around `client.chat.completions.create()`):

| Attempt | Delay before | Exceptions caught |
|---|---|---|
| 1 (first try) | none | — |
| 2 | 1 s | `RateLimitError`, `APIStatusError` with code in {429,500,502,503,504} |
| 3 | 2 s | same |
| raise | — | same (after 3 attempts exhausted) |

Exponential backoff doubles the delay per retry. Non-retryable `APIStatusError` codes
(e.g. 400 Bad Request, 401 Unauthorized) are re-raised immediately.

`OpenAIClient` is only instantiated when `ENABLE_LLM=true` and `OPENAI_API_KEY` is set
(via `llm_factory.create_openai_client()`). All service constructors accept
`llm_client=None` and degrade gracefully to the template/deterministic path.

### 12.5 Structured Logging and Request Tracing

**File:** `backend/logging_utils.py`

Log format:
```
2026-05-22 10:15:43,201 INFO trace_id=3f8a1b2c-... request_completed
```

`TraceIdFilter` adds `trace_id="-"` to any log record that does not already have a
`trace_id` attribute, ensuring the `%(trace_id)s` format field always resolves
(background threads, startup logs, test output, any code path that does not go through
the HTTP middleware).

`configure_logging()` is called once at `app.py` import time:

```python
def configure_logging() -> None:
    _filter = TraceIdFilter()
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(Formatter("... %(trace_id)s ..."))
        handler.addFilter(_filter)
        root.addHandler(handler)
    else:
        for handler in root.handlers:
            handler.addFilter(_filter)
            handler.setFormatter(Formatter("... %(trace_id)s ..."))
    root.addFilter(_filter)
```

**Why the filter is attached to handlers (not just the root logger):** Python's logging
infrastructure resolves format fields at `handler.format(record)` time. A filter added
only to the logger runs before handler dispatch but the format field check happens in
the handler's formatter. Without the handler-level filter the `%(trace_id)s` field
raises `ValueError` for log records that originate outside the HTTP request lifecycle.

### 12.6 Docker and Compose

**`backend/Dockerfile`**
```dockerfile
FROM python:3.12-slim
WORKDIR /app
# Build context is repo root (set in docker-compose.yml context: .)
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY . .
ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

Both `backend/services/__init__.py` and `backend/tests/__init__.py` are committed as
explicit empty package markers, required for consistent imports inside Docker.

**`docker-compose.yml`**
```yaml
services:
  api:
    build: { context: ., dockerfile: backend/Dockerfile }
    ports:  ["8000:8000"]
    env_file: [.env]
    volumes: ["./data:/data"]          # exposes CLI-built vector stores
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

`./data` is mounted read-write so the CLI can write vector store JSON files inside
the container's `/data` path, which then persist on the host for subsequent runs.

---

## 13. Design Decisions

### Why in-memory vector store instead of ChromaDB or FAISS?

The PRD listed ChromaDB but the actual implementation uses a custom in-memory store.
Rationale: zero external service dependency (no Docker sidecar needed), full control
over persistence format (plain JSON, readable and debuggable), and O(n) cosine scan
is fast enough for demo-scale datasets (tens of thousands of items). The interface
(`add`, `query`) is stable and can be replaced with a production vector database behind
the same `VectorStoreService` facade without changing any API or pipeline code.

### Why template-based review generation rather than always using LLM?

Templates produce deterministic, latency-free output that can be run without an API key.
This satisfies the PRD requirement for a deterministic demo mode and makes evaluation
reproducible. The LLM path is available when `use_llm=True` and is intended as the
production-quality path; the template path is the fallback and baseline.

### Why per-candidate metadata matching in deliberative scoring?

An earlier implementation added `axis_score = sum(axis.weight for axis in axes)` as a
global constant to every candidate's score — a no-op for ranking. The corrected design
matches axis names against candidate metadata keys so only items that are actually
relevant to the user's axes receive a boost. This requires dataset ingestion to populate
metadata fields that correspond to axis names (e.g. `"food": true` for food-category
items).

### Why SHA-256 hash as cache key instead of (user_id, record_count)?

A count-based key would produce false cache hits when records change (e.g. a record is
updated with a corrected rating). The hash covers all semantically relevant fields and
produces a different key on any data change while remaining collision-resistant.

### Why profile_service is module-level in app.py?

FastAPI's module-level initialisation means `ProfileService` (and its `TTLCache`) are
shared across all requests in a single process — the intended behaviour. The cache is
not request-scoped. In a multi-worker deployment each worker has its own cache, which
is acceptable since the cache is advisory (not authoritative).

### Why is `timestamp_key` public in `data/split.py`?

`trajectory.py` needs the same timestamp parsing logic. Duplicating it would create a
maintenance burden. Making it public and importing it is preferable to importing a
private function (which signals it is not part of the module's contract).

### Why JSONL for vector store persistence instead of a single JSON array?

The original implementation called `json.dumps()` on the full store payload (50k items ×
384-dim vectors = ~800MB) in a single shot. Python string concatenation of that scale
causes a silent OOM: the file is opened and truncated to 0 bytes before the write, so
a failed write leaves an empty file with no error. Streaming one JSON object per line
makes memory usage independent of store size. For the current 200k store (1.6 GB),
this is essential. `load_vector_store` auto-detects the legacy format by checking
whether the first character is `[`, so existing small test stores continue to work
without migration.

### Why stream-batch ingestion instead of load-all-then-embed?

The Yelp Academic Dataset is 6.99M reviews (~5.3 GB JSONL). Loading it into a Python list
before embedding would require multi-GB RAM before the first vector is produced. Batching
reads and embedding in `batch_size` chunks (default 512) caps peak memory to roughly
one batch plus the growing store, making it possible to ingest any dataset size on
commodity hardware. The 200k-item store uses ~1.2 GB RAM at runtime (200k × 384-dim
float32 vectors plus Python overhead).

### Why multi-checkpoint ingestion instead of a single --limit run?

A single `--limit 200000` CLI run works but produces one file at the end. If the run is
interrupted (codespace restart, OOM, power loss), all 89 minutes of work are lost.
`ingest_checkpoints.py` saves a complete, usable JSONL snapshot at each 50k boundary
during the same streaming pass. Each checkpoint file is an independent, fully valid
vector store that can be used immediately — giving four recovery points at zero extra
embedding cost.

### Why accept both `review_text` and `text` in record parsing?

The canonical field name inside `InteractionRecord` is `review_text` (matches the
evaluation scripts and data loaders). However, direct API callers and Yelp-style
payloads naturally use `text`. Without the fallback, callers who send `text` receive
all-zero stylometry, value keyword, trajectory, and cultural signals — the profile
appears as a new user with no history. The fallback is a one-line change that eliminates
an entire class of silent misconfiguration.

### Why guarantee all 4 agent steps even when the LLM returns fewer?

`tool_choice="auto"` in a single OpenAI chat completion may return only 1–2 tool calls;
the model is not required to exhaust the list in one shot. Mapping only the returned
names caused the agent to silently stop after `extract_axes`, returning a response with
an empty `score_candidates` result. The fill-in ensures `retrieve_candidates` and
`score_candidates` always execute regardless of LLM output, making the agent path as
reliable as the deterministic path while still respecting any reordering the LLM
chooses.

---

## 14. Extension Points

| Feature | Current implementation | Upgrade path |
|---|---|---|
| Vector database | `InMemoryVectorStore` (O(n) cosine scan) | Drop-in `ChromaDBVectorStore` behind `VectorStoreService` — interface is already stable |
| LLM provider | OpenAI via `llm_client.py` | Add `AnthropicClient` / `OllamaClient` with same `chat_completion()` interface; update `llm_factory.py` |
| Review generation | Template + structured LLM prompts (`review_generator.py`, `llm_prompts.py`) | BERTScore-ranked template selection; expand cultural phrase library |
| Evaluation text quality | ROUGE-L + optional BERTScore | Install `bert-score`; pass `--bertscore` flag to `task_a_eval` |
| Cold-start elicitation | 4 fixed questions | Add adaptive question selection based on partial answer uncertainty |
| Cultural signals | 12 fixed pidgin terms | Expand dictionary from sociolinguistic corpus; add Yoruba, Igbo, Hausa term sets |
| Cross-domain retrieval | `MultiVectorStoreService` with per-domain min-max normalisation | Add source reliability weights; cache per-domain embedding norms |
| Ablation studies | `evaluation/ablation.py` with 5 layers | Add interaction-level ablation (e.g. ablate cold-start vs history users) |
| Multi-turn recommendation | `session.py` + `SessionStore` with TTL+LRU | Persist sessions to Redis for multi-worker deployments |
| Profile cache | In-process TTL+LRU | Add Redis or Memcached backend for multi-worker shared cache |
| Reasoning trace | `_build_reasoning()` in task_a_service | Include trajectory plot data for frontend visualisation |
