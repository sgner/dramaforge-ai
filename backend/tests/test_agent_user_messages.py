import pytest

from app.agent.user_messages import missing_source_question


@pytest.mark.parametrize(
    ("language", "marker"),
    [("zh", "创作素材"), ("en", "creative material"), ("ja", "創作素材"), ("ko", "창작 소재")],
)
def test_missing_source_question_is_localized(language, marker):
    copy = missing_source_question("custom", language)

    assert marker in copy["question"]
    assert copy["options"]
    assert "structured_source" not in copy["question"]
    assert "agreed_deliverables" not in copy["question"]


def test_missing_source_question_unknown_language_falls_back_to_english():
    copy = missing_source_question("custom", "fr")

    assert "creative material" in copy["question"]


@pytest.mark.parametrize("task_type", ["promotion", "commercial", "custom", "unknown"])
def test_missing_source_question_never_exposes_internal_parameter_names(task_type):
    for language in ("zh", "en", "ja", "ko", "fr"):
        copy = missing_source_question(task_type, language)
        text = " ".join([copy["question"], *copy["options"]])
        assert "structured_source" not in text
        assert "agreed_deliverables" not in text
