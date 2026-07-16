# Task 4 Report: 修改 llm.py 的 REACT_SYSTEM_PROMPT + 运行全部后端测试

**Date:** 2026-07-16
**Plan:** docs/superpowers/plans/2026-07-16-agent-prompt-spec-injection.md
**Base commit:** 22cff3f
**Task commit:** a227cdb

---

## Status

**DONE**

---

## Commits Made

| Hash | Message |
|------|---------|
| `a227cdb` | `feat(agent): add project spec hard rules to REACT_SYSTEM_PROMPT` |

Files staged in the commit:
- `backend/app/agent/llm.py` (REACT_SYSTEM_PROMPT constant: appended 【项目规范】 section)
- `backend/tests/test_agent_prompt_injection.py` (appended 5 new REACT tests)

---

## What Was Implemented

### Step 1 — Appended 5 new tests
Appended to the END of `backend/tests/test_agent_prompt_injection.py` (after the image_tools tests), under the section header `# llm.py REACT_SYSTEM_PROMPT 铁律段`:

1. `test_react_system_prompt_contains_project_spec_section` — asserts `【项目规范】` in REACT_SYSTEM_PROMPT
2. `test_react_system_prompt_contains_isolation_rule` — asserts `隔离` / `角色` / `场景` / `道具` all present
3. `test_react_system_prompt_contains_material_rule` — asserts `可触摸` present
4. `test_react_system_prompt_contains_word_count_rule` — asserts `400-600` (or `400`) and `500-800` (or `500`) present
5. `test_build_system_prompt_still_returns_react_prompt` — asserts `build_system_prompt() == REACT_SYSTEM_PROMPT`

### Step 2 — RED phase verified
Ran the 4 new content-asserting REACT tests. All 4 FAILED with `AssertionError` for the expected reason (feature missing — REACT_SYSTEM_PROMPT did not yet contain the 【项目规范】 section). Confirmed tests actually test the right thing.

### Step 3 — GREEN: replaced REACT_SYSTEM_PROMPT constant
Edited `backend/app/agent/llm.py`: appended the 【项目规范】 section (5 hard rules) to the end of the `REACT_SYSTEM_PROMPT` constant. `build_system_prompt()` and `build_react_prompt()` logic were NOT touched (verified via diff — only the constant text changed).

### Critical verifications performed before replacing
1. **Read current REACT_SYSTEM_PROMPT** (llm.py lines 67-87): The current content matched the plan's pre-【项目规范】 portion exactly (your role description, work method, output format). Therefore replaced verbatim by appending the 【项目规范】 section — no content was lost or reworded.
2. **`build_system_prompt()` already exists** at llm.py lines 108-109, returns `REACT_SYSTEM_PROMPT`. No adjustment needed — the backward-compat test passes out of the box.
3. **Searched `backend/tests/` for tests referencing `REACT_SYSTEM_PROMPT` / `build_system_prompt`**: Found `backend/tests/test_agent_llm.py` uses `build_system_prompt()` and `build_react_prompt()`. Verified ALL assertions use substring matching (`in p`), not exact equality. `test_build_system_prompt_contains_role` only checks for `导演` or `director` (both still present). No regression risk.

### Step 4 — All 19 tests pass
`test_agent_prompt_injection.py`: 19 passed, 0 failed (14 from Tasks 2-3 + 5 new from Task 4).

### Step 5 — Agent module tests pass
`test_specs.py` + `test_agent_llm_tools.py` + `test_agent_prompt_injection.py`: 62 passed, 0 failed (29 + 14 + 19).

### Step 6 — Full backend regression
See Test Results section below. 19 pre-existing failures + 1 pre-existing collection error, all unrelated to this change (proven by stash-and-rerun on BASE commit).

### Step 7 — Committed
Commit `a227cdb` with exact message `feat(agent): add project spec hard rules to REACT_SYSTEM_PROMPT`, staging the two specified files.

---

## Test Results

### Command 1 (Step 2 — RED phase, 4 new REACT tests)
```
py -m pytest tests/test_agent_prompt_injection.py::test_react_system_prompt_contains_project_spec_section \
              tests/test_agent_prompt_injection.py::test_react_system_prompt_contains_isolation_rule \
              tests/test_agent_prompt_injection.py::test_react_system_prompt_contains_material_rule \
              tests/test_agent_prompt_injection.py::test_react_system_prompt_contains_word_count_rule -v
```
**Result:** 4 failed (expected RED). All failures were `AssertionError` because REACT_SYSTEM_PROMPT did not yet contain the 【项目规范】 section / `隔离` / `可触摸` / `400`|`400-600`. Failures were for the correct reason (feature missing, not typos).

### Command 2 (Step 4 — GREEN phase, full injection test file)
```
py -m pytest tests/test_agent_prompt_injection.py -v
```
**Result:** 19 passed, 0 failed.

### Command 3 (Step 5 — agent module tests)
```
py -m pytest tests/test_specs.py tests/test_agent_llm_tools.py tests/test_agent_prompt_injection.py -v
```
**Result:** 62 passed, 0 failed.

### Command 4 (Step 6 — full backend regression, with my change)
```
py -m pytest tests/ -v --tb=short --continue-on-collection-errors
```
**Result:** 303 passed, 19 failed, 1 error (9 warnings).

### Command 5 (Verification — same suite on clean BASE commit 22cff3f, change stashed)
```
py -m pytest tests/ --tb=line --continue-on-collection-errors -q
```
**Result:** 298 passed, 19 failed, 1 error.

### Comparison / Conclusion
- BASE (22cff3f, no change): 298 passed, 19 failed, 1 error
- With Task 4 change (a227cdb): 303 passed, 19 failed, 1 error
- Delta: +5 passed (the 5 new REACT tests), 0 newly broken tests.

The EXACT same 19 failures + 1 error occur on the clean BASE commit. This definitively proves all failures are pre-existing and unrelated to the REACT_SYSTEM_PROMPT text change.

### Pre-existing failures (all unrelated to this task)
All 19 failures + 1 error fall into clearly pre-existing categories:

1. **`test_openai_llm_client.py` (1 ERROR)** — `ModuleNotFoundError: No module named 'respx'`. Explicitly noted in task instructions as a pre-existing missing package. NOT caused by this change.

2. **LLM provider not enabled (most failures)** — `assert 400 == 200` with detail `"llm capability provider 'custom-api' is not enabled"`. These are environment/config failures (no LLM provider configured in test env). Affected files:
   - `test_agent_routes.py` (3 direct 400 failures)
   - `test_ask_user_resume.py` (1 direct 400 failure)
   - `test_parse_user_goal_param.py` (1 direct 400 failure)
   - `test_runtime_autostart.py` (3 direct 400 failures)
   - `test_server_responsiveness.py` (2 direct 400 failures)

3. **Cascading `KeyError: 'id'` (6 failures)** — All in `test_agent_routes.py`, `test_ask_user_resume.py`, `test_server_responsiveness.py`. These are downstream of the 400 failures above: the create-task call returned 400, so the response has no `id`, and the subsequent `create['id']` / `r.json()['id']` raises KeyError.

4. **`test_agent_tasks_list_filter.py::test_list_tasks_filtered_by_project_id`** — `assert 0 >= 2`: no tasks created because create calls returned 400. Cascading from LLM provider issue.

5. **`test_drama_task_router.py::test_drama_task_crud_roundtrip`** — `assert [...] == []`: persistent database contains leftover tasks from previous manual test runs (`asdddsss`, `test`). A test-isolation / dirty-DB issue, NOT caused by this change.

6. **`test_media_providers.py::test_generate_video_fallback_on_404`** — `assert 502 == 200`: external media provider returned 502 Bad Gateway. Network/external-service issue, NOT caused by this change.

**None** of the failing tests reference `REACT_SYSTEM_PROMPT` or `build_system_prompt` exact text. No adjustment to any test assertion was needed.

---

## Deviations from Plan

**None.** The plan was followed verbatim:

- The current `REACT_SYSTEM_PROMPT` (llm.py lines 67-87) matched the plan's pre-【项目规范】 portion exactly, so the constant was replaced verbatim (appended the 【项目规范】 section). No content was preserved/merged because nothing was missing.
- `build_system_prompt()` already existed and returned `REACT_SYSTEM_PROMPT` — no adjustment was needed.
- No tests asserted the old REACT_SYSTEM_PROMPT exact text, so no assertion adjustments were needed.
- `build_react_prompt()` logic was not touched (verified via diff — only the constant text changed).
- Commit message is exactly `feat(agent): add project spec hard rules to REACT_SYSTEM_PROMPT`.
- Only `backend/app/agent/llm.py` and `backend/tests/test_agent_prompt_injection.py` were staged.

---

## One-line Summary

Appended a 【项目规范】 section with 5 cross-tool hard rules to `REACT_SYSTEM_PROMPT` in `backend/app/agent/llm.py` (TDD: 5 new tests added, all 19 injection tests pass, full backend regression shows only pre-existing unrelated failures).

---

## Concerns

None.

- The 19 pre-existing test failures + 1 collection error are all environment/infrastructure issues (missing `respx` package, LLM provider not enabled, dirty persistent DB, external 502) and are NOT caused by this task. They were verified to be identical on the clean BASE commit via stash-and-rerun.
- All agent-module tests (specs + llm_tools + prompt_injection = 62 tests) pass.
- The change is minimal and isolated: only the `REACT_SYSTEM_PROMPT` constant text was modified; `build_system_prompt()` and `build_react_prompt()` logic untouched.
