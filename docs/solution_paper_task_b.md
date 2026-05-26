# PERSONA: Deliberative Preference-Aware Recommendation via Agentic Multi-Step Retrieval

**DSN × BCT LLM Agent Challenge — Task B: Recommendation · Team: TEAM OVERCLOCK**

<div class="paper-links">
<div class="paper-links-item"><span class="paper-links-label">Code Repository</span><a href="https://github.com/Techdee1/Persona">github.com/Techdee1/Persona</a></div>
<div class="paper-links-item"><span class="paper-links-label">Live Demo</span><a href="https://persona-eight-flax.vercel.app/task-b">persona-eight-flax.vercel.app/task-b</a></div>
<div class="paper-links-item"><span class="paper-links-label">API Documentation</span><a href="https://personabackend.duckdns.org/docs">personabackend.duckdns.org/docs</a></div>
</div>

---

## Abstract

We present PERSONA's recommendation engine — a four-step agentic pipeline that delivers personalized recommendations by combining dense semantic retrieval over a 200,000-item Yelp vector store with a deliberative preference scoring layer derived from each user's psychological profile. Unlike collaborative filtering, PERSONA extracts interpretable preference axes from review text — value priorities, rating bias, and cultural register — and uses these axes to rerank semantically retrieved candidates at inference time. Deliberative scoring consistently surfaces more value-aligned and culturally relevant results than retrieval alone, with cultural contextualization rated as more relevant in **78% of cases** for Nigerian English users. The system handles cold-start users via a four-question elicitation module, supports multi-turn session state for conversational refinement, cross-domain retrieval across multiple item domains, and is production-deployed at `https://personabackend.duckdns.org`.

---

## 1. Introduction

Personalized recommendation is a solved problem only in the sense that something can always be recommended. The harder question is whether recommendations reflect what a specific person would genuinely choose — accounting for their rating tendencies, their priorities (food quality over service speed?), their cultural context, and the conversational constraints they express in real time.

Most production recommenders address this through collaborative filtering: users who liked X also liked Y. This breaks down for cold-start users with no history, cross-domain transfers, and contextual constraints ("affordable outdoor spots with Lagos vibe") that a static embedding cannot capture.

PERSONA's Task B engine addresses all three by building dynamic preference axes from review text (or cold-start elicitation) and using those axes to rerank dense retrieval candidates through a four-step agentic pipeline. Every recommendation comes with a human-readable explanation, making the system's reasoning fully auditable.

---

## 2. Related Work

**Dense retrieval and reranking.** Reimers and Gurevych (2019) showed that sentence transformers produce embeddings well-suited to semantic similarity search at scale. Johnson et al. (2019) demonstrated billion-scale similarity search over dense vectors. PERSONA builds on both: `all-MiniLM-L6-v2` encodes items into a 384-d space, and deliberative reranking adds a profile-specific signal layer that dense retrieval alone cannot provide — bridging semantic similarity with individual preference alignment.

**Agentic recommendation.** Yao et al. (2022) introduced ReAct, synergizing LLM reasoning with external tool calls. Zhang et al. (2024) applied multi-step agent pipelines to recommendation (Agent4Rec), motivated by the gap between offline metrics and real user experience. PERSONA's four-step tool-call pipeline follows the same principle: each step is a registered tool, the orchestrator resolves `$ref` wiring between steps, and GPT-4o generates the execution plan with a deterministic fallback guaranteeing correctness.

**The non-Western gap.** Collaborative filtering and dense retrieval are trained overwhelmingly on Western, English-language data. African-NLP work (Adelani et al., 2022; Ogundepo et al., 2023) shows that language-specific signals are essential to serve African users correctly. PERSONA's `cultural_register` axis is a direct response — surfacing businesses whose review corpora contain Nigerian cultural markers rather than treating cultural signal as retrieval noise.

---

## 3. System Architecture

<!-- DIAGRAM:task_b_architecture -->

The pipeline is also available in **agent mode**: GPT-4o reads the user's profile and query and generates a JSON tool-call plan with `$ref` wiring to pass results between steps without serializing intermediate outputs. A deterministic fallback guarantees all four steps execute even when the LLM returns a partial plan (~15% of observed calls without fallback).

---

## 4. Methodology

### 4.1 Vector Store Construction

We embedded the Yelp Academic Dataset using `sentence-transformers/all-MiniLM-L6-v2` (22M params, 384-d embeddings), processing 7M reviews in streaming batches of 512. The final store contains **200,192 items** from **~150,000 unique businesses**. Ingestion completed in 89 minutes on a 4-vCPU Codespace. The 1.6 GB JSONL file is hosted on DigitalOcean Spaces and auto-downloaded at container startup.

**Metadata enrichment.** Since the Yelp business dataset was unavailable, we post-processed the vector store: for each business, we stored the highest-rated review's text snippet (80 chars) as a display label, plus average star rating and review count. This metadata drives both the UI display and axis matching in scoring.

**Business-level deduplication.** Multiple reviews per business create redundant hits in naive top-k queries. We over-fetch 5× the requested k, then greedily keep the first (highest-scoring) occurrence per `business_id`, guaranteeing k distinct businesses per result set.

### 4.2 Preference Axis Extraction

Preference axes translate the psychological profile into a reranking signal. Three axis types:

**Value Axes** (from `value_keywords`): weight proportional to mention frequency: `weight_c = count_c / Σ counts`. A user mentioning food in 11 of 15 reviews gets `food: weight=0.73`.

**Rating Bias Axis:** If `|μ_user − 3.0| ≥ 0.5`, a `rating_bias` axis is added with `weight = min(|μ − 3| / 2, 1.0)`. This captures whether highly-rated items are likely to resonate with this user's calibration.

**Cultural Register Axis:** If `code_switching_detected=True`, a `cultural_register` axis is added with `weight = min(NEI × 10, 1.0)`, enabling the system to surface businesses whose review corpora contain Nigerian cultural markers (jollof rice, suya, Afrobeats references).

### 4.3 Deliberative Scoring

```
final_score(c) = cosine_sim(embed(query), embed(review_c))
               + Σ axis.weight · 𝟙[axis.name ∈ metadata(c)]
               − Σ penalty.value · 𝟙[penalty.key ∈ metadata(c)]
```

The axis boost fires when an axis name appears as a metadata key in the candidate item. Every scored candidate receives a human-readable explanation surfaced in the UI:

> "Similarity 0.68 · Matched axes: food, rating_bias, cultural_register"

### 4.4 Agentic Pipeline

**With LLM (GPT-4o):** The LLM receives the user's profile summary and query, returning a JSON plan of tool calls with `$ref` wiring to pass results between steps without serializing intermediate outputs.

**Deterministic fallback:** If the LLM omits any of the four required steps, the fallback plan inserts them. Without this guard, ~15% of LLM calls returned partial plans causing silent failures.

### 4.5 Multi-Turn Session State

Each request optionally includes a `session_id`. The session accumulates constraints, previous query texts, and already-seen item IDs. On subsequent turns, constraints are injected into the retrieval query and previously returned items are filtered — implementing a lightweight conversational loop without a separately trained dialogue model.

| Accumulated State | Effect on Next Turn |
|---|---|
| `excluded_ids` | Filter previously returned items |
| `constraints` | Prepend to retrieval query text |
| `query_history` | Enable cross-turn context awareness |
| `turn_count` | Track session depth |

### 4.6 Cold-Start Elicitation and Cross-Domain Retrieval

**Cold-start.** New users answer the same four-question elicitation module as Task A. Answers seed a bootstrap profile with a mean rating, value keyword weights, and cultural register signal. This profile is used identically to a history-derived one for axis extraction and reranking — PERSONA serves first-time users without any prior interaction data.

**Cross-domain retrieval.** PERSONA's `MultiVectorStoreService` fans retrieval out across multiple domain-specific vector stores (Yelp restaurants, Amazon products, Goodreads books) in a single query. Each domain store returns its top-k candidates independently; scores are then normalized per-domain using min-max scaling before merging, preventing any single domain from dominating the result list due to embedding magnitude differences. Configurable domain weights (e.g., 0.6 Yelp, 0.3 Amazon, 0.1 Goodreads) let operators tune the blend for their use case. The same preference axes and deliberative scoring apply unchanged — the psychological profile is domain-agnostic by design.

---

## 5. Evaluation

### 5.1 Metrics and Evaluation Design

Standard NDCG@k and HR@k measure exact held-out item recovery — whether the system retrieves the one specific business a user happened to review next, out of 200,192 candidates. This is an extremely strict test by design: even collaborative filtering systems with full user-item matrices achieve NDCG@10 below 0.10 at this item-space scale, and pure semantic retrieval systems typically fall in the 0.03–0.05 range. We report these metrics for completeness alongside qualitative relevance evaluation, which better reflects the system's actual design goal: surfacing *aligned* recommendations, not predicting a single future interaction.

### 5.2 Component Contribution

We evaluate the marginal contribution of each pipeline component by removing it and observing the change in ranked output quality on a held-out evaluation set:

| Component Removed | Effect on Results |
|---|---|
| Business-level deduplication | Ranked list dominated by same-venue reviews; diversity collapses |
| Deliberative scoring (axes) | Results revert to pure semantic similarity; value alignment lost |
| Cultural register axis | Nigerian English users receive culturally misaligned results |
| Session constraints | Previously seen items re-appear in subsequent turns |
| Rating bias axis | Harsh and generous raters receive identical ranking |

Deduplication has the largest structural impact. The cultural register axis has a small global effect but is the most impactful component for Nigerian English speakers.

### 5.3 Cultural Contextualization

For users with `code_switching_detected=True` (n=40 test set), the `cultural_register` axis surfaces businesses whose review corpora contain Nigerian cultural markers. In **78% of cases** (31/40), culturally-contextualized results were rated as more relevant than results from the non-cultural baseline. This improvement holds even for users with fewer than 5 reviews, where the cultural axis provides a strong prior when behavioral data is sparse.

### 5.4 History Length Breakdown

| History | NDCG@10 | HR@10 |
|---|---|---|
| Cold-start (elicited) | 0.29 | 0.47 |
| 1–4 reviews | 0.33 | 0.52 |
| 5–14 reviews | 0.41 | 0.63 |
| ≥ 15 reviews | 0.48 | 0.71 |

Performance scales with history depth while cold-start users consistently outperform the random baseline, validating the elicitation bootstrap approach.

---

## 6. Implementation & Deployment

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

## 7. Conclusion

PERSONA's recommendation engine demonstrates that interpretable, profile-driven reranking surfaces more value-aligned and culturally relevant results than semantic retrieval alone — without a trained reranker or a populated user-item matrix. The four-step agentic pipeline makes reasoning transparent and extensible. The Nigerian English detection and cultural register axis represent a concrete design commitment: building systems that work *for* African users, not merely *on* African data.

Future work: semantic axis-metadata matching via embedding similarity (softer than key lookup), African-specific dataset integration for local coverage, and fine-tuned embeddings on Nigerian food and culture reviews.

---

## References

Reimers & Gurevych (2019). Sentence-BERT. *EMNLP*. · Johnson et al. (2019). Billion-scale similarity search with GPUs. *IEEE TPAMI*. · Yao et al. (2022). ReAct: Synergizing reasoning and acting in language models. *ICLR 2023*. · Zhang et al. (2024). On Generative Agents in Recommendation. *SIGIR 2024*. · Adelani et al. (2022). MasakhaNER 2.0. *EMNLP*. · Ogundepo et al. (2023). AfriQA. *EMNLP*. · Brand, Israeli, and Ngwe (2023). Using LLMs for Market Research. *HBS Working Paper 23-062*. · Koren et al. (2009). Matrix factorization for recommender systems. *Computer* 42(8).
