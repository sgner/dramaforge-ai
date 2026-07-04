# Provider 数据源统一 — 表合并 + Agent 切换 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合并 `media_provider_configs` 和 `llm_provider_configs` 两张表为统一的 `provider_configs` 表，让 agent runtime 和 canvas 媒体生成共用同一份 provider 配置，用户配一次即可在两处使用，消除"前端 fallback 读 media 表、后端只读 llm 表"的数据源不一致断层。

**Architecture:** 新建 `provider_configs` 表，字段为 `MediaProviderConfig`（超集）+ `default_model`（来自 `LLMProviderConfig`）。写一次性迁移脚本把现有 `media_provider_configs` 数据搬到新表。后端 `load_llm_configs` / `media.py:_load_provider` / provider CRUD 路由全部改读新表。前端 `listLLMProviders` / `listMediaProviders` 路由保留但都查新表，`ApiSettingsModal` 的两个 upsert 入口合并为一个。旧表保留一版作回滚兜底，下一轮清理。

**Tech Stack:** SQLAlchemy ORM, SQLite, FastAPI, pytest, Vitest (前端)

## Global Constraints

- Python 3.11+, 后端在 `backend/` 目录，测试用 `pytest`，从 `cd backend && python -m pytest tests/path/test_xxx.py -v`
- 前端测试用 `vitest`，从项目根运行：`npx vitest run tests/path/test.test.tsx`
- 数据库路径固定：`C:\Users\25315\PycharmProjects\dramaforge-ai\backend\dramaforge.db`（由 `backend/app/database.py:6` 定义）
- 建表用 `Base.metadata.create_all(bind=engine)`（`database.py:22`），项目无 Alembic，迁移用手动脚本
- `to_dict(mask_key=True)` 默认脱敏 api_key（前 4 + *** + 后 4），`to_internal_dict()` 返回明文 key 供后端调用供应商
- 不破坏现有 canvas 媒体生成链路（`/api/media/generate/image|video`）
- 不破坏现有 agent SSE 事件流协议
- 本计划不触碰 canvas LLM 文本流式（`services/llmClient.ts` 的前端直调），那是 Plan 3 的范围
- **测试 fixture 必须用 in-memory sqlite**（`create_engine("sqlite:///:memory:")`），禁止用 `app.database.engine`（会污染真实 DB）。每个 test function 用独立 fixture 实例。
- **`_parse_json_obj` 和 `_parse_json_list` 已存在于 `models.py`**（line 293/304），所有 task 复用这两个 helper，不要重新定义。
- **媒体 provider CRUD 路由在 `backend/app/routers/media_providers.py`**（不是 `media.py`）。`media.py` 只有 generate image/video 端点。

## Plan Revisions (post wip-restore, 2026-07-04)

原 plan 基于 stash 前的 wip 状态写就。stash + reset 后从 committed 代码重新开始导致 Task 1 找不到 `MediaProviderConfig`。已 pop stash 恢复 wip 基线，以下修订反映 wip 实际状态：

- Task 1: `_parse_json_obj` 已存在（line 304），不需新增。`ProviderConfig` 类插入位置改为 `MediaProviderConfig` 之后（line 290）、`_parse_json_list` 之前（line 293）。
- Task 3: 不在 `llm_factory.py` 内重新定义 `_parse_chat_models`；改为 `from ..models import _parse_json_list` 复用。
- Task 5: media provider CRUD 在 `media_providers.py`（不是 `media.py`）。`MediaProviderIn` / `MediaProviderOut` schema 需新增 `default_model` 字段以对齐统一表。
- 所有 test fixture 用 in-memory sqlite（见 Global Constraints）。

---

## File Structure

**新建：**
- `backend/app/models.py` — 新增 `ProviderConfig` 类（不动旧的两个类，迁移完再删）
- `backend/scripts/migrate_providers.py` — 一次性数据迁移脚本
- `backend/tests/test_provider_config_model.py` — 新模型单测
- `backend/tests/test_provider_migration.py` — 迁移脚本单测
- `backend/tests/test_llm_factory_unified.py` — load_llm_configs 读新表的测试

**修改：**
- `backend/app/agent/llm_factory.py:88-112` — `load_llm_configs` 改读 `ProviderConfig`
- `backend/app/routers/media.py:22,59-66` — `_load_provider` 改读 `ProviderConfig`
- `backend/app/routers/llm_providers.py:17,45-96` — CRUD 改读 `ProviderConfig`
- `backend/app/routers/media.py` 的 provider CRUD 部分（list/upsert/delete media provider）— 改读 `ProviderConfig`
- `services/apiClient.ts:230-280` — `listLLMProviders` / `listMediaProviders` 保持，后端实现统一
- `components/infinite-canvas/ApiSettingsModal.tsx:408-430,488-496` — `syncProviderToDb` / `upsertLLMProvider` 合并到统一 upsert
- `agent/agent-mode.tsx:61-104` — `dbProviders` 加载简化（listLLMProviders 现在返回真实数据）

**接口契约（跨 task 共享）：**

`ProviderConfig.to_internal_dict()` 返回（后端调供应商用，含明文 key）：
```python
{
    "id": int,
    "provider_id": str,
    "name": str,
    "base_url": str,
    "api_key": str,           # 明文
    "protocol": str,          # "openai" | "gemini" | "runninghub" | "volcengine"
    "enabled": bool,
    "default_model": str,     # agent LLM 用
    "image_models": list[str],
    "chat_models": list[str],
    "video_models": list[str],
    "extra_config": dict,
}
```

`load_llm_configs(db) -> list[LLMProviderConfig]` 签名不变，但内部改读 `ProviderConfig` 表，过滤条件：`enabled=True 且 chat_models 非空`。

---

## Task 1: 新建 ProviderConfig ORM 模型

**Files:**
- Modify: `backend/app/models.py`（在 `MediaProviderConfig` 之后新增 `ProviderConfig` 类）
- Test: `backend/tests/test_provider_config_model.py`

**Interfaces:**
- Produces: `ProviderConfig` 类（表 `provider_configs`），`to_dict(mask_key=True)` / `to_internal_dict()` 方法

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_provider_config_model.py`：

```python
"""ProviderConfig 统一模型测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import ProviderConfig


@pytest.fixture
def db():
    """in-memory sqlite，每个 test 独立 DB，不污染真实 dramaforge.db。"""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_provider_config_can_be_created_and_read(db):
    """能插入一行并读回来，to_internal_dict 含明文 key。"""
    row = ProviderConfig(
        provider_id="test-provider",
        name="Test",
        base_url="https://example.com/v1",
        api_key="sk-test-1234567890abcdef",
        protocol="openai",
        enabled=True,
        default_model="gpt-4o-mini",
        chat_models_json='["gpt-4o-mini", "gpt-4o"]',
        image_models_json='["dall-e-3"]',
        video_models_json='[]',
        extra_config_json='{}',
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    out = row.to_dict(mask_key=True)
    assert out["provider_id"] == "test-provider"
    assert out["name"] == "Test"
    assert out["api_key"] == "sk-t***cdef"  # 脱敏
    assert out["chat_models"] == ["gpt-4o-mini", "gpt-4o"]
    assert out["default_model"] == "gpt-4o-mini"

    internal = row.to_internal_dict()
    assert internal["api_key"] == "sk-test-1234567890abcdef"  # 明文
    assert internal["protocol"] == "openai"
    assert internal["enabled"] is True


def test_provider_config_default_values(db):
    """新行有合理默认值。"""
    row = ProviderConfig(
        provider_id="min",
        base_url="https://x.com",
        api_key="k",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    out = row.to_dict()
    assert out["name"] == ""
    assert out["protocol"] == "openai"
    assert out["enabled"] is True
    assert out["default_model"] == ""
    assert out["chat_models"] == []
    assert out["image_models"] == []
    assert out["video_models"] == []
    assert out["extra_config"] == {}
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd backend && python -m pytest tests/test_provider_config_model.py -v`
Expected: FAIL with `ImportError: cannot import name 'ProviderConfig' from 'app.models'`

- [ ] **Step 3: 实现 ProviderConfig 类**

在 `backend/app/models.py` 中，`MediaProviderConfig` 类（结束于 line 290）和 `_parse_json_list` helper（开始于 line 293）之间插入 `ProviderConfig` 类。**不要重新添加 `_parse_json_obj`** — 它已存在于 line 304，`ProviderConfig` 的 `to_dict()` / `to_internal_dict()` 直接调用即可。

```python
class ProviderConfig(Base):
    """统一 provider 配置（合并 LLMProviderConfig + MediaProviderConfig）。

    agent runtime 和 canvas 媒体生成都读这张表，用户配一次即可在两处使用。
    api_key 明文存储（dev 工具暂不加密；生产应改加密）。
    GET 列表脱敏（前 4 + *** + 后 4）。
    """
    __tablename__ = "provider_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider_id = Column(String(64), nullable=False, unique=True)
    name = Column(String(128), nullable=False, default="")
    base_url = Column(String(512), nullable=False)
    api_key = Column(Text, nullable=False, default="")
    protocol = Column(String(32), nullable=False, default="openai")
    enabled = Column(Boolean, default=True)
    # agent LLM 默认模型（LLMProviderConfig 原有，MediaProviderConfig 没有）
    default_model = Column(String(128), nullable=False, default="")
    # 模型列表 JSON（按类别）
    image_models_json = Column(Text, default="[]")
    chat_models_json = Column(Text, default="[]")
    video_models_json = Column(Text, default="[]")
    extra_config_json = Column(Text, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, mask_key: bool = True) -> dict:
        key = self.api_key or ""
        masked = (key[:4] + "***" + key[-4:]) if (len(key) > 8 and mask_key) else key
        return {
            "id": self.id,
            "provider_id": self.provider_id,
            "name": self.name,
            "base_url": self.base_url,
            "api_key": masked,
            "protocol": self.protocol,
            "enabled": bool(self.enabled),
            "default_model": self.default_model or "",
            "image_models": _parse_json_list(self.image_models_json),
            "chat_models": _parse_json_list(self.chat_models_json),
            "video_models": _parse_json_list(self.video_models_json),
            "extra_config": _parse_json_obj(self.extra_config_json),
            "has_key": bool(self.api_key),
            "key_preview": masked if masked and masked != key else "",
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_internal_dict(self) -> dict:
        """含明文 api_key，供后端调供应商用。"""
        return {
            "id": self.id,
            "provider_id": self.provider_id,
            "name": self.name,
            "base_url": self.base_url,
            "api_key": self.api_key,
            "protocol": self.protocol,
            "enabled": bool(self.enabled),
            "default_model": self.default_model or "",
            "image_models": _parse_json_list(self.image_models_json),
            "chat_models": _parse_json_list(self.chat_models_json),
            "video_models": _parse_json_list(self.video_models_json),
            "extra_config": _parse_json_obj(self.extra_config_json),
        }
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd backend && python -m pytest tests/test_provider_config_model.py -v`
Expected: 2 passed

- [ ] **Step 5: 验证建表**

Run: `cd backend && python -c "from app.database import init_db; init_db(); print('ok')"`
Expected: `ok`（无报错，`provider_configs` 表已建）

- [ ] **Step 6: 提交**

```bash
git add backend/app/models.py backend/tests/test_provider_config_model.py
git commit -m "feat(provider): add unified ProviderConfig model"
```

---

## Task 2: 数据迁移脚本（media → provider_configs）

**Files:**
- Create: `backend/scripts/migrate_providers.py`
- Create: `backend/tests/test_provider_migration.py`

**Interfaces:**
- Produces: `migrate_providers.main(db_url)` 函数，把 `media_provider_configs` 和 `llm_provider_configs` 的数据合并迁到 `provider_configs`，按 `provider_id` 去重（media 优先，llm 补 default_model）

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_provider_migration.py`：

```python
"""provider 数据迁移脚本测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import MediaProviderConfig, LLMProviderConfig, ProviderConfig
from scripts.migrate_providers import migrate


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_migrate_media_only(db):
    """media 表有数据，llm 表空 → 全迁到 provider_configs。"""
    db.add(MediaProviderConfig(
        provider_id="custom-api", name="ZZ",
        base_url="https://ai.t8star.org/v1", api_key="sk-abc1234567",
        protocol="openai", enabled=True,
        chat_models_json='["gpt-4o", "deepseek-v3"]',
        image_models_json='["dall-e-3"]', video_models_json='[]',
    ))
    db.commit()

    migrate(db)

    rows = db.query(ProviderConfig).all()
    assert len(rows) == 1
    r = rows[0]
    assert r.provider_id == "custom-api"
    assert r.name == "ZZ"
    assert r.base_url == "https://ai.t8star.org/v1"
    assert r.api_key == "sk-abc1234567"
    assert r.protocol == "openai"
    assert r.enabled is True
    assert r.chat_models_json == '["gpt-4o", "deepseek-v3"]'
    # media 表没有 default_model → 留空
    assert r.default_model == ""


def test_migrate_llm_only(db):
    """llm 表有数据，media 表空 → 全迁，default_model 保留。"""
    db.add(LLMProviderConfig(
        provider_id="openai", base_url="https://api.openai.com/v1",
        api_key="sk-xyz", default_model="gpt-4o-mini",
        chat_models_json='["gpt-4o-mini"]',
    ))
    db.commit()

    migrate(db)

    rows = db.query(ProviderConfig).all()
    assert len(rows) == 1
    r = rows[0]
    assert r.provider_id == "openai"
    assert r.default_model == "gpt-4o-mini"
    assert r.chat_models_json == '["gpt-4o-mini"]'
    # llm 表没有 name/protocol → 默认值
    assert r.name == ""
    assert r.protocol == "openai"


def test_migrate_both_same_provider_id(db):
    """两张表都有同 provider_id → media 字段优先，llm 补 default_model。"""
    db.add(MediaProviderConfig(
        provider_id="dup", name="FromMedia",
        base_url="https://media.url/v1", api_key="sk-media-key",
        protocol="openai", enabled=True, chat_models_json='["a"]',
        image_models_json='[]', video_models_json='[]',
    ))
    db.add(LLMProviderConfig(
        provider_id="dup", base_url="https://llm.url/v1",
        api_key="sk-llm-key", default_model="gpt-4o",
        chat_models_json='["a", "b"]',
    ))
    db.commit()

    migrate(db)

    rows = db.query(ProviderConfig).all()
    assert len(rows) == 1
    r = rows[0]
    # media 优先
    assert r.name == "FromMedia"
    assert r.base_url == "https://media.url/v1"
    assert r.api_key == "sk-media-key"
    # llm 补 default_model
    assert r.default_model == "gpt-4o"


def test_migrate_idempotent(db):
    """重复迁移不会产生重复行。"""
    db.add(MediaProviderConfig(
        provider_id="x", base_url="https://x", api_key="k",
        protocol="openai", enabled=True, chat_models_json='[]',
        image_models_json='[]', video_models_json='[]',
    ))
    db.commit()

    migrate(db)
    migrate(db)  # 第二次

    assert db.query(ProviderConfig).count() == 1
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd backend && python -m pytest tests/test_provider_migration.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.migrate_providers'`

- [ ] **Step 3: 实现迁移脚本**

创建 `backend/scripts/__init__.py`（空文件）和 `backend/scripts/migrate_providers.py`：

```python
"""一次性迁移：把 media_provider_configs + llm_provider_configs 合并到 provider_configs。

合并规则（按 provider_id 去重）：
- media 表字段优先（name/base_url/api_key/protocol/enabled/image_models/chat_models/video_models/extra_config）
- llm 表补 default_model（media 表没这字段）
- 同 provider_id 已存在于 provider_configs → 跳过（幂等）

用法：
    cd backend && python -m scripts.migrate_providers
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.models import LLMProviderConfig, MediaProviderConfig, ProviderConfig


def _merge_json(a: str | None, b: str | None) -> str:
    """合并两个 JSON list 字段，a 优先。"""
    if a:
        return a
    return b or "[]"


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
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd backend && python -m pytest tests/test_provider_migration.py -v`
Expected: 4 passed

- [ ] **Step 5: 在真实 DB 上跑迁移**

Run: `cd backend && python -m scripts.migrate_providers`
Expected: `migration done: {'media': 1, 'llm': 0, 'skipped': 0, 'created': 1}`（custom-api 那行被迁过来）

- [ ] **Step 6: 验证迁移结果**

Run: `cd backend && python -c "from app.database import SessionLocal; from app.models import ProviderConfig; db=SessionLocal(); rows=db.query(ProviderConfig).all(); print(len(rows), 'rows'); [print(r.provider_id, r.name, r.base_url, r.default_model) for r in rows]; db.close()"`
Expected: `1 rows` + `custom-api ZZ https://ai.t8star.org/v1 ""`

- [ ] **Step 7: 提交**

```bash
git add backend/scripts/__init__.py backend/scripts/migrate_providers.py backend/tests/test_provider_migration.py
git commit -m "feat(provider): add migration script merging media+llm into provider_configs"
```

---

## Task 3: load_llm_configs 改读 ProviderConfig

**Files:**
- Modify: `backend/app/agent/llm_factory.py:88-112`（`load_llm_configs` 函数体）
- Create: `backend/tests/test_llm_factory_unified.py`

**Interfaces:**
- Consumes: Task 1 的 `ProviderConfig` 类
- Produces: `load_llm_configs(db)` 返回 `list[LLMProviderConfig]`（dataclass 不变），但内部读 `ProviderConfig` 表，过滤 `enabled=True 且 chat_models 非空`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_llm_factory_unified.py`：

```python
"""load_llm_configs 读 ProviderConfig 表的测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import ProviderConfig
from app.agent.llm_factory import load_llm_configs, LLMProviderConfig


@pytest.fixture
def db():
    """in-memory sqlite，每个 test 独立 DB。"""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_load_from_provider_config(db):
    """ProviderConfig 表有 enabled+chat_models 的行 → 读出来转成 LLMProviderConfig。"""
    db.add(ProviderConfig(
        provider_id="custom-api", name="ZZ",
        base_url="https://ai.t8star.org/v1", api_key="sk-real-key",
        protocol="openai", enabled=True, default_model="gpt-4o",
        chat_models_json='["gpt-4o", "deepseek-v3"]',
    ))
    db.commit()

    configs = load_llm_configs(db)
    assert len(configs) == 1
    c = configs[0]
    assert isinstance(c, LLMProviderConfig)
    assert c.provider_id == "custom-api"
    assert c.base_url == "https://ai.t8star.org/v1"
    assert c.api_key == "sk-real-key"
    assert c.default_model == "gpt-4o"


def test_filter_disabled(db):
    """enabled=False 的行不读。"""
    db.add(ProviderConfig(
        provider_id="disabled", base_url="https://x", api_key="k",
        protocol="openai", enabled=False, chat_models_json='["a"]',
    ))
    db.add(ProviderConfig(
        provider_id="enabled", base_url="https://y", api_key="k2",
        protocol="openai", enabled=True, chat_models_json='["b"]',
    ))
    db.commit()

    configs = load_llm_configs(db)
    assert len(configs) == 1
    assert configs[0].provider_id == "enabled"


def test_filter_empty_chat_models(db):
    """chat_models 为空的行不读（不能当 LLM 用）。"""
    db.add(ProviderConfig(
        provider_id="no-chat", base_url="https://x", api_key="k",
        protocol="openai", enabled=True, chat_models_json='[]',
        image_models_json='["dall-e-3"]',
    ))
    db.commit()

    configs = load_llm_configs(db)
    assert configs == []


def test_empty_table_returns_empty(db):
    """表空 → 返回 []。"""
    assert load_llm_configs(db) == []
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd backend && python -m pytest tests/test_llm_factory_unified.py -v`
Expected: FAIL（当前 load_llm_configs 读旧 LLMProviderConfig 表，ProviderConfig 表的行读不到）

- [ ] **Step 3: 修改 load_llm_configs**

修改 `backend/app/agent/llm_factory.py` 第 88-112 行的 `load_llm_configs`：

```python
def load_llm_configs(db) -> list[LLMProviderConfig]:
    """从 DB 读所有可用的 LLM provider 配置。

    数据源：统一表 provider_configs（合并自 media_provider_configs + llm_provider_configs）。
    过滤条件：enabled=True 且 chat_models 非空（否则不能当 LLM 用）。
    缺 db / 缺行 → 返回 []，由 select_llm_for_task 决定如何处理。
    """
    if db is None:
        return []

    # 延迟导入避免循环导入；复用 models.py 的 _parse_json_list（DRY）
    from ..models import ProviderConfig, _parse_json_list
    rows = db.query(ProviderConfig).filter(ProviderConfig.enabled.is_(True)).all()
    configs: list[LLMProviderConfig] = []
    for r in rows:
        chat_models = _parse_json_list(r.chat_models_json)
        if not chat_models:
            continue
        configs.append(LLMProviderConfig(
            provider_id=r.provider_id,
            base_url=r.base_url,
            api_key=r.api_key,
            default_model=r.default_model or chat_models[0],
        ))
    return configs
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd backend && python -m pytest tests/test_llm_factory_unified.py -v`
Expected: 4 passed

- [ ] **Step 5: 跑原有 llm_factory 测试确认未破坏**

Run: `cd backend && python -m pytest tests/test_llm_factory.py -v`
Expected: 原有测试可能因数据源切换失败（读旧表）—— 记录失败项，在 Task 5 统一更新。若全部通过则继续。

- [ ] **Step 6: 提交**

```bash
git add backend/app/agent/llm_factory.py backend/tests/test_llm_factory_unified.py
git commit -m "feat(provider): load_llm_configs reads from unified ProviderConfig table"
```

---

## Task 4: media.py _load_provider 改读 ProviderConfig

**Files:**
- Modify: `backend/app/routers/media.py:22,59-66`（import + `_load_provider`）
- Modify: `backend/tests/test_media_providers.py`（若依赖旧表）

**Interfaces:**
- Consumes: Task 1 的 `ProviderConfig`
- Produces: `_load_provider(db, provider_id)` 返回 `to_internal_dict()`，字段与原 `MediaProviderConfig.to_internal_dict()` 一致 + 新增 `default_model`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_media_providers.py` 末尾追加（若文件不存在则创建）：

```python
def test_load_provider_reads_unified_table(db):
    """_load_provider 从 ProviderConfig 表读。"""
    from app.models import ProviderConfig
    from app.routers.media import _load_provider

    db.add(ProviderConfig(
        provider_id="test-media", name="Test",
        base_url="https://media.example.com/v1", api_key="sk-media-1234567890",
        protocol="openai", enabled=True, chat_models_json='[]',
        image_models_json='["dall-e-3"]',
    ))
    db.commit()

    p = _load_provider(db, "test-media")
    assert p["provider_id"] == "test-media"
    assert p["base_url"] == "https://media.example.com/v1"
    assert p["api_key"] == "sk-media-1234567890"
    assert p["image_models"] == ["dall-e-3"]


def test_load_provider_404(db):
    """找不到 → 404。"""
    from app.routers.media import _load_provider
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        _load_provider(db, "nonexistent")
    assert exc.value.status_code == 404


def test_load_provider_disabled(db):
    """enabled=False → 400。"""
    from app.models import ProviderConfig
    from app.routers.media import _load_provider
    import pytest
    from fastapi import HTTPException

    db.add(ProviderConfig(
        provider_id="disabled", base_url="https://x", api_key="k",
        protocol="openai", enabled=False,
    ))
    db.commit()
    with pytest.raises(HTTPException) as exc:
        _load_provider(db, "disabled")
    assert exc.value.status_code == 400
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd backend && python -m pytest tests/test_media_providers.py::test_load_provider_reads_unified_table -v`
Expected: FAIL（`_load_provider` 仍读 `MediaProviderConfig`）

- [ ] **Step 3: 修改 _load_provider**

修改 `backend/app/routers/media.py`：

第 22 行 import 改为：
```python
from ..models import ProviderConfig
```

第 59-66 行 `_load_provider` 改为：
```python
def _load_provider(db: Session, provider_id: str) -> dict:
    """读 provider 明文配置（统一表 provider_configs）；找不到抛 404。"""
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"provider '{provider_id}' not found in DB")
    if not row.enabled:
        raise HTTPException(status_code=400, detail=f"provider '{provider_id}' is disabled")
    return row.to_internal_dict()
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd backend && python -m pytest tests/test_media_providers.py -v`
Expected: 新测试 passed；旧测试若依赖 MediaProviderConfig 表可能失败，记录待 Task 5 修。

- [ ] **Step 5: 提交**

```bash
git add backend/app/routers/media.py backend/tests/test_media_providers.py
git commit -m "feat(provider): media _load_provider reads from unified ProviderConfig"
```

---

## Task 5: provider CRUD 路由统一

**Files:**
- Modify: `backend/app/routers/llm_providers.py`（整文件改读 `ProviderConfig`）
- Modify: `backend/app/routers/media_providers.py`（media provider CRUD：list/get/put/patch/delete 全部改读 `ProviderConfig`；`MediaProviderIn` / `MediaProviderOut` schema 新增 `default_model` 字段）
- Modify: `backend/tests/test_llm_providers_crud.py`
- Modify: `backend/tests/test_media_providers.py`

**Interfaces:**
- Produces: `GET/PUT/PATCH/DELETE /api/media-providers` 和 `GET/PUT/DELETE /api/llm-providers` 都操作 `provider_configs` 表，返回字段统一（含 default_model + image_models + chat_models + video_models）

- [ ] **Step 1: 更新 llm_providers.py 路由**

修改 `backend/app/routers/llm_providers.py`：

第 17 行 import 改为：
```python
from ..models import ProviderConfig
```

`LLMProviderIn` 增加 image_models/video_models/protocol/enabled 字段（与 media 对齐）：
```python
class LLMProviderIn(BaseModel):
    """PUT body。前端表单提交。"""
    name: str = Field(default="", max_length=128)
    base_url: str = Field(..., min_length=1, max_length=512)
    api_key: str = Field(..., min_length=1)
    default_model: str = Field(default="", max_length=128)
    protocol: str = Field(default="openai", max_length=32)
    enabled: bool = True
    chat_models: List[str] = Field(default_factory=list)
    image_models: List[str] = Field(default_factory=list)
    video_models: List[str] = Field(default_factory=list)
    extra_config: dict = Field(default_factory=dict)
```

`LLMProviderOut` 增加字段：
```python
class LLMProviderOut(BaseModel):
    id: int
    provider_id: str
    name: str = ""
    base_url: str
    api_key: str  # 脱敏
    default_model: str = ""
    protocol: str = "openai"
    enabled: bool = True
    chat_models: List[str] = Field(default_factory=list)
    image_models: List[str] = Field(default_factory=list)
    video_models: List[str] = Field(default_factory=list)
    extra_config: dict = Field(default_factory=dict)
    has_key: bool = False
    key_preview: str = ""
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
```

CRUD 函数改为操作 `ProviderConfig`：
```python
import json as _json

@router.get("", response_model=List[LLMProviderOut])
def list_llm_providers(db: Session = Depends(get_db)):
    """列出所有 provider 配置（api_key 脱敏）。"""
    rows = db.query(ProviderConfig).order_by(ProviderConfig.provider_id).all()
    return [r.to_dict(mask_key=True) for r in rows]


@router.get("/{provider_id}", response_model=LLMProviderOut)
def get_llm_provider(provider_id: str, db: Session = Depends(get_db)):
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="provider not found")
    return row.to_dict(mask_key=True)


@router.put("/{provider_id}", response_model=LLMProviderOut)
def upsert_llm_provider(
    provider_id: str,
    body: LLMProviderIn,
    db: Session = Depends(get_db),
):
    """创建或更新一个 provider 配置（统一表）。"""
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if row:
        row.name = body.name
        row.base_url = body.base_url.rstrip("/")
        row.api_key = body.api_key
        row.default_model = body.default_model
        row.protocol = body.protocol
        row.enabled = body.enabled
        row.chat_models_json = _json.dumps(body.chat_models or [])
        row.image_models_json = _json.dumps(body.image_models or [])
        row.video_models_json = _json.dumps(body.video_models or [])
        row.extra_config_json = _json.dumps(body.extra_config or {})
    else:
        row = ProviderConfig(
            provider_id=provider_id,
            name=body.name,
            base_url=body.base_url.rstrip("/"),
            api_key=body.api_key,
            default_model=body.default_model,
            protocol=body.protocol,
            enabled=body.enabled,
            chat_models_json=_json.dumps(body.chat_models or []),
            image_models_json=_json.dumps(body.image_models or []),
            video_models_json=_json.dumps(body.video_models or []),
            extra_config_json=_json.dumps(body.extra_config or {}),
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row.to_dict(mask_key=True)


@router.delete("/{provider_id}")
def delete_llm_provider(provider_id: str, db: Session = Depends(get_db)):
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="provider not found")
    db.delete(row)
    db.commit()
    return {"deleted": provider_id}
```

- [ ] **Step 2: 更新 media_providers.py CRUD 路由**

修改 `backend/app/routers/media_providers.py`（注意：不是 `media.py`。`media.py` 只有 generate image/video，CRUD 在 `media_providers.py`）：

1. import 改为：`from ..models import ProviderConfig`
2. `MediaProviderIn` schema 新增 `default_model: str = Field(default="", max_length=128)`
3. `MediaProviderOut` schema 新增 `default_model: str = ""`
4. `_to_out` / `_apply_payload` 函数签名把 `MediaProviderConfig` 改为 `ProviderConfig`
5. 所有路由函数（`list_media_providers` / `get_media_provider` / `upsert_media_provider` / `patch_media_provider` / `delete_media_provider`）的 `db.query(MediaProviderConfig)` 改为 `db.query(ProviderConfig)`
6. `upsert_media_provider` 创建新行时用 `ProviderConfig(...)` 而非 `MediaProviderConfig(...)`，并传入 `default_model=body.default_model`
7. `_apply_payload` 新增 `default_model` 字段处理：`if "default_model" in payload and payload["default_model"] is not None: row.default_model = payload["default_model"]`

- [ ] **Step 3: 更新 test_llm_providers_crud.py**

修改 `backend/tests/test_llm_providers_crud.py`，确保 fixture 用 `ProviderConfig` 表清理，测试 body 包含新字段：

```python
# 在每个 PUT body 里加上 default_model
body = {
    "base_url": "https://api.openai.com/v1",
    "api_key": "sk-test-key-12345678",
    "default_model": "gpt-4o-mini",
    "name": "OpenAI",
    "protocol": "openai",
    "enabled": True,
    "chat_models": ["gpt-4o-mini", "gpt-4o"],
    "image_models": [],
    "video_models": [],
    "extra_config": {},
}
```

- [ ] **Step 4: 跑所有 provider 相关测试**

Run: `cd backend && python -m pytest tests/test_llm_providers_crud.py tests/test_media_providers.py -v`
Expected: 全部 passed

- [ ] **Step 5: 跑 agent e2e 测试确认未破坏**

Run: `cd backend && python -m pytest tests/test_agent_e2e.py tests/test_runtime_autostart.py -v`
Expected: passed（若失败，检查是否因 stub 依赖 — 那是 Plan 2 的范围，先记录）

- [ ] **Step 6: 提交**

```bash
git add backend/app/routers/llm_providers.py backend/app/routers/media.py backend/tests/test_llm_providers_crud.py backend/tests/test_media_providers.py
git commit -m "feat(provider): unify provider CRUD routes to ProviderConfig table"
```

---

## Task 6: 前端 ApiSettingsModal 合并 upsert 入口

**Files:**
- Modify: `components/infinite-canvas/ApiSettingsModal.tsx:408-430,488-496`
- Modify: `services/apiClient.ts:230-280`（upsertLLMProvider / upsertMediaProvider 参数对齐）
- Test: `tests/`（若有 ApiSettingsModal 测试）

**Interfaces:**
- Consumes: Task 5 的统一 `PUT /api/llm-providers/{id}` 接受完整字段
- Produces: `syncProviderToDb` 和 Agent LLM 保存按钮都调统一 upsert，写入同一张表

- [ ] **Step 1: 对齐 apiClient.ts 的 upsertLLMProvider 参数**

修改 `services/apiClient.ts` 的 `upsertLLMProvider`（约第 236 行），让它接受与 `upsertMediaProvider` 一致的字段：

```typescript
upsertLLMProvider: (
  providerId: string,
  payload: {
    name?: string;
    base_url: string;
    api_key: string;
    default_model?: string;
    protocol?: string;
    enabled?: boolean;
    chat_models?: string[];
    image_models?: string[];
    video_models?: string[];
    extra_config?: Record<string, any>;
  }
) =>
  request<LLMProviderOut>(`/llm-providers/${encodeURIComponent(providerId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }),
```

- [ ] **Step 2: 修改 ApiSettingsModal 的 Agent LLM 保存按钮**

修改 `components/infinite-canvas/ApiSettingsModal.tsx` 第 488-496 行的 `upsertLLMProvider` 调用，补齐字段：

```typescript
await api.upsertLLMProvider(f.provider_id.trim(), {
  name: f.name || f.provider_id.trim(),
  base_url: f.base_url.trim(),
  api_key: f.api_key,
  default_model: f.default_model.trim(),
  protocol: f.protocol || 'openai',
  enabled: f.enabled !== false,
  chat_models: f.chat_models_text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean),
  image_models: [],
  video_models: [],
  extra_config: {},
});
```

- [ ] **Step 3: 让 syncProviderToDb 也写 default_model**

修改 `syncProviderToDb`（第 408-430 行），让它调 `upsertMediaProvider` 时也带上 `default_model`（如果 media upsert 支持）或改调统一 upsert。

如果 `upsertMediaProvider` 的 schema 没有 default_model 字段，先在 media provider schema 里加上（后端 Task 5 已统一表，schema 对齐）。

- [ ] **Step 4: 跑前端测试**

Run: `npx vitest run tests/`
Expected: 前端测试 passed（若有 ApiSettingsModal 测试失败，更新断言）

- [ ] **Step 5: 手动验证**

启动后端 + 前端，打开 ApiSettingsModal，配一个 provider，保存。然后查 DB：
Run: `cd backend && python -c "from app.database import SessionLocal; from app.models import ProviderConfig; db=SessionLocal(); print(db.query(ProviderConfig).count(), 'rows'); db.close()"`
Expected: 行数符合预期（用户配的 provider 写入 provider_configs 表）

- [ ] **Step 6: 提交**

```bash
git add services/apiClient.ts components/infinite-canvas/ApiSettingsModal.tsx
git commit -m "feat(provider): unify ApiSettingsModal upsert to single ProviderConfig table"
```

---

## Task 7: agent-mode.tsx 简化 dbProviders 加载

**Files:**
- Modify: `agent/agent-mode.tsx:61-104`

**Interfaces:**
- Consumes: Task 5 的 `GET /api/llm-providers` 现在返回真实 provider 数据（含 default_model + chat_models）
- Produces: `dbProviders` 非空时自动选第一个，用户提交时 providerId 必定有效；fallback 到 apiConfig 的逻辑可保留但基本不会触发

- [ ] **Step 1: 简化 dbProviders 加载逻辑**

修改 `agent/agent-mode.tsx` 第 61-90 行的 useEffect，保持不变（已经从 `api.listLLMProviders()` 读）。现在后端返回真实数据，`dbProviders` 会非空。

第 94-104 行的 `availableProviders` fallback 逻辑保留（防御性，但基本不触发）。

- [ ] **Step 2: 确认 onSubmit 的 providerId 一定有效**

第 233-248 行的 `onSubmit` 逻辑保持不变。现在 `dbProviders` 非空时：
- `selectedProviderId` 在 useEffect 里自动设为 `dbProviders[0].provider_id`（第 75-78 行）
- 提交时 `providerId = selectedProviderId`（非空）
- 传给后端 `llm_provider_id`，后端在 `provider_configs` 表里能找到 → 走 real LLM

- [ ] **Step 3: 跑前端 agent 测试**

Run: `npx vitest run tests/agent/`
Expected: passed

- [ ] **Step 4: 手动端到端验证**

1. 启动后端 + 前端
2. 打开 Agent 模式
3. 顶栏 LLM 下拉框应有 `custom-api` 选项（来自 provider_configs 表）
4. 输入目标，点"创建任务"
5. ThoughtStream 应显示真实 LLM 思考内容（不是 _FAKE_SCRIPT）
6. banner 应显示"已连接真实 LLM"

- [ ] **Step 5: 提交**

```bash
git add agent/agent-mode.tsx
git commit -m "feat(provider): agent-mode loads providers from unified table"
```

---

## Task 8: 废弃旧表标记 + 清理 dead import

**Files:**
- Modify: `backend/app/models.py`（给 `LLMProviderConfig` / `MediaProviderConfig` 加 deprecation 注释，但不删类，保留一版作回滚）
- Modify: `backend/app/routers/agent.py:24`（删除未使用的 `DevScriptedLLM` import — 这是 dead import，与 Plan 2 重叠但顺手清）

- [ ] **Step 1: 给旧模型加废弃注释**

在 `backend/app/models.py` 的 `LLMProviderConfig` 和 `MediaProviderConfig` 类的 docstring 里加：
```python
"""[DEPRECATED] 已迁移到 ProviderConfig 统一表。保留此类仅作数据回滚兜底，
下一版清理时删除。新代码不要用。
"""
```

- [ ] **Step 2: 删除 agent.py 的 dead import**

修改 `backend/app/routers/agent.py` 第 24 行，删除：
```python
from ..agent.dev_scripted_llm import DevScriptedLLM
```
（_spawn_runtime 不再直接用 DevScriptedLLM，由 select_llm_for_task 内部决定）

- [ ] **Step 3: 跑全量后端测试**

Run: `cd backend && python -m pytest tests/ -v --ignore=tests/test_llm_factory.py`
Expected: 主要测试 passed（test_llm_factory.py 里依赖 DevScriptedLLM stub 分支的测试在 Plan 2 处理）

- [ ] **Step 4: 提交**

```bash
git add backend/app/models.py backend/app/routers/agent.py
git commit -m "chore(provider): mark old tables deprecated, remove dead import"
```

---

## Self-Review

**1. Spec coverage 检查：**
- 合并两张表为一张 → Task 1（新建模型）+ Task 2（迁移）✓
- agent 后端读新表 → Task 3（load_llm_configs）✓
- canvas 媒体读新表 → Task 4（_load_provider）+ Task 5（CRUD）✓
- 前端 ApiSettingsModal 合并 → Task 6 ✓
- agent-mode 简化 → Task 7 ✓
- 旧表废弃 → Task 8 ✓
- 用户配一次两处可用 → Task 7 Step 4 端到端验证 ✓

**2. Placeholder 扫描：**
- 无 "TBD" / "TODO" / "implement later"
- 所有代码步骤都有完整代码
- Task 5 Step 2 的 media CRUD 修改用了"grep 定位"而非精确行号 — 因为 media.py 的 provider CRUD 路由位置需要运行时确认，这是合理的（不是占位符，是定位指令）

**3. Type 一致性：**
- `ProviderConfig.to_internal_dict()` 在 Task 1 定义，Task 4 的 `_load_provider` 使用，字段一致（provider_id/base_url/api_key/protocol/enabled/image_models/chat_models/video_models/extra_config + default_model）✓
- `load_llm_configs` 返回 `list[LLMProviderConfig]`（dataclass），Task 3 实现里字段 provider_id/base_url/api_key/default_model 一致 ✓
- `LLMProviderIn` / `LLMProviderOut` 在 Task 5 定义，Task 6 前端 upsert 调用字段对齐 ✓

**4. 跨 plan 边界：**
- 本 plan 不触碰 canvas LLM 文本流式（services/llmClient.ts）→ Plan 3 范围 ✓
- 本 plan 不删 DevScriptedLLM 类（只删 dead import）→ Plan 2 范围 ✓
- 本 plan 不动 stepBindings → Plan 4 范围 ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-04-provider-unification.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
