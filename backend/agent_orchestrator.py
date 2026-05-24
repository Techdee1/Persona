"""
Agent orchestrator: executes a plan of ToolCalls in sequence.

Design principles:
  - Each tool is stateless: it receives a complete input dict and returns a complete output dict.
  - Results are stored in `context` keyed by tool name so later steps can reference them.
  - Argument wiring uses {"$ref": "tool_name"} placeholders resolved at execution time,
    decoupling the plan builder from the runtime data flow.
  - The orchestrator never inspects tool semantics; it only routes calls and stores outputs.

See AGENTS.md for full pipeline documentation.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .agent_tools import ToolCall, ToolResult, ToolRegistry


@dataclass(frozen=True)
class AgentStep:
    """A single executed step: the instruction, the call made, and the result produced."""
    thought: str
    tool_call: Optional[ToolCall]
    tool_result: Optional[ToolResult]


@dataclass(frozen=True)
class AgentOutput:
    """The full trace of an agent run: all steps and their aggregated results."""
    steps: List[AgentStep]
    final: Dict[str, object]


def run_agent(tool_registry: ToolRegistry, plan: List[ToolCall]) -> AgentOutput:
    """Execute a plan sequentially, resolving $ref arguments between steps.

    Each ToolCall's arguments are resolved before the tool runs. After each run,
    the result is stored in `context` so subsequent steps can reference it via $ref.
    """
    steps: List[AgentStep] = []
    # context maps tool_name → its output dict, populated as each step completes.
    context: Dict[str, Dict[str, object]] = {}

    for call in plan:
        # Replace any {"$ref": "tool_name"} placeholders with the actual output
        # of the named step, allowing tools to receive upstream results directly.
        resolved_args = _resolve_args(call.arguments, context)
        result = tool_registry.run(ToolCall(name=call.name, arguments=resolved_args))
        steps.append(
            AgentStep(
                thought=f"Calling {call.name}",
                tool_call=call,
                tool_result=result,
            )
        )
        context[call.name] = result.output

    final = {
        "tool_results": [step.tool_result.output for step in steps if step.tool_result],
    }

    return AgentOutput(steps=steps, final=final)


def _resolve_args(value: Any, context: Dict[str, Dict[str, object]]) -> Any:
    """Recursively resolve {"$ref": "tool_name"} placeholders in an argument tree.

    - A dict with a "$ref" key is replaced with the named tool's output from context.
      Unknown $refs resolve to {} to avoid hard failures on partial LLM plans.
    - Other dicts and lists are traversed recursively.
    - Scalars (str, int, float, bool, None) are returned as-is.
    """
    if isinstance(value, dict):
        if "$ref" in value:
            # Resolve the reference; fall back to empty dict if the step hasn't run yet.
            return context.get(value["$ref"], {})
        return {key: _resolve_args(val, context) for key, val in value.items()}
    if isinstance(value, list):
        return [_resolve_args(item, context) for item in value]
    return value
