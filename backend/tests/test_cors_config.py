"""CORS 配置回归：默认白名单收紧，可用 DRAMAFORGE_CORS_ORIGINS 覆盖。

背景：此前 CORSMiddleware 配置为 allow_origins=["*"] + allow_credentials=True，
本地桌面应用后端（默认 8765 端口）对任意网页来源开放全部 API（含读写本地项目、
provider api_key 等）。修复后默认仅放行 Vite dev server（5173）/ preview（4173）
的 localhost / 127.0.0.1 / [::1] 源。
"""
from app import _cors_origins


def test_cors_default_origins_are_localhost_only(monkeypatch):
    monkeypatch.delenv("DRAMAFORGE_CORS_ORIGINS", raising=False)
    origins = _cors_origins()
    assert origins, "默认白名单不应为空（否则本地 dev 前端被挡）"
    assert "*" not in origins, "禁止回归为通配符全开放"
    # vite.config.ts: dev server port 5173, host 0.0.0.0
    assert "http://localhost:5173" in origins
    assert "http://127.0.0.1:5173" in origins
    # 白名单内只允许 localhost / 127.0.0.1 / [::1] 源
    for origin in origins:
        host = origin.split("://", 1)[-1]
        assert host.startswith(("localhost", "127.0.0.1", "[::1]")), origin


def test_cors_env_override(monkeypatch):
    monkeypatch.setenv(
        "DRAMAFORGE_CORS_ORIGINS", "http://192.168.1.10:5173, https://example.com ,"
    )
    assert _cors_origins() == ["http://192.168.1.10:5173", "https://example.com"]


def test_cors_env_empty_disables_cross_origin(monkeypatch):
    """显式置空 = 只允许同源访问（打包/生产场景），不回落到默认白名单。"""
    monkeypatch.setenv("DRAMAFORGE_CORS_ORIGINS", "")
    assert _cors_origins() == []
