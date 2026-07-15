# Agent Interaction and Canvas Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent user questions support structured single/multiple/confirm/text responses and make the canvas reflect the complete agent event lifecycle without duplicate or stale nodes.

**Architecture:** Normalize ask-user payloads at the store/API boundary, render one protocol-driven response card, and keep backend response JSON intact through respond/resume. Extend the existing canvas projection with stable timeline nodes while retaining current artifact image/prompt nodes and drag overrides.

**Tech Stack:** React 19, TypeScript, Zustand, Vite/Vitest, FastAPI/Pydantic, pytest.

## Global Constraints

- Preserve legacy `options: string[]` as single-select and legacy string responses.
- Multiple selection submits `response: string[]`; optional free text submits `custom_text`.
- Do not add a UI component library or replace the canvas persistence model.
- Replayed SSE events and task hydration must be idempotent.
- Keep recovery-action payloads (`retry`, `change_model`, `skip`) working.

---

### Task 1: Normalize the ask-user protocol in shared frontend state

**Files:**
- Modify: `agent/use-agent-store.ts`
- Test: `tests/agent/use-agent-store.test.ts`

**Interfaces:**
- `PendingQuestion.options` accepts normalized `{ id: string; label: string }[]` while reading legacy strings.
- Add `selection_mode`, `allow_custom`, `min_selections`, and `max_selections` to the pending question state.
- Add a pure normalization helper in the module for event and hydrate paths.

- [ ] Step 1: Add failing tests for legacy string options, structured options, and preserving response arrays in `user_input_received`.
- [ ] Step 2: Run `npm test -- --run tests/agent/use-agent-store.test.ts`; expect the new normalization assertions to fail.
- [ ] Step 3: Implement normalization and use it in `applyEvent('request_user_input')` and `hydrate` without changing old response semantics.
- [ ] Step 4: Run the focused test and expect PASS.

### Task 2: Implement the protocol-driven response card

**Files:**
- Modify: `agent/agent-mode.tsx`
- Modify: `agent/agent.css`
- Test: `tests/agent/ask-user-response.test.tsx`

**Interfaces:**
- `AskUserResponse` submits `{ response: string | string[]; custom_text?: string; approved?: boolean }` through `api.respondAgent`.
- Single/multiple modes select locally and submit only through an explicit confirm action.

- [ ] Step 1: Add failing tests for single-select, multiple-select, confirm accept/reject, custom text, min/max validation, loading, and failed request retry.
- [ ] Step 2: Run the focused test and verify the new interaction assertions fail.
- [ ] Step 3: Replace immediate option submission with local selection state, mode-aware controls, selected-count feedback, explicit submit, and inline error recovery.
- [ ] Step 4: Move layout styling into `agent.css` with responsive width, safe bottom/side offsets, `pointer-events` isolation, and no overlap with the ThoughtStream drawer.
- [ ] Step 5: Run the focused test and expect PASS.

### Task 3: Preserve structured responses through API and runtime resume

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/agent.py`
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/tools/planning.py`
- Tests: `backend/tests/test_agent_routes.py`, `backend/tests/test_ask_user_resume.py`, `backend/tests/test_agent_planning_tools.py`

**Interfaces:**
- `AgentUserResponse.response` remains `Any`; add `custom_text: Optional[str]`.
- `ask_user` returns normalized metadata while accepting legacy options.
- `pending_response` stores `response`, `custom_text`, `approved`, and existing recovery fields.

- [ ] Step 1: Add failing backend tests posting an array response plus custom text and asserting the stored pending response and emitted event.
- [ ] Step 2: Add a resume test asserting the runtime receives the complete structured response object for a multiple-selection answer.
- [ ] Step 3: Update schema/router/runtime payload handling and ask_user metadata defaults.
- [ ] Step 4: Run `pytest backend/tests/test_agent_routes.py backend/tests/test_ask_user_resume.py backend/tests/test_agent_planning_tools.py -q`; expect PASS.

### Task 4: Restore idempotent event-to-canvas timeline projection

**Files:**
- Modify: `components/infinite-canvas/use-canvas-store.ts`
- Modify: `components/infinite-canvas/CanvasNode.tsx`
- Modify: `components/infinite-canvas/types.ts` if timeline metadata requires a type addition
- Tests: `tests/infinite-canvas/add-agent-nodes-image.test.ts`, `tests/infinite-canvas/canvas-node-agent.test.tsx`, `tests/agent/agent-mode-canvas.test.tsx`

**Interfaces:**
- `addAgentNodes(input)` keeps existing artifact projection and additionally creates stable timeline nodes for goal, plan, action, observation, question, and terminal status.
- Stable node ids are derived from task id plus event kind and event key; repeated input replaces the same node.

- [ ] Step 1: Add failing tests proving plans/actions/observations/questions create nodes, replay does not duplicate nodes, and question status changes after response/done.
- [ ] Step 2: Run the focused canvas tests and verify they fail because only artifact nodes are projected.
- [ ] Step 3: Implement timeline node construction and status mapping while retaining artifact nodes and `nodeOverrides`.
- [ ] Step 4: Update `AgentNodeBody` to show question option summary, selected values, and compact event metadata without swallowing canvas drag events.
- [ ] Step 5: Run all focused canvas tests and expect PASS.

### Task 5: Verify the complete AgentMode flow and rendered layout

**Files:**
- Modify: `tests/agent/agent-mode-e2e.test.tsx` and/or `tests/agent/agent-mode-canvas.test.tsx`
- No committed screenshot or report files.

**Interfaces:**
- Flow under test: AgentMode mount -> request_user_input event -> select multiple options and custom text -> respond/resume -> event clears pending UI -> canvas question node updates.

- [ ] Step 1: Add an integration assertion for structured response and canvas projection.
- [ ] Step 2: Run `npm test` and `npm run build`; fix only failures caused by this change.
- [ ] Step 3: Start Vite with `npm run dev -- --host 127.0.0.1`, inspect the first viewport and a narrow viewport, and exercise the complete flow with browser tooling if available.
- [ ] Step 4: Check page identity, nonblank render, no framework overlay, console errors, interaction proof, and canvas node drag/relayout behavior.
- [ ] Step 5: Record remaining risks in the final handoff and keep temporary screenshots outside the repository.
