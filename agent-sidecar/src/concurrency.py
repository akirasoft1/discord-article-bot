"""Per-user + global concurrency gate.

Single-replica sidecar only; uses asyncio primitives. Documented constraint:
do not scale this sidecar past 1 replica without distributed coordination.
"""
import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass


@dataclass
class GateAcquireError(Exception):
    scope: str  # "user" or "global"

    def __str__(self) -> str:
        return f"concurrency cap exceeded ({self.scope})"


class ConcurrencyGate:
    def __init__(self, per_user: int, global_: int) -> None:
        self._per_user = per_user
        self._global = global_
        self._user_counts: dict[str, int] = defaultdict(int)
        self._global_count = 0
        self._lock = asyncio.Lock()
        self._cond = asyncio.Condition(self._lock)

    @asynccontextmanager
    async def acquire(self, *, user_id: str, wait: bool = True):
        async with self._lock:
            while not self._can_admit(user_id):
                if not wait:
                    raise GateAcquireError(scope=self._blocking_scope(user_id))
                await self._cond.wait()
            self._user_counts[user_id] += 1
            self._global_count += 1
        try:
            yield
        finally:
            async with self._lock:
                self._user_counts[user_id] -= 1
                if self._user_counts[user_id] == 0:
                    del self._user_counts[user_id]
                self._global_count -= 1
                self._cond.notify_all()

    def _can_admit(self, user_id: str) -> bool:
        return (
            self._user_counts[user_id] < self._per_user
            and self._global_count < self._global
        )

    def _blocking_scope(self, user_id: str) -> str:
        if self._global_count >= self._global:
            return "global"
        return "user"
