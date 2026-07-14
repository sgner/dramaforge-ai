"""Routers package — explicit re-exports avoid `from .routers import x` failures
when the package is empty. Add new router modules here.
"""
from . import (
    projects,
    assets,
    uploads,
    agent,
    llm_providers,
    media_providers,
    media,
    providers,
    drama_tasks,
    user_preferences,
)

__all__ = [
    "projects",
    "assets",
    "uploads",
    "agent",
    "llm_providers",
    "media_providers",
    "media",
    "providers",
    "drama_tasks",
    "user_preferences",
]
