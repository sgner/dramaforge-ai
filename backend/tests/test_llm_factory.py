"""TDD: llm_factory

覆盖：
- load_llm_configs: 过滤 enabled / chat_models，从 DB 构建 LLMProviderConfig
- select_llm_for_task:
  * task_provider_id=None + configs 非空 → 自动用 configs[0] (real client)
  * task_provider_id=None + configs 空 → 抛 NoLLMConfigured
  * 找到指定 provider → 用其 base_url/api_key/model
  * 找不到指定 provider → 抛 NoLLMConfigured(reason_code="provider_not_found")
- model 优先级: task_model_id > config.default_model

本测试套件**绝不**依赖任何模拟/脚本化 LLM 实现。NoLLMConfigured 必须被
测试为可预期的失败路径。
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent.llm_factory import (
    LLMProviderConfig,
    NoLLMConfigured,
    load_llm_configs,
    select_llm_for_task,
)
from app.database import Base
from app.models import ProviderConfig


# ---------------- fixtures ----------------

@pytest.fixture
def db_session():
    """In-memory SQLite + Base metadata + ProviderConfig table。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    yield s
    s.close()
    engine.dispose()


def _seed(db, *, provider_id="custom-api", name="ZZ", base_url="https://x.test/v1",
          api_key="sk-test", chat_models=('["gpt-4","deepseek-v3"]'),
          enabled=True, default_model=""):
    row = ProviderConfig(
        provider_id=provider_id,
        name=name,
        base_url=base_url,
        api_key=api_key,
        protocol="openai",
        enabled=enabled,
        default_model=default_model,
        chat_models_json=chat_models,
        image_models_json="[]",
        video_models_json="[]",
        extra_config_json="{}",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ---------------- load_llm_configs ----------------

def test_load_llm_configs_returns_empty_when_db_is_none():
    assert load_llm_configs(None) == []


def test_load_llm_configs_returns_empty_when_no_providers(db_session):
    assert load_llm_configs(db_session) == []


def test_load_llm_configs_includes_enabled_provider_with_chat_models(db_session):
    _seed(db_session, provider_id="custom-api",
          chat_models='["gpt-4","deepseek-v3"]')
    configs = load_llm_configs(db_session)
    assert len(configs) == 1
    c = configs[0]
    assert c.provider_id == "custom-api"
    assert c.base_url == "https://x.test/v1"
    assert c.api_key == "sk-test"
    assert c.default_model == "gpt-4"  # 缺 default_model 时取 chat_models[0]


def test_load_llm_configs_uses_explicit_default_model_when_set(db_session):
    _seed(db_session, default_model="deepseek-v3",
          chat_models='["gpt-4","deepseek-v3"]')
    configs = load_llm_configs(db_session)
    assert configs[0].default_model == "deepseek-v3"


def test_load_llm_configs_skips_disabled_providers(db_session):
    _seed(db_session, provider_id="disabled", enabled=False,
          chat_models='["gpt-4"]')
    _seed(db_session, provider_id="enabled", enabled=True,
          chat_models='["gpt-4"]')
    configs = load_llm_configs(db_session)
    assert [c.provider_id for c in configs] == ["enabled"]


def test_load_llm_configs_skips_providers_without_chat_models(db_session):
    _seed(db_session, provider_id="no-models", chat_models="[]")
    _seed(db_session, provider_id="with-models", chat_models='["gpt-4"]')
    configs = load_llm_configs(db_session)
    assert [c.provider_id for c in configs] == ["with-models"]


# ---------------- select_llm_for_task ----------------

def _make_config(pid="custom-api", base_url="https://x.test/v1",
                 api_key="sk-test", default_model="gpt-4"):
    return LLMProviderConfig(
        provider_id=pid, base_url=base_url, api_key=api_key,
        default_model=default_model,
    )


def test_select_returns_real_client_when_no_task_provider_but_configs_exist():
    configs = [_make_config()]
    client = select_llm_for_task(task_provider_id=None, configs=configs)
    # 真实 OpenAI 客户端：base_url 会被 /v1 规范化（client 内置的 _normalize_base_url）
    assert client.base_url == "https://x.test"  # 原始 /v1 被剥掉（client 内部会再补回 /v1/chat/completions）
    assert client.model == "gpt-4"
    assert client.api_key == "sk-test"


def test_select_raises_no_llm_configured_when_no_provider_no_configs():
    with pytest.raises(NoLLMConfigured) as exc_info:
        select_llm_for_task(task_provider_id=None, configs=[])
    assert exc_info.value.reason_code == "no_provider"
    assert "no llm provider configured" in str(exc_info.value).lower()


def test_select_raises_when_task_provider_set_but_no_configs():
    with pytest.raises(NoLLMConfigured) as exc_info:
        select_llm_for_task(task_provider_id="custom-api", configs=[])
    assert exc_info.value.reason_code == "no_provider"


def test_select_uses_requested_provider_when_present():
    configs = [
        _make_config("alpha", base_url="https://a.test/v1", api_key="sk-a"),
        _make_config("beta", base_url="https://b.test/v1", api_key="sk-b"),
    ]
    client = select_llm_for_task(task_provider_id="beta", configs=configs)
    assert client.base_url == "https://b.test"  # /v1 被 _normalize_base_url 剥掉
    assert client.api_key == "sk-b"


def test_select_prefers_task_model_id_over_default_model():
    configs = [_make_config(default_model="gpt-4")]
    client = select_llm_for_task(
        task_provider_id=None, configs=configs, task_model_id="deepseek-v3",
    )
    assert client.model == "deepseek-v3"


def test_select_raises_provider_not_found_when_id_missing():
    configs = [_make_config("alpha")]
    with pytest.raises(NoLLMConfigured) as exc_info:
        select_llm_for_task(task_provider_id="beta", configs=configs)
    assert exc_info.value.reason_code == "provider_not_found"
    assert "beta" in str(exc_info.value)
    assert "alpha" in str(exc_info.value)  # available 列表


def test_select_message_mentions_api_settings_to_help_user():
    """NoLLMConfigured 错误消息必须引导用户去 API 设置页配 provider。"""
    with pytest.raises(NoLLMConfigured) as exc_info:
        select_llm_for_task(task_provider_id=None, configs=[])
    msg = str(exc_info.value).lower()
    assert "api settings" in msg or "settings" in msg
