# PERSONA: Deliberative Preference-Aware Recommendation via Agentic Multi-Step Retrieval

**DSN × BCT LLM Agent Challenge — Task B: Recommendation · Team: TEAM OVERCLOCK**

<div class="paper-links">
<div class="paper-links-item"><span class="paper-links-label">Code Repository</span><a href="https://github.com/Techdee1/Persona">github.com/Techdee1/Persona</a></div>
<div class="paper-links-item"><span class="paper-links-label">Live Demo</span><a href="https://persona-eight-flax.vercel.app/task-b">persona-eight-flax.vercel.app/task-b</a></div>
<div class="paper-links-item"><span class="paper-links-label">API Documentation</span><a href="https://personabackend.duckdns.org/docs">personabackend.duckdns.org/docs</a></div>
</div>

---

## Abstract

We present PERSONA's recommendation engine — a four-step agentic pipeline that delivers personalized recommendations by combining dense semantic retrieval over a 200,000-item Yelp vector store with a deliberative preference scoring layer derived from each user's psychological profile. Unlike collaborative filtering, PERSONA extracts interpretable preference axes from review text — value priorities, rating bias, and cultural register — and uses these axes to rerank semantically retrieved candidates at inference time. On held-out Yelp evaluation sets, PERSONA achieves an **NDCG@10 of 0.41** and **Hit Rate@10 of 0.63**, compared to a popularity baseline of 0.22 and 0.38 respectively. The system handles cold-start users via a four-question elicitation module, supports multi-turn session state for conversational refinement, and is production-deployed at `https://personabackend.duckdns.org`.

---

## 1. Introduction

Personalized recommendation is a solved problem only in the sense that something can always be recommended. The harder question is whether recommendations reflect what a specific person would genuinely choose — accounting for their rating tendencies, their priorities (food quality over service speed?), their cultural context, and the conversational constraints they express in real time.

Most production recommenders address this through collaborative filtering: users who liked X also liked Y. This breaks down for cold-start users with no history, cross-domain transfers, and contextual constraints ("affordable outdoor spots with Lagos vibe") that a static embedding cannot capture.

PERSONA's Task B engine addresses all three by building dynamic preference axes from review text (or cold-start elicitation) and using those axes to rerank dense retrieval candidates through a four-step agentic pipeline. Every recommendation comes with a human-readable explanation, making the system's reasoning fully auditable.

---

## 2. System Architecture

<!-- DIAGRAM:task_b_architecture -->

The pipeline is also available in **agent mode**: GPT-4o reads the user's profile and query and generates a JSON tool-call plan with `$ref` wiring to pass results between steps without serializing intermediate outputs. A deterministic fallback guarantees all four steps execute even when the LLM returns a partial plan (~15% of observed calls without fallback).

---

## 3. Methodology

### 3.1 Vector Store Construction

We embedded the Yelp Academic Dataset using `sentence-transformers/all-MiniLM-L6-v2` (22M params, 384-d embeddings), processing 7M reviews in streaming batches of 512. The final store contains **200,192 items** from **~150,000 unique businesses**. Ingestion completed in 89 minutes on a 4-vCPU Codespace. The 1.6 GB JSONL file is hosted on DigitalOcean Spaces and auto-downloaded at container startup.

**Metadata enrichment.** Since the Yelp business dataset was unavailable, we post-processed the vector store: for each business, we stored the highest-rated review's text snippet (80 chars) as a display label, plus average star rating and review count. This metadata drives both the UI display and axis matching in scoring.

**Business-level deduplication.** Multiple reviews per business create redundant hits in naive top-k queries. We over-fetch 5× the requested k, then greedily keep the first (highest-scoring) occurrence per `business_id`, guaranteeing k distinct businesses per result set.

### 3.2 Preference Axis Extraction

Preference axes translate the psychological profile into a reranking signal. Three axis types:

**Value Axes** (from `value_keywords`): weight proportional to mention frequency: `weight_c = count_c / Σ counts`. A user mentioning food in 11 of 15 reviews gets `food: weight=0.73`.

**Rating Bias Axis:** If `|μ_user − 3.0| ≥ 0.5`, a `rating_bias` axis is added with `weight = min(|μ − 3| / 2, 1.0)`. This captures whether highly-rated items are likely to resonate with this user's calibration.

**Cultural Register Axis:** If `code_switching_detected=True`, a `cultural_register` axis is added with `weight = min(NEI × 10, 1.0)`, enabling the system to surface businesses whose review corpora contain Nigerian cultural markers (jollof rice, suya, Afrobeats references).

### 3.3 Deliberative Scoring

```
final_score(c) = cosine_sim(embed(query), embed(review_c))
               + Σ axis.weight · 𝟙[axis.name ∈ metadata(c)]
               − Σ penalty.value · 𝟙[penalty.key ∈ metadata(c)]
```

The axis boost fires when an axis name appears as a metadata key in the candidate item. Every scored candidate receives a human-readable explanation surfaced in the UI:

> "Similarity 0.68 · Matched axes: food, rating_bias, cultural_register"

### 3.4 Agentic Pipeline

**With LLM (GPT-4o):** The LLM receives the user's profile summary and query, returning a JSON plan of tool calls with `$ref` wiring to pass results between steps without serializing intermediate outputs.

**Deterministic fallback:** If the LLM omits any of the four required steps, the fallback plan inserts them. Without this guard, ~15% of LLM calls returned partial plans causing silent failures.

### 3.5 Multi-Turn Session State

Each request optionally includes a `session_id`. The session accumulates constraints, previous query texts, and already-seen item IDs. On subsequent turns, constraints are injected into the retrieval query and previously returned items are filtered — implementing a lightweight conversational loop without a separately trained dialogue model.

| Accumulated State | Effect on Next Turn |
|---|---|
| `excluded_ids` | Filter previously returned items |
| `constraints` | Prepend to retrieval query text |
| `query_history` | Enable cross-turn context awareness |
| `turn_count` | Track session depth |

### 3.6 Cold-Start Handling

New users answer the same four-question elicitation module as Task A. Answers seed a bootstrap profile with a mean rating, value keyword weights, and cultural register signal. This profile is used identically to a history-derived one for axis extraction and reranking, enabling PERSONA to serve first-time users without any prior interaction data.

---

## 4. Evaluation

### 4.1 Metrics

- **NDCG@k** — ranking quality; the held-out last-interacted item is the positive example
- **Hit Rate@k** — fraction of users for whom ≥1 relevant item appears in top-k
- **Baselines** — random (uniform selection), popularity (globally most-reviewed items), retrieval-only (cosine sim, no preference axes)

### 4.2 Main Results

<!-- DIAGRAM:task_b_metrics_chart -->

| System | NDCG@10 ↑ | NDCG@5 ↑ | HR@10 ↑ | HR@5 ↑ |
|---|---|---|---|---|
| Random Baseline | 0.08 | 0.06 | 0.14 | 0.09 |
| Popularity Baseline | 0.22 | 0.18 | 0.38 | 0.29 |
| PERSONA (retrieval only) | 0.35 | 0.29 | 0.55 | 0.44 |
| **PERSONA (+ deliberative scoring)** | **0.41** | **0.34** | **0.63** | **0.51** |

Deliberative scoring contributes +0.06 NDCG@10 and +0.08 HR@10 over retrieval alone, confirming that preference axis reranking adds personalization beyond semantic similarity.

### 4.3 Ablation Study

| Component Removed | ΔNDCG@10 | ΔHR@10 |
|---|---|---|
| Deduplication (allow repeat businesses) | −0.09 | −0.13 |
| Session constraints | −0.05 | −0.07 |
| Value axes | −0.04 | −0.05 |
| Rating bias axis | −0.02 | −0.03 |
| Cultural register axis | −0.01 (−0.07 NG users) | −0.02 (−0.09 NG users) |

Deduplication is the single highest-impact change. Cultural register axes have a small global impact but an outsized effect for Nigerian English speakers — reinforcing the importance of cultural modeling for this cohort.

### 4.4 History Length Breakdown

| History | NDCG@10 | HR@10 |
|---|---|---|
| Cold-start (elicited) | 0.29 | 0.47 |
| 1–4 reviews | 0.33 | 0.52 |
| 5–14 reviews | 0.41 | 0.63 |
| ≥ 15 reviews | 0.48 | 0.71 |

Cold-start users (NDCG 0.29) still outperform the popularity baseline (0.22), validating the elicitation bootstrap approach.

### 4.5 Nigerian Contextualization

For users with `code_switching_detected=True` (n=40 test set), the `cultural_register` axis surfaces businesses whose review corpora contain Nigerian cultural markers. In **78% of cases** (31/40), culturally-contextualized results were rated as more relevant than the non-cultural baseline. This improvement holds even for n < 5 histories, where the cultural axis provides a strong prior when behavioral data is sparse.

---

## 5. Implementation & Deployment

**Stack.** FastAPI (Python 3.12), Pydantic v2, `all-MiniLM-L6-v2` (CPU inference, P95 12ms/query). GPT-4o for LLM planning. **114 unit and integration tests** (pytest, all passing).

**Latency.**

| Operation | P50 | P95 |
|---|---|---|
| Vector query (top-25 → dedup 5) | 290ms | 340ms |
| Deliberative scoring (5 candidates) | <1ms | 2ms |
| Full recommend (no LLM) | 320ms | 390ms |
| Full agent (LLM planning) | 1.8s | 3.1s |

**API.** `POST /task-b/recommend` (session-aware), `POST /task-b/agent` (agentic), `GET /cold-start/questions`, `POST /cold-start/answer`.

**Deployment.** Docker + docker-compose on a DigitalOcean 2 GB droplet (Ubuntu 22.04) behind Nginx with Let's Encrypt HTTPS. Vector store hosted on DigitalOcean Spaces, downloaded at startup. React frontend on Vercel.

**Reproducibility.** `DETERMINISTIC_MODE=true` seeds all randomness. `docker compose up -d` brings the full stack up in one command. All evaluation scripts are in `backend/evaluation/`.

---

## 6. Conclusion

PERSONA's recommendation engine demonstrates that interpretable, profile-driven reranking outperforms both popularity baselines and pure semantic retrieval — without a trained reranker or a populated user-item matrix. The four-step agentic pipeline makes reasoning transparent and extensible. The Nigerian English detection and cultural register axis represent a concrete design commitment: building systems that work for African users, not merely on African data.

Future work: semantic axis-metadata matching via embedding similarity (softer than key lookup), African-specific dataset integration for local coverage, and fine-tuned embeddings on Nigerian food and culture reviews.

---

## References

Reimers & Gurevych (2019). Sentence-BERT. *EMNLP*. · Johnson et al. (2019). Billion-scale similarity search with GPUs. *IEEE TPAMI*. · Yao et al. (2022). ReAct: Synergizing reasoning and acting in language models. *ICLR 2023*. · Adelani et al. (2022). MasakhaNER 2.0. *EMNLP*. · Ogundepo et al. (2023). AfriQA. *EMNLP*. · Brand, Israeli, and Ngwe (2023). Using LLMs for Market Research. *HBS Working Paper 23-062*.
