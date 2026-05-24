"""
The four tools that make up the Task B agentic recommendation pipeline.

Each tool is a pure function: Dict[str, object] → Dict[str, object].
They are registered into a ToolRegistry and executed by the orchestrator in sequence.

Pipeline order (enforced by both the deterministic and LLM plans):
  1. build_profile      — construct the user's PsychologicalProfile from interaction records
  2. extract_axes       — derive weighted PreferenceAxis objects from the profile
  3. retrieve_candidates — cosine-similarity search over the vector store
  4. score_candidates   — deliberative reranking using preference axes + optional penalties

See AGENTS.md for full documentation of inputs, outputs, and the $ref wiring pattern.
"""
from __future__ import annotations

from typing import Dict, List

import numpy as np

from .agent_tools import ToolRegistry
from .data.schema import InteractionRecord
from .deliberative_scoring import deliberative_score
from .preference_axes import PreferenceAxis, extract_preference_axes
from .retrieval import RetrievalItem, multi_angle_retrieve
from .services.profile_service import ProfileService


def build_tool_registry(profile_service: ProfileService) -> ToolRegistry:
    """Create and return a ToolRegistry with all four pipeline tools registered.

    profile_service is injected so build_profile can use the TTL+LRU profile cache
    rather than rebuilding on every agent call.
    """
    registry = ToolRegistry()

    registry.register("build_profile", lambda args: _build_profile(profile_service, args))
    registry.register("extract_axes", _extract_axes)
    registry.register("retrieve_candidates", _retrieve_candidates)
    registry.register("score_candidates", _score_candidates)

    return registry


def _build_profile(profile_service: ProfileService, args: Dict[str, object]) -> Dict[str, object]:
    """Tool 1: Build (or retrieve from cache) a PsychologicalProfile for the user.

    Returns the profile as a flat dict so it can be stored in the orchestrator's
    context and referenced by downstream steps via {"$ref": "build_profile"}.
    """
    user_id = str(args.get("user_id", "")).strip()
    records = _parse_records(args.get("records", []), user_id)
    profile = profile_service.build_profile_cached(user_id, records)
    return profile.to_dict()


def _extract_axes(args: Dict[str, object]) -> Dict[str, object]:
    """Tool 2: Derive weighted PreferenceAxis objects from the psychological profile.

    The profile arrives via $ref resolution from build_profile. Three axis types:
      - Value axes (food/service/price/atmosphere): weight = mention_count / total_mentions
      - Rating bias: fires when |mean − 3.0| ≥ 0.5
      - Cultural register: fires when code-switching is detected (Nigerian English)
    Axes are returned sorted by weight descending.
    """
    profile = args["profile"]
    axes = extract_preference_axes(profile)
    return {"axes": [axis.__dict__ for axis in axes]}


def _retrieve_candidates(args: Dict[str, object]) -> Dict[str, object]:
    """Tool 3: Retrieve top-k candidates by cosine similarity (multi-angle).

    Accepts multiple query_vectors with optional per-vector weights, combining scores as:
      combined = Σ (cosine_sim(item, query_i) × weight_i) / Σ weights

    This allows simultaneous retrieval across several preference signals
    (e.g., one vector per value axis) rather than a single query embedding.

    Note: in the /task-b/recommend path the VectorStoreService handles retrieval
    directly (including business-level deduplication). This tool is used by the
    /task-b/agent path when a pre-fetched candidate list is supplied.
    """
    items = [
        RetrievalItem(
            item_id=str(item.get("item_id", "")).strip(),
            vector=np.array(item.get("vector", []), dtype=float),
            metadata=item.get("metadata", {}),
        )
        for item in args.get("candidates", [])
    ]
    query_vectors = [np.array(vec, dtype=float) for vec in args.get("query_vectors", [])]
    top_k = int(args.get("top_k", 10))
    weights = args.get("weights", None)

    retrieved = multi_angle_retrieve(items, query_vectors=query_vectors, top_k=top_k, weights=weights)
    return {"retrieved": [result.__dict__ for result in retrieved]}


def _score_candidates(args: Dict[str, object]) -> Dict[str, object]:
    """Tool 4: Rerank candidates using deliberative preference scoring.

    Scoring formula per candidate:
      final_score = cosine_sim
                  + Σ axis.weight  for each axis whose name is a key in candidate.metadata
                  − Σ penalty.value for each penalty key found in candidate.metadata

    axes arrives via $ref from extract_axes; it may be a plain list or the extract_axes
    output dict — both forms are handled here.

    Returns candidates sorted by final_score descending, each with a human-readable
    explanation string for UI display and auditability.
    """
    # axes may arrive as a plain list or wrapped in the extract_axes output dict.
    axes_raw = args.get("axes", [])
    if isinstance(axes_raw, dict):
        axes_raw = axes_raw.get("axes", [])
    axes = [PreferenceAxis(**ax) if isinstance(ax, dict) else ax for ax in axes_raw]

    penalties = args.get("penalties", None)
    candidates = args.get("candidates", [])

    scored = deliberative_score(candidates, axes, penalties=penalties)
    return {"scored": [item.__dict__ for item in scored]}


def _parse_records(raw_records: List[Dict[str, object]], user_id: str) -> List[InteractionRecord]:
    """Deserialize raw record dicts (from JSON body) into typed InteractionRecord objects."""
    parsed = []
    for record in raw_records:
        parsed.append(
            InteractionRecord(
                user_id=user_id,
                item_id=str(record.get("item_id", "")).strip(),
                rating=float(record.get("rating", 0.0)),
                review_text=str(record.get("review_text", "")).strip(),
                timestamp=str(record.get("timestamp", "")).strip() or None,
                source=str(record.get("source", "")).strip() or "unknown",
            )
        )
    return parsed
