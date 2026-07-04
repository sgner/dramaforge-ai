"""LLM 配置加载 + 选 LLM 客户端。

数据源：DB 统一表 `provider_configs`（合并自 media_provider_configs + llm_provider_configs）。
过滤条件：enabled=True 且 chat_models 非空（否则不能当 LLM 用）。

选 LLM 策略（select_llm_for_task）：
- task_provider_id 为 None + configs 非空 → 自动用 configs[0] 跑真实 LLM
- task_provider_id 为 None + configs 空 → 抛 NoLLMConfigured
- configs 找不到 task_provider_id → 抛 NoLLMConfigured（带"provider not found"原因）
- 找到 → 用 OpenAI 兼容 client；model 优先 task_model_id，否则 config.default_model

注意：本文件**不再**提供任何模拟/脚本化 LLM 实现。
若 LLM 不可用（无 provider 配置、provider 被删、API 不可达），直接抛错或让上层
OpenAI 客户端抛 LLMError，**绝不**伪造响应。
"""
from __future__ import annotations

from dataclasses import dataclass

from .llm import LLMClient
from .openai_llm_client import OpenAICompatibleLLMClient


class NoLLMConfigured(Exception):
    """没有可用的真实 LLM 配置时抛出。"""

    def __init__(self, message: str, reason_code: str = "no_provider"):
        super().__init__(message)
        self.reason_code = reason_code


@dataclass
class LLMProviderConfig:
    provider_id: str
    base_url: str
    api_key: str
    default_model: str


def load_llm_configs(db) -> list[LLMProviderConfig]:
    """从 DB 读所有可用的 LLM provider 配置。

    过滤条件：enabled=True 且 chat_models 非空。
    缺 db / 缺行 → 返回 []（由 select_llm_for_task 抛 NoLLMConfigured）。
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
) -> LLMClient:
    """为单个 task 选 LLM 客户端；找不到时抛 NoLLMConfigured。

    Returns: LLMClient (always real)
    Raises:
        NoLLMConfigured - DB 里没 provider 或 task 指定的 provider 不存在
    """
    # 1) task_provider_id 为 None 但 DB 有 provider → 自动用 configs[0]
    if task_provider_id is None:
        if not configs:
            raise NoLLMConfigured(
                "no LLM provider configured in DB. "
                "Open API settings to add at least one provider.",
                reason_code="no_provider",
            )
        first = configs[0]
        model = task_model_id or first.default_model
        return OpenAICompatibleLLMClient(
            base_url=first.base_url,
            api_key=first.api_key,
            model=model,
        )

    # 2) task_provider_id 有值但 configs 为空
    if not configs:
        raise NoLLMConfigured(
            f"requested provider '{task_provider_id}' but DB has no enabled providers. "
            "Open API settings to add the provider.",
            reason_code="no_provider",
        )

    # 3) 找到指定 provider
    for c in configs:
        if c.provider_id == task_provider_id:
            model = task_model_id or c.default_model
            return OpenAICompatibleLLMClient(
                base_url=c.base_url,
                api_key=c.api_key,
                model=model,
            )

    # 4) 找不到 → 抛错（绝不回退到 stub）
    available = ", ".join(c.provider_id for c in configs) or "(none)"
    raise NoLLMConfigured(
        f"requested provider '{task_provider_id}' not found in DB. "
        f"Available: {available}.",
        reason_code="provider_not_found",
    )
