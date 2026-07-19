"""Localized user-facing copy for Agent clarification steps."""
from __future__ import annotations

from typing import TypedDict


SUPPORTED_LANGUAGES = {"zh", "en", "ja", "ko"}


class AgentQuestionCopy(TypedDict):
    question: str
    options: list[str]


_COPY: dict[str, dict[str, AgentQuestionCopy]] = {
    "en": {
        "promotion": {
            "question": "I still need your campaign goals, audience, and key message. Please add the promotion brief so I can confirm the direction before creating media assets.",
            "options": ["Let Agent write the script"],
        },
        "commercial": {
            "question": "I still need product information and advertising requirements. Please add the product highlights, target audience, and desired style before I create media assets.",
            "options": ["Let Agent write the script"],
        },
        "custom": {
            "question": "I still need creative material and the content you want to create. Please add a story idea, reference material, or specific requirements before I create media assets.",
            "options": ["Let Agent write the script"],
        },
        "default": {
            "question": "I still need a complete story or script that can be broken down. Please provide it before I create media assets.",
            "options": ["Let Agent write the script"],
        },
    },
    "zh": {
        "promotion": {
            "question": "还需要你的宣传目标、受众和核心信息。请补充宣传需求，我会先确认方向，再生成媒体资产。",
            "options": ["由 Agent 编写脚本"],
        },
        "commercial": {
            "question": "还需要产品资料和广告需求。请补充产品卖点、目标受众和期望风格，我会先确认需求，再生成媒体资产。",
            "options": ["由 Agent 编写脚本"],
        },
        "custom": {
            "question": "还需要创作素材，以及你希望生成的内容。请补充故事梗概、参考素材或具体要求，我会先确认需求，再生成媒体资产。",
            "options": ["由 Agent 编写脚本"],
        },
        "default": {
            "question": "还需要一份可以进行拆解的完整故事或剧本。请先提供内容，我再生成媒体资产。",
            "options": ["由 Agent 编写脚本"],
        },
    },
    "ja": {
        "promotion": {
            "question": "宣伝の目的、対象者、主なメッセージがまだ必要です。メディア素材を作成する前に、宣伝の要件を追加してください。",
            "options": ["Agent に脚本を書かせる"],
        },
        "commercial": {
            "question": "商品情報と広告の要件がまだ必要です。商品の特徴、対象者、希望するスタイルを追加してから、メディア素材を作成します。",
            "options": ["Agent に脚本を書かせる"],
        },
        "custom": {
            "question": "創作素材と、作りたい内容がまだ必要です。ストーリーの概要、参考素材、または具体的な要望を追加してから、メディア素材を作成します。",
            "options": ["Agent に脚本を書かせる"],
        },
        "default": {
            "question": "分解できる完全なストーリーまたは脚本がまだ必要です。内容を提供してから、メディア素材を作成します。",
            "options": ["Agent に脚本を書かせる"],
        },
    },
    "ko": {
        "promotion": {
            "question": "홍보 목표, 대상 고객, 핵심 메시지가 아직 필요합니다. 미디어 자산을 만들기 전에 홍보 요구사항을 추가해 주세요.",
            "options": ["Agent가 대본 작성"],
        },
        "commercial": {
            "question": "제품 정보와 광고 요구사항이 아직 필요합니다. 제품의 장점, 대상 고객, 원하는 스타일을 추가해 주시면 미디어 자산을 만들겠습니다.",
            "options": ["Agent가 대본 작성"],
        },
        "custom": {
            "question": "창작 소재와 만들고 싶은 콘텐츠가 아직 필요합니다. 이야기 개요, 참고 자료 또는 구체적인 요구사항을 추가해 주시면 미디어 자산을 만들겠습니다.",
            "options": ["Agent가 대본 작성"],
        },
        "default": {
            "question": "분석할 수 있는 완성된 이야기나 대본이 아직 필요합니다. 내용을 제공해 주시면 미디어 자산을 만들겠습니다.",
            "options": ["Agent가 대본 작성"],
        },
    },
}


def normalize_language(language: str | None) -> str:
    return language if language in SUPPORTED_LANGUAGES else "en"


def missing_source_question(task_type: str, language: str | None) -> AgentQuestionCopy:
    locale = _COPY[normalize_language(language)]
    return locale.get(task_type, locale["default"])
