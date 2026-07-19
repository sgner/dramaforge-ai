import pytest
from types import SimpleNamespace

from app.agent.llm import REACT_SYSTEM_PROMPT
from app.agent.memory import AgentMemory
from app.agent.rule_packs import get_rule_pack
from app.agent.runtime import AgentRuntime
from app.agent.tools import build_default_registry
from app.agent.tools.base import RetryableError, ToolContext, ToolValidationError
from app.agent.tools.planning import CREATE_PLAN_SYSTEM_PROMPT, classify_source_maturity


def test_source_maturity_distinguishes_idea_synopsis_and_long_form():
    assert classify_source_maturity("失忆侦探在婚礼上发现新娘是凶手") == "idea"
    assert classify_source_maturity("雨夜，侦探收到旧友来信。" * 12) == "synopsis"
    assert classify_source_maturity("雨夜，侦探收到旧友来信。" * 120) == "long_form_source"


def test_drama_rule_pack_expands_story_before_generating_script():
    steps = get_rule_pack("drama_short.v1").workflow_steps
    by_id = {step.id: step for step in steps}

    assert by_id["story_expansion"].tool == "expand_story"
    assert by_id["script"].depends_on == ["story_expansion"]


def test_agent_prompts_require_story_expansion_for_ideas_and_synopses():
    for prompt in (REACT_SYSTEM_PROMPT, CREATE_PLAN_SYSTEM_PROMPT):
        assert "expand_story" in prompt
        assert "简单梗概" in prompt
        assert "直接" in prompt and "generate_script" in prompt


def test_default_registry_exposes_expand_story_tool():
    tool = build_default_registry().get("expand_story")
    assert tool is not None
    assert tool.category == "llm"


@pytest.mark.asyncio
async def test_expand_story_generates_script_ready_long_form_source():
    class _StubLLM:
        async def generate(self, messages, **kwargs):
            from app.agent.llm import LLMResponse

            assert "完整故事正文" in messages[0]["content"]
            assert "失忆侦探" in messages[1]["content"]
            return LLMResponse(content="雨夜，侦探推开教堂大门。" * 90)

    tool = build_default_registry().get("expand_story")
    emitted = []
    artifacts = {}
    result = await tool.call(
        ToolContext(
            task_id="t-expand",
            llm_client=_StubLLM(),
            artifacts=artifacts,
            emit=lambda event_type, payload: emitted.append((event_type, payload)),
        ),
        {"idea_text": "失忆侦探在婚礼上发现新娘是凶手"},
    )

    assert result["source_maturity"] == "long_form_source"
    assert result["source_kind"] == "novel"
    assert len(result["long_text"]) >= 1000
    assert result["novel_asset"]["asset_kind"] == "novel"
    assert artifacts["novel"][0]["body"] == result["long_text"]
    assert [event for event, _ in emitted if event == "artifact_created"]


@pytest.mark.asyncio
async def test_expand_story_retries_when_model_returns_another_short_synopsis():
    class _StubLLM:
        async def generate(self, messages, **kwargs):
            from app.agent.llm import LLMResponse

            return LLMResponse(content="侦探来到婚礼，发现新娘是凶手。")

    tool = build_default_registry().get("expand_story")
    with pytest.raises(RetryableError, match="扩写结果仍然过短"):
        await tool.call(
            ToolContext(task_id="t-short", llm_client=_StubLLM()),
            {"idea_text": "失忆侦探在婚礼上发现新娘是凶手"},
        )


def test_generate_script_params_prefer_expanded_story_over_original_synopsis():
    runtime = AgentRuntime.__new__(AgentRuntime)
    runtime.memory = AgentMemory(user_goal="写一个失忆侦探短剧")
    runtime.memory.add_step(
        step_number=1,
        thought="扩写故事",
        action={"tool": "expand_story", "params": {"idea_text": "失忆侦探"}},
        observation={
            "result": {
                "long_text": "完整故事正文" * 100,
                "source_kind": "novel",
                "source_maturity": "long_form_source",
            }
        },
        status="success",
    )
    runtime._latest_parsed_goal = lambda: {
        "source_text": "简短梗概",
        "source_maturity": "synopsis",
    }

    params = runtime._prepare_generate_script_params({"long_text": "简短梗概"})

    assert params["long_text"] == "完整故事正文" * 100
    assert params["source_maturity"] == "long_form_source"


@pytest.mark.asyncio
async def test_drama_generate_script_rejects_unexpanded_synopsis():
    tool = build_default_registry().get("generate_script")
    ctx = ToolContext(
        task_id="t-script-gate",
        task_profile=SimpleNamespace(task_type="drama_short"),
    )

    with pytest.raises(ToolValidationError, match="expand_story"):
        await tool.call(ctx, {"long_text": "雨夜里侦探发现新娘是凶手。" * 8})
