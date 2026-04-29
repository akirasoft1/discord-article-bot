"""ADK tool wrapper around SandboxOrchestrator."""
from dataclasses import asdict
from typing import Any

from .orchestrator import (
    SandboxOrchestrator,
    UserConcurrencyCap,
    GlobalConcurrencyCap,
)


class ToolBudgetExceeded(Exception):
    pass


class RunInSandboxTool:
    """Stateful per-turn tool. One instance per agent turn so call_budget
    is scoped to a single user message."""

    def __init__(self, *, orch: SandboxOrchestrator, user_id: str, call_budget: int) -> None:
        self._orch = orch
        self._user_id = user_id
        self._budget = call_budget
        self._used = 0
        self.execution_ids: list[str] = []
        self.results: list[Any] = []

    async def run(
        self,
        *,
        language: str,
        code: str,
        stdin: str | None = None,
        env: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        if self._used >= self._budget:
            raise ToolBudgetExceeded()
        self._used += 1
        try:
            result = await self._orch.run(
                user_id=self._user_id,
                language=language,
                code=code,
                stdin=stdin,
                env=env or {},
            )
        except UserConcurrencyCap:
            return {"exit_code": -2, "error": "user_concurrency_cap", "execution_id": None}
        except GlobalConcurrencyCap:
            return {"exit_code": -2, "error": "global_concurrency_cap", "execution_id": None}
        self.execution_ids.append(result.execution_id)
        self.results.append(result)
        return asdict(result)
