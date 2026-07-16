# Pet Agent Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the desktop pet the visible Agent interaction surface and make the toolbar Agent button a toggle.

**Architecture:** `CanvasToolbar` continues to own the mode toggle. `AgentMode` keeps task orchestration, while `AgentPetController` owns the draggable pet and an anchored panel containing task input, status, counters, and the existing question UI. ThoughtStream remains available from the pet panel instead of occupying a separate top-level capsule.

**Tech Stack:** React, TypeScript, Zustand, existing CSS tokens, Vitest and Testing Library.

## Global Constraints

- Agent mode must not create Agent process nodes on the canvas.
- The pet position remains project-scoped and clamped to the canvas bounds.
- The Agent panel is expanded by default and can be toggled by clicking the pet.
- Clicking the active toolbar Agent button exits Agent mode; no separate exit button is rendered.
- All existing Agent inputs remain free-text capable.

---

### Task 1: Toolbar toggle and pet panel contract

**Files:**
- Modify: `App.tsx`
- Modify: `components/infinite-canvas/CanvasToolbar.tsx`
- Modify: `agent/agent-mode.tsx`
- Modify: `agent/agent-pet-controller.tsx`
- Test: `tests/app-agent-mode.test.tsx`
- Test: `tests/agent/agent-pet-controller.test.tsx`

- [ ] **Step 1: Write failing tests**

Add assertions that clicking the active toolbar Agent button dispatches the existing `agent-mode-exit` event, AgentMode does not render `exit-agent-mode`, and the pet renders an expanded panel by default.

- [ ] **Step 2: Run tests and verify failure**

Run `npm run test -- --run tests/app-agent-mode.test.tsx tests/agent/agent-pet-controller.test.tsx`.
Expected: the old exit button is still present and the pet has no expanded panel contract.

- [ ] **Step 3: Implement the interaction contract**

Pass `agentModeActive` into the toolbar handler and make the handler dispatch `agent-mode-exit` when active. Remove the standalone exit button from AgentMode. Add `panelOpen` state to `AgentPetController`, defaulting to `true`, and expose `data-testid="agent-pet-panel"` plus a click handler on the pet that toggles it without breaking drag behavior.

- [ ] **Step 4: Run tests and verify pass**

Run the same Vitest command and expect all targeted tests to pass.

### Task 2: Move Agent controls around the pet

**Files:**
- Modify: `agent/agent-pet-controller.tsx`
- Modify: `agent/agent-mode.tsx`
- Modify: `agent/agent.css`
- Test: `tests/agent/agent-mode-e2e.test.tsx`

- [ ] **Step 1: Write failing tests**

Assert that the pet panel contains the goal input, create-task button, status text, thought/action/observation counts, and a ThoughtStream toggle; assert the old `agent-topbar` goal input is absent.

- [ ] **Step 2: Run tests and verify failure**

Run `npm run test -- --run tests/agent/agent-mode-e2e.test.tsx`.
Expected: controls are still rendered in the top bar and the pet panel is not present.

- [ ] **Step 3: Implement the panel**

Move the controlled goal input and submit callback into `AgentPetController` via props. Pass status, counters, latest thought, `thoughtOpen`, and `onToggleThought` from AgentMode. Render the panel as an anchored card beside the pet, with a highlighted default-open state and a compact mobile layout. Keep `AskUserResponse` inside the same panel so questions use the pet surface.

- [ ] **Step 4: Run tests and verify pass**

Run the E2E test file and expect all tests to pass.

### Task 3: Remove obsolete controls and verify build

**Files:**
- Modify: `agent/agent-mode.tsx`
- Modify: `agent/agent.css`
- Modify: `tests/app-agent-mode.test.tsx`
- Modify: `tests/agent/agent-mode-e2e.test.tsx`

- [ ] **Step 1: Update stale assertions**

Replace tests that expect the removed exit button or progress capsule with assertions for the toolbar toggle and pet panel status surface.

- [ ] **Step 2: Run the complete focused suite**

Run `npm run test -- --run tests/app-agent-mode.test.tsx tests/agent/agent-mode.test.tsx tests/agent/agent-mode-e2e.test.tsx tests/agent/agent-pet-controller.test.tsx tests/agent/use-agent-store.test.ts`.

- [ ] **Step 3: Build and inspect the diff**

Run `npm run build` and `git diff --check`. The build must succeed; only the existing chunk-size warning is acceptable.
