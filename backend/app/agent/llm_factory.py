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
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass


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
    data = json.loads(raw)
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
