import pytest

from app.agent.memory import AgentMemory
from app.agent.runtime import AgentRuntime
from app.agent.task_profiles import TaskProfile, classify_task


def test_short_topic_requires_script_and_clarification():
    profile = classify_task("功夫", {"title": "功夫"}, [])

    assert isinstance(profile, TaskProfile)
    assert profile.task_type == "drama_short"
    assert profile.input_mode == "topic_only"
    assert profile.script_required is True
    assert profile.needs_clarification is True
    assert "script" in profile.missing_inputs


def test_classifies_all_supported_task_types():
    cases = {
        "write a short drama about a reunion": "drama_short",
        "make a documentary from these interview facts": "documentary",
        "promote our new event with a social campaign": "promotion",
        "create an ad for this product and its features": "commercial",
        "make something unusual for my community": "custom",
    }

    for goal, expected in cases.items():
        assert classify_task(goal, None, []).task_type == expected


def test_single_asset_intent_bypasses_script_gate():
    """用户只要求生成角色图/场景图/道具图时，不需要 script source。

    回归问题：此前"给我画一个角色图"被分类为 custom + topic_only，
    needs_clarification=True，source gate 阻止所有媒体工具，agent 陷入
    "要求 structured source"死循环。
    """
    cases = {
        "给我画一个赛博朋克女主角角色图": "character",
        "生成一个古风场景图": "scene",
        "画一个魔法道具图": "prop",
        "generate a character portrait of a warrior": "character",
        "create a scene concept image": "scene",
    }
    for goal, expected_deliverable in cases.items():
        profile = classify_task(goal, None, [])
        assert profile.task_type == "custom"
        assert profile.input_mode == "single_asset"
        assert profile.script_required is False
        assert profile.needs_clarification is False
        assert expected_deliverable in profile.deliverables
        assert profile.missing_inputs == []


def test_single_asset_intent_not_triggered_for_drama_goals():
    """目标中含 drama/短剧/剧本等关键词时，即使提到角色图也走完整流程。"""
    cases = [
        "做一个短剧，先生成角色图再写剧本",
        "drama short film, need character design first",
        "生成角色图然后拍成视频",
    ]
    for goal in cases:
        profile = classify_task(goal, None, [])
        # 不应走 single_asset 模式
        assert profile.input_mode != "single_asset"


def test_detects_input_completeness_and_asset_modes():
    for wording in (
        "use the uploaded files only",
        "use these files only",
        "只使用这些文件",
        "仅使用上传的文件",
    ):
        assert classify_task(wording, None, [{"id": "a1"}]).input_mode == "upload_only"
    assert classify_task("here is a complete script", {"script": "INT. ROOM\nA scene"}, []).input_mode == "complete_script"
    assert classify_task("documentary outline and facts", {"outline": "three chapters", "facts": ["fact"]}, []).input_mode == "documentary_outline"
    assert classify_task("promotion brief for launch", {"brief": "launch next week"}, []).input_mode == "promotion_brief"
    assert classify_task("product information", {"product": {"name": "Lamp", "features": ["LED"]}}, []).input_mode == "product_info"
    assert classify_task("script plus uploaded references", {"script": "scene"}, [{"id": "a1"}]).input_mode == "mixed"


@pytest.mark.parametrize(
    ("goal", "parsed_goal", "expected"),
    [
        ("promote this event", {"brief": "launch next week"}, True),
        ("create an ad", {"product": {"name": "Lamp"}}, True),
        ("make a custom video", {"deliverables": ["video"], "source": "approved brief"}, True),
        ("功夫", {"title": "功夫"}, False),
    ],
)
def test_runtime_media_source_gate_uses_task_profile(goal, parsed_goal, expected):
    runtime = AgentRuntime("t1", None, AgentMemory(goal))
    runtime.memory.add_step(
        step_number=1,
        thought="parsed",
        action={"tool": "parse_user_goal", "params": {}},
        observation={"result": parsed_goal},
        status="success",
    )

    assert runtime._has_source_for_profile(runtime._selected_task_profile()) is expected


def test_single_asset_goal_bypasses_source_gate():
    """"生成角色图"这类单一资产目标不应被 source gate 阻塞。

    回归问题：agent 调用 generate_character_portrait 时，_has_source_for_profile
    对 custom + needs_clarification 返回 False，触发 _pause_for_script_requirement，
    导致 agent 陷入"要求 structured source"死循环。
    """
    runtime = AgentRuntime("t1", None, AgentMemory("给我画一个赛博朋克女主角角色图"))
    profile = runtime._selected_task_profile()
    assert profile.input_mode == "single_asset"
    assert runtime._has_source_for_profile(profile) is True
