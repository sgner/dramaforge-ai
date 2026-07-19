import pytest

from app.agent.memory import AgentMemory
from app.agent.runtime import AgentRuntime
from app.agent.task_profiles import (
    TaskProfile,
    classify_task,
    is_deliverables_question,
    parse_user_deliverable_answer,
)


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
    对 custom + needs_clarification 返回 False，触发 _pause_for_script_requirement,
    导致 agent 陷入"要求 structured source"死循环。
    """
    runtime = AgentRuntime("t1", None, AgentMemory("给我画一个赛博朋克女主角角色图"))
    profile = runtime._selected_task_profile()
    assert profile.input_mode == "single_asset"
    assert runtime._has_source_for_profile(profile) is True


# ===================================================================
# 用户在 ask_user 中回答"要哪些交付物"的处理逻辑
# ===================================================================

class TestParseUserDeliverableAnswer:
    """parse_user_deliverable_answer 把用户的 option label 解析为 deliverable 列表。"""

    def test_parses_full_short_drama_option(self):
        # 这是 fig 1 中用户选择的 option 标签
        result = parse_user_deliverable_answer("完整短剧（剧本+角色肖像+场景概念图+道具图+分镜）")
        assert set(result) == {"script", "video", "character", "scene", "prop", "storyboard"}

    def test_parses_partial_image_only(self):
        result = parse_user_deliverable_answer("只要场景概念图和角色图")
        assert set(result) == {"scene", "character"}

    def test_parses_script_and_character(self):
        result = parse_user_deliverable_answer("只要剧本和角色设计图")
        assert "script" in result
        assert "character" in result
        # 不应误判成 video（因为没有"短剧"/"视频"等关键词）
        assert "video" not in result

    def test_english_answer(self):
        result = parse_user_deliverable_answer("I need character portrait and scene concept")
        assert "character" in result
        assert "scene" in result

    def test_returns_empty_for_empty_input(self):
        assert parse_user_deliverable_answer("") == []
        assert parse_user_deliverable_answer(None) == []

    def test_returns_empty_for_all_means_no_limit(self):
        # "全部"表示不限制 → 返回空，由 agent 决定
        assert parse_user_deliverable_answer("全部都要") == []
        assert parse_user_deliverable_answer("all deliverables") == []

    def test_handles_array_input(self):
        # 多选场景
        result = parse_user_deliverable_answer(["场景图", "角色图"])
        assert "scene" in result
        assert "character" in result


class TestIsDeliverablesQuestion:
    def test_detects_chinese_question(self):
        assert is_deliverables_question("你希望我为你生成哪些交付物？以下是常见选项")
        assert is_deliverables_question("你想要哪些资产？")
        assert is_deliverables_question("请告诉我你需要哪些")

    def test_detects_english_question(self):
        assert is_deliverables_question("Which deliverables do you need?")

    def test_returns_false_for_unrelated_questions(self):
        assert not is_deliverables_question("你的目标是什么？")
        assert not is_deliverables_question("请补充故事背景")
        assert is_deliverables_question("") is False
        assert is_deliverables_question(None) is False


class TestProfileWithUserConfirmed:
    """with_user_confirmed() 应当正确更新 profile 状态。"""

    def test_clears_needs_clarification_when_confirmed(self):
        profile = classify_task("功夫", {"title": "功夫"}, [])
        assert profile.needs_clarification is True
        updated = profile.with_user_confirmed(["character", "scene", "prop", "storyboard"])
        assert updated.needs_clarification is False
        assert updated.user_confirmed_deliverables == ["character", "scene", "prop", "storyboard"]
        assert set(updated.deliverables) == {"character", "scene", "prop", "storyboard"}

    def test_keeps_existing_deliverables_when_empty_confirmed(self):
        profile = classify_task("功夫", {"title": "功夫"}, [])
        updated = profile.with_user_confirmed([])
        # 传空 list 时保留默认 deliverables
        assert updated.deliverables == profile.deliverables

    def test_replaces_user_confirmed_on_subsequent_calls(self):
        """用户二次修改交付物时，以最新一次为准。"""
        profile = classify_task("功夫", {"title": "功夫"}, [])
        step1 = profile.with_user_confirmed(["character"])
        step2 = step1.with_user_confirmed(["script", "character", "scene"])
        assert step2.user_confirmed_deliverables == ["script", "character", "scene"]


class TestUserConfirmedBypassesSourceGate:
    """用户回答了 deliverables 后，source gate 应自动满足，避免再次询问。"""

    def test_answered_deliverables_bypasses_gate_for_drama(self):
        """回归问题：用户回答"完整短剧（剧本+角色+场景+道具+分镜）"后，
        runtime 仍然反复询问要哪些交付物（needs_clarification 始终为 True）。
        修复后：_selected_task_profile 应将 user_confirmed_deliverables
        投影到 profile，_has_source_for_profile 应返回 True。"""
        runtime = AgentRuntime("t1", None, AgentMemory("我想做一个异世界的故事"))
        # 模拟 ask_user + 用户回答
        runtime.memory.add_step(
            step_number=1,
            thought="询问用户",
            action={
                "tool": "ask_user",
                "params": {
                    "question": "你希望我为你生成哪些交付物？以下是常见选项",
                    "options": [
                        "完整短剧（剧本+角色肖像+场景概念图+道具图+分镜）",
                        "只要剧本和角色设计图",
                    ],
                    "missing_inputs": ["structured_source"],
                },
            },
            observation={"user_response": "完整短剧（剧本+角色肖像+场景概念图+道具图+分镜）"},
            status="success",
        )
        profile = runtime._selected_task_profile()
        # 关键断言：needs_clarification 已被清除
        assert profile.needs_clarification is False, (
            f"用户已回答 deliverables，但 needs_clarification 仍为 True："
            f"missing_inputs={profile.missing_inputs}, "
            f"user_confirmed_deliverables={profile.user_confirmed_deliverables}"
        )
        # source gate 应通过
        assert runtime._has_source_for_profile(profile) is True

    def test_partial_image_only_bypasses_gate(self):
        """用户只要图（场景+角色），不应再被 source gate 阻塞。"""
        runtime = AgentRuntime("t1", None, AgentMemory("一个异世界短片"))
        runtime.memory.add_step(
            step_number=1,
            thought="问",
            action={
                "tool": "ask_user",
                "params": {
                    "question": "你想要哪些资产？",
                    "missing_inputs": ["structured_source"],
                },
            },
            observation={"user_response": "只要场景概念图和角色图"},
            status="success",
        )
        profile = runtime._selected_task_profile()
        # 用 set 比较：parse_user_deliverable_answer 返回顺序依赖 rules 优先级
        assert set(profile.user_confirmed_deliverables) == {"scene", "character"}
        assert runtime._has_source_for_profile(profile) is True

    def test_non_deliverables_question_keeps_gate(self):
        """非 deliverables 问题（如故事背景）不应触发 user_confirmed_deliverables。"""
        runtime = AgentRuntime("t1", None, AgentMemory("功夫"))
        runtime.memory.add_step(
            step_number=1,
            thought="问背景",
            action={
                "tool": "ask_user",
                "params": {
                    "question": "请补充你的故事背景？",
                    "missing_inputs": ["structured_source"],
                },
            },
            observation={"user_response": "民国时期上海"},
            status="success",
        )
        profile = runtime._selected_task_profile()
        # 非 deliverables 问题：user_confirmed_deliverables 应为空
        assert profile.user_confirmed_deliverables == []
        # 但 structured_source 应已被投影到 profile（custom 类型）
        # 这是已有的 _answered_source_context 行为

    def test_llm_freeform_question_still_captures_deliverables(self):
        """回归：LLM 自由提问（不含 deliverables 关键词）时，user 回答中明确提到
        资产类型也应被识别为已确认的 deliverable。

        之前的 bug：_answered_deliverables_context 强依赖 is_deliverables_question
        过滤 → LLM 自由提问"你想基于什么主题创作"时，用户回答"我只要角色图、
        场景图、道具图、分镜"被忽略 → agent 反复询问。
        """
        runtime = AgentRuntime("t1", None, AgentMemory("一个异世界短片"))
        runtime.memory.add_step(
            step_number=1,
            thought="问主题",
            action={
                "tool": "ask_user",
                "params": {
                    # 关键：问题文本是 LLM 自由发挥的，不含"哪些交付物"等关键词
                    "question": "你想基于'异世界'这个主题创作什么？请告诉我更多细节。",
                    "missing_inputs": ["structured_source"],
                },
            },
            observation={"user_response": "我只要角色图、场景图、道具图、分镜"},
            status="success",
        )
        profile = runtime._selected_task_profile()
        # 关键断言：用户回答中提到的资产被识别为已确认
        assert set(profile.user_confirmed_deliverables) == {"character", "scene", "prop", "storyboard"}
        # source gate 通过，不再问
        assert runtime._has_source_for_profile(profile) is True

    def test_pure_descriptive_answer_not_misidentified_as_deliverable(self):
        """非资产描述（"民国时期"/"2分钟"/"奇幻风格"）不应触发 user_confirmed_deliverables。

        这是 parse_user_deliverable_answer 关键词集严格性的回归测试：
        避免把时长/风格/年代等纯描述误判为 deliverable。
        """
        runtime = AgentRuntime("t1", None, AgentMemory("功夫"))
        runtime.memory.add_step(
            step_number=1,
            thought="问时长",
            action={
                "tool": "ask_user",
                "params": {
                    "question": "你的目标时长是？",
                    "missing_inputs": ["structured_source"],
                },
            },
            observation={"user_response": "2分钟"},
            status="success",
        )
        profile = runtime._selected_task_profile()
        # 纯时长回答：不应被识别为 deliverable
        assert profile.user_confirmed_deliverables == []

    def test_answer_with_embedded_assets_still_recognized(self):
        """'完整短剧'中含多种资产，应被识别为多个 deliverable。"""
        runtime = AgentRuntime("t1", None, AgentMemory("我想做一个异世界的故事"))
        runtime.memory.add_step(
            step_number=1,
            thought="问",
            action={
                "tool": "ask_user",
                "params": {
                    "question": "你想要哪些？",
                    "missing_inputs": ["structured_source"],
                },
            },
            observation={"user_response": "完整短剧（剧本+角色肖像+场景概念图+道具图+分镜）"},
            status="success",
        )
        profile = runtime._selected_task_profile()
        assert set(profile.user_confirmed_deliverables) == {
            "script", "video", "character", "scene", "prop", "storyboard",
        }


class TestTaskProfileSerializationWithNewFields:
    """Pydantic 序列化：user_confirmed_deliverables 字段应能正确持久化到 DB JSON。"""

    def test_round_trip_preserves_user_confirmed_deliverables(self):
        """TaskProfile.model_dump() → JSON → TaskProfile.model_validate() 应保留 user_confirmed_deliverables。"""
        original = TaskProfile(
            task_type="custom",
            input_mode="single_asset",
            source_kind="topic",
            script_required=False,
            needs_clarification=False,
            deliverables=["character", "scene", "prop"],
            asset_strategy="request or create required assets",
            confidence=0.85,
            missing_inputs=[],
            rule_pack_id="custom.v1",
            user_confirmed_deliverables=["character", "scene", "prop"],
            user_excluded_deliverables=["video"],
        )
        dumped = original.model_dump(mode="json")
        restored = TaskProfile.model_validate(dumped)
        assert restored.user_confirmed_deliverables == ["character", "scene", "prop"]
        assert restored.user_excluded_deliverables == ["video"]
        # 关键：DB 持久化 → 重建 runtime → 字段仍在，避免下次重新询问
        assert restored.needs_clarification is False
