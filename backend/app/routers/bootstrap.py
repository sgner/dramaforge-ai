"""Bootstrap 端点：合并首屏 3 个请求为 1 个，减少 RTT。

回归性能问题：进入首页时 3-10s。首屏发起 3 个请求（listDramaTasks +
listProviders + getUserPreference('model_bindings')），每个请求在 --reload
模式下都有模块加载开销，RTT 累加导致延迟。合并为单个 /api/bootstrap 端点。
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..routers.providers import ProviderOut

router = APIRouter()


@router.get("/bootstrap")
def get_bootstrap(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """首屏合并请求：返回 tasks + providers + modelBindings。

    替代首屏的 3 个独立请求：
    - GET /api/drama-tasks
    - GET /api/providers
    - GET /api/user-preferences/model_bindings
    """
    # 1) tasks（不含 deleted）
    task_rows = (
        db.query(models.DramaTask)
        .filter(models.DramaTask.deleted == False)  # noqa: E712
        .order_by(models.DramaTask.updated_at.desc())
        .all()
    )
    tasks = [r.to_dict() for r in task_rows]

    # 2) providers（api_key 脱敏，补全 has_key/key_preview 供前端使用）
    provider_rows = (
        db.query(models.ProviderConfig)
        .order_by(models.ProviderConfig.provider_id)
        .all()
    )
    providers = []
    for r in provider_rows:
        d = r.to_dict(mask_key=True)
        d["has_key"] = bool(r.api_key)
        d["key_preview"] = (r.api_key[-4:] if r.api_key else "")
        providers.append(d)

    # 3) model_bindings 偏好
    pref = (
        db.query(models.UserPreference)
        .filter(models.UserPreference.key == "model_bindings")
        .first()
    )
    import json
    model_bindings: Optional[List[Any]] = None
    if pref and pref.value_json:
        try:
            model_bindings = json.loads(pref.value_json)
        except (json.JSONDecodeError, TypeError):
            model_bindings = None

    return {
        "tasks": tasks,
        "providers": providers,
        "modelBindings": model_bindings,
    }
