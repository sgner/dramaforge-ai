"""Tests for OpenAICompatibleLLMClient.

覆盖：请求 URL/headers/body schema、tool_call 解析、tools 参数传递、
401 不重试、5xx 重试 1 次、generate_structured 传 response_format。
"""
import asyncio
import json

import pytest
import respx
from httpx import Response

from app.agent.llm import LLMError
from app.agent.openai_llm_client import OpenAICompatibleLLMClient


@pytest.fixture
def client():
    return OpenAICompatibleLLMClient(
        base_url="https://api.openai.com",
        api_key="sk-test-123",
        model="gpt-4o-mini",
        timeout_sec=5.0,
    )


def test_generate_sends_chat_completions_request(client):
    """验证请求 URL、headers、body schema 正确。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(
            return_value=Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": "hi", "tool_calls": None}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            })
        )
        r = asyncio.run(client.generate([
            {"role": "user", "content": "hello"}
        ]))
        assert r.content == "hi"
        assert r.prompt_tokens == 10
        assert r.completion_tokens == 5
        # 验证请求体
        sent = route.calls.last.request
        assert sent.headers["authorization"] == "Bearer sk-test-123"
        body = json.loads(sent.content)
        assert body["model"] == "gpt-4o-mini"
        assert body["messages"] == [{"role": "user", "content": "hello"}]
        assert body["stream"] is False


def test_generate_parses_tool_call_response(client):
    """验证 OpenAI tool_calls 格式解析为 (tool_name, tool_args, content)。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        mock.post("/v1/chat/completions").mock(
            return_value=Response(200, json={
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "finish_task",
                                "arguments": json.dumps({"summary": "all done"})
                            }
                        }]
                    }
                }],
                "usage": {"prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28},
            })
        )
        r = asyncio.run(client.generate([{"role": "user", "content": "go"}]))
        assert r.tool_name == "finish_task"
        assert r.tool_args == {"summary": "all done"}


def test_generate_passes_tools_to_request(client):
    """tools 参数必须被加进 body.tools。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(
            return_value=Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": "ok"}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            })
        )
        tools = [{
            "type": "function",
            "function": {
                "name": "create_plan",
                "description": "Make a plan",
                "parameters": {"type": "object", "properties": {"steps": {"type": "array"}}}
            }
        }]
        asyncio.run(client.generate([{"role": "user", "content": "x"}], tools=tools))
        body = json.loads(route.calls.last.request.content)
        assert body["tools"] == tools


def test_generate_raises_on_401(client):
    """401 立刻 raise，不 retry。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(return_value=Response(401, json={"error": "bad key"}))
        with pytest.raises(LLMError, match="401"):
            asyncio.run(client.generate([{"role": "user", "content": "x"}]))
        # 4xx 不 retry — 只能调 1 次
        assert route.call_count == 1


def test_generate_retries_on_5xx_then_succeeds(client):
    """5xx retry 1 次后成功。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(side_effect=[
            Response(503, json={"error": "overloaded"}),
            Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": "retry-ok"}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            }),
        ])
        r = asyncio.run(client.generate([{"role": "user", "content": "x"}]))
        assert r.content == "retry-ok"
        assert route.call_count == 2


def test_generate_structured_sets_json_response_format(client):
    """generate_structured 必须传 response_format=json_object。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(
            return_value=Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": '{"a": 1}'}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            })
        )
        r = asyncio.run(client.generate_structured(
            [{"role": "user", "content": "give json"}],
            json_schema={"type": "object", "properties": {"a": {"type": "integer"}}}
        ))
        body = json.loads(route.calls.last.request.content)
        assert body["response_format"] == {"type": "json_object"}
        assert r.content == '{"a": 1}'
