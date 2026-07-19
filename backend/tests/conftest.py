"""Shared pytest fixtures.

- `seeded_provider`: 在 DB 注入一个 enabled provider，并把 OpenAICompatibleLLMClient
  替换成 NoOp，让 autostart 路径走"真实 LLM 选择 → 真实 client（被 monkey-patch 拦截）→ 跑通"。
  用于所有依赖 DevScriptedLLM 旧行为但实际想验证 autostart 机制的测试。
- `_seed_llm_binding` (autouse): 注入 model_bindings UserPreference，指向 autostart-test/gpt-4，
  让 `resolve_capability_bindings` 不会因为没绑 provider 而返回 400。
  这是因为：之前 agent task 创建路由在缺 binding 时返回 400，导致 ~25 个 test 失败
  （test_agent_routes / test_runtime_autostart / test_ask_user_resume 等）。
  在 teardown 时清空，避免污染下一个测试。
  关键：不动 ProviderConfig 表，只动 UserPreference；不影响 test_providers_crud（用 in-memory DB 隔离）。

【测试库隔离】此前本文件直接 `from app.database import SessionLocal` —— 那是**开发库**
（backend/dramaforge.db）。多个 fixture/测试会对它执行清空写操作：
  - conftest setUp: DELETE FROM drama_tasks WHERE id NOT LIKE 'live_%'（清空用户真实任务）
  - test_media_providers / test_video_dev_fallback: query(ProviderConfig).delete()
    （清空用户真实 API 配置 —— 用户反馈"每次跑完代码 API 配置就没了"的根因）
  - autouse setUp: 注入 autostart-test provider 且 teardown 不删（残留到用户配置里）
因此在本文件顶部（任何 app 模块被 import 之前）把 DRAMAFORGE_DB_PATH 指向独立的
测试库文件，app.database 的 engine 在 import 时绑定该路径，整个套件不再触碰开发库。
"""
import json
import os
import tempfile

# 必须在任何 `from app...` import 之前设置（app.database 在 import 时创建 engine）。
os.environ.setdefault(
    "DRAMAFORGE_DB_PATH",
    os.path.join(tempfile.gettempdir(), "dramaforge-test.db"),
)

import pytest


@pytest.fixture(scope="session", autouse=True)
def _init_test_db_schema():
    """测试库是独立文件，首次运行前建好表（含增量迁移列）。

    此前测试依赖开发库里已存在的表；隔离后必须自己 init。
    init_db 是幂等的（create_all + 列存在性检查），每个 pytest 进程跑一次即可。
    """
    from app.database import init_db
    init_db()
    yield


@pytest.fixture(autouse=True)
def _seed_llm_binding(request):
    """自动注入 model_bindings，避免 agent task 创建路由返回 400。

    仅在以下条件注入：
    - 测试使用真 DB（不重写 get_db）—— 跳过用 in-memory DB 的 test_providers_crud 等
    - 跳过 test_provider_migration / test_llm_factory_unified（它们自己 seed UserPreference）
    - 跳过 test_capability_bindings（它自己测 binding 解析逻辑，不能注入）

    关键：teardown 永远跑，保证 model_bindings 不被前一个测试残留污染
    后续的 "不传 llm_* 时 llm_provider_id is None" 类的测试。
    """
    test_path = request.node.fspath
    skip_setup = False
    if "test_providers_crud" in str(test_path):
        skip_setup = True  # 这些用 in-memory DB
    elif "test_provider_migration" in str(test_path):
        skip_setup = True  # 自己测 model_bindings 迁移
    elif "test_llm_factory_unified" in str(test_path):
        skip_setup = True  # 自己测 model_bindings
    elif "test_capability_bindings" in str(test_path):
        skip_setup = True  # 自己测 binding 解析
    elif "test_agent_capability_bindings" in str(test_path):
        skip_setup = True  # 自己测 binding 解析
    elif request.node.name == "test_create_task_without_llm_fields_defaults_to_null":
        skip_setup = True  # 验证"不传 llm 时 llm_provider_id=None"旧行为
    elif request.node.name == "test_create_task_with_no_provider_fails_gracefully":
        skip_setup = True  # 验证"没 provider 时 task failed"行为，不能注入 provider/binding

    if not skip_setup:
        from app.database import SessionLocal
        from app.models import UserPreference, ProviderConfig

        binding_value = json.dumps([{
            "kind": "llm",
            "providerId": "autostart-test",
            "modelId": "gpt-4",
        }], ensure_ascii=False)

        # setUp: 注入 binding（如果 provider 不存在则先注入）
        with SessionLocal() as db:
            provider = db.query(ProviderConfig).filter_by(provider_id="autostart-test").first()
            if not provider:
                provider = ProviderConfig(
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
                db.add(provider)
            pref = db.query(UserPreference).filter_by(key="model_bindings").first()
            if not pref:
                pref = UserPreference(key="model_bindings", value_json=binding_value)
                db.add(pref)
            else:
                # 记住旧值，teardown 恢复
                request.node._old_model_bindings = pref.value_json
                pref.value_json = binding_value
            # 关键：清空 drama_tasks 残留（test_drama_task_router 期望空列表），
            # 只清空不在 'pending' 状态的 task（避免影响正在运行的 task）。
            # 用 raw SQL 避免引入 drama task model 依赖。
            from sqlalchemy import text
            try:
                db.execute(text("DELETE FROM drama_tasks WHERE id NOT LIKE 'live_%'"))
            except Exception:
                # 表可能不存在于某些 test env，吞掉
                db.rollback()
            db.commit()

    try:
        yield
    finally:
        # tearDown: 永远跑。恢复原状，避免污染下一个测试。
        # 即使 skip_setup=True（如 "不传 llm_*" 测试）也要清掉残留 binding，
        # 否则下一个测试会看到上一轮注入的 binding，断言失败。
        from app.database import SessionLocal
        from app.models import UserPreference
        try:
            with SessionLocal() as db:
                pref = db.query(UserPreference).filter_by(key="model_bindings").first()
                if pref is not None:
                    if hasattr(request.node, "_old_model_bindings"):
                        pref.value_json = request.node._old_model_bindings
                    else:
                        db.delete(pref)
                    db.commit()
        except Exception:
            # teardown 不应让测试失败；吞掉异常。
            pass


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
