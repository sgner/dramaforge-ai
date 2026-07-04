# SDD Progress Ledger — Plan 5 UI Merge

**Plan file:** `docs/superpowers/plans/2026-07-04-ui-merge.md`
**Spec file:** `docs/superpowers/specs/2026-07-04-ui-merge-design.md`
**Branch:** `recovery`
**Base commit (spec doc):** `aa96d34`
**Started:** 2026-07-04

## Context

Plan 1 把后端 provider 表合并到统一 `provider_configs`，但前端 `ApiSettingsModal` 仍把配置拆成 "Agent LLM" + "平台列表" 两个独立 section（虽然都从同一张表读）。用户报"前端看起来仍分开"。Plan 5 把两个 section 合并为单一 Provider 列表 + 单一折叠式编辑器，后端两个 endpoint 合并为 `/api/providers`，旧 endpoint 返 410。

## Pre-Flight Resolutions

1. **PUT 字段保留语义** — 已在 plan Task 2 verbatim 写明：`api_key` None/空 → 保留 DB 原 key；非空 → 覆盖。其它字段总是用 body 覆盖。
2. **`ProviderOut` 16 字段** — 已在 plan Task 1+4 verbatim 写明，前后端字段名一致。
3. **`<details>` 折叠** — HTML5 原生元素，无需第三方库。
4. **Task 6 是大型重构** — 已有 verbatim 模板代码，implementer 只需按模板套到现有 renderEditor 逻辑里（保留 renderAdvancedExtensions）。

## Task Status

| Task | Title | Status | Implementer Commits | Reviewer Verdict | Notes |
|------|-------|--------|---------------------|------------------|-------|
| 1 | 后端 GET /api/providers | done | 2f09c2f | SPEC ✅ | 0 findings — clean. 4/4 tests pass. Plan had 3 stale "main.py" / "app.models.Base" refs; implementer fixed to `app/__init__.py` / `app.database.Base` (matches existing test_llm_providers_crud.py). |
| 2 | 后端 PUT /api/providers/{id} | done | bfadc83 | SPEC ✅ | 0 findings. 9/9 tests pass. `if body.api_key:` preserve semantics correct in both create/update paths. |
| 3 | 后端 DELETE + 旧 endpoint 410 | done | 8978392 | SPEC ✅ | 0 findings — clean. 20/20 new tests pass; 213/213 full backend pass. PATCH endpoint intentionally omitted from unified /api/providers (PUT field-preserve covers partial updates; test_patch_partial removed from test_media_providers.py as a result). `Request` type required for stub handler signature (naive `request` param triggers 422 'query field required'). |
| 4 | 前端类型 + ProviderOut interface | done | dc03d52 | ready for review | `ProviderOut` interface (16 字段) added to apiClient.ts; `defaultModel?` added to `Provider` interface in types.ts. tsc: 0 errors in modified files. |
| 5 | 前端 apiClient 删 9 加 5 | done | c83c50e | ready for review | Removed 9 old methods, added 5 new (listProviders, getProvider, upsertProvider, patchProvider, deleteProvider). |
| 6 | 前端 ApiSettingsModal 重构 | done | f1be228 | ready for review | Merged two sections into single Provider list with fold-out editor. renderAdvancedExtensions preserved. |
| 7 | agent-mode.tsx 改 listProviders | done | 716741b | ready for review | `api.listLLMProviders()` → `api.listProviders()`. Response shape identical. |
| 8 | 全量测试清理 | done | db7ce61 | ready for review | Fixed leftover cleanup: `respondAgent` TS payload now includes `recovery_action`/`new_model_id` (Spec B); `mediaProviderMigration` uses `upsertProvider`; `error-recovery-card` uses `respondAgent`; test mocks updated. 137/137 vitest pass, 213/213 pytest pass. |
| 9 | Final whole-branch review | done | c3b4e7b | APPROVE_WITH_FIXES ✅ | Reviewer verdict: APPROVE_WITH_FIXES. Fixed: Important #1 (orphan `patchProvider` removed — PUT field-preserve covers partial updates) + Minor #2 (`LLMProviderOut` / `MediaProviderOut` dead interfaces deleted) + Minor #4 (added `test_upsert_provider_flips_enabled`). 137/137 vitest + 21/21 test_providers_crud pytest pass. Defer: Minor #3 (`api-settings-unified.test.tsx` new test), Minor #5 (legacy form cleanup — Plan 6), Minor #6 (doc artifacts cleanup — next plan). |

## Final Review

- [x] Whole-branch review dispatched (BASE = aa96d34)
- [x] Findings resolved (Important #1, Minor #2, Minor #4)
- [x] Branch ready for merge (deferred: Minor #3/#5/#6 → next plan)

## Minor Findings (collect for final review triage)

1. **`api-settings-unified.test.tsx` 缺失**（reviewer Minor #3）— 下一 plan 补（fold-out editor 集成测试 3-4 case）。
2. **`ApiSettingsModal.tsx` legacy form 段~1900 行待清理**（reviewer Minor #5）— Plan 6 独立 task。
3. **历史 review artifact 中的 `LLMProviderOut`/`MediaProviderOut` 引用**（reviewer Minor #6）— 下次 plan rotation 时清理。
