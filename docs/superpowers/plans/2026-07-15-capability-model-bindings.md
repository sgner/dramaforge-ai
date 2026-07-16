# Capability Model Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace workflow-step model bindings with exactly three capability bindings: LLM, image generation, and video generation.

**Architecture:** `ApiConfig` will store `modelBindings` keyed by capability rather than by workflow step. A compatibility normalizer will convert existing `step_bindings` data into the three capabilities when loading old projects. Runtime helpers will map workflow steps to capabilities so existing task execution keeps using one selected model per capability.

**Tech Stack:** React, TypeScript, Zustand, Vitest, FastAPI preference storage.

## Global Constraints

- The API settings UI must show only three binding cards: LLM, image generation, and video generation.
- No new binding may be persisted for `preprocessing`, `scriptGeneration`, `characterDesign`, `storyboarding`, or `promptOptimization`.
- Existing saved configurations must remain readable and be migrated without exposing API keys.
- Agent mode and normal canvas execution must resolve the same capability binding.

---

### Task 1: Define capability binding data and migration helpers

**Files:**
- Modify: `types.ts`
- Test: `tests/types-model-bindings.test.ts`

- [x] **Step 1: Write the failing tests** for normalizing legacy step bindings, selecting the capability binding, and producing three default binding slots.
- [x] **Step 2: Run the focused test and verify it fails** because the capability types and helpers do not exist.
- [x] **Step 3: Implement** `ModelBindingKind`, `ModelBinding`, `modelBindings`, `normalizeModelBindings`, `getBindingForStep`, and capability-based provider/model helpers while keeping the old `StepType` API only as a runtime mapping input.
- [x] **Step 4: Run the focused test and verify it passes.**

### Task 2: Replace the API settings step grid with three capability bindings

**Files:**
- Modify: `components/infinite-canvas/ApiSettingsModal.tsx`
- Modify: `locales.ts`
- Test: `tests/infinite-canvas/api-settings-modal.test.tsx`

- [x] **Step 1: Write the failing UI tests** asserting the modal renders exactly LLM, image generation, and video generation binding cards and does not render workflow-step labels.
- [x] **Step 2: Run the focused UI test and verify it fails** against the existing step grid.
- [x] **Step 3: Implement** capability metadata, capability-specific model lists, updates by capability, and footer copy/counts; remove step-to-model selection from the rendered UI.
- [x] **Step 4: Update Chinese/English/Japanese/Korean binding labels and descriptions** to describe capability bindings rather than workflow steps.
- [x] **Step 5: Run the focused UI test and verify it passes.**

### Task 3: Migrate persistence and synchronize Agent/canvas configuration

**Files:**
- Modify: `App.tsx`
- Modify: `components/infinite-canvas/use-canvas-store.ts`
- Modify: `agent/agent-mode.tsx`
- Modify: `tests/app-agent-mode.test.tsx`
- Modify: `tests/agent/agent-mode.test.tsx`

- [x] **Step 1: Write failing tests** for loading `model_bindings`, migrating old `step_bindings`, and having Agent submit the LLM capability binding.
- [x] **Step 2: Run the focused tests and verify they fail** because the app still reads/writes step bindings.
- [x] **Step 3: Implement** backend-preference loading with `model_bindings`, legacy fallback normalization, local-storage migration, and store synchronization; update Agent to read the LLM capability binding and fallback provider.
- [x] **Step 4: Run the focused tests and verify they pass.**

### Task 4: Route normal task execution through capability bindings

**Files:**
- Modify: `hooks/useTaskExecutor.ts`
- Modify: `hooks/useTaskActions.ts`
- Modify: `tests/hooks/model-binding-resolution.test.ts`

- [x] **Step 1: Write failing tests** proving preprocessing/script/prompt steps use the LLM binding, character/scene/storyboard steps use the image binding, and video generation uses the video binding.
- [x] **Step 2: Run the focused tests and verify they fail** with the old per-step lookup semantics.
- [x] **Step 3: Replace direct step-binding reads** with capability-aware helpers and preserve existing task status behavior.
- [x] **Step 4: Run the focused tests and verify they pass.**

### Task 5: Full regression verification

**Files:**
- Modify: any files required by test/build findings only.

- [x] **Step 1: Run all frontend tests:** `npm run test -- --run`.
- [x] **Step 2: Run the production build:** `npm run build`.
- [x] **Step 3: Run `git diff --check` and inspect the final diff** for remaining `stepBindings` UI/runtime usage.
- [x] **Step 4: Report any unrelated pre-existing warnings separately from failures.**
