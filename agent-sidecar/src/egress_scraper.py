"""Egress event scraping. v1 is best-effort and CNI-dependent.

Two implementations:
- NoopEgressScraper: always empty list. Used when CNI logs unavailable.
- CalicoFlowLogScraper: tails Calico Felix logs via K8s API.

The line-parsing function is exported for unit testing.
"""
import re
from datetime import datetime, timezone
from typing import Any, Protocol


class EgressScraper(Protocol):
    async def scrape(self, *, pod_ip: str, start: datetime, end: datetime) -> list[dict[str, Any]]: ...


class NoopEgressScraper:
    async def scrape(self, *, pod_ip: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
        return []


_CALICO_LINE_RE = re.compile(
    r"^(?P<ts>\S+)\s+calico-felix\s+\S+\s+"
    r"action=(?P<verdict>allow|deny)\s+"
    r"src=(?P<src>\S+)\s+"
    r"dst=(?P<dst>\S+)\s+"
    r"proto=(?P<proto>\S+)\s+"
    r"dport=(?P<dport>\d+)"
)


def parse_calico_flow_log_line(line: str, *, sandbox_pod_ip: str) -> dict[str, Any] | None:
    m = _CALICO_LINE_RE.match(line)
    if not m:
        return None
    if m.group("src") != sandbox_pod_ip:
        return None
    try:
        ts = datetime.fromisoformat(m.group("ts").replace("Z", "+00:00"))
    except ValueError:
        ts = datetime.now(tz=timezone.utc)
    return {
        "timestamp": ts,
        "direction": "out",
        "verdict": m.group("verdict"),
        "protocol": m.group("proto"),
        "dst_ip": m.group("dst"),
        "dst_port": int(m.group("dport")),
        "reason": None if m.group("verdict") == "allow" else "matched-deny-rule",
    }


class CalicoFlowLogScraper:
    """Stub for Phase 9. v1 only stitches lines from a pre-collected log buffer
    pulled by the orchestrator out of the K8s API. The actual log pulling lives
    in orchestrator.py to keep this module pure."""

    def __init__(self, log_lines_provider) -> None:
        self._provider = log_lines_provider

    async def scrape(self, *, pod_ip: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        async for line in self._provider(start, end):
            ev = parse_calico_flow_log_line(line, sandbox_pod_ip=pod_ip)
            if ev is not None:
                events.append(ev)
        return events
