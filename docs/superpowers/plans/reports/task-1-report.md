# Task 1 Report: specs.py 核心 + 10 个 builder 函数 + 单元测试

## Status: DONE_WITH_CONCERNS

Work is complete, all 29 tests pass, and the commit was made with the exact required
message. The "WITH_CONCERNS" flag is raised only because I had to correct a path bug
in the plan's source code (see "Concerns / Notes" below). The reviewer should validate
that this correction was the right call.

## Commits Made

- **Hash:** `3055ffec2b98962f8a286e6f136cfeb3b64f3f49` (short: `3055ffe`)
- **Branch:** `recovery`
- **Message:** `feat(agent): add specs.py with 10 tool-specific spec builders and tests`
- **Files staged:** `backend/app/agent/specs.py`, `backend/tests/test_specs.py`
- **Diff stat:** 2 files changed, 506 insertions(+)

## Test Results

**Command run (RED — before implementation):**

```
cd backend && py -m pytest tests/test_specs.py -v
```

Result: collection error, exit code 2 — `ImportError: cannot import name 'specs' from
'app.agent'`. This is the expected RED state (specs.py did not exist yet). Matches the
plan's expected failure (`ModuleNotFoundError` or `ImportError`).

**Command run (GREEN — after implementation):**

```
cd backend && py -m pytest tests/test_specs.py -v
```

Result: **29 passed, 0 failed** in 1.00s. Exit code 0.

Full test list (all PASSED):
1. `test_load_file_returns_content_when_exists`
2. `test_load_file_returns_empty_when_missing_key`
3. `test_load_file_caches_second_call`
4. `test_load_file_returns_empty_on_unicode_error`
5. `test_extract_between_with_end_pattern`
6. `test_extract_between_without_end_pattern`
7. `test_extract_between_no_start_match_returns_empty`
8. `test_get_spec_for_unknown_tool_returns_empty`
9. `test_get_spec_for_tool_caches_result`
10. `test_extract_characters_spec_contains_face_anchors`
11. `test_extract_characters_spec_contains_clothing_layers`
12. `test_extract_characters_spec_contains_hairstyle_rules`
13. `test_extract_characters_spec_contains_prohibitions`
14. `test_extract_props_spec_contains_classification`
15. `test_extract_props_spec_contains_required_fields`
16. `test_extract_props_spec_contains_prohibitions`
17. `test_extract_scenes_spec_contains_character_adaptation`
18. `test_extract_scenes_spec_contains_seven_layers`
19. `test_extract_scenes_spec_contains_color_management`
20. `test_extract_shots_spec_contains_video_directions`
21. `test_optimize_prompt_spec_contains_cineforge_constraints`
22. `test_optimize_prompt_spec_contains_sensitive_words`
23. `test_optimize_prompt_spec_contains_quality_tail`
24. `test_generate_script_spec_contains_audiovisual_signature`
25. `test_image_character_spec_contains_concept_layout`
26. `test_image_scene_spec_contains_material_standard`
27. `test_image_prop_spec_contains_composition`
28. `test_image_storyboard_spec_contains_storyboard_rules`
29. `test_all_builders_return_empty_when_docs_missing`

**Assertion keyword adjustments:** NONE. All `test_*_spec_contains_*` tests passed with
the original candidate keywords from the plan. No assertion text was modified. The docs
files (`【资产库】全资产大师V3.0_场景+角色+道具_万能版.txt`, `视频提示词模板.md`,
`分镜解析.md`) all exist at `c:\Users\25315\PycharmProjects\dramaforge-ai\docs\` and
their content matched the expected keywords.

**Pre-existing warnings (unrelated to this task):** 9 warnings about Pydantic V2
deprecated `class config` and FastAPI `on_event` deprecation — these come from
`app/schemas.py` and `app/__init__.py`, not from my changes.

## One-Line Summary

Created `backend/app/agent/specs.py` (spec loader + 10 tool-specific builders +
`get_spec_for_tool` public API with module-level caching and silent fallback) and
`backend/tests/test_specs.py` (29 passing tests covering load/cache/extract/cache-hit/
end-to-end builder output/fallback); all tests green.

## Concerns / Notes for the Reviewer

### 1. `_DOCS_DIR` path was corrected (5 parents → 4 parents)

This is the only deviation from the plan's literal source code, and it was necessary
to make any test pass.

**Plan's code (as written):**
```python
# 向上 4 层：specs.py -> agent -> app -> backend -> project_root
_DOCS_DIR = Path(__file__).parent.parent.parent.parent.parent / "docs"
```

**My code (committed):**
```python
# 向上 4 层：specs.py -> agent -> app -> backend -> project_root
_DOCS_DIR = Path(__file__).parent.parent.parent.parent / "docs"
```

**Why this was necessary (path math verification):**

`specs.py` lives at:
`c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\agent\specs.py`

`docs/` lives at:
`c:\Users\25315\PycharmProjects\dramaforge-ai\docs`

Counting `.parent` calls from `specs.py`:
| Call count | Resolves to |
|---|---|
| 1 | `...\backend\app\agent` |
| 2 | `...\backend\app` |
| 3 | `...\backend` |
| 4 | `...\dramaforge-ai` (project root — CORRECT) |
| 5 | `...\PycharmProjects` (one level too high — WRONG) |

With the plan's 5 `.parent` calls, `_DOCS_DIR` would resolve to
`c:\Users\25315\PycharmProjects\docs`, which does **not** exist. Every end-to-end
builder test would fail with empty spec (silent fallback returns `""`).

The plan's own comment says "向上 4 层" (up 4 levels) and lists 4 hops
("specs.py -> agent -> app -> backend -> project_root"), which matches 4 `.parent`
calls. So the plan's code had a typo: the comment was correct, the code was off by one.

The task instructions explicitly asked me to "Verify this resolves to
`c:\Users\25315\PycharmProjects\dramaforge-ai\docs` by reading the actual directory
structure." I performed this verification, confirmed the discrepancy, and applied the
minimal fix (4 parents) needed to make tests pass — this is the TDD GREEN step
("write minimal code to pass").

I did **not** change any spec builder logic, regex patterns, file keys, or the public
`get_spec_for_tool` API. Only the `.parent` count on the `_DOCS_DIR` line was changed.

If the reviewer disagrees and wants the literal 5-parent version committed instead,
the fix is trivial to revert — but then all 20 end-to-end builder tests will fail
because docs will not be found.

### 2. `python` not on PATH; used `py` launcher

The first attempt to run pytest with `python -m pytest` failed with
`The system cannot find the path specified`. I switched to the Windows `py` launcher
(`py -m pytest`), which uses Python 3.14.3 with pytest 9.1.1. All test commands in the
plan say `python -m pytest`; on this machine the equivalent working command is
`py -m pytest`. Test results are identical.

### 3. asyncio_mode = auto

`backend/pytest.ini` sets `asyncio_mode = auto`. The specs tests are all synchronous,
so this has no impact on Task 1, but Tasks 2/3 will rely on it for the `@pytest.mark.asyncio`
integration tests.

## Files Changed

| File | Operation | Lines |
|---|---|---|
| `backend/app/agent/specs.py` | Create | ~245 lines (incl. docstrings) |
| `backend/tests/test_specs.py` | Create | ~260 lines (incl. docstrings) |

Both files are committed in `3055ffe`. No existing files were modified.
