"""LLMClient 抽象测试。"""
import asyncio
import json
import pytest

from app.agent.llm import (
    LLMClient,
    LLMResponse,
    LLMError,
    _parse_function_call,
    build_system_prompt,
    build_react_prompt,
)


# ========================
# 解析 Function Call 测试
# ========================

def test_parse_function_call_with_tool_call():
    """解析带 tool_calls 的响应。"""
    raw = {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "function": {"name": "generate_script", "arguments": '{"raw_novel_text": "abc"}'}
                }],
            }
        }]
    }
    name, args, content = _parse_function_call(raw)
    assert name == "generate_script"
    assert args == {"raw_novel_text": "abc"}
    assert content is None


def test_parse_function_call_with_text():
    """解析纯文本响应。"""
    raw = {"choices": [{"message": {"role": "assistant", "content": "纯文本回复"}}]}
    name, args, content = _parse_function_call(raw)
    assert name is None
    assert args is None
    assert content == "纯文本回复"


def test_parse_function_call_invalid_json_args():
    """参数 JSON 损坏时返回错误。"""
    raw = {"choices": [{"message": {"tool_calls": [{"function": {"name": "x", "arguments": "not json"}}]}}]}
    with pytest.raises(LLMError):
        _parse_function_call(raw)


# ========================
# Prompt 构建测试
# ========================

def test_build_system_prompt_contains_role():
    """系统 prompt 包含导演角色。"""
    p = build_system_prompt()
    assert "导演" in p or "director" in p.lower()


def test_build_react_prompt_includes_goal():
    """ReAct prompt 包含用户目标。"""
    p = build_react_prompt(
        user_goal="把这段小说变 1 分钟短剧",
        plan=[{"step": 1, "tool": "generate_script"}],
        artifacts={"characters": []},
        recent_steps=[],
        tool_summaries=[{"name": "generate_script", "description": "生成脚本"}],
    )
    assert "把这段小说变 1 分钟短剧" in p
    assert "generate_script" in p


def test_build_react_prompt_includes_artifacts():
    """ReAct prompt 包含已生成资产摘要。"""
    p = build_react_prompt(
        user_goal="x",
        plan=[],
        artifacts={"characters": [{"name": "林尘"}]},
        recent_steps=[],
        tool_summaries=[],
    )
    assert "林尘" in p


def test_build_react_prompt_includes_recent_steps():
    """ReAct prompt 包含最近步骤。"""
    p = build_react_prompt(
        user_goal="x",
        plan=[],
        artifacts={},
        recent_steps=[{"step_number": 1, "thought": "我先做X", "action": {"tool": "a"}, "status": "success"}],
        tool_summaries=[],
    )
    assert "我先做X" in p
    assert "success" in p.lower()


def test_build_react_prompt_includes_user_response_observation():
    """用户回答 ask_user 后，下一轮 LLM 必须能看到回答内容。"""
    p = build_react_prompt(
        user_goal="郑明传奇",
        plan=[],
        artifacts={},
        recent_steps=[{
            "step_number": 2,
            "thought": "等待用户补充信息",
            "action": {"tool": "ask_user"},
            "observation": {
                "success": True,
                "user_response": {"response": "郑明传奇"},
            },
            "status": "success",
        }],
        tool_summaries=[],
    )
    assert "郑明传奇" in p
    assert "user_response" in p


def test_build_react_prompt_includes_tool_parameter_schema():
    """ReAct prompt 必须把工具参数名 / 类型 / 必填告诉 LLM，
    否则 LLM 会瞎猜参数名（如把 user_input 写成 user_text），工具 validate 失败 → 死循环。
    """
    p = build_react_prompt(
        user_goal="长相思",
        plan=[],
        artifacts={},
        recent_steps=[],
        tool_summaries=[
            {
                "name": "parse_user_goal",
                "description": "解析用户原话为结构化目标",
                "parameters": [
                    {
                        "name": "user_text",
                        "type": "string",
                        "description": "用户原话",
                        "required": True,
                    },
                ],
            },
        ],
    )
    # 工具名 / 描述
    assert "parse_user_goal" in p
    assert "解析用户原话" in p
    # 参数名（关键！缺这个 LLM 会猜错）
    assert "user_text" in p
    # 参数类型
    assert "string" in p
    # 必填标记
    assert "必填" in p
    # 参数描述
    assert "用户原话" in p


# ========================
# LLMClient 协议测试
# ========================

def test_llm_response_dataclass():
    """LLMResponse 字段。"""
    r = LLMResponse(
        content="hi", tool_name=None, tool_args=None,
        model="gpt-4o", prompt_tokens=10, completion_tokens=20, cost_usd=0.001,
    )
    assert r.content == "hi"
    assert r.total_tokens == 30
