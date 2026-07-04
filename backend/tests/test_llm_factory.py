"""Tests for app.agent.llm_factory — env-based LLMProviderConfig loader
+ select_llm_for_task factory with stub fallback.

Covers:
- Short env mode (LLM_API_KEY + LLM_BASE_URL + LLM_MODEL) → single provider
- Long env mode (LLM_PROVIDERS_JSON) → multiple providers
- Missing env → empty list (no exception)
- Partial short env → empty list (must not guess fields)
- Malformed JSON → empty list (no exception)

select_llm_for_task:
- env 命中 provider_id → 返回 OpenAICompatibleLLMClient (mode=real)
- env 没命中 → 回 DevScriptedLLM (mode=stub, reason 非 None)
- env 完全没配 → 回 DevScriptedLLM (mode=stub, reason 非 None)
- task_provider_id=None → 静默回 DevScriptedLLM (mode=stub, reason=None)
- task_model_id 覆盖 config.default_model
"""
import json

import pytest

from app.agent.dev_scripted_llm import DevScriptedLLM
from app.agent.llm_factory import (
    LLMProviderConfig,
    load_llm_configs,
    load_llm_configs_from_env,
    select_llm_for_task,
)
from app.agent.openai_llm_client import OpenAICompatibleLLMClient


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


# ========================
# select_llm_for_task
# ========================


def test_select_returns_real_llm_when_provider_match():
    """env 配了 openai，task_provider_id='openai' → 返回 OpenAICompatibleLLMClient。"""
    configs = [LLMProviderConfig("openai", "https://api.openai.com", "sk-1", "gpt-4o-mini")]
    llm, mode, reason = select_llm_for_task("openai", configs)
    assert mode == "real"
    assert reason is None
    assert isinstance(llm, OpenAICompatibleLLMClient)
    assert llm.model == "gpt-4o-mini"


def test_select_falls_back_to_stub_when_provider_not_in_env():
    """task_provider_id 不在 env configs 里 → 退回 stub，reason 不为 None。"""
    configs = [LLMProviderConfig("openai", "https://api.openai.com", "sk-1", "gpt-4o-mini")]
    llm, mode, reason = select_llm_for_task("deepseek", configs)
    assert mode == "stub"
    assert reason is not None
    assert "deepseek" in reason.lower() or "not found" in reason.lower()
    assert isinstance(llm, DevScriptedLLM)


def test_select_falls_back_to_stub_when_no_env_at_all():
    """configs 为空且 task_provider_id 不为 None → 退回 stub，reason 提示未配置。"""
    llm, mode, reason = select_llm_for_task("openai", [])
    assert mode == "stub"
    assert reason is not None
    assert isinstance(llm, DevScriptedLLM)


def test_select_returns_stub_silently_when_task_provider_id_is_none():
    """task_provider_id 为 None（用户没选）→ 直接 stub，reason 为 None。"""
    llm, mode, reason = select_llm_for_task(None, [])
    assert mode == "stub"
    assert reason is None
    assert isinstance(llm, DevScriptedLLM)


def test_select_uses_task_model_id_override():
    """如果 task 显式指定 model_id，应覆盖 config 的 default_model。"""
    configs = [LLMProviderConfig("openai", "https://api.openai.com", "sk-1", "gpt-4o-mini")]
    llm, mode, _ = select_llm_for_task("openai", configs, task_model_id="gpt-4o")
    assert mode == "real"
    assert isinstance(llm, OpenAICompatibleLLMClient)
    assert llm.model == "gpt-4o"


# ========================
# load_llm_configs(db) — DB 唯一数据源（env fallback 已移除）
# ========================


def test_load_llm_configs_db_empty_returns_empty(monkeypatch):
    """DB 为空 → 返回 []（env fallback 已移除，统一 DB 唯一数据源）。"""
    # 故意设 env：但因 DB 空，env 不应被读
    monkeypatch.setenv("LLM_API_KEY", "sk-env-1")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.openai.com")
    monkeypatch.setenv("LLM_MODEL", "gpt-4o-mini")

    from app.database import Base, engine, SessionLocal
    from app.models import LLMProviderConfig as Orm
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as s:
        s.query(Orm).delete()
        s.commit()
        configs = load_llm_configs(s)

    assert configs == []


def test_load_llm_configs_db_rows_override_env(monkeypatch):
    """DB 有行 → 用 DB，env 完全被忽略。"""
    monkeypatch.setenv("LLM_API_KEY", "sk-env-1")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.openai.com")
    monkeypatch.setenv("LLM_MODEL", "gpt-4o-mini")

    from app.database import Base, engine, SessionLocal
    from app.models import ProviderConfig as Orm
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as s:
        s.query(Orm).delete()
        s.add(Orm(
            provider_id="deepseek",
            base_url="https://api.deepseek.com",
            api_key="sk-db-2",
            default_model="deepseek-chat",
            chat_models_json='["deepseek-chat"]',
        ))
        s.commit()
        configs = load_llm_configs(s)

    assert len(configs) == 1
    assert configs[0].provider_id == "deepseek"
    assert configs[0].api_key == "sk-db-2"  # DB 的 key，不是 env
    assert configs[0].default_model == "deepseek-chat"


def test_load_llm_configs_no_db_returns_empty(monkeypatch):
    """db=None → 直接返回 []，不读 env。"""
    monkeypatch.setenv("LLM_API_KEY", "sk-env-only")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.openai.com")
    monkeypatch.setenv("LLM_MODEL", "gpt-4o-mini")

    configs = load_llm_configs(None)
    assert configs == []
