from datetime import datetime, timedelta, timezone

import mongomock
import pytest

from src.retention import demote_old_traces


@pytest.fixture
def db():
    return mongomock.MongoClient()["bot"]


def _make_doc(user_id: str, n: int) -> dict:
    return {
        "execution_id": f"{user_id}-{n}",
        "user_id": user_id,
        "language": "bash",
        "code": "echo " + str(n),
        "stdin": None,
        "env_keys": [],
        "stdout": str(n),
        "stderr": "",
        "egress_events": [{"dst_ip": "1.1.1.1"}],
        "runtime_events": [],
        "agent_rationale": "test",
        "resource_usage": {},
        "exit_code": 0,
        "duration_ms": 1,
        "schedule_wait_ms": 0,
        "timed_out": False,
        "oom_killed": False,
        "orchestrator_error": None,
        "stdout_truncated": False,
        "stderr_truncated": False,
        "parent_interaction_id": "p",
        "user_tag": "u#0",
        "channel_id": "c",
        "guild_id": "g",
        "agent_turn_index": 0,
        "pod_name": "p",
        "node_name": None,
        "demoted_at": None,
        # day-0 is newest, day-N is oldest
        "created_at": datetime.now(tz=timezone.utc) - timedelta(days=n),
    }


def test_demotes_only_older_than_threshold(db):
    coll = db.sandbox_executions
    for i in range(60):
        coll.insert_one(_make_doc("u1", i))
    demoted = demote_old_traces(db, retention_per_user=50)
    assert demoted == 10

    full = list(coll.find({"user_id": "u1", "code": {"$ne": None}}))
    assert len(full) == 50
    demoted_docs = list(coll.find({"user_id": "u1", "demoted_at": {"$ne": None}}))
    assert len(demoted_docs) == 10
    for d in demoted_docs:
        assert d["code"] is None
        assert d["egress_events"] is None
        assert d["agent_rationale"] is None
        # outputs preserved
        assert d["stdout"] is not None
        assert d["stderr"] is not None


def test_does_nothing_when_under_retention(db):
    coll = db.sandbox_executions
    for i in range(20):
        coll.insert_one(_make_doc("u1", i))
    demoted = demote_old_traces(db, retention_per_user=50)
    assert demoted == 0
    full = list(coll.find({"user_id": "u1", "code": {"$ne": None}}))
    assert len(full) == 20


def test_per_user_independent(db):
    coll = db.sandbox_executions
    for i in range(60):
        coll.insert_one(_make_doc("u1", i))
    for i in range(10):
        coll.insert_one(_make_doc("u2", i))
    demote_old_traces(db, retention_per_user=50)
    assert coll.count_documents({"user_id": "u1", "demoted_at": {"$ne": None}}) == 10
    assert coll.count_documents({"user_id": "u2", "demoted_at": {"$ne": None}}) == 0


def test_idempotent_when_run_twice(db):
    coll = db.sandbox_executions
    for i in range(60):
        coll.insert_one(_make_doc("u1", i))
    demoted_first = demote_old_traces(db, retention_per_user=50)
    demoted_second = demote_old_traces(db, retention_per_user=50)
    assert demoted_first == 10
    assert demoted_second == 0
