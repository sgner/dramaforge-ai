"""媒体生成服务抽象（image / video / audio）。

agent 工具不直接调外部 API，而是通过此服务。v1.0 用 stub 实现，v1.1 接真实 provider。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class MediaRequest:
    """统一的媒体生成请求。"""
    kind: str  # image | video | audio
    prompt: str
    negative_prompt: str = ""
    model_id: str | None = None
    provider_id: str | None = None
    width: int = 1024
    height: int = 1024
    duration_sec: float = 5.0
    voice: str | None = None  # audio 用
    reference_urls: list[str] = field(default_factory=list)
    extra: dict = field(default_factory=dict)


@dataclass
class MediaResult:
    """统一的媒体生成结果。"""
    url: str
    kind: str
    cost_usd: float = 0.0
    elapsed_sec: float = 0.0
    raw: dict = field(default_factory=dict)


class MediaServiceError(Exception):
    pass


class DatabaseMediaService:
    """Adapter from Agent media tools to the unified provider configuration table."""

    def __init__(self, db, preferred_provider_id: str | None = None):
        self.db = db
        self.preferred_provider_id = preferred_provider_id

    def _provider(self, request: MediaRequest) -> dict:
        from ..models import ProviderConfig

        rows = self.db.query(ProviderConfig).filter(ProviderConfig.enabled.is_(True)).all()
        if request.provider_id:
            rows = [row for row in rows if row.provider_id == request.provider_id]
        elif self.preferred_provider_id:
            preferred = [row for row in rows if row.provider_id == self.preferred_provider_id]
            rows = preferred + [row for row in rows if row not in preferred]
        for row in rows:
            cfg = row.to_internal_dict()
            models = cfg.get(f"{request.kind}_models", [])
            if not models:
                continue
            if request.model_id and request.model_id not in models:
                continue
            if cfg.get("base_url") and (cfg.get("api_key") or cfg.get("protocol") == "local"):
                return cfg
        raise MediaServiceError(f"no enabled {request.kind} provider/model is configured")

    async def generate(self, request: MediaRequest) -> MediaResult:
        if request.kind == "audio":
            raise MediaServiceError("audio provider integration is not configured")
        from ..routers.media import ImageGenerateIn, VideoGenerateIn, _openai_image, _openai_video
        import time

        provider = self._provider(request)
        started = time.perf_counter()
        if request.kind == "image":
            body = ImageGenerateIn(
                provider_id=provider["provider_id"],
                model=request.model_id or provider.get("default_model") or (provider.get("image_models") or [None])[0],
                prompt=request.prompt,
                ref_urls=request.reference_urls,
                aspect_ratio=request.extra.get("aspect_ratio", "1:1"),
                extra=request.extra,
            )
            result = await _openai_image(provider, body)
        elif request.kind == "video":
            body = VideoGenerateIn(
                provider_id=provider["provider_id"],
                model=request.model_id or provider.get("default_model") or (provider.get("video_models") or [None])[0],
                prompt=request.prompt,
                ref_urls=request.reference_urls,
                aspect_ratio=request.extra.get("aspect_ratio", "16:9"),
                duration_sec=max(1, int(request.duration_sec)),
                extra=request.extra,
            )
            result = await _openai_video(provider, body)
        else:
            raise MediaServiceError(f"unsupported media kind: {request.kind}")
        return MediaResult(
            url=result.url,
            kind=request.kind,
            elapsed_sec=time.perf_counter() - started,
            raw=result.raw,
        )


class MediaService(Protocol):
    """媒体服务协议。后端实现可以是 stub / 真实 provider。"""

    async def generate(self, request: MediaRequest) -> MediaResult: ...


class StubMediaService:
    """Stub 实现：把 prompt 编码成 data URL，不调真实 API。

    用途：
    - agent 端到端测试
    - 无 API key 时的开发演示
    """

    def __init__(self, base_url: str = ""):
        self.base_url = base_url

    async def generate(self, request: MediaRequest) -> MediaResult:
        import base64
        import hashlib
        import time

        seed = f"{request.kind}|{request.prompt}|{request.model_id or ''}"
        digest = hashlib.md5(seed.encode("utf-8")).hexdigest()[:8]
        # 1x1 transparent PNG (or text marker)
        marker = f"STUB-{request.kind}-{digest}"
        b64 = base64.b64encode(marker.encode("utf-8")).decode("ascii")
        url = f"data:text/plain;base64,{b64}"
        return MediaResult(
            url=url,
            kind=request.kind,
            cost_usd=0.0,
            elapsed_sec=0.001,
            raw={"stub": True, "prompt": request.prompt},
        )


_default_service: MediaService | None = None


def get_default_media_service() -> MediaService:
    if _default_service is None:
        raise MediaServiceError(
            "media provider is not configured; configure a provider before generating media"
        )
    return _default_service


def set_default_media_service(svc: MediaService) -> None:
    global _default_service
    _default_service = svc
