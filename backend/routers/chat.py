"""面试官流式追问（SSE）：快模型流式输出，首字 < 2s（FR-03 / AC-04）。"""
import asyncio
import json
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import config
from services.orchestrator import build_interviewer_messages
from services.transcript_manager import count_user_turns
from services.mock_generator import mock_interviewer_line
from services.llm_client import chat_stream

router = APIRouter(prefix="/api/chat", tags=["chat"])

_VALID_LEVELS = {"gentle", "standard", "hard"}


class ChatReq(BaseModel):
    session_id: str = ""
    scene: str = "campus_recruit"
    level: str = "standard"
    user_reply: str = ""
    transcript: list = []
    # 注意：必须 Optional[dict]——显式 null 在 Pydantic v2 下对 dict 类型会 422
    profile: Optional[dict] = None   # 面试者背景（院校/专业/求职意向/简历要点，可选）


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _gen(req: ChatReq):
    try:
        if req.level not in _VALID_LEVELS:
            req.level = "standard"
        messages, compressed, transcript_text = build_interviewer_messages(
            req.scene, req.level, req.transcript, req.profile or None
        )
        user_turns = count_user_turns(req.transcript)
        full = ""
        if config.use_mock:
            line = mock_interviewer_line(req.scene, req.level, transcript_text, user_turns, req.profile)
            for ch in line:
                full += ch
                yield _sse("message", {"delta": ch})
                await asyncio.sleep(0.008)  # 模拟逐字，首字即时到达
        else:
            async for delta in chat_stream(messages):
                full += delta
                yield _sse("message", {"delta": delta})
        yield _sse("message", {"done": True, "full": full})
        if compressed:
            yield _sse("message", {"notice": "context_compressed", "message": "已为你精简上下文，继续训练"})
    except Exception as exc:  # 不崩溃、不丢上下文（AC-05）
        code = "timeout" if "timeout" in str(exc).lower() or "Timeout" in str(exc) else "gen_failed"
        msg = "网络超时，请检查网络后重试" if code == "timeout" else "生成出错，请重试"
        yield _sse("error", {"code": code, "message": msg})


@router.post("/interviewer")
async def interviewer(req: ChatReq):
    return StreamingResponse(_gen(req), media_type="text/event-stream")
