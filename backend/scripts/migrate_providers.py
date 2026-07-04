"""一次性迁移：把 media_provider_configs + llm_provider_configs 合并到 provider_configs。

合并规则（按 provider_id 去重）：
- media 表字段优先（name/base_url/api_key/protocol/enabled/image_models/chat_models/video_models/extra_config）
- llm 表补 default_model（media 表没这字段）
- 同 provider_id 已存在于 provider_configs → 跳过（幂等）

用法：
    cd backend && python -m scripts.migrate_providers
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import LLMProviderConfig, MediaProviderConfig, ProviderConfig


def migrate(db: Session) -> dict[str, int]:
    """执行迁移。返回 {'media': N, 'llm': N, 'skipped': N, 'created': N}。"""
    media_rows = db.query(MediaProviderConfig).all()
    llm_rows = db.query(LLMProviderConfig).all()
    llm_by_id = {r.provider_id: r for r in llm_rows}

    stats = {"media": len(media_rows), "llm": len(llm_rows), "skipped": 0, "created": 0}

    seen = set()
    # 先迁 media 表
    for m in media_rows:
        existing = db.query(ProviderConfig).filter_by(provider_id=m.provider_id).first()
        if existing:
            seen.add(m.provider_id)
            stats["skipped"] += 1
            continue
        llm = llm_by_id.get(m.provider_id)
        default_model = llm.default_model if llm else ""
        row = ProviderConfig(
            provider_id=m.provider_id,
            name=m.name or "",
            base_url=m.base_url,
            api_key=m.api_key or "",
            protocol=m.protocol or "openai",
            enabled=bool(m.enabled),
            default_model=default_model,
            image_models_json=m.image_models_json or "[]",
            chat_models_json=m.chat_models_json or "[]",
            video_models_json=m.video_models_json or "[]",
            extra_config_json=m.extra_config_json or "{}",
        )
        db.add(row)
        seen.add(m.provider_id)
        stats["created"] += 1

    # 再迁 llm 表中 media 表没有的
    for llm in llm_rows:
        if llm.provider_id in seen:
            continue
        existing = db.query(ProviderConfig).filter_by(provider_id=llm.provider_id).first()
        if existing:
            stats["skipped"] += 1
            continue
        row = ProviderConfig(
            provider_id=llm.provider_id,
            name="",
            base_url=llm.base_url,
            api_key=llm.api_key,
            protocol="openai",
            enabled=True,
            default_model=llm.default_model,
            image_models_json="[]",
            chat_models_json=llm.chat_models_json or "[]",
            video_models_json="[]",
            extra_config_json="{}",
        )
        db.add(row)
        seen.add(llm.provider_id)
        stats["created"] += 1

    db.commit()
    return stats


def main() -> None:
    from app.database import SessionLocal
    with SessionLocal() as db:
        stats = migrate(db)
    print(f"migration done: {stats}")


if __name__ == "__main__":
    main()
