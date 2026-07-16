# Task 3 Report: Inject project specs into 4 image prompt builders

## Status

DONE

## Commits

- `22cff3f37fa06bb3544c32ef6de9628305385a4d` — `feat(agent): inject project specs into 4 image prompt builders`
  - Branch: `recovery`
  - Parent (BASE): `aa7f2b3`
  - Files staged: `backend/app/agent/tools/image_tools.py`, `backend/tests/test_agent_prompt_injection.py`
  - Diff: 2 files changed, 66 insertions(+)

## What was implemented

Followed TDD (RED → GREEN) to inject project spec strings into the 4 `_build_*_prompt` functions in `backend/app/agent/tools/image_tools.py`:

1. **Import**: Added `from ..specs import get_spec_for_tool` at the end of the existing import block (after `from .base import BaseTool, ToolContext, ToolParameter`).
2. **`_build_character_prompt`**: Appends `get_spec_for_tool("image_character")` to `parts` before joining (B.4 concept layout / B.5 organization / A.1.2 quality tail).
3. **`_build_prop_prompt`**: Appends `get_spec_for_tool("image_prop")` (C.3 composition / C.4 organization / A.1.2).
4. **`_build_scene_prompt`**: Appends `get_spec_for_tool("image_scene")` (A.1.2 / A.2 seven layers / A.3 material standard).
5. **`_build_storyboard_prompt`**: Appends `get_spec_for_tool("image_storyboard")` after the existing `parts.append("storyboard frame, sketch style, cinematic framing")` (§4 storyboard rules).

All 4 functions preserve their original signatures, base prompt parts, default values, and return type. Spec injection is guarded by `if spec:` so docs-missing fallback still returns the base prompt unchanged.

5 new tests appended to `backend/tests/test_agent_prompt_injection.py` under the section header `# image_tools._build_*_prompt 注入规范`:
- `test_build_character_prompt_contains_concept_layout`
- `test_build_scene_prompt_contains_material_standard`
- `test_build_prop_prompt_contains_composition`
- `test_build_storyboard_prompt_contains_storyboard_rules`
- `test_build_prompts_run_without_spec_when_docs_missing` (fallback case)

## Test results

### Step 2 — RED (before implementation)

Command:
```
py -m pytest tests/test_agent_prompt_injection.py::test_build_character_prompt_contains_concept_layout tests/test_agent_prompt_injection.py::test_build_scene_prompt_contains_material_standard tests/test_agent_prompt_injection.py::test_build_prop_prompt_contains_composition tests/test_agent_prompt_injection.py::test_build_storyboard_prompt_contains_storyboard_rules -v
```
Result: **4 failed** — all with expected `AssertionError` on the spec-keyword `any(...)` assertion (base prompt present, spec not yet injected). Failure reason matched expectation.

### Step 8 — GREEN (full file)

Command:
```
py -m pytest tests/test_agent_prompt_injection.py -v
```
Result: **14 passed** (9 from Task 2 + 5 new from Task 3), 0 failed, in 1.19s.

### Step 9 — Regression

Command:
```
py -m pytest tests/ -k "image" -v --continue-on-collection-errors
```
Result: **16 passed**, 301 deselected. 1 collection error in `tests/test_openai_llm_client.py` (see Deviations).

## Deviations from plan

**No deviations in implementation.** The current `_build_*_prompt` function bodies in `image_tools.py` were byte-for-byte identical to the plan's "base parts" sections, so the plan's replacement code was applied verbatim — no business-logic divergence, no need to adjust test assertion keywords (all candidate keywords matched actual spec content from `docs/`).

### Pre-existing environmental issue (not caused by this task)

`tests/test_openai_llm_client.py` fails to import with `ModuleNotFoundError: No module named 'respx'`. This is a pre-existing collection error caused by a missing optional test dependency (`respx` is an HTTP mocking library for `httpx`). It is completely unrelated to Task 3 — I did not modify that file or any of its dependencies. The plan's Step 9 regression command (`py -m pytest tests/ -k "image" -v`) aborted collection on this import error; I re-ran with `--continue-on-collection-errors` to confirm all 16 actual image-keyword tests pass. The controller may want to install `respx` (e.g. `pip install respx`) or add it to dev requirements to clear this pre-existing issue, but it is out of scope for Task 3.

### Minor note on specs.py path (pre-existing, not touched)

`backend/app/agent/specs.py` line 22 uses `_DOCS_DIR = Path(__file__).parent.parent.parent.parent / "docs"` (4 levels up), while the plan's code listing showed 5 `.parent` calls. This was set during Task 1 and tests pass, so the path is correct; the plan's code listing had a typo. Not modified in Task 3.

## One-line summary

Successfully injected project specs into all 4 `_build_*_prompt` image prompt builders via TDD; all 14 tests pass (9 prior + 5 new) and 16 image-keyword regression tests pass.

## Concerns

None for this task. The only issue encountered (missing `respx` package breaking `test_openai_llm_client.py` collection) is pre-existing, environmental, and unrelated to Task 3 — flagged for controller awareness only.
