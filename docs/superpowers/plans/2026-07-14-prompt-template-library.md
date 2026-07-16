# Prompt Template Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the reference project's prompt template library — 10 built-in image prompt templates with full backend CRUD, DB persistence, and a frontend side panel with search/filter/edit/insert.

**Architecture:** Backend adds a `prompt_templates` table (SQLAlchemy) + FastAPI router with CRUD endpoints. Built-in templates are seeded on app startup. Frontend adds a `PromptLibraryPanel` component (right-side overlay) with search, category filter, inline editor, and insert callback. API client gets a new `promptTemplates` namespace.

**Tech Stack:** FastAPI + SQLAlchemy + SQLite (backend), React 19 + TypeScript (frontend), Vitest + pytest (testing)

## Global Constraints

- Python 3.12+, FastAPI 0.115+
- React 19.2.3, TypeScript 5.8, Vite 6.2
- DB: SQLite via SQLAlchemy, timezone Asia/Shanghai (UTC+8)
- Existing `request<T>()` helper in `services/apiClient.ts` for all frontend HTTP
- Existing `Base` from `backend/app/database.py` for all ORM models
- Existing `_now()` from `backend/app/models.py` for timestamps
- Router registration in both `backend/app/routers/__init__.py` and `backend/app/__init__.py`
- Tests: backend `pytest`, frontend `vitest`

---

### Task 1: Backend Model + Schemas

**Files:**
- Modify: `backend/app/models.py` (append PromptTemplate class at end)
- Modify: `backend/app/schemas.py` (append prompt template schemas at end)
- Test: `backend/tests/test_prompt_templates.py` (create)

**Interfaces:**
- Produces: `models.PromptTemplate` (ORM model), `schemas.PromptTemplateOut`, `schemas.PromptTemplateCreate`, `schemas.PromptTemplateUpdate`, `schemas.PromptTemplateBatchDelete`

- [ ] **Step 1: Write the failing test for model + schemas**

Create `backend/tests/test_prompt_templates.py`:

```python
"""Prompt template CRUD tests."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models import PromptTemplate


@pytest.fixture
def client():
    """In-memory SQLite test client."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
            finally:
                db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_prompt_template_model_exists():
    """PromptTemplate ORM model can be instantiated."""
    tmpl = PromptTemplate(
        id="test_1",
        name="Test Template",
        category="character",
        scene="Test scene",
        positive="A test prompt",
        negative="bad quality",
        params={"Midjourney": "--ar 1:1"},
        is_builtin=False,
    )
    assert tmpl.id == "test_1"
    assert tmpl.name == "Test Template"
    assert tmpl.is_builtin is False


def test_schema_imports():
    """All prompt template schemas can be imported."""
    from app.schemas import (
        PromptTemplateOut,
        PromptTemplateCreate,
        PromptTemplateUpdate,
        PromptTemplateBatchDelete,
    )
    assert PromptTemplateOut is not None
    assert PromptTemplateCreate is not None
    assert PromptTemplateUpdate is not None
    assert PromptTemplateBatchDelete is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_prompt_templates.py::test_prompt_template_model_exists tests/test_prompt_templates.py::test_schema_imports -v`
Expected: FAIL — `ImportError: cannot import name 'PromptTemplate'` / `cannot import name 'PromptTemplateOut'`

- [ ] **Step 3: Add PromptTemplate model to models.py**

Append to end of `backend/app/models.py`:

```python
class PromptTemplate(Base):
    """提示词模板 — 内置 + 用户自定义。

    内置模板 (is_builtin=True) 在 app startup 时 seed，可编辑不可删除。
    用户模板 (is_builtin=False) 通过 API 增删改查。
    """
    __tablename__ = "prompt_templates"

    id = Column(String, primary_key=True)  # "builtin_md_1" or "tpl_<hex12>"
    name = Column(String, nullable=False)
    category = Column(String, nullable=False, default="custom")
    scene = Column(Text, default="")
    positive = Column(Text, default="")
    negative = Column(Text, default="")
    params = Column(JSON, default=dict)
    is_builtin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        """Serialize for API response."""
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "scene": self.scene or "",
            "positive": self.positive or "",
            "negative": self.negative or "",
            "params": self.params or {},
            "is_builtin": self.is_builtin,
            "created_at": _iso(self.created_at),
            "updated_at": _iso(self.updated_at),
        }
```

- [ ] **Step 4: Add schemas to schemas.py**

Append to end of `backend/app/schemas.py`:

```python
# ============ PromptTemplate ============
class PromptTemplateOut(BaseModel):
    id: str
    name: str
    category: str
    scene: str = ""
    positive: str = ""
    negative: str = ""
    params: dict = {}
    is_builtin: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class PromptTemplateCreate(BaseModel):
    name: str
    category: str = "custom"
    scene: str = ""
    positive: str = ""
    negative: str = ""
    params: dict = {}


class PromptTemplateUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    scene: Optional[str] = None
    positive: Optional[str] = None
    negative: Optional[str] = None
    params: Optional[dict] = None


class PromptTemplateBatchDelete(BaseModel):
    ids: List[str] = []
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_prompt_templates.py::test_prompt_template_model_exists tests/test_prompt_templates.py::test_schema_imports -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/tests/test_prompt_templates.py
git commit -m "feat(prompt-templates): add ORM model and Pydantic schemas"
```

---

### Task 2: Backend Seed Data

**Files:**
- Create: `backend/app/agent/prompt_template_seed.py`
- Test: `backend/tests/test_prompt_templates.py` (append seed test)

**Interfaces:**
- Produces: `BUILTIN_PROMPT_TEMPLATES` (list[dict]), `seed_builtin_prompt_templates(db)`

- [ ] **Step 1: Write the failing test for seeding**

Append to `backend/tests/test_prompt_templates.py`:

```python
def test_seed_creates_10_builtins():
    """seed_builtin_prompt_templates creates exactly 10 builtin rows on first call."""
    from app.agent.prompt_template_seed import seed_builtin_prompt_templates
    from app.database import SessionLocal

    # Use the test DB (in-memory, already has tables from client fixture)
    # We need a fresh DB session — recreate using the client's engine
    # Simpler: just call seed and check via API
    # This test uses the client fixture's DB
    pass  # Will implement properly after seed function exists
```

Actually, let's write a proper test:

```python
def test_seed_builtin_prompt_templates():
    """seed_builtin_prompt_templates inserts 10 builtin templates, idempotent."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database import Base
    from app.agent.prompt_template_seed import seed_builtin_prompt_templates, BUILTIN_PROMPT_TEMPLATES
    from app.models import PromptTemplate

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # First call: seed 10 builtins
    with SessionLocal() as db:
        seed_builtin_prompt_templates(db)
        count = db.query(PromptTemplate).filter(PromptTemplate.is_builtin == True).count()
        assert count == 10

    # Second call: no duplicates
    with SessionLocal() as db:
        seed_builtin_prompt_templates(db)
        count = db.query(PromptTemplate).filter(PromptTemplate.is_builtin == True).count()
        assert count == 10

    # Check first template has expected fields
    with SessionLocal() as db:
        first = db.query(PromptTemplate).filter_by(id="builtin_md_1").first()
        assert first is not None
        assert first.name == "多机位九宫格"
        assert first.category == "character"
        assert len(first.positive) > 100
        assert first.is_builtin is True

    # Check all 10 have non-empty positive
    with SessionLocal() as db:
        builtins = db.query(PromptTemplate).filter(PromptTemplate.is_builtin == True).all()
        for b in builtins:
            assert len(b.positive) > 50, f"Template {b.id} has empty positive"
            assert len(b.negative) > 20, f"Template {b.id} has empty negative"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_prompt_templates.py::test_seed_builtin_prompt_templates -v`
Expected: FAIL — `ImportError: cannot import name 'seed_builtin_prompt_templates'`

- [ ] **Step 3: Create the seed data file**

Create `backend/app/agent/prompt_template_seed.py` with the 10 built-in templates. Content copied verbatim from the reference project's `prompt_libraries.json`:

```python
"""10 个内置提示词模板 — 内容来自参考项目 prompt_libraries.json。

启动时由 seed_builtin_prompt_templates() 写入 DB（幂等）。
内置模板可编辑不可删除。
"""
from __future__ import annotations
import uuid
from typing import Any

BUILTIN_PROMPT_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "builtin_md_1",
        "name": "多机位九宫格",
        "category": "character",
        "scene": "同一主体/场景，9个不同机位/角度同时呈现，用于角色多角度参考、产品展示、空间勘测",
        "positive": "A multi-camera angle reference sheet in 3x3 grid layout, showing [主体] from 9 different perspectives simultaneously: top-left front view, top-center 3/4 front view, top-right side profile, middle-left low angle, middle-center eye-level straight-on, middle-right high angle, bottom-left back view, bottom-center 3/4 back view, bottom-right top-down overhead view. [主体详细描述]. Consistent lighting across all 9 frames, uniform light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, professional studio photography, clean grid layout with thin white dividers between frames, character consistency maintained across all angles, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, lighting mismatch between frames, blurry, low quality, cropped, out of frame",
        "params": {
            "Midjourney": "`--ar 1:1 --style raw --s 50`",
            "即梦/可灵": "直接粘贴，开启「参考图」锁一致性",
            "Flux": "配合 `add_detail` LoRA，CFG 3.5-5.0",
        },
    },
    {
        "id": "builtin_md_2",
        "name": "多机位九宫格4K",
        "category": "storyboard",
        "scene": "高分辨率版本的多机位九宫格，用于印刷级输出、大屏展示、精细材质参考",
        "positive": "Ultra high resolution multi-camera angle reference sheet in 3x3 grid layout, 4K quality, showing [主体] from 9 different perspectives simultaneously: top-left front view, top-center 3/4 front view, top-right side profile, middle-left low angle, middle-center eye-level straight-on, middle-right high angle, bottom-left back view, bottom-center 3/4 back view, bottom-right top-down overhead view. [主体详细描述]. Consistent cinematic lighting across all 9 frames, uniform light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, professional studio photography with medium format film aesthetic, clean grid layout with thin white dividers between frames, character consistency maintained across all angles, fine organic film grain, zero digital sharpening, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, lighting mismatch between frames, blurry, low quality, cropped, out of frame, digital sharpening, oversharpened, plastic skin, over-smoothing",
        "params": {
            "Midjourney": "`--ar 1:1 --style raw --s 50 --q 2`",
            "即梦/可灵": "选择「高清」或「4K」模式",
            "Flux": "开启 Tiled VAE 或 hires fix",
        },
    },
    {
        "id": "builtin_md_3",
        "name": "剧情推演四宫格",
        "category": "storyboard",
        "scene": "同一事件的4个连续阶段/情绪递进，用于故事板预览、情绪弧线设计、叙事节奏测试",
        "positive": "A 4-panel storyboard sequence in 2x2 grid, showing narrative progression of [事件/场景]: top-left [阶段1描述], top-right [阶段2描述], bottom-left [阶段3描述], bottom-right [阶段4描述]. Consistent character design across all panels, coherent lighting and color palette, uniform light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, cinematic composition, emotional arc from [情绪A] to [情绪B], film grain texture, clean thin white grid dividers, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, lighting mismatch between frames, discontinuous action, jump cut feel, blurry, low quality, cropped, out of frame",
        "params": {
            "Midjourney": "`--ar 1:1 --style raw --s 75`",
            "即梦/可灵": "直接粘贴，建议分镜时先写情绪词再填场景",
            "Flux": "配合 `film grain` LoRA 增强故事板质感",
        },
    },
    {
        "id": "builtin_md_4",
        "name": "角色脸部三视图",
        "category": "character",
        "scene": "角色面部正面/侧面/四分之三侧面的设定参考，用于Actor ID锁定、表情一致性控制",
        "positive": "Character face reference sheet, three views side by side in single row: left panel front view straight-on, center panel 3/4 angle view, right panel side profile view. [角色面部详细描述]. Consistent lighting from 45-degree top-side across all three views, light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, neutral clean backdrop, professional character design sheet, clean linework, subtle skin texture, identical facial features maintained across all angles, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, asymmetrical eyes, crossed eyes, extra fingers, deformed hands, inconsistent facial features between panels, lighting mismatch, blurry, low quality, cropped, out of frame",
        "params": {
            "Midjourney": "`--ar 16:9 --style raw --s 50`",
            "即梦/可灵": "上传参考图锁定Actor ID后使用",
            "Flux": "开启面部修复 + 一致性采样器",
        },
    },
    {
        "id": "builtin_md_5",
        "name": "产品三视图",
        "category": "product",
        "scene": "产品设计的正面/侧面/顶面展示，用于工业设计、电商详情、技术文档",
        "positive": "Product design reference sheet, three orthographic views in single row: front view, side view, top view. [产品详细描述]. Light warm gray background color F0EDE8, products softly blending with background with natural edge transition, no hard edges no white halo no light bleed, studio lighting with soft shadows, technical drawing aesthetic, precise proportions, material texture visible, no perspective distortion, professional product photography, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, distorted proportions, perspective distortion, blurry, low quality, cropped, out of frame, cluttered background, random objects, inconsistent material texture between views",
        "params": {
            "Midjourney": "`--ar 16:9 --style raw --s 50`",
            "即梦/可灵": "浅暖灰背景建议加 `--no gradient background`",
            "Flux": "配合 `product photography` LoRA",
        },
    },
    {
        "id": "builtin_md_6",
        "name": "25宫格连贯分镜",
        "category": "storyboard",
        "scene": "完整场景/动作的25帧连续分镜，5×5网格承载9个叙事节拍，用于电影分镜预览、动作连贯性测试、Seedance分段参考",
        "positive": "A 5x5 cinematic storyboard grid, 25 sequential frames showing continuous narrative flow of [主体/场景/动作], naturally divided into 9 story beats progressing through beginning, development, escalation, twist, climax, and resolution. Scene transitions conveyed purely through visual continuity and character motion, absolutely no visible numbers, text, labels, frame counters, corner marks, or annotations anywhere on the image. Consistent character and environment across all 25 frames, smooth motion continuity between adjacent frames, uniform cinematic lighting and color palette, light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, varied shot progression from wide to close-up, professional film storyboard aesthetic, subtle film grain, clean thin white grid dividers",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, lighting mismatch between frames, discontinuous action, jump cut feel, blurry, low quality, cropped, out of frame, different hairstyle between frames, different clothing between frames",
        "params": {
            "Midjourney": "`--ar 1:1 --style raw --s 75 --q 2`",
            "即梦/可灵": "建议先测试单格效果再生成25格，分段生成更可控",
            "Flux": "开启 `Batch count: 1`，CFG 4.0，配合 `storyboard` LoRA",
        },
    },
    {
        "id": "builtin_md_7",
        "name": "电影级光影校正",
        "category": "lighting",
        "scene": "同一场景在不同光影条件下的对比展示，用于灯光方案测试、色调选择、情绪对照",
        "positive": "Cinematic lighting comparison sheet, 6 panels showing the same [主体/场景] under different lighting conditions: top-left golden hour warm backlight, top-center overcast soft diffused light, top-right neon night city light, bottom-left harsh midday direct sun, bottom-center Rembrandt 45-degree side light with triangle shadow, bottom-right dramatic low-key chiaroscuro. Consistent composition and subject across all panels, only lighting changes, light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, professional cinematography reference, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, inconsistent subject between panels, different pose between panels, different costume between panels, cluttered background, blurry, low quality, cropped, out of frame",
        "params": {
            "Midjourney": "`--ar 3:2 --style raw --s 50`",
            "即梦/可灵": "适合作为「Talk to Edit」的光影参考基底图",
            "Flux": "配合 `cinematic lighting` LoRA",
        },
    },
    {
        "id": "builtin_md_8",
        "name": "角色设定参考表（胸口特写+全身三视图）",
        "category": "character",
        "scene": "角色一致性设定参考：左侧1/3脸部大特写锚定面部，右侧2/3三格横排全身三视图（正/侧/背）锚定服装与身形，用于Actor ID锁定、服装一致性控制、Seedance Canvas故事板",
        "positive": "Character reference sheet, left-right split layout: left one-third area is chest-up close-up front view portrait (shoulder-up framing, extreme facial detail clarity, gentle natural expression, bright eyes looking straight at camera, realistic skin texture with visible pores and subtle imperfections, refined classical makeup); right two-thirds area is three full-body views in horizontal row, from left to right: full-body front standing pose (arms hanging naturally, feet together, complete front costume and body proportions), full-body side profile view (weight slightly shifted, waist-hip curve and silhouette visible, complete side costume and footwear), full-body back view (complete back neckline, hairstyle from behind, back costume details). Consistent front-top-side lighting across all panels, soft diffused light quality, light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, identical character design, costume, hairstyle and accessories across all panels, professional character design sheet style, clean edges, accurate proportions, material texture visible from all angles, absolutely no visible numbers, text, labels, frame counters, corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, dividing line labels, panel markers, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, lighting mismatch between frames, different hairstyle between panels, different clothing between panels, blurry, low quality, cropped, out of frame, asymmetrical eyes, crossed eyes, plastic skin, over-smoothing, textureless skin, uniform skin tone, digital sharpening, filter look, CG look, retouched, airbrushed, multiple heads, mutated limbs, floating limbs, disconnected limbs, uneven panel sizes, broken layout",
        "params": {
            "Midjourney": "`--ar 16:9 --style raw --s 50 --q 2`",
            "即梦/可灵": "上传此图作为Actor ID参考，Canvas锁脸首选",
            "Flux": "开启面部一致性 + 服装一致性双重采样",
        },
    },
    {
        "id": "builtin_md_9",
        "name": "6种基础表情胸像（2×3六宫格）",
        "category": "character",
        "scene": "同一角色六种基础表情同时呈现，用于表情一致性控制、情绪基准设定、Seedance Talk to Edit表情参考",
        "positive": "Character expression reference sheet in 2x3 grid layout, six basic expressions of the same character: top row from left to right: calm neutral expression (relaxed face, eyes looking straight ahead, lips naturally closed), gentle smile (corners of mouth slightly raised, eyes with smile lines, warm and approachable), joyful laugh (eyebrows and eyes curved upward, mouth open showing teeth, exuberant happiness); bottom row from left to right: sad tearful expression (slight furrow between brows, downturned outer eye corners, tears welling in eyes about to fall), angry stern expression (brows tightly locked, sharp piercing eyes with pressure, jaw slightly set), surprised astonished expression (eyes wide open, eyebrows raised high, mouth slightly open in O shape). All six expressions are chest-up close-up portraits of the same character, shoulder-up framing, extreme facial detail clarity, realistic skin texture preserved, no additional light source, light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, identical character styling, hairstyle, makeup and accessories across all six panels, only facial expression changes, professional character expression sheet style, clean edges, absolutely no visible numbers, text, labels, frame counters, corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, expression name labels, emotion text, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, different hairstyle between panels, different clothing between panels, lighting mismatch between panels, blurry, low quality, cropped, out of frame, asymmetrical eyes, crossed eyes, plastic skin, over-smoothing, textureless skin, uniform skin tone, digital sharpening, filter look, CG look, retouched, airbrushed, multiple heads, mutated limbs, floating limbs, disconnected limbs, uneven panel sizes, broken layout, extra rows, extra columns, missing panel, shadows on face, directional light, dramatic lighting, colored light",
        "params": {
            "Midjourney": "`--ar 3:2 --style raw --s 50`",
            "即梦/可灵": "直接粘贴，建议开启「参考图」锁角色一致性",
            "Flux": "配合 `add_detail` + 面部一致性采样器",
        },
    },
    {
        "id": "builtin_md_10",
        "name": "360全景图",
        "category": "view",
        "scene": "用于生成360全景、VR全景、可左右循环拼接的空间视角图，适合室内空间、展厅、场景漫游、环境概念设计；封闭场景需要具备合理出入口。",
        "positive": "生成一个720度的全景VR图，左右边缘100%像素级无缝衔接，可无限循环拼接；上下极点(南北极)自然过渡，无明显断层或拉伸，场景一致性，以及场景的逻辑性，封闭场景需要有门",
        "negative": "seam, visible seam, hard seam, broken panorama, discontinuous edge, mismatched left and right edges, distorted poles, stretched ceiling, stretched floor, warped horizon, inconsistent scene logic, impossible space, no exit in closed room, text, letters, labels, watermark, logo, blurry, low quality",
        "params": {},
    },
]


def seed_builtin_prompt_templates(db) -> None:
    """Idempotent seeding: insert missing builtin templates, do not touch existing ones.

    Called on app startup. If all 10 builtins exist, does nothing.
    If some are missing (e.g. new version added templates), inserts only the missing ones.
    Does NOT overwrite user edits to builtin templates.
    """
    from ..models import PromptTemplate

    existing_ids = {
        row.id for row in db.query(PromptTemplate).filter(PromptTemplate.is_builtin == True).all()
    }
    missing = [t for t in BUILTIN_PROMPT_TEMPLATES if t["id"] not in existing_ids]
    for tmpl in missing:
        db.add(PromptTemplate(
            id=tmpl["id"],
            name=tmpl["name"],
            category=tmpl["category"],
            scene=tmpl["scene"],
            positive=tmpl["positive"],
            negative=tmpl["negative"],
            params=tmpl.get("params", {}),
            is_builtin=True,
        ))
    if missing:
        db.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_prompt_templates.py::test_seed_builtin_prompt_templates -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/prompt_template_seed.py backend/tests/test_prompt_templates.py
git commit -m "feat(prompt-templates): add 10 built-in template seed data"
```

---

### Task 3: Backend CRUD Router

**Files:**
- Create: `backend/app/routers/prompt_templates.py`
- Modify: `backend/app/routers/__init__.py`
- Modify: `backend/app/__init__.py`
- Test: `backend/tests/test_prompt_templates.py` (append CRUD tests)

**Interfaces:**
- Consumes: `models.PromptTemplate`, `schemas.PromptTemplate*`, `prompt_template_seed.seed_builtin_prompt_templates`
- Produces: `routers.prompt_templates.router` (FastAPI APIRouter)

- [ ] **Step 1: Write failing CRUD tests**

Append to `backend/tests/test_prompt_templates.py`:

```python
def test_list_templates_empty():
    """GET /api/prompt-templates returns empty list when no data."""
    # Use a fresh client (no seeding)
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database import Base, get_db
    from app.main import app

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
            finally:
                db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    resp = client.get("/api/prompt-templates")
    assert resp.status_code == 200
    assert resp.json() == []
    app.dependency_overrides.clear()


def test_create_and_get_template():
    """POST then GET a user template."""
    client = _seeded_client()
    resp = client.post("/api/prompt-templates", json={
        "name": "My Template",
        "category": "character",
        "scene": "custom scene",
        "positive": "a positive prompt",
        "negative": "bad quality",
        "params": {"Flux": "CFG 4.0"},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "My Template"
    assert data["is_builtin"] is False
    assert data["id"].startswith("tpl_")

    # GET by id
    resp2 = client.get(f"/api/prompt-templates/{data['id']}")
    assert resp2.status_code == 200
    assert resp2.json()["name"] == "My Template"


def test_list_with_category_filter():
    """GET /api/prompt-templates?category=character returns only character templates."""
    client = _seeded_client()
    resp = client.get("/api/prompt-templates?category=character")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) >= 3  # builtin_md_1, builtin_md_4, builtin_md_8, builtin_md_9
    for item in items:
        assert item["category"] == "character"


def test_update_template():
    """PUT updates a template."""
    client = _seeded_client()
    resp = client.post("/api/prompt-templates", json={
        "name": "Original", "category": "custom", "positive": "old",
    })
    tid = resp.json()["id"]
    resp2 = client.put(f"/api/prompt-templates/{tid}", json={"name": "Updated", "positive": "new"})
    assert resp2.status_code == 200
    assert resp2.json()["name"] == "Updated"
    assert resp2.json()["positive"] == "new"


def test_delete_user_template():
    """DELETE removes a user template."""
    client = _seeded_client()
    resp = client.post("/api/prompt-templates", json={"name": "To Delete", "positive": "x"})
    tid = resp.json()["id"]
    resp2 = client.delete(f"/api/prompt-templates/{tid}")
    assert resp2.status_code == 200
    # Confirm gone
    resp3 = client.get(f"/api/prompt-templates/{tid}")
    assert resp3.status_code == 404


def test_delete_builtin_rejected():
    """DELETE on builtin template returns 403."""
    client = _seeded_client()
    resp = client.delete("/api/prompt-templates/builtin_md_1")
    assert resp.status_code == 403


def test_batch_delete():
    """POST /batch-delete removes multiple user templates."""
    client = _seeded_client()
    ids = []
    for i in range(3):
        resp = client.post("/api/prompt-templates", json={"name": f"Batch {i}", "positive": "x"})
        ids.append(resp.json()["id"])
    resp2 = client.post("/api/prompt-templates/batch-delete", json={"ids": ids})
    assert resp2.status_code == 200
    assert resp2.json()["removed"] == 3


def _seeded_client():
    """Test client with 10 builtin templates pre-seeded."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database import Base, get_db
    from app.main import app
    from app.agent.prompt_template_seed import seed_builtin_prompt_templates

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    with SessionLocal() as db:
        seed_builtin_prompt_templates(db)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
            finally:
                db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_prompt_templates.py -v -k "test_create_and_get or test_list_with_category or test_delete_builtin"`
Expected: FAIL — routes not found (404)

- [ ] **Step 3: Create the router**

Create `backend/app/routers/prompt_templates.py`:

```python
"""Prompt template CRUD router — 内置 + 用户自定义提示词模板。"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import PromptTemplate
from .. import schemas

router = APIRouter()


@router.get("", response_model=list[schemas.PromptTemplateOut])
def list_templates(
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List all templates; optional ?category= filter."""
    q = db.query(PromptTemplate)
    if category:
        q = q.filter(PromptTemplate.category == category)
    return [t.to_dict() for t in q.order_by(PromptTemplate.created_at.desc()).all()]


@router.get("/{template_id}", response_model=schemas.PromptTemplateOut)
def get_template(template_id: str, db: Session = Depends(get_db)):
    tmpl = db.query(PromptTemplate).filter_by(id=template_id).first()
    if not tmpl:
        raise HTTPException(404, f"Template {template_id} not found")
    return tmpl.to_dict()


@router.post("", response_model=schemas.PromptTemplateOut)
def create_template(body: schemas.PromptTemplateCreate, db: Session = Depends(get_db)):
    tmpl = PromptTemplate(
        id=f"tpl_{uuid.uuid4().hex[:12]}",
        name=body.name,
        category=body.category,
        scene=body.scene,
        positive=body.positive,
        negative=body.negative,
        params=body.params,
        is_builtin=False,
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return tmpl.to_dict()


@router.put("/{template_id}", response_model=schemas.PromptTemplateOut)
def update_template(
    template_id: str,
    body: schemas.PromptTemplateUpdate,
    db: Session = Depends(get_db),
):
    tmpl = db.query(PromptTemplate).filter_by(id=template_id).first()
    if not tmpl:
        raise HTTPException(404, f"Template {template_id} not found")
    if body.name is not None:
        tmpl.name = body.name
    if body.category is not None:
        tmpl.category = body.category
    if body.scene is not None:
        tmpl.scene = body.scene
    if body.positive is not None:
        tmpl.positive = body.positive
    if body.negative is not None:
        tmpl.negative = body.negative
    if body.params is not None:
        tmpl.params = body.params
    db.commit()
    db.refresh(tmpl)
    return tmpl.to_dict()


@router.delete("/{template_id}")
def delete_template(template_id: str, db: Session = Depends(get_db)):
    tmpl = db.query(PromptTemplate).filter_by(id=template_id).first()
    if not tmpl:
        raise HTTPException(404, f"Template {template_id} not found")
    if tmpl.is_builtin:
        raise HTTPException(403, "Cannot delete built-in template")
    db.delete(tmpl)
    db.commit()
    return {"ok": True}


@router.post("/batch-delete")
def batch_delete_templates(
    body: schemas.PromptTemplateBatchDelete,
    db: Session = Depends(get_db),
):
    ids = set(body.ids)
    if not ids:
        raise HTTPException(400, "No template IDs provided")
    rows = db.query(PromptTemplate).filter(PromptTemplate.id.in_(ids)).all()
    removed = 0
    for row in rows:
        if row.is_builtin:
            continue  # Skip builtins silently
        db.delete(row)
        removed += 1
    db.commit()
    return {"removed": removed}
```

- [ ] **Step 4: Register router in `__init__.py` files**

In `backend/app/routers/__init__.py`, add `prompt_templates` to imports and `__all__`:

```python
from . import (
    projects,
    assets,
    uploads,
    agent,
    llm_providers,
    media_providers,
    media,
    providers,
    drama_tasks,
    user_preferences,
    prompt_templates,
)

__all__ = [
    "projects",
    "assets",
    "uploads",
    "agent",
    "llm_providers",
    "media_providers",
    "media",
    "providers",
    "drama_tasks",
    "user_preferences",
    "prompt_templates",
]
```

In `backend/app/__init__.py`, add import + include_router + seed on startup:

```python
# Add to import line:
from .routers import projects, assets, uploads, agent, llm_providers, media_providers, media, providers, drama_tasks, user_preferences, prompt_templates

# Add after user_preferences include_router:
app.include_router(prompt_templates.router, prefix="/api/prompt-templates", tags=["prompt-templates"])

# Modify startup to seed templates:
@app.on_event("startup")
def on_startup():
    init_db()
    # Seed builtin prompt templates
    from .database import SessionLocal
    from .agent.prompt_template_seed import seed_builtin_prompt_templates
    with SessionLocal() as db:
        seed_builtin_prompt_templates(db)
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_prompt_templates.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/prompt_templates.py backend/app/routers/__init__.py backend/app/__init__.py backend/tests/test_prompt_templates.py
git commit -m "feat(prompt-templates): add CRUD router with builtin seeding on startup"
```

---

### Task 4: Frontend API Client

**Files:**
- Modify: `services/apiClient.ts` (append promptTemplates section)
- Test: `tests/prompt-library/api-client.test.ts` (create)

**Interfaces:**
- Produces: `PromptTemplateOut` interface, `promptTemplates` API object

- [ ] **Step 1: Write failing test**

Create `tests/prompt-library/api-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promptTemplates, PromptTemplateOut } from '../../services/apiClient';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(data: any, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(data),
    json: async () => data,
  } as Response;
}

beforeEach(() => mockFetch.mockReset());

describe('promptTemplates API', () => {
  it('list() calls GET /api/prompt-templates', async () => {
    const items: PromptTemplateOut[] = [
      { id: 'builtin_md_1', name: 'Test', category: 'character', scene: '', positive: 'p', negative: 'n', params: {}, is_builtin: true, created_at: '', updated_at: '' },
    ];
    mockFetch.mockResolvedValue(mockResponse(items));
    const result = await promptTemplates.list();
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prompt-templates',
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result).toEqual(items);
  });

  it('list(category) adds query param', async () => {
    mockFetch.mockResolvedValue(mockResponse([]));
    await promptTemplates.list('character');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prompt-templates?category=character',
      expect.any(Object)
    );
  });

  it('create() sends POST', async () => {
    const created = { id: 'tpl_abc', name: 'New', category: 'custom', scene: '', positive: 'p', negative: '', params: {}, is_builtin: false, created_at: '', updated_at: '' };
    mockFetch.mockResolvedValue(mockResponse(created));
    const result = await promptTemplates.create({ name: 'New', category: 'custom', scene: '', positive: 'p', negative: '', params: {} });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prompt-templates',
      expect.objectContaining({ method: 'POST', body: expect.any(String) })
    );
    expect(result.id).toBe('tpl_abc');
  });

  it('update() sends PUT', async () => {
    mockFetch.mockResolvedValue(mockResponse({ id: 'tpl_abc', name: 'Updated' }));
    await promptTemplates.update('tpl_abc', { name: 'Updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prompt-templates/tpl_abc',
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('remove() sends DELETE', async () => {
    mockFetch.mockResolvedValue(mockResponse({ ok: true }));
    await promptTemplates.remove('tpl_abc');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prompt-templates/tpl_abc',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt-library/api-client.test.ts`
Expected: FAIL — `promptTemplates` is not exported

- [ ] **Step 3: Add promptTemplates to apiClient.ts**

Append to end of `services/apiClient.ts`:

```typescript
// ============ Prompt Templates ============
export interface PromptTemplateOut {
  id: string;
  name: string;
  category: string;
  scene: string;
  positive: string;
  negative: string;
  params: Record<string, string>;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export const promptTemplates = {
  list: (category?: string) =>
    request<PromptTemplateOut[]>(
      category ? `/prompt-templates?category=${category}` : '/prompt-templates'
    ),
  get: (id: string) =>
    request<PromptTemplateOut>(`/prompt-templates/${id}`),
  create: (data: {
    name: string;
    category?: string;
    scene?: string;
    positive?: string;
    negative?: string;
    params?: Record<string, string>;
  }) =>
    request<PromptTemplateOut>('/prompt-templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<PromptTemplateOut>) =>
    request<PromptTemplateOut>(`/prompt-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/prompt-templates/${id}`, { method: 'DELETE' }),
  batchRemove: (ids: string[]) =>
    request<{ removed: number }>('/prompt-templates/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prompt-library/api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/apiClient.ts tests/prompt-library/api-client.test.ts
git commit -m "feat(prompt-templates): add frontend API client methods"
```

---

### Task 5: Frontend Side Panel Component

**Files:**
- Create: `components/PromptLibraryPanel.tsx`
- Create: `components/PromptLibraryPanel.css`
- Test: `tests/prompt-library/prompt-library-panel.test.tsx`

**Interfaces:**
- Consumes: `promptTemplates` from `services/apiClient`, `PromptTemplateOut` type
- Produces: `PromptLibraryPanel` React component with props `{ onInsert: (t: PromptTemplateOut) => void }`

- [ ] **Step 1: Write failing test**

Create `tests/prompt-library/prompt-library-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PromptLibraryPanel } from '../../components/PromptLibraryPanel';
import { promptTemplates } from '../../services/apiClient';

// Mock the API
vi.mock('../../services/apiClient', () => ({
  promptTemplates: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    batchRemove: vi.fn(),
  },
}));

const mockTemplates = [
  { id: 'builtin_md_1', name: '多机位九宫格', category: 'character', scene: '9 views', positive: 'A multi-camera sheet', negative: 'bad', params: {}, is_builtin: true, created_at: '', updated_at: '' },
  { id: 'builtin_md_10', name: '360全景图', category: 'view', scene: '360 pano', positive: 'panorama', negative: 'seam', params: {}, is_builtin: true, created_at: '', updated_at: '' },
  { id: 'tpl_abc', name: 'My Custom', category: 'custom', scene: 'custom', positive: 'custom prompt', negative: '', params: {}, is_builtin: false, created_at: '', updated_at: '' },
];

beforeEach(() => {
  vi.mocked(promptTemplates.list).mockResolvedValue(mockTemplates);
});

describe('PromptLibraryPanel', () => {
  it('renders templates from API', async () => {
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('多机位九宫格')).toBeInTheDocument();
      expect(screen.getByText('360全景图')).toBeInTheDocument();
    });
  });

  it('filters by category', async () => {
    vi.mocked(promptTemplates.list).mockClear();
    vi.mocked(promptTemplates.list).mockResolvedValue(mockTemplates.filter(t => t.category === 'character'));
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    const charBtn = await screen.findByText('角色');
    fireEvent.click(charBtn);
    await waitFor(() => {
      expect(promptTemplates.list).toHaveBeenCalledWith('character');
    });
  });

  it('searches by name', async () => {
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('多机位九宫格')).toBeInTheDocument());
    const input = screen.getByPlaceholderText('搜索...');
    fireEvent.change(input, { target: { value: '360' } });
    expect(screen.getByText('360全景图')).toBeInTheDocument();
    expect(screen.queryByText('多机位九宫格')).not.toBeInTheDocument();
  });

  it('calls onInsert when insert button clicked', async () => {
    const onInsert = vi.fn();
    render(<PromptLibraryPanel onInsert={onInsert} />);
    await waitFor(() => expect(screen.getByText('多机位九宫格')).toBeInTheDocument());
    const insertBtn = screen.getAllByText('插入')[0];
    fireEvent.click(insertBtn);
    expect(onInsert).toHaveBeenCalledWith(mockTemplates[0]);
  });

  it('shows builtin badge for builtin templates', async () => {
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('多机位九宫格')).toBeInTheDocument());
    expect(screen.getAllByText('内置').length).toBeGreaterThan(0);
  });

  it('hides delete button for builtin templates', async () => {
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('多机位九宫格')).toBeInTheDocument());
    // Builtin templates should not have delete buttons
    // User template "My Custom" should have delete
    const deleteBtns = screen.getAllByText('删除');
    expect(deleteBtns.length).toBe(1); // Only the user template
  });

  it('creates new template', async () => {
    vi.mocked(promptTemplates.create).mockResolvedValue({
      id: 'tpl_new', name: 'New Template', category: 'custom', scene: '', positive: 'new', negative: '', params: {}, is_builtin: false, created_at: '', updated_at: '',
    });
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('多机位九宫格')).toBeInTheDocument());
    fireEvent.click(screen.getByText('新建模板'));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'New Template' } });
    fireEvent.change(screen.getByLabelText('正向提示词'), { target: { value: 'new' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(promptTemplates.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Template', positive: 'new' })
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt-library/prompt-library-panel.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create the component**

Create `components/PromptLibraryPanel.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { promptTemplates, PromptTemplateOut } from '../services/apiClient';
import './PromptLibraryPanel.css';

const CATEGORIES = [
  { id: '', name: '全部' },
  { id: 'view', name: '视角' },
  { id: 'storyboard', name: '分镜' },
  { id: 'character', name: '角色' },
  { id: 'product', name: '产品' },
  { id: 'lighting', name: '光影' },
  { id: 'custom', name: '自定义' },
];

const CATEGORY_LABELS: Record<string, string> = {
  view: '视角', storyboard: '分镜', character: '角色',
  product: '产品', lighting: '光影', custom: '自定义',
};

interface PromptLibraryPanelProps {
  onInsert: (template: PromptTemplateOut) => void;
}

export function PromptLibraryPanel({ onInsert }: PromptLibraryPanelProps) {
  const [templates, setTemplates] = useState<PromptTemplateOut[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PromptTemplateOut | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const load = useCallback(async (cat: string) => {
    const items = await promptTemplates.list(cat || undefined);
    setTemplates(items);
  }, []);

  useEffect(() => {
    load(activeCategory);
  }, [activeCategory, load]);

  const filtered = search
    ? templates.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.scene.toLowerCase().includes(search.toLowerCase()) ||
        t.positive.toLowerCase().includes(search.toLowerCase())
      )
    : templates;

  const handleSave = async (data: Partial<PromptTemplateOut>) => {
    if (isCreating) {
      await promptTemplates.create(data as any);
    } else if (editing) {
      await promptTemplates.update(editing.id, data);
    }
    setEditing(null);
    setIsCreating(false);
    await load(activeCategory);
  };

  const handleDelete = async (id: string) => {
    await promptTemplates.remove(id);
    await load(activeCategory);
  };

  return (
    <div className="prompt-library-panel" data-testid="prompt-library-panel">
      <div className="plp-header">
        <input
          className="plp-search"
          type="text"
          placeholder="搜索..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="plp-categories">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            className={`plp-cat-btn ${activeCategory === cat.id ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>
      <div className="plp-list">
        {filtered.map(t => (
          <div key={t.id} className="plp-card">
            <div className="plp-card-header">
              <span className="plp-card-name">{t.name}</span>
              <div className="plp-card-badges">
                <span className="plp-cat-badge">{CATEGORY_LABELS[t.category] || t.category}</span>
                {t.is_builtin && <span className="plp-builtin-badge">内置</span>}
              </div>
            </div>
            <div className="plp-card-scene">{t.scene}</div>
            <div className="plp-card-actions">
              <button onClick={() => setEditing(t)}>编辑</button>
              <button onClick={() => onInsert(t)}>插入</button>
              {!t.is_builtin && <button onClick={() => handleDelete(t.id)}>删除</button>}
            </div>
          </div>
        ))}
      </div>
      <button className="plp-new-btn" onClick={() => setIsCreating(true)}>+ 新建模板</button>
      {(editing || isCreating) && (
        <TemplateEditor
          template={editing}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setIsCreating(false); }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  onSave,
  onCancel,
}: {
  template: PromptTemplateOut | null;
  onSave: (data: Partial<PromptTemplateOut>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name || '');
  const [category, setCategory] = useState(template?.category || 'custom');
  const [scene, setScene] = useState(template?.scene || '');
  const [positive, setPositive] = useState(template?.positive || '');
  const [negative, setNegative] = useState(template?.negative || '');

  return (
    <div className="plp-editor" data-testid="plp-editor">
      <div className="plp-editor-row">
        <label>名称</label>
        <input value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="plp-editor-row">
        <label>分类</label>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORIES.filter(c => c.id).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="plp-editor-row">
        <label>适用场景</label>
        <input value={scene} onChange={e => setScene(e.target.value)} />
      </div>
      <div className="plp-editor-row">
        <label>正向提示词</label>
        <textarea value={positive} onChange={e => setPositive(e.target.value)} rows={4} />
      </div>
      <div className="plp-editor-row">
        <label>负向提示词</label>
        <textarea value={negative} onChange={e => setNegative(e.target.value)} rows={3} />
      </div>
      <div className="plp-editor-actions">
        <button onClick={() => onSave({ name, category, scene, positive, negative })}>保存</button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the CSS**

Create `components/PromptLibraryPanel.css`:

```css
.prompt-library-panel {
  width: 280px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--panel, #1a1a1a);
  border-left: 1px solid var(--line, #333);
  font-size: 12px;
  color: var(--text, #e0e0e0);
  overflow: hidden;
}

.plp-header {
  padding: 10px 12px 6px;
  flex-shrink: 0;
}

.plp-search {
  width: 100%;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--line, #333);
  background: var(--bg, #111);
  color: var(--text, #e0e0e0);
  font-size: 12px;
}

.plp-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 12px 8px;
  flex-shrink: 0;
}

.plp-cat-btn {
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid var(--line, #333);
  background: transparent;
  color: var(--muted, #888);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s;
}

.plp-cat-btn.active {
  background: var(--text, #e0e0e0);
  color: var(--panel, #1a1a1a);
  border-color: var(--text, #e0e0e0);
}

.plp-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
}

.plp-card {
  padding: 10px 0;
  border-bottom: 1px solid var(--line, #333);
}

.plp-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 4px;
}

.plp-card-name {
  font-weight: 600;
  font-size: 13px;
  flex: 1;
}

.plp-card-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.plp-cat-badge,
.plp-builtin-badge {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  border: 1px solid var(--line, #333);
}

.plp-builtin-badge {
  background: var(--text, #e0e0e0);
  color: var(--panel, #1a1a1a);
}

.plp-card-scene {
  font-size: 11px;
  color: var(--muted, #888);
  margin-bottom: 6px;
  line-height: 1.4;
}

.plp-card-actions {
  display: flex;
  gap: 6px;
}

.plp-card-actions button {
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid var(--line, #333);
  background: transparent;
  color: var(--text, #e0e0e0);
  font-size: 11px;
  cursor: pointer;
}

.plp-card-actions button:hover {
  background: var(--soft, #2a2a2a);
}

.plp-new-btn {
  margin: 8px 12px 12px;
  padding: 8px;
  border-radius: 6px;
  border: 1px dashed var(--line, #333);
  background: transparent;
  color: var(--text, #e0e0e0);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.plp-new-btn:hover {
  background: var(--soft, #2a2a2a);
}

/* Editor overlay */
.plp-editor {
  position: absolute;
  inset: 0;
  background: var(--panel, #1a1a1a);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 10;
}

.plp-editor-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plp-editor-row label {
  font-size: 11px;
  color: var(--muted, #888);
}

.plp-editor-row input,
.plp-editor-row textarea,
.plp-editor-row select {
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--line, #333);
  background: var(--bg, #111);
  color: var(--text, #e0e0e0);
  font-size: 12px;
  resize: vertical;
}

.plp-editor-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}

.plp-editor-actions button {
  flex: 1;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--line, #333);
  background: transparent;
  color: var(--text, #e0e0e0);
  cursor: pointer;
  font-size: 12px;
}

.plp-editor-actions button:first-child {
  background: var(--text, #e0e0e0);
  color: var(--panel, #1a1a1a);
  border-color: var(--text, #e0e0e0);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/prompt-library/prompt-library-panel.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/PromptLibraryPanel.tsx components/PromptLibraryPanel.css tests/prompt-library/prompt-library-panel.test.tsx
git commit -m "feat(prompt-templates): add PromptLibraryPanel side panel component"
```

---

### Task 6: Integration into Agent Mode

**Files:**
- Modify: `agent/agent-mode.tsx` (render panel + toggle button)
- Modify: `agent/agent.css` (toggle button styles)
- Test: `tests/app-agent-mode.test.tsx` (verify panel toggle)

**Interfaces:**
- Consumes: `PromptLibraryPanel` from Task 5

- [ ] **Step 1: Write failing test for panel toggle**

Append to `tests/app-agent-mode.test.tsx`:

```typescript
it('shows prompt library panel when toggle button clicked', async () => {
  // ... existing setup that opens canvas ...
  // Find the bookmark/book icon button in the topbar
  const panelBtn = screen.getByTestId('prompt-library-toggle');
  fireEvent.click(panelBtn);
  await waitFor(() => {
    expect(screen.getByTestId('prompt-library-panel')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app-agent-mode.test.tsx -t "prompt library panel"`
Expected: FAIL — button not found

- [ ] **Step 3: Add panel + toggle to agent-mode.tsx**

In `agent/agent-mode.tsx`:
- Import `PromptLibraryPanel` at top
- Add `const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);` state
- Add a toggle button in the topbar (next to view buttons)
- Render panel conditionally as right-side overlay

```tsx
// Add import:
import { PromptLibraryPanel } from '../components/PromptLibraryPanel';

// Add state (near other useState):
const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);

// In the topbar, add button:
<button
  data-testid="prompt-library-toggle"
  className={`agent-topbar-btn ${promptLibraryOpen ? 'active' : ''}`}
  onClick={() => setPromptLibraryOpen(v => !v)}
  title="提示词模板库"
>
  {/* bookmark icon */}
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
  </svg>
</button>

// After the canvas container div, add:
{promptLibraryOpen && (
  <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 40 }}>
    <PromptLibraryPanel
      onInsert={(tmpl) => {
        // Insert positive prompt into the goal input
        setGoal(g => g ? `${g}\n\n${tmpl.positive}` : tmpl.positive);
      }}
    />
  </div>
)}
```

- [ ] **Step 4: Add toggle button CSS to agent.css**

Append to `agent/agent.css`:

```css
.agent-topbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition: all 0.12s;
  flex-shrink: 0;
}

.agent-topbar-btn:hover {
  background: var(--soft);
}

.agent-topbar-btn.active {
  background: var(--text);
  color: var(--panel);
  border-color: var(--text);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/app-agent-mode.test.tsx tests/prompt-library/`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run` and `cd backend && python -m pytest tests/test_prompt_templates.py -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add agent/agent-mode.tsx agent/agent.css tests/app-agent-mode.test.tsx
git commit -m "feat(prompt-templates): integrate PromptLibraryPanel into agent mode"
```
