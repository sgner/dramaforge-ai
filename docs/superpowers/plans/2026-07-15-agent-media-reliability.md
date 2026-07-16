# Agent Media Generation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent image/video generation transparent, parallel-capable, resilient to media failures, and idempotent when failed assets are retried.

**Architecture:** Keep the main Agent loop responsible for planning and aggregation, while media generation runs as independent async work units with lifecycle events. Prompt/provider/model metadata is persisted on the same asset record and surfaced in the existing generation panel. A failed asset retry updates the existing asset identity instead of creating another asset record/node; optional failure recovery is reported to the Agent as a side result and does not pause the main workflow.

**Tech Stack:** FastAPI, SQLAlchemy, asyncio, React, Zustand, Vitest, pytest.

## Global Constraints

- Agent canvas shows asset nodes only; Agent status remains in ThoughtStream/pet UI.
- Image and video jobs must be allowed to run concurrently when the workflow has independent media actions.
- Failure recovery must not block or cancel the main workflow.
- Retrying a failed asset must preserve one logical asset identity.
- Reuse current capability bindings for image/video providers and models.

---

### Task 1: Expose generated prompts in the Agent generation panel

**Files:**
- Modify: `agent/agent-pet-controller.tsx`
- Modify: `agent/agent.css`
- Test: `tests/agent/agent-pet-controller.test.tsx`

- [ ] Write a failing test asserting a media action prompt is rendered in the expanded pet panel.
- [ ] Run the focused Vitest test and verify it fails because the panel has no media prompt.
- [ ] Add a derived latest-media-action value from Agent actions and render the prompt, provider, and model in a compact panel section.
- [ ] Run the focused test and verify it passes.
- [ ] Verify the panel remains usable when the prompt is long or absent.

---

### Task 2: Make independent Agent media actions concurrent

**Files:**
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/tools/base.py` only if a concurrency-safe context is required
- Test: `backend/tests/test_agent_runtime.py`
- Test: `backend/tests/test_agent_media_tools.py`

- [ ] Add a failing runtime test with two independent media actions whose service records overlapping start times.
- [ ] Run the focused pytest test and verify the actions currently execute serially.
- [ ] Add a bounded async media job runner that schedules independent image/video calls together, preserves per-job lifecycle events, and waits for all results before the next aggregation step.
- [ ] Ensure a failed media job returns a failed asset result without cancelling sibling jobs.
- [ ] Run focused runtime/media tests and verify overlap plus result aggregation.
- [ ] Run the existing Agent runtime suite.

---

### Task 3: Keep failure recovery off the main Agent critical path

**Files:**
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/events.py` only if a dedicated side-recovery event is needed
- Test: `backend/tests/test_agent_runtime.py`

- [ ] Add a failing test where one media generation fails and the main workflow still reaches its next planned action.
- [ ] Run the test and verify the current retryable error path pauses the whole runtime.
- [ ] Change media failure handling to emit a side-recovery request/result and continue the main workflow; use a bounded subagent/recovery coroutine for diagnosis/retry, never mutating the main runtime state.
- [ ] Aggregate the side-recovery result into the next Agent observation.
- [ ] Run focused and full Agent runtime tests.

---

### Task 4: Make failed asset retry idempotent

**Files:**
- Modify: `backend/app/agent/media_assets.py`
- Modify: `components/infinite-canvas/use-canvas-store.ts`
- Modify: `components/infinite-canvas/CanvasNode.tsx` only if retry metadata needs to be forwarded
- Test: `backend/tests/test_agent_media_assets.py`
- Test: `tests/infinite-canvas/canvas-node-normal.test.tsx` or a focused retry-store test

- [ ] Add a failing backend test asserting retrying an existing failed asset keeps the same ID and does not add a second row.
- [ ] Add a failing frontend/store test asserting a retry replaces the failed asset/node by logical asset ID.
- [ ] Implement an update-in-place lifecycle transition: failed/generating -> generating -> success/failed.
- [ ] Make retry requests carry the existing asset ID and preserve prompt/provider/model metadata.
- [ ] Run focused backend/frontend tests and verify asset count remains one.
- [ ] Run the full relevant test groups.

---

### Task 5: End-to-end verification

**Files:**
- No production file changes expected.
- Evidence: outside-repository browser screenshots/logs only.

- [ ] Run backend tests for media lifecycle, runtime, and Agent recovery.
- [ ] Run Vitest tests for pet panel, canvas asset retry, and Agent store.
- [ ] Run `npm run build`.
- [ ] Open `http://127.0.0.1:5173/` in the in-app Browser.
- [ ] Verify a media action shows its prompt in the pet panel, independent image/video jobs overlap, a failed job does not stop the main flow, and retry does not duplicate the asset.

