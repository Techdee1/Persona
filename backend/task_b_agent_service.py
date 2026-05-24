"""
Task B agentic recommendation service.

Entry point for the POST /task-b/agent endpoint. Coordinates two execution paths:

  Deterministic path (default, use_llm=False):
    _deterministic_plan() builds the 4-step ToolCall list directly.
    No LLM required. Sub-400ms end-to-end. Fully reproducible.

  LLM planning path (use_llm=True, requires ENABLE_LLM + OPENAI_API_KEY):
    GPT-4o is asked to produce a tool-call plan. The LLM's ordering decisions
    are honoured where possible, but its plan is mapped back to the deterministic
    ToolCall objects (which carry the correct pre-wired data). Any steps the LLM
    omits are appended in the required execution order — guaranteeing all four
    steps always run regardless of what the LLM returns.

Both paths run through AgentOrchestrator.run_agent(), which resolves $ref argument
wiring and records every step for the response trace.

See AGENTS.md for the full pipeline design and data flow diagram.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from .agent_orchestrator import run_agent
from .agent_tool_defs import build_tool_registry
from .agent_tools import ToolCall
from .llm_client import OpenAIClient
from .retrieval import RetrievalItem, RetrievalResult
from .services.profile_service import ProfileService


class TaskBAgentService:
    def __init__(
        self,
        profile_service: Optional[ProfileService] = None,
        llm_client: Optional[OpenAIClient] = None,
    ) -> None:
        self._profile_service = profile_service or ProfileService()
        self._llm_client = llm_client

    def recommend(
        self,
        user_id: str,
        records: List[Dict[str, object]],
        query_vectors: List[List[float]],
        candidates: List[Dict[str, object]],
        top_k: int = 10,
        weights: Optional[List[float]] = None,
        penalties: Optional[Dict[str, float]] = None,
        use_llm: bool = False,
    ) -> Dict[str, object]:
        registry = build_tool_registry(self._profile_service)

        plan = (
            self._plan_with_llm(user_id, records, query_vectors, candidates, top_k, weights, penalties)
            if use_llm and self._llm_client
            else _deterministic_plan(user_id, records, query_vectors, candidates, top_k, weights, penalties)
        )

        output = run_agent(registry, plan)
        return {
            "user_id": user_id,
            "steps": [
                {
                    "thought": step.thought,
                    "tool": step.tool_call.name if step.tool_call else None,
                    "result": step.tool_result.output if step.tool_result else None,
                }
                for step in output.steps
            ],
            "final": output.final,
        }

    def _plan_with_llm(
        self,
        user_id: str,
        records: List[Dict[str, object]],
        query_vectors: List[List[float]],
        candidates: List[Dict[str, object]],
        top_k: int,
        weights: Optional[List[float]],
        penalties: Optional[Dict[str, float]],
    ) -> List[ToolCall]:
        tools = [
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": f"Tool {name}",
                    "parameters": {"type": "object", "properties": {}, "additionalProperties": True},
                },
            }
            for name in ["build_profile", "extract_axes", "retrieve_candidates", "score_candidates"]
        ]

        messages = [
            {
                "role": "system",
                "content": "Plan tool calls to produce recommendations.",
            },
            {
                "role": "user",
                "content": "Call tools in order: build_profile, extract_axes, retrieve_candidates, score_candidates.",
            },
        ]

        response = self._llm_client.chat_completion(messages, tools=tools, tool_choice="auto")
        tool_calls = response.get("choices", [])[0].get("message", {}).get("tool_calls", [])

        if not tool_calls:
            return _deterministic_plan(user_id, records, query_vectors, candidates, top_k, weights, penalties)

        # Use LLM's ordering for tools it returned; always include all 4 steps.
        required_order = ["build_profile", "extract_axes", "retrieve_candidates", "score_candidates"]
        det = {call.name: call for call in _deterministic_plan(
            user_id, records, query_vectors, candidates, top_k, weights, penalties
        )}
        llm_names = [
            tc.get("function", {}).get("name", "")
            for tc in tool_calls
            if tc.get("function", {}).get("name", "") in det
        ]
        # Fill in any steps the LLM omitted, preserving the required execution order.
        seen = set(llm_names)
        full_names = llm_names + [n for n in required_order if n not in seen]
        return [det[n] for n in full_names if n in det]


def _deterministic_plan(
    user_id: str,
    records: List[Dict[str, object]],
    query_vectors: List[List[float]],
    candidates: List[Dict[str, object]],
    top_k: int,
    weights: Optional[List[float]],
    penalties: Optional[Dict[str, float]],
) -> List[ToolCall]:
    return [
        ToolCall(name="build_profile", arguments={"user_id": user_id, "records": records}),
        ToolCall(name="extract_axes", arguments={"profile": {"$ref": "build_profile"}}),
        ToolCall(
            name="retrieve_candidates",
            arguments={
                "query_vectors": query_vectors,
                "candidates": candidates,
                "top_k": top_k,
                "weights": weights,
            },
        ),
        ToolCall(
            name="score_candidates",
            arguments={
                "candidates": [
                    RetrievalResult(item_id=item["item_id"], score=0.0, metadata=item.get("metadata", {}))
                    for item in candidates
                ],
                "axes": {"$ref": "extract_axes"},
                "penalties": penalties or {},
            },
        ),
    ]
