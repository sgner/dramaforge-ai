# Agent Asset Intelligence and Workflow Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Agent workflow that understands uploaded and generated assets, standardizes them when necessary, reuses them consistently across images/video/shots, and gives immediate visible feedback for parallel work and recovery.

**Architecture:** Keep the canvas limited to asset nodes; keep Agent reasoning, progress, questions, recovery, and asset-reference decisions in ThoughtStream and the draggable pet panel. Add a project-scoped asset intelligence layer between Agent planning and media tools. That layer classifies source assets with a vision-capable LLM, decides whether normalization is needed, resolves logical asset IDs into provider reference URLs, and records derivation/usage relationships. Media generation receives explicit `reference_asset_ids` and batch jobs, while the runtime creates pending asset rows before provider calls and emits lifecycle events immediately.

**Tech Stack:** React + Zustand + Vitest + Vite; FastAPI + SQLAlchemy + Pydantic + pytest; existing provider/model capability bindings; existing SSE Agent event stream; existing `MediaService` adapter.

## Global Constraints

- Agent mode runs inside the existing canvas and never creates Agent-process nodes on the canvas.
- The canvas may show only reusable/generated/uploaded asset nodes; Agent state remains in ThoughtStream and the pet UI.
- All asset state is project-scoped and must survive refresh, task switching, and Agent mode toggling.
- User questions support free text and multiple selections; options are suggestions, never the only input path.
- A stopped/cancelled Agent must not execute stale tool calls or continue recovery work for the cancelled task.
- Independent image/video jobs must start concurrently through `generate_media_batch`.
- Failed media jobs must keep one visible failed node, trigger a visible bounded recovery worker, and never create duplicate assets on retry.
- A provider/model binding is resolved by capability (`llm`, `image`, `video`); no hidden legacy model fallback is allowed when a required binding is absent.
- Uploaded assets are never silently replaced; normalized derivatives retain `derived_from` links to their originals.
- Provider reference-image support is capability-dependent; unsupported references produce an explicit Agent explanation and user-visible recovery path.

---

## Project Structure and Responsibilities

### Backend

- `backend/app/models.py`: add project-scoped asset metadata and relationship persistence.
- `backend/app/schemas.py`: request/response contracts for asset inspection, references, usage, and lifecycle state.
- `backend/app/routers/assets.py`: upload/inspect/reference/usage endpoints.
- `backend/app/agent/asset_intelligence.py`: classify, standardize, resolve, and validate asset references.
- `backend/app/agent/tools/asset_intelligence_tools.py`: Agent-facing inspection and reference-resolution tools.
- `backend/app/agent/tools/image_tools.py`: accept logical reference asset IDs and resolve them before image generation.
- `backend/app/agent/tools/video_tools.py`: accept logical reference asset IDs and resolve them before video generation.
- `backend/app/agent/tools/media_batch.py`: concurrently run independent image/video jobs with per-job references.
- `backend/app/agent/runtime.py`: orchestrate pending assets, asset inspection, batch execution, recovery, cancellation, and event emission.
- `backend/app/agent/llm.py`: encode mandatory asset planning and parallel scheduling policy.
- `backend/app/agent/events.py`: lifecycle events for asset inspection, normalization, reference resolution, batch progress, and recovery.

### Frontend

- `agent/use-agent-store.ts`: consume new lifecycle events and expose progress/recovery/reference state.
- `agent/thought-stream.tsx`: render asset decisions, normalization, reference usage, batch progress, and recovery messages.
- `agent/agent-pet-controller.tsx`: show the current media prompt, referenced assets, pending/retrying status, and progress counts.
- `agent/ask-user-response.tsx`: retain free text plus multi-select answers.
- `agent/agent-mode.tsx`: hydrate project/task state without cross-project leakage and preserve canvas-only asset projection.
- `components/infinite-canvas/use-canvas-store.ts`: project pending/uploaded/derived asset rows as asset nodes only; dedupe by stable asset ID.
- `components/infinite-canvas/*`: expose upload and asset-reference affordances without introducing Agent process nodes.
- `services/apiClient.ts`: add typed asset intelligence and usage APIs.

### Tests and Documentation

- `backend/tests/test_asset_intelligence.py`
- `backend/tests/test_asset_reference_resolution.py`
- `backend/tests/test_agent_asset_workflow.py`
- `backend/tests/test_agent_cancellation.py`
- `backend/tests/test_agent_media_batch.py`
- `tests/agent/asset-progress.test.tsx`
- `tests/agent/use-agent-store.test.ts`
- `tests/infinite-canvas/asset-reference-nodes.test.ts`
- `tests/e2e/agent-asset-workflow.e2e.ts`
- `README.md`: describe upload → inspect → normalize → reuse workflow and capability requirements.

---

## Phase 0: Baseline and Contracts

### Task 0.1: Freeze current behavior with regression tests

**Files:**
- Test: `backend/tests/test_agent_media_assets.py`
- Test: `backend/tests/test_agent_media_batch.py`
- Test: `tests/agent/agent-pet-controller.test.tsx`
- Test: `tests/infinite-canvas/add-agent-nodes-image.test.ts`

- [ ] Add assertions for: pending media rows before provider execution; one row after retry; prompt/model visible in the pet panel; asset nodes deduped by stable ID.
- [ ] Run:

```powershell
npm run test -- --run tests/agent/agent-pet-controller.test.tsx tests/infinite-canvas/add-agent-nodes-image.test.ts
.\backend\.venv\Scripts\python.exe -m pytest backend/tests/test_agent_media_assets.py backend/tests/test_agent_media_batch.py -q
```

- [ ] Record existing unrelated failures separately; do not weaken new assertions to match legacy behavior.

### Task 0.2: Define the asset intelligence contracts

**Files:**
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_asset_intelligence.py`

Use these stable contracts:

```python
class AssetInspectionIn(BaseModel):
    asset_id: str
    project_id: str

class AssetInspectionOut(BaseModel):
    asset_id: str
    asset_kind: Literal["character", "prop", "scene", "storyboard", "reference", "other"]
    confidence: float
    source_format: str
    standardized: bool
    extracted: dict[str, Any]
    missing_requirements: list[str]
    recommended_action: Literal["reuse", "normalize", "ask_user"]

class AssetReference(BaseModel):
    asset_id: str
    role: Literal["character", "prop", "scene", "style", "source", "other"]
    required: bool = False

class MediaJob(BaseModel):
    kind: Literal["image", "video"]
    name: str
    asset_kind: str
    prompt: str
    reference_asset_ids: list[str] = []
    duration_sec: float | None = None
```

- [ ] Test validation for unknown asset IDs, invalid roles, empty prompts, and unsupported media kinds.
- [ ] Run the focused schema tests and expect PASS.

---

## Phase 1: Persistent Asset Identity and Upload Ingestion

### Task 1.1: Extend the asset model with origin and relationships

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_asset_intelligence.py`

Add fields to `Asset`:

```python
origin: str  # uploaded | generated | normalized | imported
source_asset_id: str | None
visual_identity: str | None
inspection: dict
reference_capabilities: dict
usage_count: int
```

- [ ] Keep `id` stable and project-scoped.
- [ ] Add indexes on `(project_id, asset_kind, name)` and `source_asset_id`.
- [ ] Ensure legacy rows default to `origin="generated"`, empty inspection, and `usage_count=0`.
- [ ] Test that an uploaded asset and its normalized derivative can coexist and point back to the original.

### Task 1.2: Persist uploaded assets before Agent planning

**Files:**
- Modify: `backend/app/routers/assets.py`
- Modify: `services/apiClient.ts`
- Modify: `components/infinite-canvas/use-canvas-store.ts`
- Test: `backend/tests/test_asset_intelligence.py`
- Test: `tests/infinite-canvas/asset-reference-nodes.test.ts`

- [ ] Add `POST /api/projects/{project_id}/assets/upload` returning an `AssetOut` with `origin="uploaded"` and `generating=False`.
- [ ] Emit `asset_uploaded` to the project/task event stream when an upload is associated with an active Agent task.
- [ ] Render the uploaded asset node immediately with `inspection_status="pending"`.
- [ ] Do not send the file to a provider until the user has explicitly requested generation.
- [ ] Test refresh persistence and project isolation.

### Task 1.3: Make project snapshots safe for all asset rows

**Files:**
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_project_snapshot_assets.py`

- [ ] Enable ORM attribute mapping for `AssetOut`.
- [ ] Add a snapshot test containing uploaded, pending, failed, and normalized assets.
- [ ] Assert `GET /api/projects/{project_id}` returns 200 and no asset disappears after refresh.

---

## Phase 2: Multimodal Asset Inspection and Standardization

### Task 2.1: Add explicit vision capability resolution

**Files:**
- Modify: `backend/app/agent/capabilities.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_asset_intelligence.py`

- [ ] Add `vision` to the LLM capability metadata without creating a separate hidden provider configuration.
- [ ] Resolve whether the currently bound LLM accepts image parts.
- [ ] Return a deterministic error when no vision-capable LLM is bound:

```json
{
  "code": "vision_capability_required",
  "message": "当前 LLM 不支持图片理解，无法判断上传资产类型、"
}
```

- [ ] Test bound vision model, bound text-only model, and missing binding.

### Task 2.2: Implement `inspect_uploaded_asset`

**Files:**
- Create: `backend/app/agent/asset_intelligence.py`
- Create: `backend/app/agent/tools/asset_intelligence_tools.py`
- Modify: `backend/app/agent/tools/__init__.py`
- Test: `backend/tests/test_asset_intelligence.py`

Implement:

```python
async def inspect_asset(ctx: ToolContext, asset_id: str) -> AssetInspectionOut:
    # load project-scoped asset, send image + project standards to vision LLM,
    # validate structured response, persist inspection, emit asset_inspected
```

The structured result must classify:

- character: single person, multiple people, portrait, full body, turn-around sheet;
- prop: isolated object, hand-held object, product image;
- scene: background/location/environment;
- other: logo, texture, document, unsupported input.

- [ ] Add the Agent tool `inspect_uploaded_asset`.
- [ ] Persist `inspection`, `visual_identity`, `reference_capabilities`, and confidence.
- [ ] Emit `asset_inspection_started` immediately, then `asset_inspected`.
- [ ] Test that raw LLM output cannot create arbitrary asset kinds or unsafe project IDs.

### Task 2.3: Decide whether a character requires normalization

**Files:**
- Modify: `backend/app/agent/asset_intelligence.py`
- Modify: `backend/app/agent/tools/asset_intelligence_tools.py`
- Test: `backend/tests/test_asset_intelligence.py`

Use project standards:

```python
CHARACTER_STANDARD = {
    "required_views": ["front", "side", "back", "three_quarter"],
    "required_subject_count": 1,
    "preferred_background": "white",
    "required_consistency": True,
}
```

- [ ] A single-person portrait missing required views returns `recommended_action="normalize"`.
- [ ] A valid four-view sheet returns `recommended_action="reuse"`.
- [ ] Ambiguous or low-confidence input returns `recommended_action="ask_user"`.
- [ ] Do not regenerate merely because the image style differs; style is metadata unless the project explicitly requires a style match.

### Task 2.4: Generate normalized derivatives from uploaded references

**Files:**
- Modify: `backend/app/agent/tools/image_tools.py`
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/media_assets.py`
- Test: `backend/tests/test_agent_asset_workflow.py`

- [ ] Extend `generate_character_portrait` with `reference_asset_ids`.
- [ ] Resolve the uploaded image into `reference_urls` before calling the image provider.
- [ ] Persist the result as `origin="normalized"`, `source_asset_id=<uploaded_asset_id>`, `asset_kind="character"`.
- [ ] Reuse the existing character three-view prompt builder; append only the source-reference and consistency requirements.
- [ ] Emit a `normalization_started` event before provider execution and `asset_normalized` after completion.
- [ ] Test single portrait → normalized four-view derivative and failed normalization retry without duplicate rows.

---

## Phase 3: Asset Reference Graph and Reuse

### Task 3.1: Add asset-reference resolution

**Files:**
- Modify: `backend/app/agent/asset_intelligence.py`
- Create: `backend/app/agent/tools/asset_reference_tools.py`
- Modify: `backend/app/agent/tools/__init__.py`
- Test: `backend/tests/test_asset_reference_resolution.py`

Implement:

```python
async def resolve_asset_refs(
    db: Session,
    project_id: str,
    asset_ids: list[str],
    media_kind: str,
) -> list[dict]:
    # return id, role, url, prompt_identity, and provider compatibility
```

- [ ] Reject asset IDs from another project.
- [ ] Prefer normalized derivatives over their raw source when both are available for a character/prop/scene.
- [ ] Preserve the raw upload as a fallback reference.
- [ ] Return a structured unsupported-reference result when the selected provider cannot accept reference images.
- [ ] Increment `usage_count` only after a provider request is accepted.

### Task 3.2: Record usage and derivation relationships

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/routers/assets.py`
- Modify: `backend/app/agent/runtime.py`
- Test: `backend/tests/test_asset_reference_resolution.py`

Add `AssetUsage`:

```python
class AssetUsage(Base):
    id: str
    project_id: str
    asset_id: str
    consumer_type: str  # task | shot | media_asset
    consumer_id: str
    role: str
    created_at: datetime
```

- [ ] Record that `prop-001` is used by every shot/media asset that references it.
- [ ] Record `source_asset_id` for normalized derivatives.
- [ ] Expose `GET /api/projects/{project_id}/assets/{asset_id}/usage`.
- [ ] Test the same prop referenced by two characters and three shots produces one prop asset and three usage rows.

### Task 3.3: Extend all media tools to consume logical asset references

**Files:**
- Modify: `backend/app/agent/tools/image_tools.py`
- Modify: `backend/app/agent/tools/video_tools.py`
- Modify: `backend/app/agent/tools/media_batch.py`
- Modify: `backend/app/agent/media_service.py`
- Test: `backend/tests/test_asset_reference_resolution.py`
- Test: `backend/tests/test_agent_media_batch.py`

Each media request must support:

```json
{
  "reference_asset_ids": ["char-001", "prop-001", "scene-002"]
}
```

- [ ] Resolve IDs in the Agent layer, never let the LLM construct provider URLs.
- [ ] Pass resolved URLs to image and video providers.
- [ ] Store `reference_asset_ids` in the generated asset `extra` field.
- [ ] In batch mode, resolve references independently per job before `asyncio.gather`.
- [ ] Test one prop reused by two concurrent jobs and verify both jobs carry the same reference asset ID.

---

## Phase 4: Agent Planning and Workflow Semantics

### Task 4.1: Make asset inspection mandatory before generation

**Files:**
- Modify: `backend/app/agent/llm.py`
- Modify: `backend/app/agent/runtime.py`
- Test: `backend/tests/test_agent_asset_workflow.py`

Add planning policy:

```text
Before generating media, inspect all uploaded assets and read existing project assets.
If an uploaded asset is usable, reference it instead of regenerating it.
If it is a character/prop/scene but does not meet project standards, normalize it first.
Do not use a raw upload in downstream shots when a normalized derivative exists.
```

- [ ] Include existing project assets and their inspection status in the Agent context.
- [ ] Add `reference_asset_ids` to planned media jobs.
- [ ] Test upload character → inspect → normalize → generate shot without an extra character generation.

### Task 4.2: Make parallel execution the default for independent jobs

**Files:**
- Modify: `backend/app/agent/llm.py`
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/tools/media_batch.py`
- Test: `backend/tests/test_agent_media_batch.py`

- [ ] If the plan contains two or more independent image/video jobs, the next action must be `generate_media_batch`.
- [ ] Create every pending asset row and emit every `artifact_created` event before the first provider call.
- [ ] Use `asyncio.gather(..., return_exceptions=True)`; preserve job order in results.
- [ ] Never invoke an individual media tool first merely to discover that batch execution is needed.
- [ ] Test elapsed time, pending-node event order, per-job success/failure isolation, and shared references.

### Task 4.3: Add visible recovery worker semantics

**Files:**
- Modify: `backend/app/agent/events.py`
- Modify: `backend/app/agent/runtime.py`
- Modify: `agent/use-agent-store.ts`
- Modify: `agent/thought-stream.tsx`
- Modify: `agent/agent-pet-controller.tsx`
- Test: `backend/tests/test_agent_cancellation.py`
- Test: `tests/agent/asset-progress.test.tsx`

Events:

```text
media_recovery_started { task_id, asset_id, tool, attempt, max_attempts }
media_recovery_progress { asset_id, status, message }
media_recovery_finished { asset_id, success, error, result_asset_id }
```

- [ ] Show “生成中 / 旁路重试中 / 已完成 / 失败” on the asset node and in ThoughtStream.
- [ ] Show current prompt, model, referenced asset names, and job progress in the pet panel.
- [ ] Keep main Agent status `running` while recovery is active unless the main plan truly requires the failed asset.
- [ ] Make retry bounded and idempotent.
- [ ] Test that a 502 produces a visible failed node immediately, then visible recovery events, without a silent wait.

### Task 4.4: Make cancellation terminate all work

**Files:**
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/media_service.py`
- Modify: `agent/use-agent-stream.ts`
- Test: `backend/tests/test_agent_cancellation.py`

- [ ] Track provider/recovery tasks by `task_id` and `asset_id`.
- [ ] Cancel pending `asyncio` tasks on `stop_task`.
- [ ] Check `AgentState.CANCELLED` before every provider call and before emitting completion events.
- [ ] Ignore late provider responses after cancellation.
- [ ] Test stop during batch, stop during recovery, and retry after cancellation.

---

## Phase 5: Frontend Asset Interaction and Project Isolation

### Task 5.1: Add asset inspection and normalization UI feedback

**Files:**
- Modify: `agent/thought-stream.tsx`
- Modify: `agent/agent-pet-controller.tsx`
- Modify: `components/infinite-canvas/use-canvas-store.ts`
- Test: `tests/agent/asset-progress.test.tsx`

- [ ] Render “正在识别上传资产”.
- [ ] Render classification, confidence, and missing standards.
- [ ] Render “正在生成标准角色三视图”.
- [ ] Render original → normalized relationship.
- [ ] Keep the canvas node as an asset node, never a process/timeline node.

### Task 5.2: Add reference visibility and manual override

**Files:**
- Modify: `agent/agent-pet-controller.tsx`
- Modify: `agent/thought-stream.tsx`
- Modify: `components/infinite-canvas/use-canvas-store.ts`
- Modify: `services/apiClient.ts`
- Test: `tests/agent/asset-progress.test.tsx`

- [ ] Show the assets used by the latest generation: names, roles, and source/normalized status.
- [ ] Allow the user to remove or add a reference asset before a user-triggered retry.
- [ ] If confidence is low, expose “确认这是角色 / 道具 / 场景 / 其他” with free text available.
- [ ] Persist user corrections to the inspection record.

### Task 5.3: Verify task/project isolation

**Files:**
- Modify: `agent/agent-mode.tsx`
- Modify: `agent/use-agent-store.ts`
- Modify: `components/infinite-canvas/use-canvas-store.ts`
- Test: `tests/agent/project-isolation.test.tsx`

- [ ] Clear task event projections when switching projects.
- [ ] Load only assets where `project_id` matches the active project.
- [ ] Do not reuse a previous project’s pending question, recovery event, artifact, or pet status.
- [ ] Test project A running recovery, switch to project B, and verify project B is clean.

---

## Phase 6: End-to-End Verification and Documentation

### Task 6.1: Add the complete asset workflow E2E test

**Files:**
- Create: `tests/e2e/agent-asset-workflow.e2e.ts`
- Modify: `backend/tests/test_agent_asset_workflow.py`

The test must cover:

1. Upload a single-character image.
2. Confirm immediate uploaded asset node.
3. Run multimodal inspection.
4. Confirm the result says `character`, `standardized=false`, and `recommended_action=normalize`.
5. Generate the normalized character sheet using the upload as reference.
6. Generate a prop once.
7. Generate two shots in parallel where two characters reference the same prop.
8. Confirm all pending nodes appear before provider completion.
9. Force one provider job to return 502.
10. Confirm failed node + visible recovery worker + one final asset row after retry.
11. Stop a second batch and confirm no late nodes/events are added.
12. Refresh and confirm assets, relationships, and project isolation.

Run:

```powershell
npm run build
npm run test -- --run tests/agent tests/infinite-canvas tests/e2e
.\backend\.venv\Scripts\python.exe -m pytest backend/tests/test_asset_intelligence.py backend/tests/test_asset_reference_resolution.py backend/tests/test_agent_asset_workflow.py backend/tests/test_agent_cancellation.py backend/tests/test_agent_media_batch.py -q
```

Expected: all newly added tests pass; only explicitly documented legacy tests may remain until their fixed tool-count/API assumptions are updated.

### Task 6.2: Update README and operator documentation

**Files:**
- Modify: `README.md`
- Create: `docs/asset-intelligence.md`
- Create: `docs/agent-workflow.md`

Document:

- required LLM vision capability for uploaded-asset inspection;
- image/video capability bindings;
- upload → inspect → normalize → reuse lifecycle;
- how the same prop is reused across multiple characters/shots;
- how pending, failed, recovery, and cancelled states appear;
- provider limitations for reference images;
- E2E commands and expected health endpoints.

### Task 6.3: Update stale test contracts

**Files:**
- Modify: `backend/tests/test_agent_default_registry.py`
- Modify: `backend/tests/test_agent_tools_metadata.py`
- Modify: `backend/tests/test_agent_routes.py`
- Modify: `backend/tests/test_runtime_autostart.py`

- [ ] Replace fixed “18 tools” assertions with explicit required-tool name assertions plus a minimum count.
- [ ] Update API binding tests to use the current capability-binding contract.
- [ ] Remove tests that assume hidden DevScriptedLLM or legacy step-model bindings.
- [ ] Keep all new workflow tests independent from developer machine database state.

---

## Recommended Delivery Order

1. Phase 0 contracts and regression tests.
2. Phase 1 upload persistence and project snapshots.
3. Phase 2 multimodal inspection and character normalization.
4. Phase 3 reference graph and media-tool integration.
5. Phase 4 runtime scheduling, pending nodes, recovery, and cancellation.
6. Phase 5 frontend feedback and project isolation.
7. Phase 6 E2E, stale-test cleanup, and README update.

Each task should be committed after its focused tests pass. Do not combine database schema, Agent runtime, and UI changes into one unreviewable commit.

## Self-Review

- Uploaded role identification: covered by Tasks 1.2, 2.1, 2.2, and 2.3.
- Single portrait to standard character sheet: covered by Task 2.4.
- Reusing one prop across multiple characters/shots: covered by Tasks 3.1–3.3 and 6.1.
- User-provided assets as project references: covered by Tasks 1.2, 3.1, and 5.2.
- Parallel image/video jobs: covered by Tasks 4.2 and 6.1.
- Visible pending/recovery feedback: covered by Tasks 4.3 and 5.1.
- Cancellation and stale event prevention: covered by Task 4.4.
- Duplicate retry prevention: covered by Tasks 1.1, 2.4, 4.3, and 6.1.
- Legacy test and documentation drift: covered by Tasks 6.2 and 6.3.

