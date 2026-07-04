"""[DEPRECATED 2026-07-04] /api/media-providers 已被 /api/providers 取代。

保留此文件仅为显式返 410 Gone 引导旧调用方迁移。
详见 docs/superpowers/specs/2026-07-04-ui-merge-design.md §3.1。
"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

_GONE = JSONResponse(
    status_code=410,
    content={"detail": "moved to /api/providers since 2026-07-04"},
)


@router.api_route("", methods=["GET", "PUT"], response_class=JSONResponse)
@router.api_route("/{provider_id}", methods=["GET", "PUT", "PATCH", "DELETE"], response_class=JSONResponse)
async def gone_all(request: Request):
    return _GONE
