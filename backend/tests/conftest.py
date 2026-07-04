"""Shared pytest fixtures.

- `seeded_provider`: 在 DB 注入一个 enabled provider，并把 OpenAICompatibleLLMClient
  替换成 NoOp，让 autostart 路径走"真实 LLM 选择 → 真实 client（被 monkey-patch 拦截）→ 跑通"。
  用于所有依赖 DevScriptedLLM 旧行为但实际想验证 autostart 机制的测试。
"""
import pytest


@pytest.fixture
def seeded_provider(monkeypatch):
    from app.database import SessionLocal
    from app.models import ProviderConfig
    from app.agent import openai_llm_client as ollc
    from app.agent import llm_factory as lf
    from app.agent.llm import LLMResponse

    class _NoOpLLM:
        model = "test-noop"
        async def generate(self, messages, tools=None, temperature=0.7, max_tokens=4000):
            return LLMResponse(
                tool_name="finish_task",
                tool_args={"summary": "noop finished"},
                cost_usd=0.0, prompt_tokens=0, completion_tokens=0,
            )
        async def generate_structured(self, messages, json_schema=None,
                                      temperature=0.7, max_tokens=4000):
            return await self.generate(messages)

    # 把 OpenAICompatibleLLMClient 替换成 NoOp（让 runtime 跳过真实 HTTP 调用）
    monkeypatch.setattr(ollc, "OpenAICompatibleLLMClient", lambda **kw: _NoOpLLM())
    monkeypatch.setattr(lf, "OpenAICompatibleLLMClient", lambda **kw: _NoOpLLM())

    # 在 DB 注入 enabled provider
    with SessionLocal() as db:
        row = db.query(ProviderConfig).filter_by(provider_id="autostart-test").first()
        if not row:
            row = ProviderConfig(
                provider_id="autostart-test",
                name="Autostart Test",
                base_url="https://autostart.test/v1",
                api_key="sk-noop",
                protocol="openai",
                enabled=True,
                default_model="gpt-4",
                chat_models_json='["gpt-4","deepseek-v3"]',
                image_models_json="[]",
                video_models_json="[]",
                extra_config_json="{}",
            )
            db.add(row)
            db.commit()
    yield
    with SessionLocal() as db:
        row = db.query(ProviderConfig).filter_by(provider_id="autostart-test").first()
        if row:
            db.delete(row)
            db.commit()
