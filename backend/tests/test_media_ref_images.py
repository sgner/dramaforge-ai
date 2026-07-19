"""图生图参考图传递测试。

背景：之前 _openai_image 只把 ref_urls 的 URL 文本拼进 prompt
（"(refs: /files/xxx.png)"），相对路径对上游毫无意义，上传的参考图
实际从未到达供应商。修复后：本地 /files/ 读文件转 base64 data URI，
http(s) 原样传递，统一放进 image 字段（网关实测：字符串，多图逗号拼接，
数组会被 400 拒绝）。
"""
import base64
import json

import pytest

from app.routers import media
from app.routers.media import ImageGenerateIn, VideoGenerateIn, _openai_image, _openai_video, _ref_to_image_value


def _provider(extra_config=None):
    return {
        "provider_id": "test-provider",
        "base_url": "https://api.test/v1",
        "api_key": "sk-test",
        "protocol": "openai",
        "extra_config": extra_config or {},
    }


class _Resp:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload, ensure_ascii=False)

    def json(self):
        return self._payload


@pytest.fixture
def upload_dir(tmp_path, monkeypatch):
    """把 media._UPLOAD_DIR 指到临时目录，不碰真实 uploads。"""
    d = tmp_path / "uploads"
    d.mkdir()
    monkeypatch.setattr(media, "_UPLOAD_DIR", d)
    return d


def test_ref_local_file_becomes_data_uri(upload_dir):
    (upload_dir / "abc.png").write_bytes(b"\x89PNG-fake")
    val = _ref_to_image_value("/files/abc.png")
    assert val == "data:image/png;base64," + base64.b64encode(b"\x89PNG-fake").decode()


def test_ref_passthrough_http_and_data_uri(upload_dir):
    assert _ref_to_image_value("https://cdn.test/x.png") == "https://cdn.test/x.png"
    du = "data:image/jpeg;base64,AAAA"
    assert _ref_to_image_value(du) == du


def test_ref_missing_file_returns_none(upload_dir):
    assert _ref_to_image_value("/files/nope.png") is None


def test_ref_directory_traversal_rejected(upload_dir):
    assert _ref_to_image_value("/files/../secret.png") is None
    assert _ref_to_image_value("") is None


@pytest.mark.asyncio
async def test_openai_image_sends_image_field_not_prompt_injection(upload_dir, monkeypatch):
    """ref_urls → payload['image'] 是 data URI 字符串，prompt 不再拼 (refs: ...)。"""
    (upload_dir / "ref1.png").write_bytes(b"PNGDATA")
    calls = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append(json)
        return _Resp({"data": [{"url": "https://cdn.test/out.png"}]})

    monkeypatch.setattr(media.httpx.AsyncClient, "post", fake_post)
    out = await _openai_image(
        _provider(),
        ImageGenerateIn(provider_id="test-provider", model="m", prompt="画一只猫", ref_urls=["/files/ref1.png"]),
    )
    assert out.url == "https://cdn.test/out.png"
    payload = calls[0]
    assert payload["image"] == "data:image/png;base64," + base64.b64encode(b"PNGDATA").decode()
    assert "(refs:" not in payload["prompt"]
    assert payload["prompt"] == "画一只猫"


@pytest.mark.asyncio
async def test_openai_image_multiple_refs_comma_joined(upload_dir, monkeypatch):
    """多图：本地 + 远程混合，解析成功的逗号拼接进 image 字符串。"""
    (upload_dir / "a.png").write_bytes(b"AAA")
    calls = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append(json)
        return _Resp({"data": [{"url": "https://cdn.test/out.png"}]})

    monkeypatch.setattr(media.httpx.AsyncClient, "post", fake_post)
    await _openai_image(
        _provider(),
        ImageGenerateIn(
            provider_id="test-provider", model="m", prompt="p",
            ref_urls=["/files/a.png", "https://cdn.test/b.png", "/files/missing.png"],
        ),
    )
    expected = "data:image/png;base64," + base64.b64encode(b"AAA").decode() + ",https://cdn.test/b.png"
    assert calls[0]["image"] == expected


@pytest.mark.asyncio
async def test_openai_image_ref_field_override(upload_dir, monkeypatch):
    """extra_config.image.ref_field 可覆盖参考图字段名。"""
    (upload_dir / "a.png").write_bytes(b"AAA")
    calls = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append(json)
        return _Resp({"data": [{"url": "https://cdn.test/out.png"}]})

    monkeypatch.setattr(media.httpx.AsyncClient, "post", fake_post)
    await _openai_image(
        _provider({"image": {"ref_field": "input_image"}}),
        ImageGenerateIn(provider_id="test-provider", model="m", prompt="p", ref_urls=["/files/a.png"]),
    )
    assert "input_image" in calls[0]
    assert "image" not in calls[0]


@pytest.mark.asyncio
async def test_openai_image_unresolvable_refs_fall_back_to_t2i(upload_dir, monkeypatch):
    """全部参考图无法解析 → 不带 image 字段按纯文生图提交（不崩）。"""
    calls = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append(json)
        return _Resp({"data": [{"url": "https://cdn.test/out.png"}]})

    monkeypatch.setattr(media.httpx.AsyncClient, "post", fake_post)
    out = await _openai_image(
        _provider(),
        ImageGenerateIn(provider_id="test-provider", model="m", prompt="p", ref_urls=["/files/ghost.png"]),
    )
    assert out.url == "https://cdn.test/out.png"
    assert "image" not in calls[0]


@pytest.mark.asyncio
async def test_openai_video_sends_image_field_for_i2v(upload_dir, monkeypatch):
    """图生视频：ref_urls 同样进 payload['image']（字符串/逗号拼接契约与图生图一致）。"""
    (upload_dir / "frame.png").write_bytes(b"FRAMEDATA")
    calls = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append(json)
        return _Resp({"data": {"url": "https://cdn.test/out.mp4"}})

    monkeypatch.setattr(media.httpx.AsyncClient, "post", fake_post)
    out = await _openai_video(
        _provider(),
        VideoGenerateIn(provider_id="test-provider", model="seedance-i2v", prompt="p", ref_urls=["/files/frame.png"]),
    )
    assert out.url == "https://cdn.test/out.mp4"
    assert calls[0]["image"] == "data:image/png;base64," + base64.b64encode(b"FRAMEDATA").decode()


@pytest.mark.asyncio
async def test_openai_video_unresolvable_refs_fall_back_to_t2v(upload_dir, monkeypatch):
    """参考图全部无法解析 → 不带 image 字段按纯文生视频提交（不崩）。"""
    calls = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append(json)
        return _Resp({"data": {"url": "https://cdn.test/out.mp4"}})

    monkeypatch.setattr(media.httpx.AsyncClient, "post", fake_post)
    out = await _openai_video(
        _provider(),
        VideoGenerateIn(provider_id="test-provider", model="m", prompt="p", ref_urls=["/files/ghost.png"]),
    )
    assert out.url == "https://cdn.test/out.mp4"
    assert "image" not in calls[0]


# ---------- t2i/i2i 变体自动切换（线上 400 事故回归） ----------

def test_resolve_ref_model_switches_i2i_to_t2i_without_refs():
    """无参考图 + i2i 模型 → 自动切到同族 t2i（否则上游 400 requires at least one input image）。"""
    provider = {"image_models": ["seedream-v5-pro-i2i", "seedream-v5-pro-t2i"]}
    assert media._resolve_ref_model(provider, "seedream-v5-pro-i2i", False, "image") == "seedream-v5-pro-t2i"


def test_resolve_ref_model_switches_t2i_to_i2i_with_refs():
    """有参考图 + t2i 模型 → 自动切到同族 i2i（否则参考图不会生效）。"""
    provider = {"image_models": ["seedream-v5-pro-i2i", "seedream-v5-pro-t2i"]}
    assert media._resolve_ref_model(provider, "seedream-v5-pro-t2i", True, "image") == "seedream-v5-pro-i2i"


def test_resolve_ref_model_keeps_when_variant_missing():
    """变体不在模型列表 → 保持原样（不乱猜）。"""
    provider = {"image_models": ["seedream-v5-pro-i2i"]}
    assert media._resolve_ref_model(provider, "seedream-v5-pro-i2i", False, "image") == "seedream-v5-pro-i2i"
    # 非 t2i/i2i 后缀的模型不受影响
    provider2 = {"video_models": ["kling-lip-sync-video"]}
    assert media._resolve_ref_model(provider2, "kling-lip-sync-video", False, "video") == "kling-lip-sync-video"


@pytest.mark.asyncio
async def test_openai_image_uses_t2i_when_no_refs(monkeypatch):
    """端到端：provider 绑定 i2i 模型但无参考图 → 实际发给上游的是 t2i。"""
    calls = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append(json)
        return _Resp({"data": [{"url": "https://cdn.test/out.png"}]})

    monkeypatch.setattr(media.httpx.AsyncClient, "post", fake_post)
    provider = _provider()
    provider["image_models"] = ["seedream-v5-pro-i2i", "seedream-v5-pro-t2i"]
    out = await _openai_image(
        provider,
        ImageGenerateIn(provider_id="test-provider", model="seedream-v5-pro-i2i", prompt="a cat"),
    )
    assert calls[0]["model"] == "seedream-v5-pro-t2i"
    assert out.model == "seedream-v5-pro-t2i"


@pytest.mark.asyncio
async def test_openai_video_uses_i2v_when_refs_present(monkeypatch, upload_dir):
    """端到端：video 绑定 t2v 模型但有参考图 → 实际发给上游的是 i2v。"""
    (upload_dir / "f.png").write_bytes(b"F")
    calls = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append(json)
        return _Resp({"data": {"url": "https://cdn.test/out.mp4"}})

    monkeypatch.setattr(media.httpx.AsyncClient, "post", fake_post)
    provider = _provider()
    provider["video_models"] = ["seedance-2.0-mini-t2v", "seedance-2.0-mini-i2v"]
    await _openai_video(
        provider,
        VideoGenerateIn(provider_id="test-provider", model="seedance-2.0-mini-t2v", prompt="p", ref_urls=["/files/f.png"]),
    )
    assert calls[0]["model"] == "seedance-2.0-mini-i2v"
