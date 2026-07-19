# Agent Question Internationalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent clarification questions use the task's creation-time UI language for Chinese, English, Japanese, and Korean without exposing internal parameter names.

**Architecture:** The frontend sends `language` when creating an Agent task. The backend stores the validated language on `TaskProfile`; a focused `user_messages.py` module owns localized user-facing Agent copy and falls back to English. `AgentRuntime` consumes this module while internal `missing_inputs` values remain unchanged.

**Tech Stack:** React, TypeScript, Vitest, FastAPI, Pydantic, Python, pytest

## Global Constraints

- Supported language codes are exactly `zh`, `en`, `ja`, and `ko`.
- Existing tasks without a language use English.
- Switching UI language does not change the language of a running task.
- Internal names such as `structured_source` and `agreed_deliverables` must never appear in user-facing questions.

---

### Task 1: Persist Task Language

**Files:**
- Modify: `backend/app/agent/task_profiles.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/agent.py`
- Test: `backend/tests/test_agent_task_profile_persistence.py`

**Interfaces:**
- Consumes: `AgentTaskCreate.language: Literal["zh", "en", "ja", "ko"]`
- Produces: `TaskProfile.language: Literal["zh", "en", "ja", "ko"]`, defaulting to `"en"`

- [ ] **Step 1: Write failing persistence tests**

Add tests that POST an Agent task with `language: "ja"` and assert `task_profile.language == "ja"`, and validate that `TaskProfile.model_validate()` defaults missing legacy language to `"en"`.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_agent_task_profile_persistence.py -q`

Expected: FAIL because the schema/profile do not yet accept or persist `language`.

- [ ] **Step 3: Add the minimal validated fields and persistence**

Add:

```python
AgentLanguage = Literal["zh", "en", "ja", "ko"]

class TaskProfile(BaseModel):
    language: AgentLanguage = "en"
```

Add `language: Literal["zh", "en", "ja", "ko"] = "en"` to `AgentTaskCreate`, then update the profile in `create_task` before serialization:

```python
profile = _profile_for_goal(db, body.user_goal, body.project_id).model_copy(
    update={"language": body.language}
)
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_agent_task_profile_persistence.py -q`

Expected: all tests pass.

### Task 2: Centralize Localized Agent Questions

**Files:**
- Create: `backend/app/agent/user_messages.py`
- Modify: `backend/app/agent/runtime.py`
- Test: `backend/tests/test_agent_user_messages.py`
- Test: `backend/tests/test_agent_task_profile_persistence.py`

**Interfaces:**
- Produces: `missing_source_question(task_type: str, language: str) -> dict[str, object]`
- Result keys: `question: str`, `options: list[str]`

- [ ] **Step 1: Write failing translation tests**

Create parameterized tests for `zh`, `en`, `ja`, and `ko` that assert each result contains native-language copy. Add fallback tests for an unknown language and assertions that neither `structured_source` nor `agreed_deliverables` appears in any result.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_agent_user_messages.py -q`

Expected: FAIL because `app.agent.user_messages` does not exist.

- [ ] **Step 3: Implement the translation table and English fallback**

Create a module-level dictionary with full sentences for each task type (`promotion`, `commercial`, `custom`, and `default`) and the localized “let Agent write the script” option. Implement language normalization as:

```python
SUPPORTED_LANGUAGES = {"zh", "en", "ja", "ko"}

def normalize_language(language: str | None) -> str:
    return language if language in SUPPORTED_LANGUAGES else "en"
```

Return complete user-facing sentences rather than interpolating internal field names.

- [ ] **Step 4: Wire Runtime to localized copy**

Replace `source_label` construction in `_pause_for_script_requirement` with:

```python
copy = missing_source_question(profile.task_type, profile.language)
question = {
    # existing metadata remains unchanged
    "question": copy["question"],
    "options": copy["options"],
}
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_agent_user_messages.py tests/test_agent_task_profile_persistence.py tests/test_task_profiles.py -q`

Expected: all tests pass.

### Task 3: Send UI Language When Starting Agent

**Files:**
- Modify: `services/apiClient.ts`
- Modify: `agent/agent-mode.tsx`
- Test: `tests/agent/agent-mode.test.tsx`

**Interfaces:**
- Consumes: `useI18n().lang`
- Produces: `startAgent(..., { language: Language })` and JSON field `language`

- [ ] **Step 1: Write a failing frontend test**

Render `AgentMode` under an `I18nProvider` with language set to Japanese, submit a goal, and assert:

```typescript
expect(api.startAgent).toHaveBeenCalledWith(
  'p1',
  expect.any(String),
  expect.objectContaining({ language: 'ja' }),
);
```

- [ ] **Step 2: Run test and verify RED**

Run: `npm test -- tests/agent/agent-mode.test.tsx --run`

Expected: FAIL because `language` is not passed.

- [ ] **Step 3: Extend the API and component**

Add `language?: Language` to `startAgent` options and serialize it as `language: opts.language ?? 'en'`. In `AgentMode`, read `const { lang } = useI18n()` and pass `language: lang` with provider/model IDs.

- [ ] **Step 4: Run test and verify GREEN**

Run: `npm test -- tests/agent/agent-mode.test.tsx --run`

Expected: all tests pass.

### Task 4: End-to-End Verification

**Files:**
- Verify only; no new production files

**Interfaces:**
- Consumes: persisted task language and localized Runtime copy
- Produces: verified four-language Agent clarification flow

- [ ] **Step 1: Run focused backend tests**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_agent_user_messages.py tests/test_agent_task_profile_persistence.py tests/test_task_profiles.py -q`

Expected: zero failures.

- [ ] **Step 2: Run focused frontend tests**

Run: `npm test -- tests/agent/agent-mode.test.tsx tests/i18n-locales-parity.test.ts --run`

Expected: zero failures.

- [ ] **Step 3: Build frontend**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Review user-facing strings**

Search:

```powershell
rg -n "structured source|agreed deliverables|promotion brief|product brief" backend/app/agent
```

Expected: no matches in user-facing translation/runtime code; occurrences in model prompts or internal documentation are allowed only when not sent directly to users.
