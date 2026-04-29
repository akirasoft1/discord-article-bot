"""Persists sandbox_executions documents to MongoDB."""
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any


@dataclass
class ExecutionRecord:
    execution_id: str
    parent_interaction_id: str
    user_id: str
    user_tag: str
    channel_id: str
    guild_id: str
    agent_turn_index: int
    agent_rationale: str | None
    language: str
    code: str
    stdin: str | None
    env_keys: list[str]
    exit_code: int
    stdout: str
    stderr: str
    stdout_truncated: bool
    stderr_truncated: bool
    duration_ms: int
    schedule_wait_ms: int
    timed_out: bool
    oom_killed: bool
    orchestrator_error: str | None
    egress_events: list[dict[str, Any]]
    gvisor_events: list[dict[str, Any]]
    resource_usage: dict[str, Any]
    pod_name: str
    node_name: str | None


class TraceStore:
    def __init__(self, db) -> None:  # `db` is a pymongo Database (or mongomock equivalent)
        self._db = db
        self._coll = db.sandbox_executions

    async def record(self, rec: ExecutionRecord) -> None:
        doc = asdict(rec)
        doc["created_at"] = datetime.now(tz=timezone.utc)
        doc["demoted_at"] = None
        self._coll.insert_one(doc)

    async def get_by_execution_id(self, execution_id: str) -> dict[str, Any] | None:
        return self._coll.find_one({"execution_id": execution_id})

    def ensure_indexes(self) -> None:
        self._coll.create_index([("user_id", 1), ("created_at", -1)])
        self._coll.create_index("parent_interaction_id")
        self._coll.create_index([("created_at", -1)])
        self._coll.create_index("egress_events.dst_ip", sparse=True)
