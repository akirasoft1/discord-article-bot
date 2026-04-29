from datetime import datetime, timezone

from src.egress_scraper import (
    NoopEgressScraper,
    parse_calico_flow_log_line,
)


async def test_noop_returns_empty_list():
    scraper = NoopEgressScraper()
    result = await scraper.scrape(pod_ip="10.244.1.5", start=datetime.now(tz=timezone.utc), end=datetime.now(tz=timezone.utc))
    assert result == []


def test_parse_calico_allow():
    line = (
        '2026-04-28T15:00:00.000Z calico-felix INFO action=allow src=10.244.1.5 '
        'dst=93.184.216.34 proto=tcp dport=443'
    )
    ev = parse_calico_flow_log_line(line, sandbox_pod_ip="10.244.1.5")
    assert ev is not None
    assert ev["verdict"] == "allow"
    assert ev["dst_ip"] == "93.184.216.34"
    assert ev["dst_port"] == 443
    assert ev["protocol"] == "tcp"


def test_parse_calico_deny():
    line = (
        '2026-04-28T15:00:00.000Z calico-felix INFO action=deny src=10.244.1.5 '
        'dst=192.168.1.1 proto=tcp dport=22'
    )
    ev = parse_calico_flow_log_line(line, sandbox_pod_ip="10.244.1.5")
    assert ev["verdict"] == "deny"
    assert ev["dst_ip"] == "192.168.1.1"


def test_parse_unrelated_pod_returns_none():
    line = "2026-04-28T15:00:00.000Z calico-felix INFO action=allow src=10.244.9.9 dst=1.1.1.1 proto=udp dport=53"
    assert parse_calico_flow_log_line(line, sandbox_pod_ip="10.244.1.5") is None


def test_parse_garbage_returns_none():
    assert parse_calico_flow_log_line("not a real line", sandbox_pod_ip="10.244.1.5") is None
