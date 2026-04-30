"""Tests for agent._build_model — the dispatch layer between config's
AGENT_MODEL string and what ADK's Agent(model=…) actually expects."""
from src.agent import _build_model


def test_native_gemini_returns_string():
    assert _build_model("gemini-3-flash") == "gemini-3-flash"


def test_gemini_prefix_stripped():
    assert _build_model("gemini/gemini-3-flash") == "gemini-3-flash"


def test_empty_falls_back_to_default():
    assert _build_model("") == "gemini-3-flash"
    assert _build_model("   ") == "gemini-3-flash"


def test_bare_model_with_no_slash_treated_as_native():
    # A bare model name (no provider prefix) is assumed Gemini-native.
    assert _build_model("gemini-3.1-flash-lite-preview") == "gemini-3.1-flash-lite-preview"


def test_openai_uses_litellm_wrapper():
    from google.adk.models.lite_llm import LiteLlm
    m = _build_model("openai/gpt-5.1")
    assert isinstance(m, LiteLlm)
    assert m.model == "openai/gpt-5.1"


def test_anthropic_uses_litellm_wrapper():
    from google.adk.models.lite_llm import LiteLlm
    m = _build_model("anthropic/claude-opus-4-7")
    assert isinstance(m, LiteLlm)
    assert m.model == "anthropic/claude-opus-4-7"
