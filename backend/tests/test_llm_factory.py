"""Tests for app.agent.llm_factory — env-based LLMProviderConfig loader.

Covers:
- Short env mode (LLM_API_KEY + LLM_BASE_URL + LLM_MODEL) → single provider
- Long env mode (LLM_PROVIDERS_JSON) → multiple providers
- Missing env → empty list (no exception)
- Partial short env → empty list (must not guess fields)
"""
import json

import pytest

from app.agent.llm_factory import (
    LLMProviderConfig,
    load_llm_configs_from_env,
)


def test_load_single_provider_from_short_env(monkeypatch):
    """短 env（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL）合成一个 provider。"""
    monkeypatch.setenv("LLM_API_KEY", "sk-test-123")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.openai.com")
    monkeypatch.setenv("LLM_MODEL", "gpt-4o-mini")
    monkeypatch.delenv("LLM_PROVIDERS_JSON", raising=False)

    configs = load_llm_configs_from_env()

    assert len(configs) == 1
    c = configs[0]
    assert isinstance(c, LLMProviderConfig)
    assert c.provider_id == "openai"
    assert c.api_key == "sk-test-123"
    assert c.base_url == "https://api.openai.com"
    assert c.default_model == "gpt-4o-mini"


def test_load_multiple_providers_from_json(monkeypatch):
    """LLM_PROVIDERS_JSON 解析多 provider（openai / deepseek / kimi 等）。"""
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.setenv("LLM_PROVIDERS_JSON", json.dumps({
        "openai": {"api_key": "sk-1", "base_url": "https://api.openai.com", "default_model": "gpt-4o-mini"},
        "deepseek": {"api_key": "sk-2", "base_url": "https://api.deepseek.com", "default_model": "deepseek-chat"},
    }))

    configs = load_llm_configs_from_env()

    ids = sorted(c.provider_id for c in configs)
    assert ids == ["deepseek", "openai"]
    by_id = {c.provider_id: c for c in configs}
    assert by_id["openai"].default_model == "gpt-4o-mini"
    assert by_id["deepseek"].base_url == "https://api.deepseek.com"


def test_load_returns_empty_when_no_env(monkeypatch):
    """env 完全没配 → 返回空列表（不是抛错）。"""
    for k in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_PROVIDERS_JSON"):
        monkeypatch.delenv(k, raising=False)

    configs = load_llm_configs_from_env()

    assert configs == []


def test_short_env_requires_all_three_or_returns_empty(monkeypatch):
    """短 env 只配了 LLM_API_KEY 但没 LLM_BASE_URL → 返回空（不能瞎猜 base_url）。"""
    monkeypatch.setenv("LLM_API_KEY", "sk-test-123")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_PROVIDERS_JSON", raising=False)

    configs = load_llm_configs_from_env()

    assert configs == []


def test_malformed_json_returns_empty(monkeypatch):
    """malformed LLM_PROVIDERS_JSON → 返回空 list（不向上抛 JSONDecodeError）。"""
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.setenv("LLM_PROVIDERS_JSON", "not-json")

    configs = load_llm_configs_from_env()

    assert configs == []
