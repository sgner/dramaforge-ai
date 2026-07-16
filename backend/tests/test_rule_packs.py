from app.agent.rule_packs import (
    RulePack,
    WorkflowStep,
    build_prompt_rule_context,
    get_rule_pack,
    get_workflow_steps,
)
from app.agent.task_profiles import classify_task


def test_every_supported_rule_pack_is_versioned_and_complete():
    for task_type in ("drama_short", "documentary", "promotion", "commercial", "custom"):
        pack = get_rule_pack(f"{task_type}.v1")
        assert isinstance(pack, RulePack)
        assert pack.id == f"{task_type}.v1"
        assert pack.source_documents
        assert pack.hard_rules
        assert pack.prompt_templates
        assert pack.validators
        assert pack.workflow_steps


def test_rule_pack_lookup_rejects_unknown_id():
    try:
        get_rule_pack("unknown.v9")
    except KeyError as exc:
        assert "unknown.v9" in str(exc)
    else:
        raise AssertionError("unknown rule pack should fail deterministically")


def test_workflow_steps_preserve_dependencies():
    profile = classify_task("功夫", {"title": "功夫"}, [])
    steps = get_workflow_steps(profile)

    assert all(isinstance(step, WorkflowStep) for step in steps)
    assert steps[0].id == "clarify_source"
    assert any("clarify_source" in step.depends_on for step in steps[1:])


def test_prompt_context_exposes_precedence_and_target_rules():
    context = build_prompt_rule_context(get_rule_pack("drama_short.v1"), "storyboard")

    assert context["rule_pack_id"] == "drama_short.v1"
    assert context["target"] == "storyboard"
    assert context["precedence"] == [
        "safety/data_integrity",
        "constants.ts",
        "asset_library",
        "storyboard/video",
        "task_rules",
        "safe_user_overrides",
    ]
    assert context["validators"]

