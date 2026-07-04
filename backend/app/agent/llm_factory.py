"""LLM 配置加载：从环境变量构造 LLMProviderConfig 列表。

支持两种 env 模式：

1. 短模式（单 provider）：
   LLM_API_KEY=sk-xxx
   LLM_BASE_URL=https://api.openai.com
   LLM_MODEL=gpt-4o-mini

2. 长模式（多 provider 共享一个 task）：
   LLM_PROVIDERS_JSON={"openai":{...},"deepseek":{...}}
   LLM_DEFAULT_PROVIDER=openai

任一模式返回 list[LLMProviderConfig]；env 缺 → 返回空 list。

另含 select_llm_for_task：为单个 task 选 LLM 客户端 + 降级策略。
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Literal

from .dev_scripted_llm import DevScriptedLLM
from .llm import LLMClient
from .openai_llm_client import OpenAICompatibleLLMClient


@dataclass
class LLMProviderConfig:
    provider_id: str
    base_url: str
    api_key: str
    default_model: str


def _load_short_env() -> list[LLMProviderConfig]:
    """从 LLM_API_KEY/BASE_URL/MODEL 合成一个 provider。"""
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    base_url = os.environ.get("LLM_BASE_URL", "").strip().rstrip("/")
    model = os.environ.get("LLM_MODEL", "").strip()
    if not (api_key and base_url and model):
        return []
    return [LLMProviderConfig(
        provider_id="openai",  # 短模式默认 OpenAI 协议
        base_url=base_url,
        api_key=api_key,
        default_model=model,
    )]


def _load_json_env() -> list[LLMProviderConfig]:
    """从 LLM_PROVIDERS_JSON 解析多个 provider。"""
    raw = os.environ.get("LLM_PROVIDERS_JSON", "").strip()
    if not raw:
        return []
    # 容错：malformed JSON 不应向上抛，符合模块"env 缺 → 返回空 list"的承诺
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return []
    if not isinstance(data, dict):
        return []
    out: list[LLMProviderConfig] = []
    for provider_id, cfg in data.items():
        if not isinstance(cfg, dict):
            continue
        api_key = str(cfg.get("api_key", "")).strip()
        base_url = str(cfg.get("base_url", "")).strip().rstrip("/")
        default_model = str(cfg.get("default_model", "")).strip()
        if not (api_key and base_url and default_model):
            continue
        out.append(LLMProviderConfig(
            provider_id=provider_id,
            base_url=base_url,
            api_key=api_key,
            default_model=default_model,
        ))
    return out


def load_llm_configs_from_env() -> list[LLMProviderConfig]:
    """优先解析 LLM_PROVIDERS_JSON；空则尝试短 env。两者都空 → 返回 []。"""
    return _load_json_env() or _load_short_env()


def load_llm_configs(db) -> list[LLMProviderConfig]:
    """从 DB 读所有可用的 LLM provider 配置。

    数据源：统一表 provider_configs（合并自 media_provider_configs + llm_provider_configs）。
    过滤条件：enabled=True 且 chat_models 非空（否则不能当 LLM 用）。
    缺 db / 缺行 → 返回 []，由 select_llm_for_task 决定如何处理。
    """
    if db is None:
        return []

    # 延迟导入避免循环导入；复用 models.py 的 _parse_json_list（DRY）
    from ..models import ProviderConfig, _parse_json_list
    rows = db.query(ProviderConfig).filter(ProviderConfig.enabled.is_(True)).all()
    configs: list[LLMProviderConfig] = []
    for r in rows:
        chat_models = _parse_json_list(r.chat_models_json)
        if not chat_models:
            continue
        configs.append(LLMProviderConfig(
            provider_id=r.provider_id,
            base_url=r.base_url,
            api_key=r.api_key,
            default_model=r.default_model or chat_models[0],
        ))
    return configs


def select_llm_for_task(
    task_provider_id: str | None,
    configs: list[LLMProviderConfig],
    task_model_id: str | None = None,
) -> tuple[LLMClient, Literal["real", "stub"], str | None]:
    """为单个 task 选 LLM 客户端。

    决策树：
    1. task_provider_id 为 None + configs 非空 → 自动用 configs[0] 跑真实 LLM
       （避免用户没显式选 provider 时无脑走 DevScriptedLLM 假任务；
        DB 里只要有任意 provider 配置就视为"用户已经配好了 LLM"）
    2. configs 为空 → 回 stub，reason="no LLM configured in DB"
    3. configs 中找不到 task_provider_id → 回 stub，reason="provider not found in DB"
    4. 找到 → 用真实 client；model 优先用 task_model_id，否则 config.default_model

    Returns: (client, mode, fallback_reason_or_none)
    """
    # 1) task_provider_id 为 None 但 DB 有 provider → 自动用 configs[0] 跑真实 LLM
    #    避免用户没显式选 provider 时无脑走 DevScriptedLLM 假任务；
    #    DB 里只要有任意 provider 配置就视为"用户已经配好了 LLM"
    if task_provider_id is None:
        if not configs:
            # 静默回 stub：user 没选 + DB 也没配，等同于 Dev 模式
            return DevScriptedLLM(user_goal=""), "stub", None
        first = configs[0]
        model = task_model_id or first.default_model
        client = OpenAICompatibleLLMClient(
            base_url=first.base_url,
            api_key=first.api_key,
            model=model,
        )
        return client, "real", None

    # 2) task_provider_id 有值但 configs 为空
    if not configs:
        return DevScriptedLLM(user_goal=""), "stub", (
            "no LLM configured in DB — go to API settings to add one"
        )

    # 3) 找到指定 provider
    for c in configs:
        if c.provider_id == task_provider_id:
            model = task_model_id or c.default_model
            client = OpenAICompatibleLLMClient(
                base_url=c.base_url,
                api_key=c.api_key,
                model=model,
            )
            return client, "real", None

    # 4) 找不到 → 回 stub
    available = ", ".join(c.provider_id for c in configs) or "(none)"
    return DevScriptedLLM(user_goal=""), "stub", (
        f"provider '{task_provider_id}' not found in DB; available: {available}"
    )
