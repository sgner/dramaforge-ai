# Embedded Agent Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one persistent canvas mounted while rendering Agent controls and ThoughtStream as in-canvas overlays.

**Architecture:** `App` will always render `InfiniteCanvas` for an active task and mount `AgentMode` as an overlay sibling when `agentMode` is active. `AgentMode` will stop rendering its own canvas and instead use an overlay root with a left task drawer, top goal bar, right ThoughtStream/tool drawers, and floating question/error cards. The existing global Agent store and stream manager remain the source of truth.

**Tech Stack:** React, TypeScript, Zustand, CSS, Vitest, Browser E2E.

## Global Constraints

- There must be exactly one `InfiniteCanvas` in the active project view.
- Entering or leaving Agent mode must not reset canvas nodes, viewport, or Agent task ID.
- Agent process events remain in ThoughtStream; only generated assets may become canvas nodes.
- The existing canvas toolbar Agent button must receive `agentModeActive` and remain the entry point.

---

### Task 1: Lock the single-canvas lifecycle with failing tests

**Files:**
- Modify: `tests/app-agent-mode.test.tsx`
- Modify: `tests/agent/agent-mode-canvas.test.tsx`

- [x] **Step 1: Add tests** asserting active-task rendering contains one canvas, Agent mode does not render a nested canvas, and entering/exiting preserves the canvas test marker and Agent store task ID.
- [x] **Step 2: Run the focused tests** and verify they fail against the current branch because App replaces the canvas with AgentMode and AgentMode renders its own canvas.

### Task 2: Move Agent rendering into an overlay coordinator

**Files:**
- Modify: `App.tsx`
- Modify: `agent/agent-mode.tsx`
- Modify: `components/infinite-canvas/InfiniteCanvas.tsx`

- [x] **Step 1: Keep the active-task `InfiniteCanvas` branch mounted** regardless of `agentMode`, and render `AgentMode` as a sibling overlay when active.
- [x] **Step 2: Remove the nested `InfiniteCanvas` from `AgentMode`** and add an `embedded` overlay root that uses the existing canvas container as its positioning context.
- [x] **Step 3: Preserve callbacks and state**: Agent exit only hides the overlay, task selection hydrates the same Agent store, API settings opens the shared modal, and the canvas toolbar gets `agentModeActive`.
- [x] **Step 4: Run focused lifecycle tests** and verify they pass.

### Task 3: Implement responsive Agent overlay layout

**Files:**
- Modify: `agent/agent.css`
- Modify: `agent/agent-mode.tsx`
- Test: `tests/agent/agent-mode-canvas.test.tsx`

- [x] **Step 1: Add overlay UI tests** for the left task drawer, top goal input, ThoughtStream toggle, tool drawer, question card, and close behavior.
- [x] **Step 2: Add CSS** for a full-size pointer-events-none overlay, pointer-events-auto panels, desktop left/right drawers, and mobile bottom-sheet/collapsed drawer behavior.
- [x] **Step 3: Ensure floating cards stop propagation** so inputs and buttons never initiate canvas pan/selection.
- [x] **Step 4: Run focused UI tests** and verify they pass.

### Task 4: Verify browser behavior and regressions

**Files:**
- Modify: only files required by verification findings.

- [x] **Step 1: Run all frontend tests:** `npm run test -- --run`.
- [x] **Step 2: Run production build:** `npm run build`.

> Verification completed: Browser E2E confirmed one persistent canvas, active Agent state, ThoughtStream/task drawer interactions, clean exit, and zero browser console errors.
- [ ] **Step 3: In the Browser, exercise canvas → Agent → create/choose task → exit → re-enter and verify one canvas, active button, unchanged nodes/viewport, and ThoughtStream state.
- [ ] **Step 4: Check browser console warnings/errors and run `git diff --check`.**
