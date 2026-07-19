"""Persist and query project assets."""
from __future__ import annotations

import uuid

from .base import BaseTool, ToolContext, ToolParameter


def _gen_id() -> str:
    return uuid.uuid4().hex[:16]


def _asset_status(params: dict) -> str:
    if params.get("failed"):
        return "failed"
    if params.get("generating"):
        return "processing"
    if params.get("url"):
        return "ready"
    return str(params.get("status") or "uploaded")


def _derived_from(params: dict) -> list[str]:
    derived = params.get("derived_from")
    if isinstance(derived, list):
        return [str(item) for item in derived if str(item).strip()]
    source = params.get("source_asset_id")
    return [str(source)] if source else []


class SaveAssetTool(BaseTool):
    """Create or update one logical asset idempotently."""

    name = "save_asset"
    description = "Persist generated or uploaded image, video, audio, or text assets."
    category = "asset"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.05
    idempotent = False
    parameters = [
        ToolParameter(name="kind", type="string", description="image, video, audio, or text", required=True),
        ToolParameter(name="asset_kind", type="string", description="character, prop, scene, storyboard, script, etc.", required=False),
        ToolParameter(name="name", type="string", description="logical asset name", required=False, default=""),
        ToolParameter(name="title", type="string", description="display title", required=False, default=""),
        ToolParameter(name="url", type="string", description="asset URL or data URL", required=False),
        ToolParameter(name="prompt", type="string", description="generation prompt", required=False),
        ToolParameter(name="provider_id", type="string", description="provider id", required=False),
        ToolParameter(name="provider_name", type="string", description="provider name", required=False),
        ToolParameter(name="model_id", type="string", description="model id", required=False),
        ToolParameter(name="extra", type="object", description="additional metadata", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        kind = params.get("kind")
        if not kind:
            return "kind is required"
        if str(kind) not in {"image", "video", "audio", "text"}:
            return "kind must be image, video, audio, or text"
        return None

    @staticmethod
    def _payload(params: dict, asset_id: str) -> dict:
        # 关键：把 body 从 extra 提到顶层，否则前端 taskAssets.body 为空，
        # TextReader 打开资产显示"暂无内容"（卡片预览用 prompt 兜底所以看似有内容）
        extra = params.get("extra") or {}
        return {
            "ok": True,
            "id": asset_id,
            "kind": params.get("kind"),
            "asset_kind": params.get("asset_kind"),
            "name": params.get("name") or "",
            "title": params.get("title") or "",
            "url": params.get("url"),
            "prompt": params.get("prompt"),
            "status": _asset_status(params),
            "version": int(params.get("version") or 1),
            "source_asset_id": params.get("source_asset_id"),
            "derived_from": _derived_from(params),
            "reference_role": params.get("reference_role"),
            "prompt_source": params.get("prompt_source"),
            "prompt_optimized": params.get("prompt_optimized"),
            "body": extra.get("body") or params.get("body"),
            "text_stats": extra.get("text_stats") or params.get("text_stats"),
            # 关键：保留完整 extra 字段（含 extra.script 结构化 JSON），让前端 ScriptNodeBody
            # 能从 extra.script 读角色/道具/场景/分镜/视觉签名。ARTIFACT_CREATED 事件会把
            # 这份 payload 推到前端 useAgentStore.artifacts，再由 addAgentNodes 透传到
            # TaskAssetRef.extra —— 任何一环丢 extra.script 都会导致 ScriptNodeBody 全 0。
            "extra": dict(extra),
        }

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if ctx.db is None:
            result = self._payload(params, _gen_id())
            result["note"] = "no db, asset not persisted"
            return result

        from app import models

        source_asset_id = params.get("source_asset_id")
        name = params.get("name") or ""
        prompt = params.get("prompt") or ""
        asset = (
            ctx.db.query(models.Asset)
            .filter(
                models.Asset.project_id == ctx.project_id,
                models.Asset.kind == params["kind"],
                models.Asset.asset_kind == params.get("asset_kind"),
                models.Asset.name == name,
                models.Asset.prompt == prompt,
                models.Asset.source_asset_id == source_asset_id,
            )
            .order_by(models.Asset.created_at.desc())
            .first()
        )
        values = {
            "title": params.get("title") or "",
            "name": name,
            "url": params.get("url"),
            "prompt": prompt,
            "provider_id": params.get("provider_id"),
            "provider_name": params.get("provider_name"),
            "model_id": params.get("model_id"),
            "failed": bool(params.get("failed", False)),
            "generating": bool(params.get("generating", False)),
            "error": params.get("error"),
            "extra": params.get("extra") or {},
            "origin": params.get("origin") or "generated",
            "source_asset_id": source_asset_id,
            "status": _asset_status(params),
            "version": int(params.get("version") or 1),
            "derived_from": _derived_from(params),
            "reference_role": params.get("reference_role"),
            "prompt_source": params.get("prompt_source"),
            "prompt_optimized": params.get("prompt_optimized"),
            "inspection_status": params.get("inspection_status") or "pending",
        }
        if asset is None:
            asset = models.Asset(
                id=_gen_id(), project_id=ctx.project_id, kind=params["kind"],
                asset_kind=params.get("asset_kind"), **values,
            )
            ctx.db.add(asset)
        else:
            for key, value in values.items():
                if value is not None or key in {"failed", "generating", "status", "version"}:
                    setattr(asset, key, value)
        if not asset.failed and asset.url and asset.status in {"uploaded", "processing"}:
            asset.status = "ready"
        ctx.db.commit()
        ctx.db.refresh(asset)
        return self._payload({**params, "status": asset.status, "version": asset.version, "source_asset_id": asset.source_asset_id, "derived_from": asset.derived_from}, asset.id)


class GetArtifactsTool(BaseTool):
    """Query persisted project assets."""

    name = "get_artifacts"
    description = "Query existing assets by kind, asset_kind, or name to avoid duplicates."
    category = "asset"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.05
    idempotent = True
    parameters = [
        ToolParameter(name="kind", type="string", description="kind filter", required=False),
        ToolParameter(name="asset_kind", type="string", description="asset kind filter", required=False),
        ToolParameter(name="name", type="string", description="name filter", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if ctx.db is None:
            return {"items": [], "count": 0}
        from app import models
        query = ctx.db.query(models.Asset)
        if ctx.project_id is not None:
            query = query.filter(models.Asset.project_id == ctx.project_id)
        if params.get("kind"):
            query = query.filter(models.Asset.kind == params["kind"])
        if params.get("asset_kind"):
            query = query.filter(models.Asset.asset_kind == params["asset_kind"])
        if params.get("name"):
            query = query.filter(models.Asset.name.like(f"%{params['name']}%"))
        rows = query.order_by(models.Asset.created_at.desc()).limit(50).all()
        items = []
        for asset in rows:
            items.append({
                "id": asset.id, "kind": asset.kind, "asset_kind": asset.asset_kind,
                "name": asset.name, "title": asset.title, "url": asset.url,
                "prompt": asset.prompt, "status": asset.status, "version": asset.version,
                "source_asset_id": asset.source_asset_id, "derived_from": asset.derived_from or [],
                "reference_role": asset.reference_role, "prompt_source": asset.prompt_source,
                "prompt_optimized": asset.prompt_optimized,
            })
        return {"items": items, "count": len(items)}


class ReadTextAssetTool(BaseTool):
    """读取文本资产（小说/脚本）正文。

    - 按 id 直接读取单个文本资产的 body / text_stats
    - 也可按 asset_kind 列出当前项目内所有小说/脚本资产
    """

    name = "read_text_asset"
    description = (
        "Read a text asset (novel / script) by id, or list all text assets of a given kind "
        "(novel/script) in the current project. Returns the body content and stats."
    )
    category = "asset"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.05
    idempotent = True
    parameters = [
        ToolParameter(name="asset_id", type="string", description="text asset id to read", required=False),
        ToolParameter(
            name="asset_kind",
            type="string",
            description="text asset kind filter (novel | script); used when asset_id is empty",
            required=False,
        ),
        ToolParameter(
            name="include_body",
            type="boolean",
            description="whether to include the full body in the response (default true)",
            required=False,
            default=True,
        ),
        ToolParameter(
            name="max_chars",
            type="integer",
            description="truncate body to at most N characters; 0 = no truncation",
            required=False,
            default=0,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("asset_id") and not params.get("asset_kind"):
            return "Either asset_id or asset_kind is required"
        kind = params.get("asset_kind")
        if kind and kind not in {"novel", "script"}:
            return "asset_kind must be 'novel' or 'script'"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if ctx.db is None:
            return {"ok": False, "error": "no db", "items": []}
        from app import models

        asset_id = params.get("asset_id")
        include_body = bool(params.get("include_body", True))
        max_chars = int(params.get("max_chars") or 0)

        def _serialize(asset, with_body: bool) -> dict:
            extra = asset.extra or {}
            body = extra.get("body") or asset.url or ""
            text_stats = extra.get("text_stats") or {}
            if not with_body:
                body = ""
            elif max_chars > 0 and len(body) > max_chars:
                body = body[:max_chars] + "\n…(truncated)…"
            return {
                "id": asset.id,
                "kind": asset.kind,
                "asset_kind": asset.asset_kind,
                "title": asset.title or "",
                "name": asset.name or "",
                "url": asset.url,
                "prompt": asset.prompt,
                "status": asset.status,
                "version": asset.version,
                "body": body,
                "body_length": len(extra.get("body") or asset.url or ""),
                "text_stats": text_stats,
                "updated_at": asset.created_at.isoformat() if asset.created_at else None,
            }

        if asset_id:
            asset = (
                ctx.db.query(models.Asset)
                .filter(models.Asset.id == asset_id)
                .first()
            )
            if not asset:
                return {"ok": False, "error": f"asset {asset_id} not found", "items": []}
            if asset.asset_kind not in {"novel", "script"}:
                return {
                    "ok": False,
                    "error": f"asset {asset_id} is not a text asset (asset_kind={asset.asset_kind})",
                    "items": [],
                }
            return {
                "ok": True,
                "count": 1,
                "items": [_serialize(asset, include_body)],
            }

        # List by asset_kind
        q = ctx.db.query(models.Asset).filter(
            models.Asset.asset_kind.in_(["novel", "script"])
        )
        if ctx.project_id is not None:
            q = q.filter(models.Asset.project_id == ctx.project_id)
        if params.get("asset_kind"):
            q = q.filter(models.Asset.asset_kind == params["asset_kind"])
        rows = q.order_by(models.Asset.created_at.desc()).limit(20).all()
        return {
            "ok": True,
            "count": len(rows),
            "items": [_serialize(a, include_body) for a in rows],
        }


class UpdateTextAssetTool(BaseTool):
    """更新文本资产（小说/脚本）正文。

    - asset_id + body 必填
    - 自动重新计算 text_stats（words / scenes / chapters）
    - 自动同步到 ctx.artifacts（让前端 / runtime 能立即看到更新）
    """

    name = "update_text_asset"
    description = (
        "Update the body of a text asset (novel / script) by id. "
        "Use this when the agent edits / extends / rewrites a novel or script. "
        "Body is required. text_stats is recomputed automatically."
    )
    category = "asset"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.05
    idempotent = False
    parameters = [
        ToolParameter(name="asset_id", type="string", description="target text asset id", required=True),
        ToolParameter(name="body", type="string", description="new full body content", required=True),
        ToolParameter(
            name="mode",
            type="string",
            description="how to apply body: replace (default) | append",
            required=False,
            default="replace",
            enum=["replace", "append"],
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("asset_id"):
            return "asset_id is required"
        if params.get("body") is None:
            return "body is required"
        mode = params.get("mode", "replace")
        if mode not in {"replace", "append"}:
            return "mode must be 'replace' or 'append'"
        return None

    @staticmethod
    def _compute_text_stats(body: str) -> dict:
        if not body:
            return {"words": 0, "chapters": 0, "scenes": 0}
        cjk = len([ch for ch in body if "\u4e00" <= ch <= "\u9fff"])
        non_cjk = "".join(" " if "\u4e00" <= ch <= "\u9fff" else ch for ch in body)
        ascii_words = len([w for w in non_cjk.split() if w])
        words = cjk + ascii_words
        chapters = sum(1 for _ in __import__("re").finditer(r"^#{1,3}\s+", body, flags=__import__("re").MULTILINE))
        scenes = len(
            __import__("re").findall(
                r"(^|\n)\s*(第[一二三四五六七八九十百零0-9]+场|场景[一二三四五六七八九十百零0-9]*[：:.\s]|【场\d+】)",
                body,
            )
        )
        return {"words": words, "chapters": chapters, "scenes": scenes}

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if ctx.db is None:
            return {"ok": False, "error": "no db"}
        from app import models

        asset = (
            ctx.db.query(models.Asset)
            .filter(models.Asset.id == params["asset_id"])
            .first()
        )
        if not asset:
            return {"ok": False, "error": f"asset {params['asset_id']} not found"}
        if asset.asset_kind not in {"novel", "script"}:
            return {
                "ok": False,
                "error": f"asset {params['asset_id']} is not a text asset (asset_kind={asset.asset_kind})",
            }

        new_body = params["body"]
        mode = params.get("mode", "replace")
        if mode == "append":
            existing = (asset.extra or {}).get("body") or asset.url or ""
            new_body = (existing + new_body) if existing else new_body

        text_stats = self._compute_text_stats(new_body)
        extra = dict(asset.extra or {})
        extra["body"] = new_body
        extra["text_stats"] = text_stats
        asset.extra = extra
        # 兼容旧字段：把 body 同步到 url（避免前端读 url 拿到空）
        if not asset.url:
            asset.url = new_body
        asset.generating = False
        asset.failed = False
        asset.status = asset.status or "ready"
        # bump version
        try:
            asset.version = int(asset.version or 1) + 1
        except Exception:
            asset.version = 2
        ctx.db.commit()
        ctx.db.refresh(asset)

        # 同步到 ctx.artifacts（runtime 用此推送给前端）
        try:
            if ctx.artifacts is not None:
                arr = ctx.artifacts.get("items")
                if isinstance(arr, list):
                    replaced = False
                    for it in arr:
                        if isinstance(it, dict) and it.get("id") == asset.id:
                            it["body"] = new_body
                            it["text_stats"] = text_stats
                            it["url"] = new_body
                            it["version"] = asset.version
                            replaced = True
                            break
                    if not replaced:
                        arr.append({
                            "id": asset.id,
                            "kind": asset.kind,
                            "asset_kind": asset.asset_kind,
                            "title": asset.title,
                            "name": asset.name,
                            "url": new_body,
                            "body": new_body,
                            "text_stats": text_stats,
                            "version": asset.version,
                        })
        except Exception:
            pass

        # 触发 ASSET_UPDATED 事件
        try:
            ctx.emit_event(
                "asset_updated",
                {
                    "id": asset.id,
                    "kind": asset.kind,
                    "asset_kind": asset.asset_kind,
                    "title": asset.title,
                    "name": asset.name,
                    "url": new_body,
                    "body": new_body,
                    "text_stats": text_stats,
                    "version": asset.version,
                    # 关键：带上 extra（脚本资产含 extra.script 结构化 JSON），
                    # 否则前端收到更新后 ScriptNodeBody 的 extra.script 丢失，
                    # 角色/道具/场景/分镜 tabs 重新归 0。
                    "extra": asset.extra or {},
                },
            )
        except Exception:
            pass

        return {
            "ok": True,
            "id": asset.id,
            "kind": asset.kind,
            "asset_kind": asset.asset_kind,
            "title": asset.title,
            "name": asset.name,
            "version": asset.version,
            "body_length": len(new_body),
            "text_stats": text_stats,
        }
