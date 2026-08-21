"""三套角色提示词模板（面试官 / 教练 / 分析师）。"""
from .interviewer import build_interviewer_prompt, LEVEL_DESC
from .coach import build_coach_prompt
from .analyst import build_analyst_prompt

__all__ = [
    "build_interviewer_prompt",
    "build_coach_prompt",
    "build_analyst_prompt",
    "LEVEL_DESC",
]
