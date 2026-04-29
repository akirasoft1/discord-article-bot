"""Daily retention/demotion job for sandbox_executions.

Per-user, the most recent N (config.sandbox_trace_retention_per_user) full
traces are kept. Older traces are demoted in place: code, stdin, env_keys,
egress_events, gvisor_events, agent_rationale, and resource_usage are nulled
out, while exit_code, stdout, stderr, duration_ms, timed_out, oom_killed are
retained as a thin audit trail. The demoted_at timestamp is set on update,
which also makes idempotent reruns cheap (already-demoted docs match the
filter only once).
"""
from datetime import datetime, timezone
import logging

log = logging.getLogger(__name__)


def demote_old_traces(db, *, retention_per_user: int) -> int:
    """Run one demotion pass. Returns the total number of demoted documents."""
    coll = db.sandbox_executions
    user_ids = coll.distinct("user_id")
    total_demoted = 0
    for user_id in user_ids:
        excess_cursor = (
            coll.find({"user_id": user_id, "demoted_at": None})
                .sort("created_at", -1)
                .skip(retention_per_user)
        )
        excess = list(excess_cursor)
        if not excess:
            continue
        cutoff = excess[0]["created_at"]
        result = coll.update_many(
            {
                "user_id": user_id,
                "created_at": {"$lte": cutoff},
                "demoted_at": None,
            },
            {
                "$set": {
                    "code": None,
                    "stdin": None,
                    "env_keys": None,
                    "egress_events": None,
                    "gvisor_events": None,
                    "agent_rationale": None,
                    "resource_usage": None,
                    "demoted_at": datetime.now(tz=timezone.utc),
                }
            },
        )
        total_demoted += result.modified_count
        log.info(
            "demoted %s traces for user %s (kept %s most recent)",
            result.modified_count, user_id, retention_per_user,
        )
    return total_demoted
