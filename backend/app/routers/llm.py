"""LLM 文本生成代理 — 提示词优化等场景前端不再直连供应商。

与 /api/media/generate/* 同一思路：api_key 只存后端 DB（provider_configs），
前端 POST { provider_id, model, prompt, system_instruction } 到这里，
后端用明文 key 调供应商 /v1/chat/completions（非流式），返回纯文本。

背景：前端直连时 store 里的 apiKey 可能是空值（后端列表脱敏后清空）
或 localStorage 里的过期值，上游网关会返 401"无效的令牌"。
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from .media import _load_provider, _strip_v1_suffix, _headers

router = APIRouter()
logger = logging.getLogger("dramaforge.llm")


class LlmGenerateIn(BaseModel):
    provider_id: str
    model: str
    prompt: str
    system_instruction: str = ""
    temperature: float = 0.7
    max_tokens: int = 8192


class LlmGenerateOut(BaseModel):
    text: str
    provider_id: str
    model: str


def _extract_text(data: dict) -> str:
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # 多段 content（part 格式）
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""


@router.post("/generate", response_model=LlmGenerateOut)
async def generate_text(body: LlmGenerateIn, db: Session = Depends(get_db)):
    provider = _load_provider(db, body.provider_id)
    if provider.get("protocol") == "gemini":
        raise HTTPException(status_code=501, detail="gemini chat not yet implemented on backend proxy")
    base = _strip_v1_suffix(provider["base_url"])
    url = f"{base}/v1/chat/completions"
    messages = []
    if body.system_instruction:
        messages.append({"role": "system", "content": body.system_instruction})
    messages.append({"role": "user", "content": body.prompt})
    payload = {
        "model": body.model,
        "messages": messages,
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as cx:
            r = await cx.post(url, headers=_headers(provider), json=payload)
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"llm provider '{provider['provider_id']}' network error: {e}",
        )
    if r.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"llm provider '{provider['provider_id']}' model '{body.model}' HTTP {r.status_code} at {url}: {r.text[:300]}",
        )
    try:
        data = r.json()
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"llm API returned invalid JSON: {e}")
    text = _extract_text(data)
    if not text:
        raise HTTPException(status_code=502, detail=f"llm API returned no text: {str(data)[:300]}")
    return LlmGenerateOut(text=text, provider_id=provider["provider_id"], model=body.model)
