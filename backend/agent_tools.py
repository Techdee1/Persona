"""
Primitive types for the agentic tool system.

ToolCall   — an instruction to invoke a named tool with a dict of arguments.
ToolResult — the output produced by executing a ToolCall.
ToolRegistry — maps tool names to their implementation functions; executes calls.

These types are intentionally minimal and data-only so the orchestrator can
record every step without coupling to any specific tool implementation.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, List


@dataclass(frozen=True)
class ToolCall:
    """A single step in an agent plan: which tool to call and with what arguments."""
    name: str
    arguments: Dict[str, object]


@dataclass(frozen=True)
class ToolResult:
    """The output of executing a ToolCall. Stored in the orchestrator's context
    so later steps can reference it via {"$ref": "<tool_name>"}."""
    name: str
    output: Dict[str, object]


# A tool implementation: receives a flat args dict, returns a flat output dict.
ToolFunc = Callable[[Dict[str, object]], Dict[str, object]]


class ToolRegistry:
    """Holds registered tool implementations and executes ToolCalls against them."""

    def __init__(self) -> None:
        self._tools: Dict[str, ToolFunc] = {}

    def register(self, name: str, func: ToolFunc) -> None:
        """Register a tool implementation under the given name."""
        self._tools[name] = func

    def has(self, name: str) -> bool:
        return name in self._tools

    def run(self, call: ToolCall) -> ToolResult:
        """Execute a ToolCall and return its result. Raises if the tool is not registered."""
        if call.name not in self._tools:
            raise ValueError(f"Tool not registered: {call.name}")
        output = self._tools[call.name](call.arguments)
        return ToolResult(name=call.name, output=output)

    def list_tools(self) -> List[str]:
        return sorted(self._tools.keys())
