"""教练反馈：正则指标（服务端现算）+ LLM 定性建议（FR-04 / FR-07）。"""
from fastapi import APIRouter
from pydantic import BaseModel

from config import config
from services.metrics_service import compute_metrics
from services.orchestrator import build_coach_messages
from services.mock_generator import mock_coach_advice
from services.llm_client import chat_json

router = APIRouter(prefix="/api/coach", tags=["coach"])


class CoachReq(BaseModel):
    user_reply: str = ""
    transcript: list = []
    metrics: dict = {}


@router.post("/feedback")
async def coach_feedback(req: CoachReq):
    # 服务端正则现算（与前端同源词典），作为权威指标
    m = compute_metrics(req.user_reply)
    metrics_out = {
        "filler_per_k": m["filler_per_k"],
        "avg_sentence_len": m["avg_sentence_len"],
        "pause_est": m["pause_est"],
        "filler_level": m["filler_level"],
        "len_level": m["len_level"],
    }

    if config.use_mock:
        advice = mock_coach_advice(req.user_reply, m)
    else:
        messages = build_coach_messages(req.user_reply, metrics_out)
        try:
            res = await chat_json(messages)
            # 兼容模型返回的键名差异（advice / suggestions / tips）
            advice = res.get("advice") or res.get("suggestions") or res.get("tips") or []
        except Exception:
            advice = mock_coach_advice(req.user_reply, m)

    if not isinstance(advice, list):
        advice = [str(advice)]
    return {"metrics": metrics_out, "advice": advice[:3]}
