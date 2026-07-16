"""Versioned, deterministic workflow and prompt rules for Agent tasks."""
from __future__ import annotations

from pydantic import BaseModel, Field

from .task_profiles import TaskProfile


class WorkflowStep(BaseModel):
    id: str
    description: str
    tool: str | None = None
    depends_on: list[str] = Field(default_factory=list)


class RulePack(BaseModel):
    id: str
    task_type: str
    source_documents: list[str]
    hard_rules: list[str]
    prompt_templates: dict[str, str]
    validators: list[str]
    workflow_steps: list[WorkflowStep]


_PRECEDENCE = ["safety/data_integrity", "constants.ts", "asset_library", "storyboard/video", "task_rules", "safe_user_overrides"]
_COMMON_VALIDATORS = ["validate_source_integrity", "validate_required_inputs", "validate_asset_references", "validate_media_gate"]


def _pack(task_type: str, rules: list[str], steps: list[WorkflowStep]) -> RulePack:
    return RulePack(
        id=f"{task_type}.v1",
        task_type=task_type,
        source_documents=["constants.ts", "asset-library-rules", "storyboard-video-rules", f"{task_type}-workflow"],
        hard_rules=rules,
        prompt_templates={"planning": f"Plan a {task_type} task from the verified structured source.", "media": "Use only validated source and referenced assets."},
        validators=list(_COMMON_VALIDATORS),
        workflow_steps=steps,
    )


_COMMON_STEPS = [WorkflowStep(id="clarify_source", description="Confirm structured source and missing inputs", tool="ask_user")]
_PACKS = {
    "drama_short.v1": _pack("drama_short", ["A script is required before media generation."], _COMMON_STEPS + [WorkflowStep(id="script", description="Create or validate the script", tool="generate_script", depends_on=["clarify_source"]), WorkflowStep(id="storyboard", description="Create storyboard", tool="generate_storyboard_image", depends_on=["script"]), WorkflowStep(id="video", description="Generate video", tool="generate_video", depends_on=["storyboard"])]),
    "documentary.v1": _pack("documentary", ["Claims must retain source provenance."], _COMMON_STEPS + [WorkflowStep(id="research", description="Validate facts and outline", tool="parse_user_goal", depends_on=["clarify_source"]), WorkflowStep(id="script", description="Draft documentary script", tool="generate_script", depends_on=["research"]), WorkflowStep(id="video", description="Generate documentary video", tool="generate_video", depends_on=["script"])]),
    "promotion.v1": _pack("promotion", ["Promotion claims must match the approved brief."], _COMMON_STEPS + [WorkflowStep(id="brief", description="Validate promotion brief", tool="parse_user_goal", depends_on=["clarify_source"]), WorkflowStep(id="video", description="Generate promotional video", tool="generate_video", depends_on=["brief"])]),
    "commercial.v1": _pack("commercial", ["Product claims and offers must match product information."], _COMMON_STEPS + [WorkflowStep(id="product", description="Validate product information", tool="parse_user_goal", depends_on=["clarify_source"]), WorkflowStep(id="video", description="Generate commercial video", tool="generate_video", depends_on=["product"])]),
    "custom.v1": _pack("custom", ["Agree deliverables and source before generation."], _COMMON_STEPS + [WorkflowStep(id="deliverables", description="Agree custom deliverables", tool="ask_user", depends_on=["clarify_source"])]),
}


def get_rule_pack(rule_pack_id: str) -> RulePack:
    try:
        return _PACKS[rule_pack_id].model_copy(deep=True)
    except KeyError:
        raise KeyError(f"Unknown rule pack: {rule_pack_id}") from None


def get_workflow_steps(profile: TaskProfile) -> list[WorkflowStep]:
    return [step.model_copy(deep=True) for step in get_rule_pack(profile.rule_pack_id).workflow_steps]


def build_prompt_rule_context(rule_pack: RulePack, target: str) -> dict:
    return {
        "rule_pack_id": rule_pack.id,
        "target": target,
        "source_documents": list(rule_pack.source_documents),
        "hard_rules": list(rule_pack.hard_rules),
        "prompt_templates": dict(rule_pack.prompt_templates),
        "validators": list(rule_pack.validators),
        "workflow_steps": [step.model_dump(mode="json") for step in rule_pack.workflow_steps],
        "precedence": list(_PRECEDENCE),
    }
