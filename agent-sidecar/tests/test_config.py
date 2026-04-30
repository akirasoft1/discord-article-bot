"""Tests for config-loading behavior, especially MONGO_URI substitution."""
import os
from unittest import mock

import pytest

import src.config as config_mod


@pytest.fixture(autouse=True)
def base_env(monkeypatch):
    # Minimum env to make load() succeed.
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("SANDBOX_BASE_IMAGE", "test:latest")


def test_resolve_mongo_uri_substitutes_password(monkeypatch):
    monkeypatch.setenv(
        "MONGO_URI",
        "mongodb://admin:${MONGO_PASSWORD}@mongodb:27017/discord-bot?authSource=admin",
    )
    monkeypatch.setenv("MONGO_PASSWORD", "s3cret-p4ssw0rd")
    cfg = config_mod.load()
    assert cfg.mongo_uri == "mongodb://admin:s3cret-p4ssw0rd@mongodb:27017/discord-bot?authSource=admin"


def test_resolve_mongo_uri_passes_through_when_no_placeholder(monkeypatch):
    monkeypatch.setenv("MONGO_URI", "mongodb://admin:literal-pw@mongodb:27017/discord-bot")
    monkeypatch.delenv("MONGO_PASSWORD", raising=False)
    cfg = config_mod.load()
    assert cfg.mongo_uri == "mongodb://admin:literal-pw@mongodb:27017/discord-bot"


def test_resolve_mongo_uri_leaves_placeholder_when_no_password_env(monkeypatch):
    # Defensive: if MONGO_PASSWORD isn't set, don't accidentally collapse the
    # placeholder to an empty string.
    monkeypatch.setenv("MONGO_URI", "mongodb://admin:${MONGO_PASSWORD}@mongodb/db")
    monkeypatch.delenv("MONGO_PASSWORD", raising=False)
    cfg = config_mod.load()
    assert "${MONGO_PASSWORD}" in cfg.mongo_uri
