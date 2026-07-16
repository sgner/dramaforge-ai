"""Resolve the three user-selected model capabilities for Agent and media tools."""
from __future__ import annotations

import json
from typing import Any


CAPABILITY_KINDS = ("llm", "image", "video")


class CapabilityConfigurationError(ValueError):
    """Raised when a saved capability binding cannot be used."""


def _read_bindings(db: Any) -> dict[str, dict[str, str]]:
    from ..models import UserPreference

    row = db.query(UserPreference).filter(UserPreference.key == "model_bindings").first()
    if not row or not row.value_json:
        return {}
    try:
        raw = json.loads(row.value_json)
    except (TypeError, ValueError) as exc:
        raise CapabilityConfigurationError("model_bindings is not valid JSON") from exc
    if not isinstance(raw, list):
        raise CapabilityConfigurationError("model_bindings must be a list")
    result: dict[str, dict[str, str]] = {}
    for item in raw:
        if not isinstance(item, dict) or item.get("kind") not in CAPABILITY_KINDS:
            continue
        provider_id = str(item.get("providerId") or item.get("provider_id") or "").strip()
        model_id = str(item.get("modelId") or item.get("model_id") or "").strip()
        if provider_id and model_id:
            result[item["kind"]] = {"provider_id": provider_id, "model_id": model_id}
    return result


def resolve_capability_bindings(db: Any, *, require_llm: bool = True) -> dict[str, dict[str, str]]:
    """Return validated capability bindings using the provider table as source of truth."""
    from ..models import ProviderConfig

    bindings = _read_bindings(db)
    if require_llm and "llm" not in bindings:
        raise CapabilityConfigurationError("llm capability binding is required")

    providers = {
        row.provider_id: row.to_internal_dict()
        for row in db.query(ProviderConfig).filter(ProviderConfig.enabled.is_(True)).all()
    }
    validated: dict[str, dict[str, str]] = {}
    model_fields = {"llm": "chat_models", "image": "image_models", "video": "video_models"}
    for kind, binding in bindings.items():
        provider = providers.get(binding["provider_id"])
        if not provider:
            raise CapabilityConfigurationError(
                f"{kind} capability provider '{binding['provider_id']}' is not enabled"
            )
        if binding["model_id"] not in provider.get(model_fields[kind], []):
            raise CapabilityConfigurationError(
                f"{kind} capability model '{binding['model_id']}' is not declared by provider '{binding['provider_id']}'"
            )
        validated[kind] = binding
    return validated
