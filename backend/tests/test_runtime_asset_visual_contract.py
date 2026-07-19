"""Regression tests for the runtime visual contracts used by media tools."""

from app.agent.tools.image_tools import (
    CHARACTER_DESIGN_SHEET_PROMPT,
    STORYBOARD_SIX_GRID_PROMPT,
    _build_character_prompt,
    _build_scene_prompt,
    _build_storyboard_prompt,
)


def test_character_prompt_is_the_left_right_reference_sheet():
    prompt = CHARACTER_DESIGN_SHEET_PROMPT.lower()
    assert "left-right split layout" in prompt
    assert "left one-third" in prompt
    assert "right two-thirds" in prompt
    assert "chest-up close-up front view portrait" in prompt
    assert "full-body front standing pose" in prompt
    assert "full-body side profile view" in prompt
    assert "full-body back view" in prompt
    assert "no visible numbers" in prompt


def test_character_source_does_not_request_scene_or_prop_content():
    prompt = _build_character_prompt({"name": "Hero"}).lower()
    assert "character identity and costume reference data only" in prompt
    assert "scene background" in prompt


def test_scene_prompt_is_reusable_environment_only_anchor():
    prompt = _build_scene_prompt({
        "name": "Corridor",
        "ambientCharacters": "two people walking",
    }).lower()
    assert "environment-only scene reference image" in prompt
    assert "no people" in prompt
    assert "ambient characters" not in prompt


def test_storyboard_prompt_is_exactly_six_panel_grid():
    prompt = _build_storyboard_prompt({
        "index": 1,
        "scene": "Corridor",
        "action": "Hero turns toward the light",
    })
    assert STORYBOARD_SIX_GRID_PROMPT in prompt
    assert "2 rows by 3 columns" in prompt
    assert "Panel 1 is a pure black buffer frame" in prompt
    assert "Panels 2 through 6" in prompt
    assert "single full-frame composition" in prompt
