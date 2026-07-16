# Prompt Template Library — Design Spec

> Date: 2026-07-14
> Status: Approved (Scheme B: full backend CRUD + frontend side panel)

## 1. Goal

Migrate the reference project's prompt template library into DramaForge AI.
Users can browse, search, create, edit, and delete prompt templates
(positive/negative/scene/params) through a side panel, and insert them
into any target input field (agent goal, image node prompt, etc.).

## 2. Data Model

### DB: `prompt_templates` table

```python
class PromptTemplate(Base):
    __tablename__ = "prompt_templates"
    id          = Column(String, primary_key=True)  # "builtin_md_1" or "tpl_<hex12>"
    name        = Column(String, nullable=False)
    category    = Column(String, nullable=False, default="custom")
    scene       = Column(Text, default="")
    positive    = Column(Text, default="")
    negative    = Column(Text, default="")
    params      = Column(JSON, default=dict)        # {"Midjourney": "--ar 1:1...", ...}
    is_builtin  = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=_now)
    updated_at  = Column(DateTime, default=_now, onupdate=_now)
```

### Categories (fixed set)

| id           | name   |
|--------------|--------|
| view         | 视角   |
| storyboard   | 分镜   |
| character    | 角色   |
| product      | 产品   |
| lighting     | 光影   |
| custom       | 自定义 |

### Built-in seed (10 templates)

Seeded on first app startup from Python constants (content copied from
reference `prompt_libraries.json`). Seeding logic:
- On app startup, check if `is_builtin=True` rows exist.
- If none, insert all 10 built-in templates with `is_builtin=True`.
- If they exist, check count — if fewer than 10, upsert missing ones.
- Built-in templates can be edited but not deleted (frontend hides
  delete button for `is_builtin=True`; backend rejects DELETE on builtin).

## 3. API Design

Router: `backend/app/routers/prompt_templates.py`
Prefix: `/api/prompt-templates`

| Method | Path              | Description                    |
|--------|-------------------|--------------------------------|
| GET    | `/`               | List all (optional `?category=`) |
| GET    | `/{id}`           | Get one                        |
| POST   | `/`               | Create (user-created)          |
| PUT    | `/{id}`            | Update (builtin or user)       |
| DELETE | `/{id}`           | Delete (reject if is_builtin)  |
| POST   | `/batch-delete`   | Batch delete by IDs            |

### Schemas

```python
class PromptTemplateOut(BaseModel):
    id: str
    name: str
    category: str
    scene: str
    positive: str
    negative: str
    params: dict
    is_builtin: bool
    created_at: datetime | None
    updated_at: datetime | None

class PromptTemplateCreate(BaseModel):
    name: str
    category: str = "custom"
    scene: str = ""
    positive: str = ""
    negative: str = ""
    params: dict = {}

class PromptTemplateUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    scene: str | None = None
    positive: str | None = None
    negative: str | None = None
    params: dict | None = None

class PromptTemplateBatchDelete(BaseModel):
    ids: list[str] = []
```

## 4. Frontend

### 4.1 API Client (`services/apiClient.ts`)

New section appended:

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
  list: (category?: string) => request<PromptTemplateOut[]>(
    category ? `/prompt-templates?category=${category}` : '/prompt-templates'
  ),
  get: (id: string) => request<PromptTemplateOut>(`/prompt-templates/${id}`),
  create: (data: Omit<PromptTemplateOut, 'id'|'is_builtin'|'created_at'|'updated_at'>) =>
    request<PromptTemplateOut>('/prompt-templates', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<PromptTemplateOut>) =>
    request<PromptTemplateOut>(`/prompt-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string) => request(`/prompt-templates/${id}`, { method: 'DELETE' }),
  batchRemove: (ids: string[]) => request('/prompt-templates/batch-delete', {
    method: 'POST', body: JSON.stringify({ ids })
  }),
};
```

### 4.2 Side Panel Component (`components/PromptLibraryPanel.tsx`)

**Layout:**

```
┌─ PromptLibraryPanel (280px wide, right side) ────┐
│ [🔍 搜索...]                                      │
│ [视角] [分镜] [角色] [产品] [光影] [自定义]      │
│ ┌──────────────────────────────────────────────┐ │
│ │ 多机位九宫格                    [角色] [内置] │ │
│ │ 同一主体/场景，9个不同机位...                 │ │
│ │                              [编辑] [插入]   │ │
│ ├──────────────────────────────────────────────┤ │
│ │ 25宫格连贯分镜                  [分镜] [内置] │ │
│ │ 完整场景/动作的25帧连续分镜...                │ │
│ │                              [编辑] [插入]   │ │
│ └──────────────────────────────────────────────┘ │
│                            [+ 新建模板]          │
└──────────────────────────────────────────────────┘
```

**Behavior:**
- Toggle open/close via a button in the agent topbar (bookmark icon).
- Filter by category tabs and search box (matches name/scene/positive).
- Click "插入" → calls `onInsert(template)` callback, parent injects
  `template.positive` into the focused input field.
- Click "编辑" → opens editor modal (same panel, inline form).
- Built-in templates show "内置" badge; delete button hidden.
- "新建模板" opens blank editor form.

### 4.3 Editor Form (inline within panel)

Fields:
- name (text input)
- category (select dropdown)
- scene (textarea, 1 line)
- positive (textarea, full)
- negative (textarea, full)
- params (key-value pairs, dynamic add/remove rows)

Save → POST or PUT based on whether it's new or existing.

### 4.4 Integration point

`PromptLibraryPanel` is rendered in `agent/agent-mode.tsx` as a sibling
of the canvas container, positioned as a right-side overlay (absolute,
z-index 40). The `onInsert` callback writes to the agent goal input
(or the currently focused input field if one is active).

## 5. Built-in Template Seed Data

Located in `backend/app/agent/prompt_template_seed.py` as a Python list
of dicts. Content directly copied from reference
`prompt_libraries.json` — 10 templates with full positive/negative/params.

## 6. Testing

### Backend tests (`backend/tests/test_prompt_templates.py`)
- CRUD: create, read, update, delete
- List with category filter
- Batch delete
- Reject DELETE on builtin template → 403
- Seed: first startup creates 10 builtin rows
- Seed: second startup does not duplicate

### Frontend tests (`tests/prompt-library/prompt-library-panel.test.tsx`)
- Render panel, see builtin templates
- Filter by category
- Search by name
- Click insert → onInsert called with template
- Edit template → form populated
- Create new template → POST called
- Delete user template → DELETE called
- Builtin template: no delete button

## 7. File Inventory

### New files
- `backend/app/routers/prompt_templates.py` — API router
- `backend/app/agent/prompt_template_seed.py` — 10 built-in templates
- `backend/tests/test_prompt_templates.py` — backend tests
- `components/PromptLibraryPanel.tsx` — side panel component
- `components/PromptLibraryPanel.css` — panel styles
- `tests/prompt-library/prompt-library-panel.test.tsx` — frontend tests

### Modified files
- `backend/app/models.py` — add PromptTemplate model
- `backend/app/schemas.py` — add prompt template schemas
- `backend/app/routers/__init__.py` — register new router
- `backend/app/__init__.py` — seed builtins on startup
- `services/apiClient.ts` — add promptTemplates API methods
- `agent/agent-mode.tsx` — render PromptLibraryPanel, pass onInsert
- `agent/agent.css` — panel toggle button styles

## 8. Known Limitations

- No import/export of templates (can add later).
- No template versioning (edit overwrites in place).
- No sharing between users (single global table).
- Panel width fixed at 280px (no resize).
