"""Regression tests: resuming a task must pick up the current global LLM binding.

Scenario: a task was created pinned to provider A (which later ran out of
balance). The user adds provider B, binds it in model_bindings and saves.
Rebuilding the runtime (resume / auto-recovery / continue) must switch to B
and write the new pinning back to the task row, instead of reusing the stale
pinned provider forever.
"""
import json

import pytest

from app.database import SessionLocal
from app.models import AgentTask, ProviderConfig, UserPreference
from app.routers.agent import _rebuild_runtime_from_db


def _upsert_provider(db, provider_id, base_url, model):
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if row is None:
        row = ProviderConfig(provider_id=provider_id)
        db.add(row)
    row.name = provider_id
    row.base_url = base_url
    row.api_key = "sk-test"
    row.protocol = "openai"
    row.enabled = True
    row.default_model = model
    row.chat_models_json = json.dumps([model])
    row.image_models_json = "[]"
    row.video_models_json = "[]"
    row.extra_config_json = "{}"
    db.commit()


def _set_llm_binding(db, provider_id, model_id):
    pref = db.query(UserPreference).filter_by(key="model_bindings").first()
    value = json.dumps([{"kind": "llm", "providerId": provider_id, "modelId": model_id}])
    if pref is None:
        pref = UserPreference(key="model_bindings", value_json=value)
        db.add(pref)
    else:
        pref.value_json = value
    db.commit()


def _create_task(db, task_id, provider_id, model_id):
    task = AgentTask(
        id=task_id,
        project_id="proj-binding-override",
        user_goal="test binding override on rebuild",
        status="paused",
        plan=[],
        artifacts={},
        total_cost_usd=0.0,
        total_tokens=0,
        llm_provider_id=provider_id,
        llm_model_id=model_id,
    )
    db.add(task)
    db.commit()


def _cleanup(db, task_id, provider_ids):
    db.query(AgentTask).filter_by(id=task_id).delete()
    db.query(ProviderConfig).filter(ProviderConfig.provider_id.in_(provider_ids)).delete(
        synchronize_session=False
    )
    db.commit()


@pytest.mark.asyncio
async def test_rebuild_prefers_current_model_binding_over_pinned():
    """Binding changed after task creation -> rebuild switches LLM and rewrites the row."""
    task_id = "task-binding-override"
    with SessionLocal() as db:
        _cleanup(db, task_id, ["old-provider", "new-provider"])
        _upsert_provider(db, "old-provider", "https://old.test/v1", "old-model")
        _upsert_provider(db, "new-provider", "https://new.test/v1", "new-model")
        _create_task(db, task_id, "old-provider", "old-model")
        # user re-binds to the new provider AFTER the task was created
        _set_llm_binding(db, "new-provider", "new-model")

    rebuilt = await _rebuild_runtime_from_db(task_id)
    try:
        assert rebuilt is not None
        runtime, _memory, _runtime_db, task_dict = rebuilt
        assert task_dict["llm_provider_id"] == "new-provider"
        assert task_dict["llm_model_id"] == "new-model"
        assert runtime.llm.model == "new-model"
        assert runtime.llm.base_url == "https://new.test"
    finally:
        if rebuilt is not None:
            rebuilt[2].close()

    # task row must be updated so future spawns and the UI show the new provider
    with SessionLocal() as db:
        row = db.query(AgentTask).filter_by(id=task_id).first()
        assert row.llm_provider_id == "new-provider"
        assert row.llm_model_id == "new-model"
        _cleanup(db, task_id, ["old-provider", "new-provider"])


@pytest.mark.asyncio
async def test_rebuild_keeps_pinned_when_binding_unchanged():
    """Binding identical to the pinned values -> no override, no row rewrite needed."""
    task_id = "task-binding-unchanged"
    with SessionLocal() as db:
        _cleanup(db, task_id, ["same-provider"])
        _upsert_provider(db, "same-provider", "https://same.test/v1", "same-model")
        _create_task(db, task_id, "same-provider", "same-model")
        _set_llm_binding(db, "same-provider", "same-model")

    rebuilt = await _rebuild_runtime_from_db(task_id)
    try:
        assert rebuilt is not None
        runtime, _memory, _runtime_db, task_dict = rebuilt
        assert task_dict["llm_provider_id"] == "same-provider"
        assert task_dict["llm_model_id"] == "same-model"
        assert runtime.llm.model == "same-model"
        assert runtime.llm.base_url == "https://same.test"
    finally:
        if rebuilt is not None:
            rebuilt[2].close()

    with SessionLocal() as db:
        _cleanup(db, task_id, ["same-provider"])


@pytest.mark.asyncio
async def test_rebuild_keeps_pinned_when_binding_invalid():
    """Binding fails validation (model not declared) -> pinned row must stay untouched.

    Note: the invalid binding also makes the later require_llm=True resolve raise
    CapabilityConfigurationError (pre-existing behavior); the point here is that
    the override block must not have rewritten the pinned values before that.
    """
    task_id = "task-binding-invalid"
    with SessionLocal() as db:
        _cleanup(db, task_id, ["pinned-provider", "bad-binding-provider"])
        _upsert_provider(db, "pinned-provider", "https://pinned.test/v1", "pinned-model")
        _upsert_provider(db, "bad-binding-provider", "https://bad.test/v1", "declared-model")
        _create_task(db, task_id, "pinned-provider", "pinned-model")
        # binding points at a model the provider does NOT declare -> resolve fails
        _set_llm_binding(db, "bad-binding-provider", "undeclared-model")

    from app.agent.capabilities import CapabilityConfigurationError

    with pytest.raises(CapabilityConfigurationError):
        await _rebuild_runtime_from_db(task_id)

    with SessionLocal() as db:
        row = db.query(AgentTask).filter_by(id=task_id).first()
        assert row.llm_provider_id == "pinned-provider"
        assert row.llm_model_id == "pinned-model"
        _cleanup(db, task_id, ["pinned-provider", "bad-binding-provider"])
