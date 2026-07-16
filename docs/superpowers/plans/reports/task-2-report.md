# Task 2 Report: Inject project specs into 6 LLM tool system prompts

## Status

**DONE**

## Commits

- `aa7f2b3` — `feat(agent): inject project specs into 6 LLM tool system prompts`
  - Base: `3055ffe` (Task 1 HEAD)
  - Branch: `recovery`
  - Files: `backend/app/agent/tools/llm_tools.py` (modified), `backend/tests/test_agent_prompt_injection.py` (new)

## What was implemented

Modified `backend/app/agent/tools/llm_tools.py`:

1. Added import `from ..specs import get_spec_for_tool` after the existing `from .planning import _coerce_json`.
2. Injected the spec block into all 6 LLM tool `execute()` methods. Each method now does, after constructing its base `system_prompt`:
   ```python
   spec = get_spec_for_tool("<tool_name>")
   if spec:
       system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
   ```
   - `GenerateScriptTool` → key `generate_script`
   - `ExtractCharactersTool` → key `extract_characters`
   - `ExtractPropsTool` → key `extract_props`
   - `ExtractScenesTool` → key `extract_scenes`
   - `ExtractShotsTool` → key `extract_shots`
   - `OptimizePromptTool` → key `optimize_prompt` (spec appended after `.format(target=target)`)

Created `backend/tests/test_agent_prompt_injection.py` with 9 integration tests using a `_CapturingLLM` that records system prompts sent to the LLM, then asserts each contains `【项目规范】` plus tool-specific spec keywords. Includes a fallback test verifying the spec section is omitted when docs are missing.

## Test results

### Step 2 — RED (pre-implementation)
Command: `cd backend && py -m pytest tests/test_agent_prompt_injection.py -v --tb=short`
Result: **8 failed, 1 passed** (9 collected)
- The 8 failures were all `AssertionError: assert '【项目规范】' in sp` — the expected failure (feature missing).
- The 1 pass was `test_tool_runs_without_spec_when_docs_missing` — it asserts the spec section does NOT appear, which is true pre-injection.
- Failures were for the correct reason (feature missing), not typos/import errors.

### Step 10 — GREEN (post-implementation)
Command: `cd backend && py -m pytest tests/test_agent_prompt_injection.py -v --tb=short`
Result: **9 passed, 9 warnings** in 1.22s
- All 9 tests pass.
- Warnings are pre-existing Pydantic/FastAPI deprecation warnings, unrelated to this task.

### Step 11 — Regression
Command: `cd backend && py -m pytest tests/test_agent_llm_tools.py -v --tb=short`
Result: **14 passed, 9 warnings** in 0.53s
- All 14 existing LLM tool tests still pass (plan estimated 12; actual count is 14).
- No behavior regression: tool names, parameters, validate, return structures, and business logic are unchanged.

## Deviations from the plan

**None.** All API assumptions in the plan's test code were verified against the actual codebase before writing tests and held exactly:

1. `ToolContext(task_id="t1", llm_client=llm)` — matches [base.py](file:///c:/Users/25315/PycharmProjects/dramaforge-ai/backend/app/agent/tools/base.py) constructor signature (lines 56-78).
2. `LLMResponse(content=...)` — matches [llm.py](file:///c:/Users/25315/PycharmProjects/dramaforge-ai/backend/app/agent/llm.py) dataclass (lines 18-32).
3. `_CapturingLLM.generate(self, messages, tools=None, **kwargs)` — matches the `LLMClient` protocol; `ctx.generate_llm` delegates to `llm_client.generate` when no `generate_streaming` attr exists (base.py lines 87-96). `temperature`/`max_tokens` are absorbed via `**kwargs`.
4. `BaseTool.call()` exists (base.py line 145) and wraps `validate()` + `execute()`.
5. `OPTIMIZE_PROMPT_SYSTEM_PROMPT` has a `{target}` placeholder (llm_tools.py line 399); `.format(target=target)` already used in current code.
6. The plan's replacement `execute()` code was **byte-for-byte identical** to the current business logic plus the spec injection lines, so no business-logic adaptation was needed. No existing behavior was regressed.

The only numeric discrepancy: the plan estimated "12 tests" in `test_agent_llm_tools.py`, but the file actually contains 14 tests. All 14 pass — this is an estimation error in the plan, not a deviation in the implementation.

## One-line summary

Injected `get_spec_for_tool` specs into all 6 LLM tool system prompts via TDD (9 new tests, RED→GREEN, 14 regression tests still green), committed as `aa7f2b3`.

## Concerns

None blocking. Minor notes:
- Pre-existing Pydantic v1-style `class Config` and FastAPI `on_event` deprecation warnings appear in test output; they predate this task and are out of scope.
- Commit was made on branch `recovery` (the current branch); the branch name is project-default and not introduced by this task.
- As noted in the plan's known-risks section, system prompt size grows by ~500-2000 chars per tool call (increased token cost). This is by design and documented.
