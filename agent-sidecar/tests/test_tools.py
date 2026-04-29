import pytest

from src.tools import RunInSandboxTool, ToolBudgetExceeded


class FakeOrch:
    def __init__(self):
        self.calls = []

    async def run(self, *, user_id, language, code, stdin, env):
        self.calls.append((user_id, language, code, stdin, env))
        from src.orchestrator import OrchestratorResult
        return OrchestratorResult(
            execution_id=f"exec-{len(self.calls)}",
            exit_code=0, stdout="ok", stderr="", stdout_truncated=False,
            stderr_truncated=False, duration_ms=10, schedule_wait_ms=5,
            timed_out=False, oom_killed=False, orchestrator_error=None,
            egress_events=[], pod_name="p", node_name=None,
        )


async def test_tool_calls_orchestrator():
    orch = FakeOrch()
    tool = RunInSandboxTool(orch=orch, user_id="u1", call_budget=8)
    result = await tool.run(language="python", code="print(1)", stdin=None, env=None)
    assert result["exit_code"] == 0
    assert result["stdout"] == "ok"
    assert orch.calls == [("u1", "python", "print(1)", None, {})]


async def test_tool_enforces_call_budget():
    orch = FakeOrch()
    tool = RunInSandboxTool(orch=orch, user_id="u1", call_budget=2)
    await tool.run(language="bash", code="echo 1", stdin=None, env=None)
    await tool.run(language="bash", code="echo 2", stdin=None, env=None)
    with pytest.raises(ToolBudgetExceeded):
        await tool.run(language="bash", code="echo 3", stdin=None, env=None)


async def test_tool_records_execution_ids():
    orch = FakeOrch()
    tool = RunInSandboxTool(orch=orch, user_id="u1", call_budget=8)
    await tool.run(language="bash", code="x", stdin=None, env=None)
    await tool.run(language="bash", code="y", stdin=None, env=None)
    assert tool.execution_ids == ["exec-1", "exec-2"]


async def test_user_concurrency_cap_returns_minus_two():
    from src.orchestrator import UserConcurrencyCap
    class CappedOrch(FakeOrch):
        async def run(self, **kw):
            raise UserConcurrencyCap()
    tool = RunInSandboxTool(orch=CappedOrch(), user_id="u1", call_budget=8)
    result = await tool.run(language="bash", code="x", stdin=None, env=None)
    assert result["exit_code"] == -2
    assert result["error"] == "user_concurrency_cap"
