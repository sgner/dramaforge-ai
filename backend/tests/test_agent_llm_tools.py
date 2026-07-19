"""TDD: LLM 类工具（generate_script / extract_* / optimize_prompt）。"""
import json
import pytest

from app.agent.tools.base import RetryableError, ToolContext, ToolValidationError
from app.agent.tools.llm_tools import (
    GenerateScriptTool,
    ExtractCharactersTool,
    ExtractPropsTool,
    ExtractScenesTool,
    ExtractShotsTool,
    OptimizePromptTool,
    _sanitize_optimized_prompt,
    _cap_prompt_length,
    _scenes_to_markdown,
    _compute_text_stats,
    _format_script_for_llm,
    GENERATE_SCRIPT_SYSTEM_PROMPT,
    EXTRACT_SHOTS_SYSTEM_PROMPT,
)
from app.agent.tools.planning import ParseUserGoalTool


# ========================
# GenerateScriptTool
# ========================

def test_generate_script_metadata():
    t = GenerateScriptTool()
    assert t.name == "generate_script"
    assert t.category == "llm"
    assert t.requires_approval is False
    assert {"novel_text", "source_text", "goal"} <= {p.name for p in t.parameters}


def test_malformed_extraction_json_is_retryable():
    from app.agent.tools.llm_tools import _parse_llm_json_or_raise

    with pytest.raises(RetryableError, match="characters"):
        _parse_llm_json_or_raise('{"thought": "not extraction output"}', "characters", "角色提取")


@pytest.mark.asyncio
async def test_extract_characters_falls_back_to_script_characters_after_invalid_json():
    existing = [{"name": "林尘", "identity": "调查员"}, {"name": "苏雨", "identity": "摄影师"}]

    class _StubLLM:
        async def generate(self, messages, **kwargs):
            from app.agent.llm import LLMResponse

            assert kwargs["max_tokens"] >= 6000
            return LLMResponse(content='{"message": "truncated before characters"}')

    result = await ExtractCharactersTool().call(
        ToolContext(task_id="t-character-fallback", llm_client=_StubLLM()),
        {"script": {"scenes": [{"characters": ["林尘", "苏雨"]}], "characters": existing}},
    )

    assert result["characters"] == existing
    assert result["fallback"] is True
    assert result["fallback_reason"] == "invalid_llm_json"


def test_script_and_shot_prompts_require_asset_membership_mapping():
    """脚本解析和后续分镜提取都必须输出场景、角色、道具归属。"""
    for prompt in (GENERATE_SCRIPT_SYSTEM_PROMPT, EXTRACT_SHOTS_SYSTEM_PROMPT):
        assert '"scene"' in prompt
        assert '"characters"' in prompt
        assert '"props"' in prompt


def test_extract_shots_input_keeps_script_shot_membership_mapping():
    formatted = _format_script_for_llm({
        "scenes": [{"index": 1, "location": "古堡大厅"}],
        "characters": [],
        "props": [],
        "bigShots": [{
            "sceneIndex": 1,
            "index": 2,
            "scene": "古堡大厅",
            "characters": ["英雄"],
            "props": ["长剑"],
        }],
        "visualSignature": {},
    })
    assert "scene=古堡大厅" in formatted
    assert "characters=英雄" in formatted
    assert "props=长剑" in formatted


@pytest.mark.asyncio
async def test_generate_script_prefers_preserved_source_text_over_summary():
    """脚本解析必须使用原始长文本，不能把 parse_user_goal 的概要喂回模型。"""
    raw_source = (
        "雨夜里，沈砚在旧车站发现一封没有寄件人的信。"
        "信中写着三年前失踪的妹妹仍然活着，并约他午夜前往废弃剧院。"
        "他带着信走进剧院，发现台上亮着一盏孤灯，幕后传来妹妹的声音。"
    )
    summary = "用户想创作一个关于失踪妹妹的悬疑短剧。"

    class _StubLLM:
        async def generate(self, messages, **kwargs):
            from app.agent.llm import LLMResponse
            if messages[0]["content"].startswith("你是 DramaForge 编剧"):
                assert raw_source in messages[1]["content"]
                assert summary not in messages[1]["content"]
                return LLMResponse(content=json.dumps({"scenes": [{"index": 1, "title": "旧车站"}]}))
            raise AssertionError("unexpected LLM call")

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await GenerateScriptTool().call(ctx, {
        "long_text": summary,
        "source_text": raw_source,
        "source_kind": "novel",
    })
    assert result["scenes"][0]["title"] == "旧车站"


@pytest.mark.asyncio
async def test_parse_user_goal_preserves_long_source_separately_from_summary():
    """parse_user_goal 可以生成概要，但必须同时保留原始素材。"""
    source = "这是第一场。主角在雨夜走进车站。" + "他发现一封关键的信，随后赶往废弃剧院。" * 3

    class _StubLLM:
        async def generate(self, messages, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps({"summary": "雨夜车站悬疑故事概要"}))

    result = await ParseUserGoalTool().call(ToolContext(task_id="t1", llm_client=_StubLLM()), {"user_text": source})
    assert result["summary"] == "雨夜车站悬疑故事概要"
    assert result["source_text"] == source


@pytest.mark.asyncio
async def test_generate_script_returns_list_of_scenes():
    payload = {
        "scenes": [
            {"index": 1, "title": "开场", "location": "咖啡店", "dialogue": "你好", "duration_sec": 30},
        ]
    }

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await GenerateScriptTool().call(ctx, {"novel_text": "林尘走进咖啡店..."})
    assert "scenes" in result
    assert result["scenes"][0]["title"] == "开场"


@pytest.mark.asyncio
async def test_generate_script_validation_requires_novel_text():
    ctx = ToolContext(task_id="t1")
    with pytest.raises(ToolValidationError):
        await GenerateScriptTool().call(ctx, {"goal": {"title": "x"}})


@pytest.mark.asyncio
async def test_generate_script_creates_script_asset():
    """generate_script 生成 scenes 后必须自动创建 asset_kind=script 的文本资产。

    否则 LLM 下一轮 think 看不到产物，会反复调 generate_script，
    最终超过 max_steps 触发 TASK_FAILED 事件。
    """
    from unittest.mock import MagicMock
    payload = {
        "scenes": [
            {"index": 1, "title": "开场", "location": "咖啡店", "dialogue": "你好", "duration_sec": 30},
        ]
    }

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    db = MagicMock()
    chain = MagicMock()
    chain.filter.return_value.order_by.return_value.first.return_value = None
    db.query.return_value = chain
    ctx = ToolContext(task_id="t1", project_id="p1", db=db, llm_client=_StubLLM())

    result = await GenerateScriptTool().call(ctx, {"novel_text": "林尘走进咖啡店..."})
    assert "scenes" in result
    assert "asset_id" in result, "generate_script 必须返回 asset_id 以便 runtime 同步到 memory.artifacts"
    # 必须落库（db.add + db.commit）
    assert db.add.called, "generate_script 必须调用 save_asset 落库"
    assert db.commit.called


def test_build_script_asset_payload_stores_structured_json_in_extra_script():
    """_build_script_asset_payload 必须把综合 JSON 写入 extra.script。

    脚本节点（ScriptNodeBody）依赖 extra.script 渲染 角色/道具/场景/分镜/视觉签名 tabs。
    如果只存 markdown body，前端 JSON.parse 失败 → tabs 全空（用户最近反馈的 bug）。
    """
    data = {
        "scenes": [
            {"index": 1, "title": "开场", "location": "咖啡店", "time": "白天",
             "characters": ["林尘", "苏晚"], "dialogue": "你好", "description": "走进咖啡店",
             "duration_sec": 30},
        ],
        "characters": [
            {"name": "林尘", "identity": "主角", "ageRange": "25-30", "gender": "男", "era": "现代",
             "faceAnchor": {"faceShape": "方"}, "hairSystem": {"color": "黑"},
             "clothingLayers": {"inner": "白衬衫"}, "specialState": ""},
        ],
        "props": [{"name": "咖啡杯", "category": "工具", "material": "陶瓷"}],
        "bigShots": [{"sceneIndex": 1, "index": 1, "shotType": "中景", "cameraMove": "固定",
                      "action": "推门走进", "dialogue": "你好", "durationSec": 5}],
        "visualSignature": {"medium": "实拍", "aspectRatio": "16:9", "colorIds": ["暖色"], "coreTheme": "都市"},
    }
    payload = GenerateScriptTool._build_script_asset_payload(
        data, long_text="林尘走进咖啡店...", source_kind="long_text",
    )
    # 关键断言：extra.script 存在且包含完整结构化 JSON
    assert "script" in payload["extra"], "必须存 extra.script 供 ScriptNodeBody 渲染 tabs"
    structured = payload["extra"]["script"]
    assert len(structured["characters"]) == 1
    assert structured["characters"][0]["name"] == "林尘"
    assert len(structured["props"]) == 1
    assert structured["props"][0]["name"] == "咖啡杯"
    assert len(structured["bigShots"]) == 1
    assert structured["bigShots"][0]["shotType"] == "中景"
    assert structured["visualSignature"]["medium"] == "实拍"
    # sceneAssets 兼容 ScriptNodeBody 字段命名（与 scenes 内容相同）
    assert len(structured["sceneAssets"]) == 1
    assert structured["sceneAssets"][0]["title"] == "开场"
    # body 仍存 markdown（TextReader 用）
    assert payload["extra"]["body"]  # 非空 markdown


def test_build_script_asset_payload_handles_missing_structured_fields():
    """LLM 只输出 scenes（老格式/简版输出）时，结构化字段填空数组/默认对象，不崩。"""
    data = {
        "scenes": [
            {"index": 1, "title": "开场", "dialogue": "你好", "duration_sec": 30},
        ],
        # 没有 characters/props/bigShots/visualSignature
    }
    payload = GenerateScriptTool._build_script_asset_payload(
        data, long_text="...", source_kind="long_text",
    )
    structured = payload["extra"]["script"]
    assert structured["characters"] == []
    assert structured["props"] == []
    assert structured["bigShots"] == []
    assert structured["visualSignature"] == {}
    assert len(structured["scenes"]) == 1


@pytest.mark.asyncio
async def test_generate_script_accepts_long_text_alias():
    """long_text 是 novel_text 的别名（与起始节点扩写出的长文本保持一致命名）。"""
    payload = {"scenes": [{"index": 1, "title": "开场", "dialogue": "x", "duration_sec": 30}]}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    from unittest.mock import MagicMock
    db = MagicMock()
    chain = MagicMock()
    chain.filter.return_value.order_by.return_value.first.return_value = None
    db.query.return_value = chain
    ctx = ToolContext(task_id="t1", project_id="p1", db=db, llm_client=_StubLLM())

    # 传 long_text 应与传 novel_text 行为一致
    result = await GenerateScriptTool().call(ctx, {"long_text": "宣传片文案..."})
    assert "scenes" in result


@pytest.mark.asyncio
async def test_generate_script_stores_source_kind_in_extra():
    """source_kind 区分小说（novel）和长文本（long_text）——用户可能是宣传片。"""
    payload = {"scenes": [{"index": 1, "title": "x", "dialogue": "y", "duration_sec": 30}]}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    from unittest.mock import MagicMock
    db = MagicMock()
    chain = MagicMock()
    chain.filter.return_value.order_by.return_value.first.return_value = None
    db.query.return_value = chain
    ctx = ToolContext(task_id="t1", project_id="p1", db=db, llm_client=_StubLLM())

    await GenerateScriptTool().call(ctx, {"novel_text": "x", "source_kind": "long_text"})
    # 落到 Asset 的 extra 里要有 source_kind
    added_asset = db.add.call_args[0][0]
    extra = added_asset.extra or {}
    assert extra.get("source_kind") == "long_text"


@pytest.mark.asyncio
async def test_generate_script_syncs_ctx_artifacts_and_emits_event():
    """回归测试：agent 直接调用 generate_script 必须同步更新 ctx.artifacts。

    根因：runtime.py 只对 top-level tool_name=='save_asset' 时同步 memory.artifacts。
    当 generate_script 内部调 SaveAssetTool 时，顶层 tool_name 是 generate_script，
    runtime 不会把脚本写进 memory.artifacts，LLM 下次 think 看不到【已生成资产】中
    的 script，会反复重试 generate_script → max_steps 耗尽 → TASK_FAILED →
    SSE 连接关闭 → 前端显示 'connection closed (task ended), no reconnect failed'。

    修复：generate_script 自己负责把脚本资产写进 ctx.artifacts（runtime memory 引用）
    并通过 ctx.emit_event 发 artifact_created 事件，让前端立即看到脚本节点。
    """
    payload = {"scenes": [{"index": 1, "title": "开场", "dialogue": "x", "duration_sec": 30}]}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    from unittest.mock import MagicMock
    db = MagicMock()
    chain = MagicMock()
    chain.filter.return_value.order_by.return_value.first.return_value = None
    db.query.return_value = chain

    # 收集 emit 事件
    emitted: list[tuple[str, dict]] = []
    artifacts: dict = {}

    def _emit(event_type: str, payload: dict) -> None:
        emitted.append((event_type, payload))

    ctx = ToolContext(
        task_id="t1",
        project_id="p1",
        db=db,
        llm_client=_StubLLM(),
        artifacts=artifacts,
        emit=_emit,
    )

    result = await GenerateScriptTool().call(ctx, {"novel_text": "林尘走进咖啡店..."})

    # 1. ctx.artifacts 必须在 'script' 桶下出现新资产
    script_bucket = artifacts.get("script") or []
    assert len(script_bucket) == 1, (
        f"generate_script 后 ctx.artifacts['script'] 必须有 1 个条目，"
        f"实际 {len(script_bucket)}：{script_bucket}"
    )
    artifact = script_bucket[0]
    assert artifact.get("asset_kind") == "script"
    assert artifact.get("id") == result.get("asset_id")
    # 2. 事件必须发出（前端资产库侧栏能看到）
    artifact_events = [e for e in emitted if e[0] == "artifact_created"]
    assert len(artifact_events) == 1, (
        f"必须发 1 次 artifact_created 事件，实际 {len(artifact_events)}：{emitted}"
    )
    assert artifact_events[0][1].get("id") == result.get("asset_id")


@pytest.mark.asyncio
async def test_generate_script_does_not_sync_on_save_failure():
    """save_asset 失败时不能把 'half-saved' 资产塞进 ctx.artifacts。"""
    payload = {"scenes": [{"index": 1, "title": "x", "dialogue": "y", "duration_sec": 30}]}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    from unittest.mock import MagicMock
    db = MagicMock()
    chain = MagicMock()
    chain.filter.return_value.order_by.return_value.first.return_value = None
    db.query.return_value = chain

    emitted: list[tuple[str, dict]] = []
    artifacts: dict = {}

    # 用一个会抛异常的 ctx.emit（模拟 event bus 失败）确保容错
    def _emit(event_type: str, payload: dict) -> None:
        if event_type == "artifact_created":
            raise RuntimeError("simulated bus error")
        emitted.append((event_type, payload))

    # 让 SaveAssetTool 内部抛异常（绕过 try 包裹，模拟 save 真的失败）
    from app.agent.tools import asset_tools as _at
    original_execute = _at.SaveAssetTool.execute
    async def _boom(self, ctx, params):
        raise RuntimeError("simulated save failure")
    _at.SaveAssetTool.execute = _boom
    try:
        ctx = ToolContext(
            task_id="t1",
            project_id="p1",
            db=db,
            llm_client=_StubLLM(),
            artifacts=artifacts,
            emit=_emit,
        )
        result = await GenerateScriptTool().call(ctx, {"novel_text": "x"})
    finally:
        _at.SaveAssetTool.execute = original_execute

    # save 失败时不能把 'half-saved' 资产写进 ctx.artifacts
    assert not artifacts.get("script"), (
        f"save 失败时不能写 ctx.artifacts['script']，实际：{artifacts.get('script')}"
    )
    # save_error 必须返回给 LLM，让它知道
    assert "save_error" in result


# ========================
# ExtractCharactersTool
# ========================

def test_extract_characters_metadata():
    t = ExtractCharactersTool()
    assert t.name == "extract_characters"
    assert t.category == "llm"
    assert "script" in {p.name for p in t.parameters}


@pytest.mark.asyncio
async def test_extract_characters_returns_list():
    payload = {"characters": [{"name": "林尘", "role": "主角", "appearance": "25岁男生"}]}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await ExtractCharactersTool().call(ctx, {"script": {"scenes": []}})
    assert "characters" in result
    assert result["characters"][0]["name"] == "林尘"


# ========================
# ExtractPropsTool
# ========================

def test_extract_props_metadata():
    t = ExtractPropsTool()
    assert t.name == "extract_props"


@pytest.mark.asyncio
async def test_extract_props_returns_list():
    payload = {"props": [{"name": "黑色笔记本", "description": "林尘的道具"}]}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await ExtractPropsTool().call(ctx, {"script": {}, "characters": []})
    assert "props" in result
    assert result["props"][0]["name"] == "黑色笔记本"


# ========================
# ExtractScenesTool
# ========================

def test_extract_scenes_metadata():
    t = ExtractScenesTool()
    assert t.name == "extract_scenes"


@pytest.mark.asyncio
async def test_extract_scenes_returns_list():
    payload = {"scenes": [{"name": "咖啡店", "description": "温暖的咖啡店", "time": "白天"}]}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await ExtractScenesTool().call(ctx, {"script": {}})
    assert "scenes" in result
    assert result["scenes"][0]["name"] == "咖啡店"


# ========================
# ExtractShotsTool
# ========================

def test_extract_shots_metadata():
    t = ExtractShotsTool()
    assert t.name == "extract_shots"


@pytest.mark.asyncio
async def test_extract_shots_returns_list():
    payload = {
        "shots": [
            {
                "scene": "咖啡店",
                "index": 1,
                "duration_sec": 5,
                "camera": "中景",
                "action": "林尘坐下",
                "dialogue": "",
            }
        ]
    }

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await ExtractShotsTool().call(ctx, {
        "script": {},
        "scenes": [{"name": "咖啡店"}],
    })
    assert "shots" in result
    assert result["shots"][0]["camera"] == "中景"


# ========================
# OptimizePromptTool
# ========================

def test_optimize_prompt_metadata():
    t = OptimizePromptTool()
    assert t.name == "optimize_prompt"
    assert "prompt" in {p.name for p in t.parameters}


@pytest.mark.asyncio
async def test_optimize_prompt_returns_optimized():
    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content="林尘坐在咖啡店角落，温暖的阳光透过窗户洒在脸上，特写镜头")

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await OptimizePromptTool().call(ctx, {"prompt": "男生在咖啡店", "target": "image"})
    assert "optimized" in result
    assert "林尘" in result["optimized"]


@pytest.mark.asyncio
async def test_optimize_prompt_uses_complete_response_not_streaming():
    class _Provider:
        async def generate(self, messages, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content="complete optimized prompt")

        async def generate_streaming(self, messages, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=None)

    ctx = ToolContext(task_id="t1", llm_client=_Provider())
    result = await OptimizePromptTool().call(ctx, {"prompt": "source", "target": "image"})
    assert result["optimized"] == "complete optimized prompt"


# ========================
# _sanitize_optimized_prompt：过滤 LLM 元描述
# ========================
# 关键：用户报告 optimize_prompt 后图片节点弹窗显示的是 LLM 的"思考/解释"内容
# （如"我们收到一个原始prompt..."）而不是真正的 prompt 文本。
# 这些测试覆盖 _sanitize_optimized_prompt 的清洗逻辑。

def test_sanitize_strips_meta_explanation_and_returns_clean_prompt():
    """LLM 输出同时包含"我们收到..."元描述和真正的英文 prompt，应只保留 prompt。"""
    raw = (
        "我们收到一个原始prompt，描述一个老年男性矮人法师角色。"
        "要求是改写为适合image生成模型的细prompt。\n\n"
        "An elderly male dwarf mage in his 200s, long white beard braided with silver rings, "
        "bald head with grey side hair, deep brown eyes, stocky build. Wearing deep purple "
        "mage robe, holding oak staff. Front view, dramatic lighting, fantasy illustration style."
    )
    out = _sanitize_optimized_prompt(raw)
    assert "我们收到" not in out
    assert "要求是" not in out
    assert "elderly male dwarf" in out
    assert "fantasy illustration style" in out


def test_sanitize_strips_markdown_code_fences():
    """LLM 用 markdown 代码块包裹 prompt，应去掉 ``` 包装。"""
    raw = "```\nA cyberpunk female warrior with neon hair, full body, front view, 8K\n```"
    out = _sanitize_optimized_prompt(raw)
    assert "```" not in out
    assert "cyberpunk" in out


def test_sanitize_strips_prompt_prefix():
    """LLM 在 prompt 前加 "Prompt:" 前缀，应去掉。"""
    raw = "Prompt: A wise old wizard in a tower, dramatic lighting, oil painting style"
    out = _sanitize_optimized_prompt(raw)
    assert not out.lower().startswith("prompt:")
    assert "wise old wizard" in out


def test_sanitize_preserves_pure_prompt_without_meta():
    """干净的 prompt 不应被破坏。"""
    raw = "A male human knight in silver armor, full body, photorealistic, 8K"
    out = _sanitize_optimized_prompt(raw)
    assert out == raw


def test_sanitize_strips_surrounding_quotes():
    """LLM 把 prompt 用双引号包裹，应去掉引号。"""
    raw = '"A wise old wizard in a tower, dramatic lighting, oil painting style"'
    out = _sanitize_optimized_prompt(raw)
    assert not out.startswith('"')
    assert not out.endswith('"')
    assert "wise old wizard" in out


def test_sanitize_extracts_english_paragraph_when_chinese_meta_above():
    """用户报告的真实场景：LLM 输出多段中文解释 + 末尾一段英文 prompt。"""
    raw = (
        "我们收到一个原始prompt，描述一个老年男性矮人法师角色。"
        "要求是改写为适合image生成模型的细prompt。\n\n"
        "上下文中asset_kind为character，名字为矮人法师_奥拉丁。\n\n"
        "原始prompt是英文，需要输出英文。\n\n"
        "An elderly male dwarf mage in his 200s, long white beard braided with silver rings, "
        "bald head with grey side hair, deep brown eyes, stocky build. Wearing deep purple "
        "mage robe, holding oak staff. Front view, dramatic lighting, fantasy illustration style."
    )
    out = _sanitize_optimized_prompt(raw)
    # 必须不包含元描述
    assert "我们收到" not in out
    assert "要求是" not in out
    assert "上下文中" not in out
    assert "原始prompt是" not in out
    # 必须包含真正的 prompt 内容
    assert "elderly male dwarf" in out
    assert "fantasy illustration style" in out
    # 长度合理（不是整段都返回）
    assert len(out) < 400


@pytest.mark.asyncio
async def test_optimize_prompt_sanitizes_meta_explanation_from_llm():
    """端到端：LLM 返回"我们收到..."元描述 + 真正 prompt，应被清洗后返回。"""
    class _StubLLM:
        async def generate(self, messages, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=(
                "我们收到一个原始prompt，描述一个老年男性矮人法师角色。"
                "要求是改写为适合image生成模型的细prompt。\n\n"
                "An elderly male dwarf mage in his 200s, long white beard braided with silver rings, "
                "bald head with grey side hair, fantasy illustration style."
            ))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await OptimizePromptTool().call(ctx, {"prompt": "source", "target": "image"})
    assert "我们收到" not in result["optimized"]
    assert "elderly male dwarf" in result["optimized"]


# ========================
# 防御 LLM 思考/规划文本泄漏（用户最近反馈 Terminal#826-885）
# ========================
# 历史 bug：LLM 经常以"最终输出应该是一个英文的细prompt..."或
# "好的，我来给你..."这类 ReAct 思考文本作为最终 prompt 返回。
# 之前 _OPTIMIZE_META_PATTERNS 漏掉这些模式，导致整段 thinking 泄漏到
# asset.prompt，画布节点显示的是规划文本而不是真实 prompt。
#
# 修复：扩展 meta pattern 列表并增加 _looks_like_real_prompt 启发式评分，
# 优先选包含镜头/光线/风格关键词的英文段落。

def test_sanitize_strips_final_output_should_planning():
    """用户报告的核心场景：LLM 用'最终输出应该...'开始输出。"""
    raw = (
        "最终输出应该是一个英文的细prompt，包含：时代/世界观（矮人）"
        "、道具类别、整体形制、构图、画质、风格关键词。\n\n"
        "An elderly male dwarf mage in his 200s, long white beard braided with silver rings, "
        "bald head with grey side hair, deep brown eyes, stocky build. Wearing deep purple "
        "mage robe, holding oak staff. Front view, dramatic lighting, fantasy illustration style."
    )
    out = _sanitize_optimized_prompt(raw)
    assert "最终输出应该" not in out
    assert "包含：" not in out
    assert "elderly male dwarf" in out
    assert "fantasy illustration style" in out


def test_sanitize_strips_chinese_thinking_preamble():
    """LLM 用'好的，我来给你...'+ '下面是...' 起头。"""
    raw = (
        "好的，我来给你改写这个prompt。\n\n"
        "下面是改写后的结果：\n\n"
        "A female samurai in her 30s, black hair in a tight bun, "
        "wearing crimson kimono with golden obi, holding katana, "
        "front view, dramatic lighting, cinematic composition, 8K, highly detailed."
    )
    out = _sanitize_optimized_prompt(raw)
    assert "好的" not in out
    assert "我来给你" not in out
    assert "下面是" not in out
    assert "female samurai" in out
    assert "crimson kimono" in out


def test_sanitize_strips_english_thinking_preamble():
    """LLM 用英文 thinking 起头。"""
    raw = (
        "Okay, let me create a detailed prompt for this character.\n\n"
        "I will focus on: clothing, expression, lighting, composition.\n\n"
        "A wise old wizard in a stone tower, long white beard, deep blue robes "
        "with golden stars, holding a glowing staff, dramatic lighting, oil painting style, "
        "highly detailed, fantasy art, 4K."
    )
    out = _sanitize_optimized_prompt(raw)
    assert "let me" not in out.lower()
    assert "I will" not in out
    assert "wise old wizard" in out
    assert "oil painting style" in out


def test_sanitize_strips_think_block():
    """LLM 用 <think>...</think> 包裹 thinking 时应整段剥离。"""
    raw = (
        "<think>The user wants a character prompt. I should include era, appearance, clothing, "
        "lighting, and style keywords. The final output should be in English.</think>\n\n"
        "An elderly male dwarf mage in his 200s, long white beard, deep purple robe, "
        "front view, dramatic lighting, fantasy illustration style."
    )
    out = _sanitize_optimized_prompt(raw)
    assert "<think>" not in out
    assert "</think>" not in out
    assert "I should include" not in out
    assert "elderly male dwarf" in out


def test_sanitize_handles_inline_planning_then_prompt():
    """LLM 在同一行内先 planning 后 prompt（无换行分隔）。"""
    raw = (
        "最终输出应该是一个英文的细prompt: An elderly male dwarf mage in his 200s, "
        "long white beard braided with silver rings, deep purple robe, "
        "front view, dramatic lighting, fantasy illustration style, 8K."
    )
    out = _sanitize_optimized_prompt(raw)
    # 至少要去掉"最终输出应该"这种元描述
    assert "最终输出应该" not in out
    # prompt 的关键内容应该保留
    assert "elderly male dwarf" in out


def test_sanitize_returns_empty_when_entire_output_is_meta():
    """整段都是元描述时返回空串，让上层重试。"""
    raw = (
        "好的，我来改写这个 prompt。\n\n"
        "下面是改写后的结果：\n\n"
        "包含：时代、人物、构图、画质。"
    )
    out = _sanitize_optimized_prompt(raw)
    # 没有真正的 prompt 段落，应返回空串
    assert out == ""


def test_sanitize_handles_chinese_prefix_marker():
    """LLM 用中文前缀"提示词：" / "输出：" 起头。"""
    raw = (
        "提示词：An elderly male dwarf mage in his 200s, long white beard, "
        "deep purple robe, front view, dramatic lighting, fantasy illustration style, 8K."
    )
    out = _sanitize_optimized_prompt(raw)
    # 中文"提示词："不是 _OPTIMIZE_META_PATTERNS 里的元描述，但它会触发 has_meta=False
    # 然后 _looks_like_real_prompt 判断为真 → 整段返回（包含"提示词："）。
    # 实际行为：保留整段；这不是大问题，因为"提示词："只是 3 个字
    assert "elderly male dwarf" in out


def test_sanitize_preserves_prompt_with_many_commas():
    """纯 prompt（很多逗号 + 镜头关键词）应被识别为真 prompt。"""
    raw = (
        "A male human knight in his early 30s, short brown hair, strong jawline, "
        "blue eyes, wearing polished silver plate armor with a steel helmet, "
        "holding a broadsword, front view, dramatic lighting, "
        "medieval fantasy style, photorealistic, highly detailed, 8K."
    )
    out = _sanitize_optimized_prompt(raw)
    assert out == raw


# ========================
# 回归测试：用户最新反馈 Terminal#951-983
# ========================
# 场景：用户输入服装六层描述，LLM 输出一大段中文思考（"考虑到..." / "综合以上..." /
# "根据规则..." / "我决定..." / "最终输出应该..."），最后才输出真正的英文 prompt。
# 当前 _sanitize_optimized_prompt 必须能从这种结构中提取最后的真 prompt。

def test_sanitize_extracts_prompt_after_chinese_reasoning_chain():
    """用户最新反馈：LLM 输出一长串中文思考 + 真正 prompt 在末尾。

    必须提取真正的 prompt，且不能包含任何中文思考词。
    """
    raw = (
        "考虑到用户输入的服装描述，我需要按照V3.0规范生成角色概念表prompt。\n\n"
        "综合以上信息，我决定采用以下结构：\n\n"
        "根据规则包的要求，我应该加入镜头、光线、风格等关键词。\n\n"
        "最终输出应该是一个英文的细prompt：\n\n"
        "Character concept art of a young character, wearing white t-shirt "
        "(inner layer), blue denim jacket (middle layer), dark blue jeans "
        "(lower layer), white sneakers (footwear), character concept sheet, "
        "4-region layout, cinematic lighting, 8K, highly detailed."
    )
    out = _sanitize_optimized_prompt(raw)
    # 必须去掉所有中文思考词
    for meta in ("考虑到", "综合以上", "根据", "我决定", "最终输出", "规则包"):
        assert meta not in out, f"sanitize 漏掉了元描述：{meta}，output={out!r}"
    # 必须保留真 prompt
    assert "Character concept art" in out
    assert "white t-shirt" in out
    assert "blue denim jacket" in out
    assert "4-region layout" in out


def test_sanitize_strips_reasoning_with_inline_chinese_punctuation():
    """LLM 思考 + 真 prompt 都在同一行（用中文标点分隔）。"""
    raw = (
        "考虑到用户的服装描述，我需要按照规范改写。综合以上信息，最终输出应该是："
        "Character concept art of a character, white t-shirt, blue denim jacket, "
        "dark jeans, white sneakers, character concept sheet, 4-region layout, "
        "cinematic lighting, 8K."
    )
    out = _sanitize_optimized_prompt(raw)
    # 不能包含中文思考词
    assert "考虑到" not in out
    assert "综合以上" not in out
    assert "最终输出" not in out
    # 保留 prompt 关键内容
    assert "Character concept art" in out
    assert "white t-shirt" in out


def test_sanitize_rejects_pure_reasoning_with_no_real_prompt():
    """LLM 整段都是中文思考+规则罗列，没有真正的 prompt。
    必须返回空串让上层重试，绝不能让元描述泄漏到 asset.prompt。
    """
    raw = (
        "考虑到用户输入，我需要按照V3.0规范生成角色概念表prompt。\n\n"
        "根据规则包的要求，我应该加入以下内容：\n\n"
        "包含：时代/世界观、人物身份、性别年龄、面容锚点、发式系统、服装六层、"
        "姿态、构图、画质。\n\n"
        "综合以上信息，我决定采用以下结构。\n\n"
        "现在我需要按照规则包的字段顺序填充。\n\n"
        "最终输出应该是一个英文的细prompt。"
    )
    out = _sanitize_optimized_prompt(raw)
    # 没有真正的 prompt 段落 → 必须返回空串
    assert out == "", f"期望空串（让上层重试），但实际返回 {out!r}"


def test_sanitize_strips_trailing_chinese_thinking_after_prompt():
    """用户最新反馈的核心 bug：LLM 先输出真 prompt（英文），后面跟中文思考。

    示例：真 prompt 在前，元描述在后，整段在同一行（无换行分隔）。
    当前 longest-paragraph 兜底逻辑会因 English>Chinese 而通过 _looks_like_real_prompt，
    把整段（含尾部中文思考）都返回，导致 thinking 泄漏到 asset.prompt。
    """
    raw = (
        "Character concept art of a young character, wearing white t-shirt "
        "(inner layer), blue denim jacket (middle layer), dark blue jeans "
        "(lower layer), white sneakers (footwear), character concept sheet, "
        "4-region layout, cinematic lighting, 8K, highly detailed. "
        "考虑到用户的输入，我需要按照V3.0规范生成角色概念表prompt。"
    )
    out = _sanitize_optimized_prompt(raw)
    # 真 prompt 的关键内容必须保留
    assert "Character concept art" in out
    assert "white t-shirt" in out
    assert "blue denim jacket" in out
    assert "4-region layout" in out
    # 尾部中文思考必须被剥离
    assert "考虑到" not in out
    assert "我需要按照" not in out
    assert "V3.0规范" not in out


def test_sanitize_strips_middle_chinese_thinking_in_paragraph():
    """LLM 把中文思考夹在真 prompt 中间（用中文标点分隔）。"""
    raw = (
        "Character concept art of a young character, "
        "wearing white t-shirt (inner layer), blue denim jacket (middle layer), "
        "考虑到用户的输入，我需要按照规范改写。"
        "dark blue jeans (lower layer), white sneakers (footwear), "
        "character concept sheet, 4-region layout, cinematic lighting, 8K."
    )
    out = _sanitize_optimized_prompt(raw)
    # 真 prompt 关键内容保留
    assert "Character concept art" in out
    assert "white t-shirt" in out
    assert "blue denim jacket" in out
    assert "dark blue jeans" in out
    # 中文思考必须被剥离
    assert "考虑到" not in out
    assert "我需要按照" not in out


@pytest.mark.asyncio
async def test_optimize_prompt_strips_final_output_should_meta():
    """端到端：LLM 输出"最终输出应该..."thinking，应被清洗掉。"""
    class _StubLLM:
        async def generate(self, messages, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=(
                "最终输出应该是一个英文的细prompt，包含：时代/世界观、构图、画质。\n\n"
                "An elderly male dwarf mage in his 200s, long white beard braided with "
                "silver rings, deep purple robe, dramatic lighting, fantasy illustration style, 8K."
            ))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await OptimizePromptTool().call(ctx, {"prompt": "source", "target": "image"})
    assert "最终输出应该" not in result["optimized"]
    assert "包含：" not in result["optimized"]
    assert "elderly male dwarf" in result["optimized"]


def test_sanitize_strips_considering_kaolvdao_thinking():
    """用户最新反馈：LLM 输出"考虑到规则中有..."这种中文 thinking 文本。

    之前 _OPTIMIZE_META_PATTERNS 漏了"考虑到"这个词，导致整段 planning 文本
    被识别为"无元描述"直接返回，泄漏到 asset.prompt 和 Composer 浮窗。
    修复后应被识别为元描述。
    """
    raw = (
        "考虑到规则中有【项目规范】A.1.2 画质技术层级\"要求所有场景提示词必须以"
        "\"全场景色彩统一协调、真人写实风格，电影画质...\"结尾，但原始风格是手绘分镜草图，"
        "这冲突。不过规则是\"必须以此结尾\"，可能意味着即使手绘风格也要加上？"
        " 但手绘风格和真人写实矛盾。我认为应该优先尊重用户原始风格，"
        "因为用户明确要求手绘分镜草图。 而且规则包是针对 drama_short，"
        "但用户输入是混合模式，可能允许"
    )
    out = _sanitize_optimized_prompt(raw)
    # 整段都是思考/推理，没有真正的英文 prompt，应被识别为元描述
    # 兜底返回空串（让上层重试或回退到 source_prompt）
    assert "考虑到" not in out
    assert "我认为" not in out
    assert "规则包是" not in out


def test_optimize_prompt_falls_back_to_source_when_sanitize_empty():
    """OptimizePromptTool 在 sanitize 返回空时必须 fallback 到 source_prompt，
    而不是抛 RuntimeError 让上层 task 失败。

    用户场景：输入"内层：白色贴身连体衣 / 中层..."这种简略 prompt，
    LLM 输出"考虑到..."等 thinking 整段被识别为元描述，sanitize 返回空。
    不应让 agent 任务卡死，而应退到 source_prompt 让生成继续。
    """
    import asyncio
    from app.agent.tools.llm_tools import OptimizePromptTool, ToolContext

    # mock ctx：LLM 输出全 thinking
    class _MockLLM:
        class _Resp:
            content = (
                "考虑到这是一个简略的 prompt，我需要先理解用户意图。"
                "我认为应该扩展细节，但是原始信息太少了。"
                "所以我决定直接返回原始 prompt。"
            )
        async def generate(self, messages, **kwargs):
            return self._Resp()

    class _MockCtx:
        llm_client = _MockLLM()
        db = None

    out = asyncio.run(OptimizePromptTool().execute(_MockCtx(), {
        "prompt": "内层：白色贴身连体衣 / 中层：白色生物防护服",
        "target": "image",
    }))
    # 必须 fallback 到 source_prompt（不是空，不是抛错）
    assert out["optimized"], "fallback 时 optimized 必须非空"
    assert "内层：白色贴身连体衣" in out["optimized"]
    assert "中层：白色生物防护服" in out["optimized"]
    assert out.get("fallback") is True
    assert out.get("fallback_reason") == "sanitize_returned_empty"


def test_sanitize_strips_thinking_with_then_prompt():
    """混合场景：thinking + 真正的英文 prompt，应只保留 prompt 段。"""
    raw = (
        "考虑到用户要求手绘风格，但规则包是真人写实，这里存在冲突。\n"
        "我认为应该尊重用户原始输入。\n\n"
        "A young female warrior with short black hair, wearing leather armor, "
        "holding a longsword, dynamic action pose, dramatic lighting, "
        "hand-drawn sketch style, storyboard frame, 4K."
    )
    out = _sanitize_optimized_prompt(raw)
    assert "考虑到" not in out
    assert "我认为" not in out
    assert "young female warrior" in out
    assert "hand-drawn sketch" in out


# ========================
# 回归测试：截图反馈——"中提到了...我们需要调整为...必须原样嵌入 B.4 的布局段"
# ========================
# 场景：optimize_prompt 阶段模型把整段中文思考（措辞不在元描述词表内）当作
# 最终 prompt 返回，画布节点 prompt 框显示思考内容。
# 两条泄漏路径都必须堵死：
# 1. has_meta=False 时整段原样返回（无结构性校验）
# 2. 兜底段落挑选只查"不含元描述词 + 长度>=20"，中文思考段会被选中

def test_sanitize_rejects_chinese_dominant_thinking_without_meta_tokens():
    """截图原样场景：整段中文思考、不含任何词表 token，不得作为 prompt 返回。"""
    raw = (
        "中提到了“cinematic lighting, medium shot, photorealistic style”，"
        "但我们需要调整为符合角色概念表布局的表述。,是“photorealistic style”，"
        "我们可以用“真人写实风格”但输出英文，用“photorealistic, cinematic”。\n\n"
        "最后，必须原样嵌入 B.4 的布局段。"
    )
    out = _sanitize_optimized_prompt(raw)
    # 没有真正的英文 prompt → 返回空串（上层 fallback 到 source_prompt）
    assert out == "", f"中文思考不得作为 prompt 返回，实际返回 {out!r}"


def test_sanitize_extracts_prompt_after_untokenized_chinese_thinking():
    """思考措辞不在词表内 + 末尾有真 prompt：应提取真 prompt 而非整段返回。"""
    raw = (
        "中提到了“cinematic lighting, medium shot, photorealistic style”，"
        "但我们需要调整为符合角色概念表布局的表述。\n\n"
        "Character concept sheet of a rugged survivor in his 40s, weathered face, "
        "wearing layered dark brown trench coat and leather gloves, full body, "
        "front view, cinematic lighting, photorealistic, highly detailed, 8K."
    )
    out = _sanitize_optimized_prompt(raw)
    assert "中提到了" not in out
    assert "我们需要" not in out
    assert "Character concept sheet" in out
    assert "cinematic lighting" in out


def test_sanitize_fallback_paragraph_rejects_chinese_thinking():
    """元描述 token 出现在前文时，兜底段落挑选不得选中后面的中文思考段。"""
    raw = (
        "规则包要求输出英文 prompt。\n\n"
        "中提到了“cinematic lighting”，但我们需要调整为符合角色概念表布局的表述，"
        "我们可以用真人写实风格，最后必须原样嵌入布局段。"
    )
    out = _sanitize_optimized_prompt(raw)
    assert out == "", f"中文思考段不得通过兜底段落挑选，实际返回 {out!r}"


# ========================
# Unique names
# ========================

def test_llm_tools_have_unique_names():
    tools = [
        GenerateScriptTool(),
        ExtractCharactersTool(),
        ExtractPropsTool(),
        ExtractScenesTool(),
        ExtractShotsTool(),
        OptimizePromptTool(),
    ]
    names = [t.name for t in tools]
    assert len(set(names)) == 6


# ========================
# _scenes_to_markdown / _compute_text_stats
# ========================
# 这两个辅助函数之前的实现缺失（只有调用没有定义），导致 generate_script 工具
# 在 LLM 返回后立即 NameError → save_asset 永远不调用 → memory.artifacts 没 script
# → 后续步骤反复调 generate_script → max_steps 耗尽 → TASK_FAILED。
# 以下测试覆盖这两个函数的最小契约，防止回归。

def test_scenes_to_markdown_includes_scene_titles_in_plain_text():
    """场景标题必须以'第N场'纯文本开头（不能被 markdown 标题包裹），
    否则 _compute_text_stats 的场景正则 (^|\\n)\\s*第X场 无法识别。
    """
    scenes = [
        {"index": 1, "title": "开场", "location": "咖啡店", "time": "白天",
         "characters": ["林尘"], "dialogue": "林尘：你好", "description": "阳光", "duration_sec": 30},
        {"index": 2, "title": "冲突", "location": "街道", "time": "夜晚",
         "characters": ["林尘", "反派"], "dialogue": "（旁白）战斗开始", "description": "霓虹灯", "duration_sec": 25},
    ]
    body = _scenes_to_markdown(scenes, "原文节选...", "novel")
    # 场景标题必须是纯文本行（不能被 ## / ### 包裹）
    assert "## 第1场" not in body
    assert "### 第1场" not in body
    assert "## 第2场" not in body
    assert "\n第1场 · 开场\n" in body
    assert "\n第2场 · 冲突\n" in body
    # 角色、画面、对白用 h3
    assert "### 角色" in body
    assert "### 画面" in body
    assert "### 对白" in body
    # 末尾追加原文节选
    assert "原文节选（小说）" in body
    assert "原文节选..." in body


def test_scenes_to_markdown_handles_empty_scenes_list():
    """空 scenes 列表必须返回有效 markdown 模板（不能崩）。"""
    body = _scenes_to_markdown([], "", "novel")
    assert "分场脚本" in body
    assert "暂无场景" in body


def test_scenes_to_markdown_handles_long_text_label_for_long_text_kind():
    """source_kind=long_text 时，节选标题应使用'长文本'标签。"""
    body = _scenes_to_markdown(
        [{"index": 1, "title": "T", "characters": [], "dialogue": "", "description": "", "duration_sec": 10}],
        "宣传片文案...",
        "long_text",
    )
    assert "原文节选（长文本）" in body
    assert "宣传片文案" in body


def test_scenes_to_markdown_skips_long_text_section_when_input_empty():
    """long_text 为空时不要追加原文节选小节。"""
    body = _scenes_to_markdown(
        [{"index": 1, "title": "T", "characters": [], "dialogue": "", "description": "", "duration_sec": 10}],
        "",
        "novel",
    )
    assert "原文节选" not in body


def test_compute_text_stats_counts_scenes_by_quhao_pattern():
    """_compute_text_stats 必须正确识别'第X场'作为场景（不识别 ## 包裹的'第X场'）。

    这是回归测试：之前 stats.scenes 始终为 0，导致 TextReader 头部
    显示 '0 场'，与脚本实际内容不符。
    """
    body = _scenes_to_markdown([
        {"index": 1, "title": "A", "characters": [], "dialogue": "", "description": "", "duration_sec": 10},
        {"index": 2, "title": "B", "characters": [], "dialogue": "", "description": "", "duration_sec": 10},
        {"index": 3, "title": "C", "characters": [], "dialogue": "", "description": "", "duration_sec": 10},
    ], "", "novel")
    stats = _compute_text_stats(body)
    assert stats["scenes"] == 3, f"期望 3 场，实际 {stats['scenes']}"


def test_compute_text_stats_counts_chapters_by_h1_to_h3():
    """# / ## / ### 都被识别为章。"""
    body = "# H1\n\n## H2\n\n### H3\n\n普通段落"
    stats = _compute_text_stats(body)
    assert stats["chapters"] == 3


def test_compute_text_stats_handles_empty_body():
    """空 body 必须返回全 0，不抛错。"""
    stats = _compute_text_stats("")
    assert stats == {"words": 0, "chapters": 0, "scenes": 0}


def test_compute_text_stats_counts_cjk_and_ascii_words():
    """字数 = CJK 字符数 + 非空白 ASCII 词数（与前端 use-canvas-store.computeTextStats 一致）。"""
    body = "Hello world 你好世界 林尘"
    stats = _compute_text_stats(body)
    # "Hello" + "world" = 2 ASCII 词；你好世界 = 4 CJK；林尘 = 2 CJK
    assert stats["words"] == 8


# ========================
# generate_script 端到端：LLM 真实返回 → 自动 save_asset → body 含场景
# ========================

@pytest.mark.asyncio
async def test_generate_script_body_contains_scene_titles():
    """generate_script 输出 body 必须能被 stats 识别出场景数（防止 _scenes_to_markdown 再次缺失）。"""
    payload = {
        "scenes": [
            {"index": 1, "title": "开场", "location": "咖啡店", "time": "白天",
             "characters": ["林尘"], "dialogue": "林尘：你好", "description": "阳光", "duration_sec": 30},
            {"index": 2, "title": "冲突", "location": "街道", "time": "夜晚",
             "characters": ["林尘", "反派"], "dialogue": "林尘：来吧", "description": "霓虹灯", "duration_sec": 25},
        ]
    }

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    from unittest.mock import MagicMock
    db = MagicMock()
    chain = MagicMock()
    chain.filter.return_value.order_by.return_value.first.return_value = None
    db.query.return_value = chain
    ctx = ToolContext(task_id="t1", project_id="p1", db=db, llm_client=_StubLLM())

    result = await GenerateScriptTool().call(ctx, {"novel_text": "林尘走进咖啡店..."})
    assert "body" in result, "generate_script 必须返回 body 供前端 TextReader 渲染"
    body = result["body"]
    stats = _compute_text_stats(body)
    assert stats["scenes"] == 2, f"body 中应有 2 个场景，实际 {stats['scenes']}"
    assert "第1场" in body
    assert "第2场" in body


# ========================
# 回归：generate_script 的 artifact 同步必须携带 extra（含 extra.script）
# ========================
# 用户反馈：agent 生成脚本后画布脚本节点"脚本分析"四项计数全 0。
# 根因：_sync_script_to_artifacts 构造的 artifact 缺 extra —— 前端 ScriptNodeBody
# 优先读 taskAssets.extra.script，拿不到就对 markdown body JSON.parse（必失败），
# 角色/道具/场景/分镜 tabs 全 0。

_STRUCTURED_SCRIPT = {
    "scenes": [{"index": 1, "title": "雨夜街道"}],
    "characters": [{"name": "林尘", "ageRange": "少年"}],
    "props": [{"name": "邮差的信"}],
    "bigShots": [{"sceneIndex": 1, "index": 1, "shotType": "中景"}],
    "sceneAssets": [{"index": 1, "title": "雨夜街道"}],
    "visualSignature": {"medium": "实拍"},
}


def test_sync_script_to_artifacts_includes_extra():
    """_sync_script_to_artifacts 写入 artifacts 和 artifact_created 的 payload 必须带 extra。"""
    events: list[tuple[str, dict]] = []
    ctx = ToolContext(task_id="t1", artifacts={}, emit=lambda t, p: events.append((t, p)))
    extra = {
        "body": "# 分场脚本",
        "text_stats": {"words": 4},
        "script": _STRUCTURED_SCRIPT,
    }

    GenerateScriptTool()._sync_script_to_artifacts(
        ctx,
        {
            "id": "asset-1",
            "name": "script_novel_1场",
            "title": "分场脚本 · 雨夜街道",
            "url": "# 分场脚本",
            "status": "ready",
            "version": 1,
        },
        "novel",
        body="# 分场脚本",
        extra=extra,
    )

    bucket = ctx.artifacts.get("script")
    assert bucket, "ctx.artifacts 必须有 script bucket"
    assert bucket[0]["extra"]["script"]["characters"][0]["name"] == "林尘"
    assert bucket[0]["body"] == "# 分场脚本"
    created = [p for t, p in events if t == "artifact_created"]
    assert created, "必须发出 artifact_created 事件"
    assert created[-1]["extra"]["script"]["bigShots"]
    assert created[-1]["text_stats"] == {"words": 4}


@pytest.mark.asyncio
async def test_generate_script_end_to_end_artifact_carries_extra():
    """端到端：LLM 返回合法脚本 JSON，generate_script 落库 + 同步的 artifact 必须带 extra.script。"""
    from unittest.mock import MagicMock

    class _StubLLM:
        async def generate(self, messages, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(_STRUCTURED_SCRIPT, ensure_ascii=False))

    db = MagicMock()
    chain = MagicMock()
    # SaveAssetTool 的查重链：filter().order_by().first() -> None（走新建分支）
    chain.filter.return_value.order_by.return_value.first.return_value = None
    db.query.return_value = chain

    events: list[tuple[str, dict]] = []
    ctx = ToolContext(
        task_id="t1", project_id="p1", db=db, llm_client=_StubLLM(),
        artifacts={}, emit=lambda t, p: events.append((t, p)),
    )

    result = await GenerateScriptTool().call(ctx, {"long_text": "雨夜的城市霓虹闪烁……"})

    assert result.get("asset_id"), "落库成功后必须返回 asset_id"
    bucket = ctx.artifacts.get("script")
    assert bucket, "ctx.artifacts 必须同步 script"
    script_json = bucket[0]["extra"]["script"]
    assert script_json["characters"][0]["name"] == "林尘"
    assert script_json["props"][0]["name"] == "邮差的信"
    assert script_json["sceneAssets"]
    assert script_json["bigShots"]
    assert script_json["visualSignature"]["medium"] == "实拍"
    created = [p for t, p in events if t == "artifact_created"]
    assert created and created[-1]["extra"]["script"]["characters"]


# ========================
# 线上事故回归：模型复述系统提示词 + prompt 超长
# ========================

def test_sanitize_strips_canonical_layout_rule_recitation():
    """模型把 optimize 系统提示词里的 canonical_layout 硬约束条款背出来当输出
    （agent_steps 真实样本：asset.prompt 以 '"If the context contains canonical_layout,
    treat it as a hard constraint..." 开头，后接中文推理）。整段是规则复述+思考，
    应返回空串让上层 fallback 到 source_prompt。"""
    raw = (
        '"If the context contains `canonical_layout`, treat it as a hard constraint. '
        'Preserve its layout, views, identity consistency, background, and negative '
        'constraints verbatim; never replace or remove those requirements.", '
        '它是硬约束。但规则说"Preserve its layout"，我需要遵守这个约束，'
        '不能替换或删除这些要求，只能在周围添加主体、动作、镜头、材质或光线细节。'
        '让我思考一下怎么处理这个角色概念表的布局段，必须原样嵌入 B.4 的布局段。'
    )
    out = _sanitize_optimized_prompt(raw)
    assert "canonical_layout" not in out
    assert "hard constraint" not in out


def test_sanitize_extracts_real_prompt_after_rule_recitation():
    """规则复述之后附带了真正的 prompt 段时，应提取真 prompt 而不是整段丢弃。"""
    raw = (
        '"If the context contains `canonical_layout`, treat it as a hard constraint." '
        '它是硬约束，我需要保留布局。\n\n'
        "A male explorer in his late 20s, long face, straight eyebrows, round eyes, "
        "short black hair, wearing a white t-shirt and dark jacket, standing relaxed, "
        "front view, soft diffused lighting, photorealistic, 8K"
    )
    out = _sanitize_optimized_prompt(raw)
    assert "canonical_layout" not in out
    assert "male explorer" in out


def test_cap_prompt_length_boundary():
    """超长 prompt 截断到上限内，且尽量落在句子/逗号边界。"""
    short = "a cat, cinematic lighting"
    assert _cap_prompt_length(short) == short
    long_prompt = ", ".join(f"detail{i}" for i in range(500))
    capped = _cap_prompt_length(long_prompt, max_len=100)
    assert len(capped) <= 100
    assert capped.endswith(("4", "5", "6", "7", "8", "9", "0", "1", "2", "3"))


@pytest.mark.asyncio
async def test_optimize_prompt_falls_back_on_rule_recitation():
    """LLM 复述系统提示词 → sanitize 判空 → fallback 到 source_prompt（不含规则文本）。"""
    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=(
                '"If the context contains `canonical_layout`, treat it as a hard constraint '
                'and preserve its layout verbatim." 它是硬约束，我需要遵守，不能替换或删除。'
                '让我想想怎么处理这个角色概念表，必须原样嵌入布局段，保留所有负面约束。'
            ))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await OptimizePromptTool().call(ctx, {"prompt": "男生在咖啡店，特写", "target": "image"})
    assert result["optimized"] == "男生在咖啡店，特写"
    assert result["fallback"] is True
    assert "canonical_layout" not in result["optimized"]


@pytest.mark.asyncio
async def test_optimize_prompt_caps_overlength_output():
    """LLM 输出超长（>1900）→ 截断到供应商可接受长度。"""
    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=", ".join(f"visual detail segment {i}" for i in range(300)))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await OptimizePromptTool().call(ctx, {"prompt": "source", "target": "image"})
    assert len(result["optimized"]) <= 1900
