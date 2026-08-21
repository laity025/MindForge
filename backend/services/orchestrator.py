"""编排层：按角色选 prompt 模板 + 注入档位变量 + 拼装上下文。"""
from services.transcript_manager import format_transcript, compress_if_needed
from prompts import build_interviewer_prompt, build_coach_prompt, build_analyst_prompt


def build_interviewer_messages(scene: str, level: str, transcript: list, profile: dict = None):
    transcript, compressed = compress_if_needed(transcript)
    text = format_transcript(transcript)
    return build_interviewer_prompt(scene, level, text, profile), compressed, text


def build_coach_messages(user_reply: str, metrics: dict):
    return build_coach_prompt(user_reply, metrics)


def build_analyst_messages(scene: str, level: str, transcript: list, local_metrics: dict):
    text = format_transcript(transcript)
    return build_analyst_prompt(scene, level, text, local_metrics)
