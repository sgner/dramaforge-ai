# Prompt Engineering and Storyboard References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every image/video generation uses prompt engineering first, and ensure storyboard generation receives connected scene, character, and prop references through persisted multi-input canvas links.

**Architecture:** Add one backend prompt-engineering boundary used by all Agent image/video tools, preserving the descriptive prompt as source context and returning an optimized prompt before the media provider call. Extend storyboard parameters and asset resolution to merge explicit references, semantic character/prop/scene asset IDs, and connected canvas node references. Keep canvas connections many-to-one, validate them at the store boundary, and pass all connected image URLs to generation instead of silently selecting only the first one.

**Tech Stack:** FastAPI/Python, SQLAlchemy asset references, OpenAI-compatible LLM client, React/TypeScript, Zustand canvas store, Vitest/Pytest.

## Global Constraints

- Never send the raw script-derived description directly to an image/video provider when an LLM is available; the optimized prompt is the provider prompt.
- Preserve the original descriptive prompt as metadata for audit/debugging.
- Storyboard generation must preserve scene, character, and prop references and may consume multiple input images.
- Connections are project-scoped, persisted, and may have multiple sources feeding one generation node.
- Do not introduce Agent state nodes onto the canvas; only asset/generation nodes are projected there.

---

### Task 1: Define prompt-engineering and storyboard-reference contracts

**Files:**
- Modify: `backend/tests/test_asset_intelligence_contract.py`
- Modify: `backend/app/agent/tools/image_tools.py`
- Modify: `backend/app/agent/tools/video_tools.py`
- Create: `backend/app/agent/prompt_engineering.py`

**Interfaces:**
- Produce `optimize_generation_prompt(ctx, source_prompt, target, context) -> tuple[str, str]`, returning `(optimized_prompt, source_prompt)`.
- Produce `collect_storyboard_reference_asset_ids(params) -> list[str]`, preserving order and removing duplicates.

- [ ] Write failing tests proving image/video calls use an optimized prompt and storyboard merges scene/character/prop asset IDs.
- [ ] Run the focused Pytest tests and verify they fail because generation currently sends the raw builder prompt and storyboard only consumes explicit IDs.
- [ ] Implement the shared prompt boundary by calling the existing `OptimizePromptTool` with target `image` or `video`; include source description and reference-role context.
- [ ] Update all four image tools and the video tool to send the optimized prompt while returning both `prompt` and `source_prompt` metadata.
- [ ] Update storyboard parameter handling to collect scene, character, prop, and explicit reference IDs and resolve all project-scoped references.
- [ ] Run the focused tests and verify they pass.

### Task 2: Make Agent prompt optimization observable and failure-safe

**Files:**
- Modify: `backend/app/agent/tools/base.py`
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/events.py`
- Modify: `backend/tests/test_asset_intelligence_contract.py`

**Interfaces:**
- `ToolContext.emit_event("prompt_optimization_started", payload)` and `prompt_optimization_finished` expose source/optimized prompt metadata without exposing secrets.
- If prompt optimization cannot run, generation fails with an explicit capability error instead of silently using the raw description.

- [ ] Add a failing test asserting optimization events bracket every Agent media generation and an unavailable LLM produces a clear error.
- [ ] Run the test and confirm the missing events/error behavior.
- [ ] Add the event wrapper to `ToolContext` and use it in `optimize_generation_prompt`.
- [ ] Ensure runtime records the optimized prompt in the media asset metadata and emits it in the observation/artifact event.
- [ ] Run Agent media, recovery, and asset-intelligence tests.

### Task 3: Make canvas manual image/video generation use the same optimization boundary

**Files:**
- Modify: `components/infinite-canvas/use-canvas-store.ts`
- Modify: `services/apiClient.ts`
- Modify: `backend/app/routers/media.py`
- Modify: `tests/infinite-canvas/canvas-node-normal.test.tsx`

**Interfaces:**
- Canvas generation requests carry `source_prompt`, `prompt`, and all `reference_urls`.
- The backend media route optimizes a source prompt when the request identifies a configured LLM capability; otherwise it returns a clear configuration error.

- [ ] Add failing frontend/API tests showing canvas image/video generation sends source text for optimization and preserves all connected image URLs.
- [ ] Run them and verify the current direct-provider request fails the contract.
- [ ] Add a media prompt-optimization request path and update `runVideoGeneration`/image retry to use the optimized result before provider execution.
- [ ] Keep the optimized prompt on the node as `_assetPrompt` and the source as `_assetSourcePrompt`.
- [ ] Run focused canvas tests and build.

### Task 4: Persist and render multi-input generation ports

**Files:**
- Modify: `components/infinite-canvas/types.ts`
- Modify: `components/infinite-canvas/use-canvas-store.ts`
- Modify: `components/infinite-canvas/CanvasNode.tsx`
- Modify: `components/infinite-canvas/CanvasLinks.tsx`
- Modify: `components/infinite-canvas/canvas.css`
- Modify: `tests/infinite-canvas/add-agent-nodes-image.test.ts`
- Create: `tests/infinite-canvas/generation-inputs.test.ts`

**Interfaces:**
- `getConnectedInputImages(nodeId)` returns every connected image/video source in stable connection order.
- `addConnection(from, to)` remains many-to-one and rejects self-links and duplicate links.
- Generation nodes show an input port and a visible count/preview for all connected references.

- [ ] Add failing tests for three source nodes connected to one storyboard/video node, duplicate/self-link rejection, and stable URL collection.
- [ ] Run them and verify current store accepts duplicate/self links or only consumes one reference where applicable.
- [ ] Implement connection validation, shared input selector, and multi-reference rendering.
- [ ] Update image/storyboard/video run handlers to pass every connected input.
- [ ] Run all infinite-canvas tests and verify persistence payload still includes every connection.

### Task 5: End-to-end storyboard consistency flow and documentation

**Files:**
- Modify: `backend/tests/test_agent_media_assets.py`
- Modify: `backend/tests/test_agent_media_batch.py`
- Modify: `tests/agent/agent-mode-e2e.test.tsx`
- Modify: `docs/agent-workflow.md`
- Modify: `docs/asset-intelligence.md`
- Modify: `README.md`

- [ ] Add an integration regression covering scene + two characters + prop references flowing into storyboard prompt optimization and media generation.
- [ ] Run backend and frontend end-to-end tests and record any provider-dependent limitations.
- [ ] Document the required flow: descriptive metadata → prompt optimization → generation, and scene/character/prop inputs → storyboard references.
- [ ] Run full relevant test suites, production build, `git diff --check`, and browser smoke test.
- [ ] Update this plan checklist only after all verification commands pass.
