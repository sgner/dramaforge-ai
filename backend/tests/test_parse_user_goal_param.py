"""TDD: 修复 agent 循环 bug 的回归测试

重现：用户输入「长相思」→ LLM 在 ReAct 决策里调 parse_user_goal，
参数名必须是 user_text（不是 user_input），且工具能正确返回结构化 JSON。
LLM 拿到结果后应能继续推进到下一步（不再循环）。

如果 build_react_prompt 没把参数 schema 告诉 LLM，LLM 会猜错参数名，
parse_user_goal validate 失败，runtime 进入"反复猜参数名 → 反复失败"的死循环。
"""
import json
import time
import pytest
from fastapi.testclient import TestClient

from app import app
from app.agent.events import event_bus, EventType
from app.agent.llm import LLMResponse


@pytest.fixture
def client():
    return TestClient(app)


class _ParseGoalThenAskUserLLM:
    """模拟真实场景：第 1 步 parse_user_goal，第 2 步 ask_user 问用户方向。"""

    model = "test-parse-then-ask"
    _step = 0
    _captured_text = None  # 记录 LLM 给 parse_user_goal 传了什么 user_text

    async def generate(self, messages, tools=None, temperature=0.7, max_tokens=4000):
        if self._step == 0:
            # 模拟"长相思"输入：LLM 决定用 user_text（不是 user_input）调 parse_user_goal
            self._step += 1
            return LLMResponse(
                tool_name="parse_user_goal",
                tool_args={"user_text": "长相思"},  # 关键：LLM 用的名字
                cost_usd=0.0, prompt_tokens=0, completion_tokens=0,
            )
        # 第 2 步：parse_user_goal 已经成功，agent 觉得目标还是太模糊 → ask_user
        self._step += 1
        return LLMResponse(
            tool_name="ask_user",
            tool_args={"question": "你想围绕《长相思》做哪一种内容？", "options": []},
            cost_usd=0.0, prompt_tokens=0, completion_tokens=0,
        )

    async def generate_structured(self, messages, json_schema=None,
                                  temperature=0.7, max_tokens=4000):
        return await self.generate(messages)


class _FakeParseGoalLLM:
    """用 mock LLM 模拟 parse_user_goal 工具的 LLM 调用：返回结构化 JSON。"""

    model = "test-parse-tool-llm"

    async def generate(self, messages, tools=None, temperature=0.4, max_tokens=600, **kwargs):
        # 工具里的 LLM 调用：用 generate_structured 走（parse_user_goal 用的是 generate）
        # 我们要让 parse_user_goal 工具成功，所以返回合法 JSON
        return LLMResponse(
            content=json.dumps({
                "title": "长相思短剧",
                "genre": "古风仙侠",
                "duration_sec": 60,
                "num_characters": 3,
                "summary": "《长相思》改编短剧",
            }, ensure_ascii=False),
            cost_usd=0.0, prompt_tokens=0, completion_tokens=0,
        )

    async def generate_structured(self, messages, json_schema=None,
                                  temperature=0.7, max_tokens=4000):
        return await self.generate(messages)


@pytest.fixture
def parse_goal_llm(monkeypatch):
    """注入两个 LLM：
    - 主 runtime LLM：_ParseGoalThenAskUserLLM（决定用哪个工具）
    - 工具内 sub-LLM：_FakeParseGoalLLM（parse_user_goal 调用的那个 LLM）
    """
    from app.agent import openai_llm_client as ollc
    from app.agent import llm_factory as lf
    from app.database import SessionLocal
    from app.models import ProviderConfig
    from app.agent.tools import base as tools_base

    # runtime 用的 LLM（被 select_llm_for_task 返回）
    runtime_llm = _ParseGoalThenAskUserLLM()
    monkeypatch.setattr(ollc, "OpenAICompatibleLLMClient", lambda **kw: runtime_llm)
    monkeypatch.setattr(lf, "OpenAICompatibleLLMClient", lambda **kw: runtime_llm)

    # 工具内 ctx.llm_client 用的 sub-LLM
    sub_llm = _FakeParseGoalLLM()
    # 拦截 ToolContext.__init__ 给 llm_client 字段赋值
    orig_init = tools_base.ToolContext.__init__

    def patched_init(self, *args, **kwargs):
        orig_init(self, *args, **kwargs)
        # 如果没传 llm_client，就用 sub_llm 顶上
        if self.llm_client is None:
            self.llm_client = sub_llm

    monkeypatch.setattr(tools_base.ToolContext, "__init__", patched_init)

    # 注入 enabled provider
    with SessionLocal() as db:
        row = db.query(ProviderConfig).filter_by(provider_id="autostart-test").first()
        if not row:
            row = ProviderConfig(
                provider_id="autostart-test", name="Test",
                base_url="https://test/v1", api_key="sk", protocol="openai",
                enabled=True, default_model="gpt-4",
                chat_models_json='["gpt-4"]', image_models_json="[]",
                video_models_json="[]", extra_config_json="{}",
            )
            db.add(row)
            db.commit()
    yield
    with SessionLocal() as db:
        row = db.query(ProviderConfig).filter_by(provider_id="autostart-test").first()
        if row:
            db.delete(row)
            db.commit()


def _wait_for_status(client, task_id, target, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/agent/tasks/{task_id}")
        if r.status_code == 200 and r.json().get("status") == target:
            return r.json()
        time.sleep(0.05)
    return None


def test_parse_user_goal_with_user_text_does_not_loop(client, parse_goal_llm):
    """回归：LLM 用 user_text 调 parse_user_goal → 工具成功 → agent 继续推进（不卡死）。"""
    r = client.post("/api/agent/tasks", json={
        "user_goal": "长相思", "max_steps": 10,
    })
    assert r.status_code == 200
    task_id = r.json()["id"]

    # 应该先 parse_user_goal（成功）→ 然后 ask_user → 任务 paused
    paused = _wait_for_status(client, task_id, "paused", timeout=5.0)
    assert paused is not None, (
        f"task should pause after parse+ask_user; "
        f"current={client.get(f'/api/agent/tasks/{task_id}').json()}"
    )

    # 验证：parse_user_goal 成功（有 observation 记录成功的 step）
    events = event_bus.get_replay(task_id)
    actions = [e for e in events if e.type == EventType.ACTION]
    observations = [e for e in events if e.type == EventType.OBSERVATION]

    # 至少有 1 次 parse_user_goal action
    parse_actions = [a for a in actions if a.payload.get("tool") == "parse_user_goal"]
    assert len(parse_actions) == 1, (
        f"parse_user_goal should be called exactly once; "
        f"got {len(parse_actions)} action events: {[a.payload for a in parse_actions]}"
    )
    # 那一次必须用 user_text
    assert parse_actions[0].payload.get("params", {}).get("user_text") == "长相思"

    # observation 里也至少有一次成功的 parse_user_goal 结果
    parse_obs = [o for o in observations if o.payload.get("success") is True]
    assert len(parse_obs) >= 1, f"no successful parse_user_goal observation: {observations}"

    # 关键断言：必须出现过 ask_user（证明 agent 没卡死、顺利推进到下一步）
    ask_events = [e for e in events if e.type == EventType.REQUEST_USER_INPUT]
    assert len(ask_events) == 1, f"expected exactly 1 ask_user; got {len(ask_events)}"
