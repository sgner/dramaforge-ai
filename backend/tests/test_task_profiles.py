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
