# Generation Nodes and Capability Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent and canvas generation use the saved `llm`/`image`/`video` capability bindings exclusively, persist generated media as visible reusable asset nodes, and surface actionable provider/model errors.

**Architecture:** The backend is the source of truth for capability selection. Agent task creation validates the persisted `model_bindings` preference and passes the resolved capability map into the runtime media service. Media tools persist a placeholder before generation and update the same asset after success/failure, allowing the existing canvas image node renderer to show generation state without creating Agent-only nodes.

**Tech Stack:** React, TypeScript, Zustand, FastAPI, SQLAlchemy, pytest, Vitest.

## Global Constraints

- Only the three capability bindings `llm`, `image`, and `video` are supported.
- No legacy provider/default-model fallback may start an Agent task when the corresponding capability binding is empty.
- Generated media must reuse the existing canvas asset node types.
- API keys remain backend-owned and must not be exposed to the browser.

---

### Task 1: Reproduce and lock down capability selection

**Files:**
- Modify: `backend/app/routers/agent.py`
- Modify: `backend/app/agent/media_service.py`
- Modify: `agent/agent-mode.tsx`
- Test: `backend/tests/test_agent_capability_bindings.py`
- Test: `tests/agent/agent-mode.test.tsx`

- [ ] **Step 1: Write failing tests** for rejecting Agent creation without an `llm` binding, selecting the saved `llm` provider/model, and rejecting media generation without the matching `image`/`video` binding.
- [ ] **Step 2: Run the focused backend and frontend tests** and confirm the current fallback behavior fails the assertions.
- [ ] **Step 3: Add a backend helper** that reads `UserPreference(key="model_bindings")`, normalizes the three capability records, and resolves enabled provider/model pairs.
- [ ] **Step 4: Make `create_task` require the resolved `llm` binding** and persist only that resolved provider/model on the Agent task; do not select the first configured provider.
- [ ] **Step 5: Pass the resolved capability map to `DatabaseMediaService`** and make image/video selection exact-match the bound provider and model.
- [ ] **Step 6: Remove `agent-mode.tsx` fallbackProvider/default-model selection** and show a clear configuration error before calling `startAgent` when the LLM binding is empty.
- [ ] **Step 7: Run the focused tests** and confirm they pass.

### Task 2: Persist generation lifecycle as reusable asset nodes

**Files:**
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/tools/asset_tools.py`
- Modify: `components/infinite-canvas/use-canvas-store.ts`
- Test: `backend/tests/test_agent_media_assets.py`
- Test: `tests/agent/agent-asset-projection.test.tsx`

- [ ] **Step 1: Write failing tests** asserting that a character, scene, storyboard, and video tool call creates one generating asset record before the provider call and updates that record after success or failure.
- [ ] **Step 2: Run the tests** and confirm generated tool results currently remain only in observations and do not appear in `memory.artifacts`/canvas nodes.
- [ ] **Step 3: Add asset lifecycle helpers** that create a stable asset id with `generating: true`, then update URL/provider/model on success or error on failure.
- [ ] **Step 4: Invoke the lifecycle helper for image/video tools** in `AgentRuntime` around `_execute_tool`, while preserving the existing explicit `save_asset` tool behavior.
- [ ] **Step 5: Extend `addAgentNodes` to render generating and failed media records** using the existing image node and metadata fields, including video assets without inventing an Agent-only node.
- [ ] **Step 6: Run focused backend/frontend tests** and verify each generation class creates exactly one visible node.

### Task 3: Make provider errors actionable across image and video generation

**Files:**
- Modify: `backend/app/routers/media.py`
- Modify: `backend/app/agent/media_service.py`
- Modify: `services/mediaService.ts`
- Test: `backend/tests/test_media_router.py`
- Test: `tests/services/media-service.test.ts`

- [ ] **Step 1: Write failing tests** for missing model, provider/model mismatch, upstream 401/404, malformed image response, and unsupported video endpoint.
- [ ] **Step 2: Run the tests** and capture the current generic 502/404 behavior.
- [ ] **Step 3: Validate provider/model capability membership before making an upstream request** and return an error containing provider id, model id, capability, and the upstream status.
- [ ] **Step 4: Normalize image responses** for URL and base64 output, and normalize video responses for direct URL plus asynchronous task-id responses where the provider supports polling.
- [ ] **Step 5: Preserve the exact backend error in the Agent recovery question and canvas failed node.**
- [ ] **Step 6: Run backend media tests, frontend media tests, and the build.

### Task 4: End-to-end verification

**Files:**
- Test: `tests/agent/agent-generation-e2e.test.tsx`
- Test: `backend/tests/test_agent_capability_bindings.py`
- Test: `backend/tests/test_agent_media_assets.py`

- [ ] **Step 1: Test no-binding behavior:** no LLM binding prevents Agent startup and no image/video binding prevents that generation tool from executing.
- [ ] **Step 2: Test binding behavior:** configured bindings select the exact provider/model and do not use legacy defaults.
- [ ] **Step 3: Test lifecycle behavior:** the canvas shows the existing upload/image asset node while generation is pending, then shows the generated URL or failure reason.
- [ ] **Step 4: Run the complete frontend and backend test suites plus `npm run build`.
- [ ] **Step 5: Run the browser flow against the local services and verify one character portrait, one scene/storyboard image, and one video attempt produce visible lifecycle nodes and no duplicate Agent actions.
