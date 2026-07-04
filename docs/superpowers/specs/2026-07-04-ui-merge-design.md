# UI 合并:ApiSettingsModal 统一 Provider 列表 + 单一后端 endpoint

**Date:** 2026-07-04
**Status:** Draft (user approved via "开始实现" after 6-section design review)
**Branch base:** `recovery` (Plan 1 已合并, HEAD = `a5eca64`)
**Author:** Plan 1 follow-up

## 1. Problem

Plan 1 把后端三套 provider 数据源合并到统一 `provider_configs` 表,数据流已经贯通。但前端 `ApiSettingsModal` 仍把配置拆成两个独立 section:

- **顶部 "Agent LLM"** — 调 `GET /api/llm-providers`,只显示 5 字段(provider_id / base_url / api_key / default_model / chat_models)
- **下方 "平台列表"** — 调 `GET /api/media-providers`,显示 `Provider` 类型全字段(image / video / chat models + wallet / volcengine / runninghub 扩展)
- **底部 "步骤绑定"** — 读 localStorage,不在本 spec 范围(Plan 4)

虽然两个 endpoint 都从同一张表读数据,**视觉上两个 section 给用户造成"配置分开管理"的错觉**。Plan 1 final review 提了 Important #2(`submitLlmForm` PUT 会 clobber 媒体字段)和 Minor #9(enabled 残留 clobber),都是合表后 UI 分离的副作用。

## 2. Goal

把"Agent LLM"和"平台列表"合并成**单一 Provider 列表 + 单一折叠式编辑器**。后端从两个 endpoint 合并为一个 `/api/providers`。步骤绑定 section 保持不动。

**User-facing success criteria:**
1. 用户打开 API 设置,看到**一个** Provider 列表(不是两个 section)
2. 点击行展开折叠式编辑器,基础字段常驻,高级字段(protocol / defaultModel / image / video / 扩展)折叠在"高级"区块
3. 编辑或新建一个 provider 一次性保存,agent 和 canvas 媒体**同时能用**(无 clobber)
4. 旧 endpoint 返 410 Gone,引导外部依赖迁移

**Out of scope:**
- 步骤绑定 section(Plan 4 范围)
- 删除 `DevScriptedLLM`(Plan 2 范围)
- canvas LLM 文本流式改走后端代理(Plan 3 范围)
- `apiConfig` localStorage 字段清理(Plan 3 范围)

## 3. Architecture

### 3.1 Backend

**新建路由文件:** `backend/app/routers/providers.py`

- `GET /api/providers` — 列出所有(从 `ProviderConfig` 读,按 `provider_id` 排序,api_key 脱敏)
- `GET /api/providers/{provider_id}` — 单个(脱敏)
- `PUT /api/providers/{provider_id}` — upsert(创建或更新,**不传字段保留 DB 原值**,等同 PATCH 语义)
- `DELETE /api/providers/{provider_id}` — 删除

**统一 schema(Pydantic):**
```python
class ProviderIn(BaseModel):
    name: str = ""
    base_url: str
    api_key: str | None = None       # None/空 = 保留 DB 原值
    default_model: str = ""
    protocol: str = "openai"
    enabled: bool = True
    chat_models: list[str] = []
    image_models: list[str] = []
    video_models: list[str] = []
    extra_config: dict = {}

class ProviderOut(BaseModel):  # 同 Plan 1 的 LLMProviderOut 字段集
    id: int
    provider_id: str
    name: str
    base_url: str
    api_key: str        # 脱敏
    default_model: str
    protocol: str
    enabled: bool
    chat_models: list[str]
    image_models: list[str]
    video_models: list[str]
    extra_config: dict
    has_key: bool
    key_preview: str
    created_at: str | None
    updated_at: str | None
```

**旧 endpoint 行为:**
- `GET / PUT / DELETE /api/llm-providers[/{id}]` → 410 Gone
- `GET / PUT / PATCH / DELETE /api/media-providers[/{id}]` → 410 Gone
- 响应体: `{"detail": "moved to /api/providers since 2026-07-04"}`

**文件操作:**
- 新建 `backend/app/routers/providers.py`
- 删除 `backend/app/routers/llm_providers.py`
- 删除 `backend/app/routers/media_providers.py`
- `backend/app/main.py` — 删 import + `include_router`,加新 import + `include_router(providers_router)`
- 旧测试 `test_llm_providers_crud.py` / `test_media_providers.py` 改 endpoint 引用

### 3.2 Frontend

**类型扩展:** `types.ts:78-111 Provider` 加 `defaultModel?: string` 字段。

**`services/apiClient.ts` 改动:**
- 删 `listLLMProviders / getLLMProvider / upsertLLMProvider / deleteLLMProvider / listMediaProviders / getMediaProvider / upsertMediaProvider / patchMediaProvider / deleteMediaProvider`(共 9 个方法)
- 新增 `listProviders / getProvider / upsertProvider / patchProvider / deleteProvider`(5 个方法)
- 新增 `export interface ProviderOut`(同后端 schema)

**`ApiSettingsModal.tsx` 改动:**
- 删 `llmProviders / mediaSyncStatus` 两个独立 state
- 新增单一 `providers: ProviderOut[]` state + `loadProviders()` 调 `listProviders`
- 编辑器改成折叠式 `<details>` 区块:基础(常驻)+ 高级(默认折叠)
- `ProviderOut` 映射到 `Provider` 类型:`id ← provider_id`, `name`, `baseUrl ← base_url`, `protocol`, `enabled`, `apiKey=''`(脱敏), `hasKey ← has_key`, `keyPreview`, `imageModels`, `chatModels`, `videoModels`, `defaultModel`
- `submitProvider()` 调 `upsertProvider`(Pydantic schema 含 enabled,无 clobber)
- 渲染结构:删 `renderAgentLLMSection()`,`renderProviderList` 改为唯一列表,`renderEditor` 改为折叠式

**`agent/agent-mode.tsx` 改动:**
- `api.listLLMProviders()` → `api.listProviders()`
- `rows` 过滤 `chat_models.length > 0` 才是可选 LLM(其它 provider 媒体专用)
- 保留 fallback 逻辑(虽然 Plan 1 后基本不触发)

### 3.3 State Retention 策略

PUT 语义 = "不传字段保留 DB 原值"(`api_key` 为 None/空时也保留)。前端表单用 `useEffect` 把当前 DB 行 hydrate 到本地 state;用户改字段 → state 更新;提交时把**所有字段**一次 PUT 过去(没改的字段用 DB 原值,达到 PATCH 等价效果)。

这样不需要 PATCH endpoint,PUT 一个 endpoint 覆盖新建/更新/部分更新 3 个场景。

## 4. UI Layout (折叠式编辑器)

```
+-- 基础 (常驻) ------------------+
|  Provider ID  [_______________] |
|  Name         [_______________] |
|  Base URL     [_______________] |
|  API Key      [_______________] |
|  [ ] Enabled                    |
+---------------------------------+
|  +-- 高级 ▼ (默认折叠) --------+ |
|  |  Protocol     [openai  ▼]  | |
|  |  Default Model[____________]| |
|  |  Models:                   | |
|  |    Image  [_______________]| |
|  |    Chat   [_______________]| |
|  |    Video  [_______________]| |
|  |  ---- 扩展 (volcengine/rh) | |
|  |  ...                       | |
|  +----------------------------+ |
+---------------------------------+
```

**列表行布局:**
```
+--------------------------------------+
| [icon] custom-api  (LLM+Media)       |
|        chat: gpt-4o, image: dall-e-3 |
|        [Delete]  [Edit]              |
+--------------------------------------+
```

每个 provider 在列表里**只显示一次**(Plan 1 的 fix 改 `_preserve_*` workaround 废弃,统一表单天然解决)。

## 5. Data Flow

### 5.1 加载流程

```
[Modal open]
    ↓
useEffect → loadProviders()
    ↓
GET /api/providers
    ↓
ProviderConfig.to_dict(mask_key=true) × N
    ↓
[ProviderOut, ...] (脱敏)
    ↓
映射到 Provider[] state
    ↓
render list
```

### 5.2 保存流程

```
[用户改基础字段]
    ↓
setEditingProvider({...editingProvider, [field]: value})
    ↓
[用户展开高级 + 改 imageModels]
    ↓
setEditingProvider({...editingProvider, imageModels: ['dall-e-3']})
    ↓
[用户点保存]
    ↓
POST /api/providers/{id} PUT
body: {base_url, api_key?, protocol, enabled, chat_models, image_models, video_models, default_model, name, extra_config}
    ↓
ProviderConfig.__table__ update
    ↓
return ProviderOut
    ↓
update providers state
    ↓
[Agent 端和 canvas 端立即可用]
```

### 5.3 删除流程

```
[用户点 Delete]
    ↓
confirm("确定删除 custom-api?")
    ↓
DELETE /api/providers/custom-api
    ↓
204 / {deleted: 'custom-api'}
    ↓
filter providers state
```

## 6. Error Handling

| 场景 | 行为 |
|------|------|
| `GET /api/providers` 失败 | 列表空 + 错误 toast,UI 提示"加载失败,点击重试" |
| `PUT /api/providers/{id}` 失败(422) | 表单显示 Pydantic 错误详情(字段级) |
| `PUT` 失败(网络) | 表单保持打开,按钮恢复可点,toast 提示 |
| `DELETE` 失败(404) | 视为已删除(幂等),UI 移除条目 |
| 旧 endpoint 调用(`/api/llm-providers` 等) | 410 Gone + 响应体说明,前端拦截后跳转到新 endpoint |

## 7. Testing Strategy

### 7.1 Backend (pytest)

**新建 `tests/test_providers_crud.py`** — 合并 `test_llm_providers_crud.py` + `test_media_providers.py`:
- `test_list_providers_empty` / `test_list_providers_returns_all` (in-memory sqlite)
- `test_get_provider_success` / `test_get_provider_404`
- `test_upsert_provider_create` / `test_upsert_provider_update_preserves_omitted_fields` (关键:验证 PUT 不传字段保留 DB 原值)
- `test_upsert_provider_preserves_api_key_when_empty`
- `test_delete_provider` / `test_delete_provider_404`
- `test_old_endpoints_return_410` — 6 个旧路径各发一次,断言 410 + detail

**删除**:`tests/test_llm_providers_crud.py`、`tests/test_media_providers.py`(内容已合并到 test_providers_crud.py)

### 7.2 Frontend (vitest)

- **更新** `tests/infinite-canvas/migrate-local-providers.test.ts` — mock 从 `listMediaProviders` 改 `listProviders`,schema 改 ProviderOut
- **新增** `tests/infinite-canvas/api-settings-unified.test.tsx`:
  - 渲染时调用 `api.listProviders()` 一次
  - 列表展示 providers 数量
  - 点击行展开折叠表单
  - 修改基础字段 + 高级字段 → 一次 PUT 包含全部
  - 折叠区有 `<details>` 包裹
- **更新** `agent-mode` 相关测试 — 改 `api.listLLMProviders()` 引用

### 7.3 tsc

`npx tsc --noEmit` 在 `services/apiClient.ts` + `components/infinite-canvas/ApiSettingsModal.tsx` 0 errors(其它预存错误与本 spec 无关)。

## 8. Risks

1. **外部脚本断 410** — 缓解:commit message + release notes 明示迁移路径;无外部脚本风险评估(grep 全仓 `listLLMProviders\|listMediaProviders` 确认无遗漏)
2. **`Provider` 类型加 `defaultModel?` 字段** — 影响所有使用 Provider 的地方(canvas / infinite-canvas / hooks)。Mitigation:加 `?` 可选字段,旧代码 0 破坏
3. **折叠式表单交互** — 用户可能不知道高级字段存在。Mitigation:高级区标题前加 "▼ 高级(N 个字段已配)" 提示有内容时
4. **PUT 整行语义** — 当前端 state 与 DB 不一致时(如 DB 有扩展字段,前端 state 没有),保存会覆盖 DB 扩展字段。Mitigation:保存前先 GET 一次拿到完整行,hydrate 到 state(防止用户编辑时丢失 DB 已有但前端没显示的字段如 extra_config)

## 9. Implementation Plan (8 Tasks)

按 subagent-driven-development (SDD) skill 执行:

1. **后端路由** `GET /api/providers` (含 `ProviderIn/Out` schema 合并)
2. **后端路由** `PUT /api/providers/{id}` (PUT 整行 + 字段保留语义)
3. **后端路由** `DELETE /api/providers/{id}` + 旧 endpoint 返 410 + main.py 切换
4. **前端类型** `Provider` 加 `defaultModel?` + `ProviderOut` interface
5. **前端 apiClient** 删 9 个旧方法加 5 个新方法
6. **前端 ApiSettingsModal** 合并 state + 折叠式编辑器
7. **agent-mode.tsx** 改 `api.listProviders()`
8. **测试更新 + 新增** (后端 test_providers_crud + 前端 api-settings-unified)
9. **Final whole-branch review + fix**

## 10. Open Questions

无(用户在 brainstorming 阶段已回答 3 个关键问题:范围/表单折叠/旧 endpoint 410)。

## 11. References

- Plan 1: `docs/superpowers/plans/2026-07-04-provider-unification.md`
- Plan 1 Ledger: `.superpowers/sdd/progress.md` (Minor #9 enabled clobber)
- Roadmap: `docs/superpowers/plans/2026-07-04-provider-unification-roadmap.md` (本 spec 不在原 4-plan roadmap 内,是 Plan 1 后追加)
