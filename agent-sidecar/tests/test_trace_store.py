from datetime import datetime, timezone

import mongomock
import pytest

from src.trace_store import TraceStore, ExecutionRecord


@pytest.fixture
def store():
    client = mongomock.MongoClient()
    return TraceStore(db=client["bot"])


async def test_record_persists_doc(store):
    rec = ExecutionRecord(
        execution_id="exec-1",
        parent_interaction_id="msg-1",
        user_id="u1",
        user_tag="test#0001",
        channel_id="c1",
        guild_id="g1",
        agent_turn_index=0,
        agent_rationale="testing",
        language="python",
        code="print(1)",
        stdin=None,
        env_keys=[],
        exit_code=0,
        stdout="1\n",
        stderr="",
        stdout_truncated=False,
        stderr_truncated=False,
        duration_ms=100,
        schedule_wait_ms=50,
        timed_out=False,
        oom_killed=False,
        orchestrator_error=None,
        egress_events=[],
        gvisor_events=[],
        resource_usage={"peak_memory_bytes": None, "cpu_seconds": None},
        pod_name="sandbox-u1-x",
        node_name=None,
    )
    await store.record(rec)
    docs = list(store._db.sandbox_executions.find())
    assert len(docs) == 1
    assert docs[0]["exit_code"] == 0
    assert docs[0]["language"] == "python"
    assert "created_at" in docs[0]


async def test_get_by_execution_id(store):
    rec = ExecutionRecord(
        execution_id="exec-2",
        parent_interaction_id="m",
        user_id="u",
        user_tag="t#0",
        channel_id="c",
        guild_id="g",
        agent_turn_index=0,
        agent_rationale=None,
        language="bash",
        code="echo hi",
        stdin=None,
        env_keys=[],
        exit_code=0,
        stdout="hi\n",
        stderr="",
        stdout_truncated=False,
        stderr_truncated=False,
        duration_ms=10,
        schedule_wait_ms=5,
        timed_out=False,
        oom_killed=False,
        orchestrator_error=None,
        egress_events=[],
        gvisor_events=[],
        resource_usage={"peak_memory_bytes": None, "cpu_seconds": None},
        pod_name="x",
        node_name=None,
    )
    await store.record(rec)
    fetched = await store.get_by_execution_id("exec-2")
    assert fetched["execution_id"] == "exec-2"
    assert fetched["stdout"] == "hi\n"
