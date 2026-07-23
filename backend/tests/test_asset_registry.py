"""资产复用层测试。"""
import pytest
from app.models import Asset, _ensure_story_entity


class TestStoryEntityId:
    def test_ensure_story_entity_generates_id_from_name(self):
        """资产有 name 但没 story_entity_id 时，用 name 生成确定性 ID。"""
        asset = Asset(
            id="a1", project_id="p1", kind="image",
            asset_kind="character", name="林尘",
        )
        assert asset.story_entity_id is None
        _ensure_story_entity(asset)
        assert asset.story_entity_id is not None
        assert len(asset.story_entity_id) == 16
        assert asset.story_entity_name == "林尘"

    def test_ensure_story_entity_is_deterministic(self):
        """同一 project_id + asset_kind + name 生成同一 entity_id。"""
        a1 = Asset(id="a1", project_id="p1", kind="image", asset_kind="character", name="林尘")
        a2 = Asset(id="a2", project_id="p1", kind="image", asset_kind="character", name="林尘")
        _ensure_story_entity(a1)
        _ensure_story_entity(a2)
        assert a1.story_entity_id == a2.story_entity_id

    def test_ensure_story_entity_differs_by_project(self):
        """不同项目的同名资产生成不同 entity_id。"""
        a1 = Asset(id="a1", project_id="p1", kind="image", asset_kind="character", name="林尘")
        a2 = Asset(id="a2", project_id="p2", kind="image", asset_kind="character", name="林尘")
        _ensure_story_entity(a1)
        _ensure_story_entity(a2)
        assert a1.story_entity_id != a2.story_entity_id

    def test_ensure_story_entity_skips_if_already_set(self):
        """已有 story_entity_id 时不覆盖。"""
        asset = Asset(
            id="a1", project_id="p1", kind="image",
            asset_kind="character", name="林尘",
            story_entity_id="existing_id",
        )
        _ensure_story_entity(asset)
        assert asset.story_entity_id == "existing_id"

    def test_ensure_story_entity_skips_if_no_name(self):
        """没有 name 时不生成 entity_id。"""
        asset = Asset(id="a1", project_id="p1", kind="image", asset_kind="character")
        _ensure_story_entity(asset)
        assert asset.story_entity_id is None
