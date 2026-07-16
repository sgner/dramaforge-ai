# Agent Pet Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Agent API overlay controls with a draggable, bounded, project-persistent desktop pet that owns Agent questions while keeping API configuration in the shared canvas toolbar.

**Architecture:** `AgentMode` remains the Agent overlay coordinator but delegates pet rendering, pointer dragging, persistence, and question submission to a focused `AgentPetController`. The controller receives the canvas container ref and Agent store state, clamps coordinates to the container, stores positions by project ID, and renders the pending question bubble near the pet. The existing canvas API button remains the only API configuration entry.

**Tech Stack:** React, TypeScript, Zustand, CSS, Vitest, in-app Browser E2E.

## Global Constraints

- Agent mode must not render a second canvas or a second API configuration component.
- The pet position is stored per project in `localStorage` and clamped to the visible canvas bounds.
- The pending question must support free text and submit through the existing Agent response path.
- Dragging the pet must not pan, select, or mutate canvas nodes.

---

### Task 1: Add controller behavior tests

**Files:**
- Create: `agent/agent-pet-controller.tsx`
- Test: `tests/agent/agent-pet-controller.test.tsx`

- [x] **Step 1: Write tests** for rendering the pet, restoring a project-specific position, clamping a stored position, dragging within bounds, and submitting a pending free-text question.
- [x] **Step 2: Run the focused test** with `npm run test -- --run tests/agent/agent-pet-controller.test.tsx` and verify the new tests fail before implementation.

### Task 2: Implement the bounded persistent pet

**Files:**
- Create: `agent/agent-pet-controller.tsx`
- Modify: `agent/agent.css`

- [x] **Step 1: Implement project-scoped position storage** using `agent-pet-position:${projectId}`, safe JSON parsing, and a clamp helper based on container and pet dimensions.
- [x] **Step 2: Implement pointer dragging** with document-level move/up listeners, pointer capture where available, and `stopPropagation`/`preventDefault` so the canvas does not receive the gesture.
- [x] **Step 3: Render the pet and anchored question bubble** with status text, keyboard-accessible button behavior, free-text input, submit/disabled states, and responsive sizing.
- [x] **Step 4: Run the focused controller tests** and verify they pass.

### Task 3: Integrate the controller and remove Agent API controls

**Files:**
- Modify: `agent/agent-mode.tsx`
- Modify: `agent/agent.css`
- Modify: `tests/agent/agent-mode-canvas.test.tsx`

- [x] **Step 1: Remove the Agent API summary/configuration block** and its callback from the Agent overlay while preserving the shared canvas API button.
- [x] **Step 2: Mount `AgentPetController`** with the active project ID, canvas container ref, Agent status, pending question, and existing response callback.
- [x] **Step 3: Add integration assertions** that Agent mode has no API settings component, renders one pet, and routes a question response through the Agent store/API mock.
- [x] **Step 4: Run Agent mode tests** with `npm run test -- --run tests/agent/agent-mode-canvas.test.tsx tests/agent/agent-pet-controller.test.tsx`.

### Task 4: Verify rendered behavior

**Files:**
- Modify: only files required by verification findings.

- [ ] **Step 1: Run all frontend tests** with `npm run test -- --run`.
- [ ] **Step 2: Run `npm run build` and `git diff --check`.**

> Verification completed: full tests and build passed; Browser confirmed the shared toolbar API entry, selected Agent button, one canvas, bounded pet layout, and no browser errors beyond the existing Tailwind CDN production warning.
- [ ] **Step 3: In the Browser, enter Agent mode, confirm the API block is absent, drag the pet inside and against the boundary, open a question, submit free text, reload/re-enter, and confirm the project-specific position is restored and clamped.
- [ ] **Step 4: Check browser console errors/warnings and capture desktop plus mobile screenshots for the final QA report.
