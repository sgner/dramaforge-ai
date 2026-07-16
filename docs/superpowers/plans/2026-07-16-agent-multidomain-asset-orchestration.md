# Agent 多类型视频创作与资产编排实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Agent 先识别任务类型和输入完整度，再根据版本化规则包编排脚本、资产、分镜和视频生产，支持用户资产标准化、节点引用、并行生成和可恢复失败处理。

**Architecture:** 在现有 `AgentRuntime` 外增加任务画像与规则包层，在资产模型上补充生命周期和派生关系，在分镜/视频工具中统一参考资产解析与提示词校验。主 Agent 只负责任务状态、用户交互和阶段编排；独立 subagent 只处理可隔离的识别、优化和修复子任务，并通过结构化结果回传。

**Tech Stack:** FastAPI、SQLAlchemy、Pydantic、Python AgentRuntime、React/TypeScript、React Flow 画布、Vitest、pytest、现有 SSE ThoughtStream。

## Global Constraints

- `constants.ts` 中的角色设计图、故事板和视频模板是硬约束，不得被任务类型规则覆盖。
- 资产库、分镜解析和视频提示词文档中的结构、材质、引用顺序和镜头对应关系必须可校验。
- 没有结构化来源时不得创建剧情媒体生成节点。
- 所有生图、生视频必须经过提示词优化；优化为空时不得调用 provider。
- 用户回答、暂停、重试、取消和迟到事件必须可持久化、可恢复、可去重。
- 失败重试必须更新原资产稳定 ID，不得创建重复资产。
- 画布只显示真实资产节点；Agent 状态只显示在 ThoughtStream / 桌宠面板。
- 不引入第二套 API/模型配置；Agent 使用现有模型能力绑定。
- 维持现有 Python 和 Node 运行方式，不新增生产依赖。

---

## Task 1: 建立任务画像与规则包接口

**Files:**
- Create: `backend/app/agent/task_profiles.py`
- Create: `backend/app/agent/rule_packs.py`
- Modify: `backend/app/agent/prompt_engineering.py`
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/tools/planning.py`
- Test: `backend/tests/test_task_profiles.py`
- Test: `backend/tests/test_rule_packs.py`

**Interfaces:**
- `class TaskProfile(BaseModel)`：定义 `task_type`、`input_mode`、`source_kind`、`script_required`、`needs_clarification`、`deliverables`、`asset_strategy`、`missing_inputs`、`rule_pack_id`。
- `def classify_task(user_goal: str, parsed_goal: dict | None, project_assets: list[dict]) -> TaskProfile`：只做确定性归类和完整度判断，不调用 provider。
- `def get_rule_pack(rule_pack_id: str) -> RulePack`：返回版本化规则包。
- `def get_workflow_steps(profile: TaskProfile) -> list[WorkflowStep]`：返回有依赖关系的步骤。
- `def build_prompt_rule_context(rule_pack: RulePack, target: str) -> dict`：供提示词优化器使用。

- [ ] **Step 1: Write failing tests for short-topic routing**

```python
def test_short_topic_requires_source_before_media():
    profile = classify_task("功夫", {"title": "功夫"}, [])
    assert profile.task_type == "drama_short"
    assert profile.input_mode == "topic_only"
    assert profile.script_required is True
    assert profile.needs_clarification is True
    assert "script" in profile.missing_inputs
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_task_profiles.py::test_short_topic_requires_source_before_media -q`

Expected: FAIL because `task_profiles.py` and `classify_task` do not exist.

- [ ] **Step 3: Implement profile schemas and deterministic classifiers**

Implement explicit mappings for `drama_short`, `documentary`, `promotion`, `commercial`, and `custom`. A one- or two-word topic must produce `topic_only` and `needs_clarification=True`; a script, brief, product description, or uploaded asset context must produce the corresponding `input_mode`.

- [ ] **Step 4: Add rule-pack definitions and source versions**

Create rule packs with stable IDs:

```python
RULE_PACKS = {
    "drama_short.v1": RulePack(
        id="drama_short.v1",
        task_types=["drama_short"],
        source_documents=["constants.ts", "docs/【资产库】全资产大师V3.0_场景+角色+道具_万能版.txt", "docs/分镜解析.md", "docs/视频提示词模板.md"],
        hard_rules=["script_required_before_media", "character_design_sheet", "storyboard_reference_mapping", "video_shot_mapping"],
        prompt_templates=["character_design_sheet", "storyboard", "video"],
        validators=["character", "prop", "scene", "storyboard", "video"],
    ),
}
```

Add equivalent rule packs for documentary, promotion, commercial, and custom. The custom pack must inherit the common asset and prompt validators.

- [ ] **Step 5: Feed rule context into Agent prompt construction**

Add the task profile and rule-pack summary to `AgentRuntime._build_messages()`. The prompt must tell the model to ask for missing source material before selecting media tools and include the exact allowed workflow tools for the selected task type.

- [ ] **Step 6: Add tests for all task types and precedence**

Cover complete script, documentary outline, promotion brief, product info, upload-only, custom task, and user instructions that conflict with hard template constraints. The expected behavior is to preserve hard constraints and record the user request as a task-specific override only where safe.

- [ ] **Step 7: Run the task-profile and existing planning tests**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_task_profiles.py backend/tests/test_rule_packs.py backend/tests/test_agent_planning_tools.py backend/tests/test_agent_runtime.py -q`

Expected: all tests pass.

- [ ] **Step 8: Commit the isolated task**

Run: `git add backend/app/agent/task_profiles.py backend/app/agent/rule_packs.py backend/app/agent/prompt_engineering.py backend/app/agent/runtime.py backend/app/agent/tools/planning.py backend/tests/test_task_profiles.py backend/tests/test_rule_packs.py && git commit -m "feat: route agent tasks through versioned rule packs"`

---

## Task 2: Enforce workflow preconditions and persist task profile

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/agent.py`
- Modify: `backend/app/agent/runtime.py`
- Modify: `services/apiClient.ts`
- Modify: `agent/use-agent-store.ts`
- Test: `backend/tests/test_agent_task_profile_persistence.py`
- Test: `tests/agent/task-profile.test.ts`

**Interfaces:**
- `AgentTask.task_profile_json` stores the serialized `TaskProfile` and selected rule-pack version.
- `AgentRuntime.profile: TaskProfile | None` is hydrated when a task resumes.
- `AgentRuntime._requires_source(tool_name: str) -> bool` identifies media tools requiring structured source.
- `AgentRuntime._pause_for_missing_source(profile: TaskProfile) -> None` creates a durable free-input question.

- [ ] **Step 1: Add failing persistence tests**

Test that a newly created task stores `task_profile`, and that a paused question contains `step_id`, `missing_inputs`, `allow_custom=True`, and `selection_mode="text"`.

- [ ] **Step 2: Run tests to verify the persistence contract fails**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_agent_task_profile_persistence.py -q`

Expected: FAIL because the model and response schema have no task profile field.

- [ ] **Step 3: Add model and API schema fields**

Add a JSON field compatible with the current SQLite/Postgres setup. Extend `AgentTaskOut` and the TypeScript client type. Preserve compatibility with existing tasks by treating a missing profile as `None` and deriving it once during hydration.

- [ ] **Step 4: Implement profile hydration and source gates**

At task creation, classify the goal and persist the profile. At runtime startup, load it before the first LLM step. Before any story media tool, require one of:

```python
memory.artifacts["script"]
successful_generate_script_step
project_asset(asset_kind="script")
profile.source_kind in {"interview_outline", "promotion_brief", "product_brief"}
```

When absent, pause with a durable question asking for the source or permission for Agent to create it. Do not emit `ACTION` for the blocked media tool and do not create pending canvas assets.

- [ ] **Step 5: Preserve the original question through refresh and answer**

Ensure the serialized task response exposes the pending question and profile. The frontend must hydrate the question before any replayed event and only clear it after a real resumed thought/action event.

- [ ] **Step 6: Add regression tests for answer recovery**

Cover: short topic → question → refresh → answer → `generate_script`; complete script → extraction; failed media step → answer → same step recovery; cancellation during an in-flight LLM call.

- [ ] **Step 7: Run backend and frontend focused tests**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_agent_task_profile_persistence.py backend/tests/test_ask_user_resume.py backend/tests/test_agent_runtime.py -q`

Run: `npm test -- --run tests/agent/use-agent-store.test.ts tests/agent/ask-user-response.test.tsx tests/agent/task-list.test.tsx tests/agent/task-profile.test.ts`

Expected: all tests pass.

- [ ] **Step 8: Commit the isolated task**

Run: `git add backend/app/models.py backend/app/schemas.py backend/app/routers/agent.py backend/app/agent/runtime.py services/apiClient.ts agent/use-agent-store.ts backend/tests/test_agent_task_profile_persistence.py tests/agent/task-profile.test.ts && git commit -m "feat: persist agent task profiles and source gates"`

---

## Task 3: Implement the asset graph and normalization contracts

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/agent/asset_intelligence.py`
- Modify: `backend/app/agent/tools/asset_intelligence_tools.py`
- Modify: `backend/app/agent/tools/asset_tools.py`
- Modify: `backend/app/agent/runtime.py`
- Modify: `components/infinite-canvas/CanvasAssetPanel.tsx`
- Modify: `agent/use-agent-store.ts`
- Test: `backend/tests/test_asset_graph.py`
- Test: `backend/tests/test_asset_intelligence_contract.py`
- Test: `tests/agent/asset-graph.test.tsx`

**Interfaces:**
- `Asset` adds lifecycle metadata: `status`, `version`, `source_asset_id`, `derived_from`, `reference_role`, `prompt_source`, `prompt_optimized`.
- `inspect_asset(asset_id: str) -> AssetInspection` identifies `character`, `prop`, `scene`, `product`, `documentary_source`, or `unknown`.
- `prepare_asset(asset_id: str, target_kind: str) -> Asset` creates a derived standard asset without mutating the source.
- `resolve_reference_assets(asset_ids: list[str], role: str) -> list[dict]` returns stable ordered references.

- [ ] **Step 1: Write failing tests for source preservation and derivation**

Assert that normalizing an uploaded character creates a new asset with `source_asset_id`, retains the original upload, and marks the new asset as `needs_review` or `ready` according to inspection output. Assert that an object identified as a prop cannot be stored in the character bucket.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_asset_graph.py backend/tests/test_asset_intelligence_contract.py -q`

Expected: FAIL because lifecycle fields and graph operations are incomplete.

- [ ] **Step 3: Add lifecycle fields with backward-compatible defaults**

Add nullable/defaulted columns and migration-safe model serialization. Existing assets must load as `ready` if they have a URL, otherwise `pending`, without changing their IDs.

- [ ] **Step 4: Implement inspection result schema**

Return structured data:

```python
{
    "asset_type": "character",
    "confidence": 0.92,
    "subjects": ["single_person"],
    "meets_standard": False,
    "missing_fields": ["front_view", "side_view", "back_view"],
    "recommended_action": "prepare_character_asset",
}
```

Use the configured multimodal LLM capability. If that capability is unavailable, pause with a user-visible configuration error instead of guessing the asset type.

- [ ] **Step 5: Implement normalization for character, prop, scene and product**

Use the canonical character design-sheet template for character normalization. Keep source asset identity and generate a derived asset with a provenance link. Add separate preparation functions for prop, scene and product so their rules cannot be mixed.

- [ ] **Step 6: Implement stable reference resolution**

Resolve references in deterministic order: explicit IDs, task artifacts, then project assets by exact name. Reject missing or failed assets for a required reference edge and return a structured validation error.

- [ ] **Step 7: Render graph state in `components/infinite-canvas/CanvasAssetPanel.tsx`**

Show source-to-derived relationships, status, version, and reference roles. Do not render Agent thinking as canvas nodes. Retried assets must update in place.

- [ ] **Step 8: Run backend/frontend asset tests**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_asset_graph.py backend/tests/test_asset_intelligence_contract.py backend/tests/test_agent_media_assets.py -q`

Run: `npm test -- --run tests/agent/asset-graph.test.tsx tests/agent/agent-mode-canvas.test.tsx`

Expected: all tests pass.

- [ ] **Step 9: Commit the isolated task**

Run: `git add backend/app/models.py backend/app/schemas.py backend/app/agent/asset_intelligence.py backend/app/agent/tools/asset_intelligence_tools.py backend/app/agent/tools/asset_tools.py backend/app/agent/runtime.py components/infinite-canvas/CanvasAssetPanel.tsx agent/use-agent-store.ts backend/tests/test_asset_graph.py backend/tests/test_asset_intelligence_contract.py tests/agent/asset-graph.test.tsx && git commit -m "feat: add versioned asset graph and normalization"`

---

## Task 4: Enforce prompt, storyboard and video consistency

**Files:**
- Modify: `backend/app/agent/prompt_engineering.py`
- Modify: `backend/app/agent/tools/image_tools.py`
- Modify: `backend/app/agent/tools/video_tools.py`
- Modify: `backend/app/agent/tools/media_batch.py`
- Modify: `backend/app/agent/specs.py`
- Modify: `utils/promptValidator.ts`
- Modify: `constants.ts`
- Test: `backend/tests/test_prompt_rule_validation.py`
- Test: `backend/tests/test_storyboard_reference_mapping.py`
- Test: `tests/constants-character-prompt.test.ts`
- Test: `tests/prompt-validator.test.ts`

**Interfaces:**
- `validate_prompt_against_rule_pack(prompt: str, target: str, context: dict) -> ValidationReport`.
- `build_storyboard_prompt(shot: dict, scene: dict, characters: list[dict], props: list[dict], rule_pack: RulePack) -> str`.
- `build_video_prompt(storyboard: dict, references: list[dict], rule_pack: RulePack) -> str`.
- `collect_storyboard_reference_asset_ids(params, artifacts) -> list[str]` remains the single reference resolver.

- [ ] **Step 1: Write failing tests for prompt optimization hard constraints**

Test that optimization preserves the character design-sheet layout, negative constraints, six-grid storyboard format, exact reference order, and fixed video declarations. Test that an empty optimized prompt is rejected before provider invocation.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_prompt_rule_validation.py backend/tests/test_storyboard_reference_mapping.py -q`

Expected: FAIL for missing rule-pack validators or incomplete reference mappings.

- [ ] **Step 3: Implement backend rule validators**

Validate required sections, reference IDs, script-to-shot mapping, scene/character/prop separation, material constraints, and prompt length. Return errors and warnings separately; hard errors block media generation.

- [ ] **Step 4: Make storyboard generation consume graph references**

Require scene reference plus all involved character and prop references. Build references from connected nodes and exact asset IDs. Do not silently generate a storyboard with missing references.

- [ ] **Step 5: Make video generation inherit storyboard shots**

Compute video content-shot count from storyboard content frames, exclude black frames, preserve one-to-one mapping, and keep reference order as storyboard → characters → scenes → props. Reject extra or missing shot numbers.

- [ ] **Step 6: Add frontend prompt validation parity**

Keep TypeScript validation for immediate UI feedback, but treat backend validation as authoritative. Add tests ensuring `constants.ts` templates still contain the required layout and prohibition strings.

- [ ] **Step 7: Verify all media paths use the optimizer and validator**

Cover direct canvas image/video generation, Agent image/video tools, batch generation, retries, and normalized uploaded assets. No path may pass the original descriptive source directly to the provider.

- [ ] **Step 8: Run prompt, media and build tests**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_prompt_rule_validation.py backend/tests/test_storyboard_reference_mapping.py backend/tests/test_agent_llm_tools.py backend/tests/test_agent_media_batch.py -q`

Run: `npm test -- --run tests/constants-character-prompt.test.ts tests/prompt-validator.test.ts tests/agent/agent-mode-e2e.test.tsx`

Run: `npm run build`

Expected: tests and build pass; only the existing bundle-size warning may remain.

- [ ] **Step 9: Commit the isolated task**

Run: `git add backend/app/agent/prompt_engineering.py backend/app/agent/tools/image_tools.py backend/app/agent/tools/video_tools.py backend/app/agent/tools/media_batch.py backend/app/agent/specs.py utils/promptValidator.ts constants.ts backend/tests/test_prompt_rule_validation.py backend/tests/test_storyboard_reference_mapping.py tests/constants-character-prompt.test.ts tests/prompt-validator.test.ts && git commit -m "feat: validate storyboard and video references"`

---

## Task 5: Add domain workflows and subagent recovery

**Files:**
- Create: `backend/app/agent/workflows.py`
- Create: `backend/app/agent/subagents.py`
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/events.py`
- Modify: `backend/app/routers/agent.py`
- Modify: `agent/thought-stream.tsx`
- Modify: `agent/agent-pet-controller.tsx`
- Modify: `agent/use-agent-store.ts`
- Test: `backend/tests/test_domain_workflows.py`
- Test: `backend/tests/test_subagent_recovery.py`
- Test: `tests/agent/subagent-progress.test.tsx`

**Interfaces:**
- `WorkflowDefinition.steps: list[WorkflowStep]` defines dependencies, approvals and parallel groups.
- `WorkflowRunner.next_ready_steps(state) -> list[WorkflowStep]` returns only steps whose inputs are ready.
- `SubagentTask(id, parent_task_id, kind, input_asset_ids, rule_pack_version)` identifies isolated work.
- `SubagentResult(status, output_asset_ids, warnings, error)` is the only subagent-to-main-agent result contract.

- [ ] **Step 1: Write failing workflow tests**

Test the four workflows: each selects the correct source preparation, requires the correct approval points, and does not make media steps ready before their dependencies complete.

- [ ] **Step 2: Run tests to verify failure**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_domain_workflows.py -q`

Expected: FAIL because workflow definitions and ready-step evaluation do not exist.

- [ ] **Step 3: Implement workflow definitions**

Define the exact stages from the design spec for drama, documentary, promotion, commercial and custom workflows. Make independent character, prop and scene image jobs share a parallel group only after prompt optimization succeeds.

- [ ] **Step 4: Implement subagent task boundaries**

Create subagent records with parent task ID, input asset versions, rule-pack version and cancellation token. Subagents may produce derived assets and reports but may not mutate parent task state directly.

- [ ] **Step 5: Add progress events and frontend feedback**

Emit `SUBAGENT_STARTED`, `SUBAGENT_PROGRESS`, `SUBAGENT_FINISHED`, and `WORKFLOW_STEP_READY` events. ThoughtStream and the pet panel show current stage, current job, model, references, and waiting reason. No silent long-running operation is allowed.

- [ ] **Step 6: Isolate media recovery from the main workflow**

On a failed media job, spawn a recovery subtask with the same asset ID and prompt source. The main workflow waits for the structured result but keeps successful sibling jobs and continues only after the failed dependency is resolved or explicitly skipped by the user.

- [ ] **Step 7: Make cancellation authoritative**

Propagate cancellation to provider requests, subagent tasks and recovery tasks. Ignore late results whose task generation or cancellation token is stale.

- [ ] **Step 8: Add end-to-end recovery tests**

Cover: parallel three-asset batch with one failure, subagent retry updating the same asset, user skip, user model change, stop during provider call, and restart with persisted workflow state.

- [ ] **Step 9: Run full verification**

Run: `backend\.venv\Scripts\python.exe -m pytest -q`

Run: `npm test -- --run tests/agent tests/infinite-canvas`

Run: `npm run build`

Then verify services and browser smoke flow:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/api/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/
```

Browser acceptance must confirm: homepage loads, short topic pauses before media nodes, script answer resumes, uploaded character creates a derived standard asset, storyboard references appear in the graph, and a failed media job shows visible recovery progress.

- [ ] **Step 10: Commit the isolated task**

Run: `git add backend/app/agent/workflows.py backend/app/agent/subagents.py backend/app/agent/runtime.py backend/app/agent/events.py backend/app/routers/agent.py agent/thought-stream.tsx agent/agent-pet-controller.tsx agent/use-agent-store.ts backend/tests/test_domain_workflows.py backend/tests/test_subagent_recovery.py tests/agent/subagent-progress.test.tsx && git commit -m "feat: orchestrate domain workflows and subagent recovery"`

---

## Final review checklist

- [ ] Run a placeholder scan on this plan and remove any unfinished wording.
- [ ] Compare every hard rule named in `constants.ts`, the asset library, storyboard analysis and video template against a validator or test.
- [ ] Confirm all interfaces used by later tasks are defined in earlier tasks.
- [ ] Confirm old tasks without `task_profile_json` hydrate safely.
- [ ] Confirm no task creates media placeholders before its source gate passes.
- [ ] Confirm retry and refresh preserve stable asset IDs and pending questions.
- [ ] Confirm browser smoke tests do not call development test data or bypass capability bindings.
