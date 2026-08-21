"""结案报告生成：分析师强模型事后批处理，与对话流隔离（FR-05 / AC-10 / AC-11）。"""
from config import config
from services.orchestrator import build_analyst_messages
from services.transcript_manager import format_transcript
from services.mock_generator import mock_analyst_report
from services.llm_client import chat_json


async def generate_report(scene: str, level: str, transcript: list, local_metrics: dict) -> dict:
    local_metrics = local_metrics or {}
    if config.use_mock:
        text = format_transcript(transcript)
        result = mock_analyst_report(scene, level, text, local_metrics)
    else:
        messages = build_analyst_messages(scene, level, transcript, local_metrics)
        # 报告用强模型（隔离于对话快模型）
        try:
            result = await chat_json(messages, model=config.STRONG_MODEL)
        except Exception:
            # 真实模型失败 → 用本地统计兜底生成报告，保证结案报告永不空窗
            text = format_transcript(transcript)
            result = mock_analyst_report(scene, level, text, local_metrics)

    # 统一结构 + 本地统计佐证
    scores = result.get("scores", {"language": 0, "logic": 0, "emotion": 0})
    return {
        "scores": {
            "language": int(scores.get("language", 0)),
            "logic": int(scores.get("logic", 0)),
            "emotion": int(scores.get("emotion", 0)),
        },
        "improvements": result.get("improvements", []),
        "summary": result.get("summary", ""),
        "local_stats": {
            "filler_per_k": local_metrics.get("filler_per_k", 0),
            "avg_sentence_len": local_metrics.get("avg_sentence_len", 0),
            "pause_est": local_metrics.get("pause_est", "normal"),
            "turns": local_metrics.get("turns", 0),
        },
    }
