"""语音对话陪练（SSE 流式）：自由对话 + 可引导的面试追问。"""
import asyncio
import json
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import config
from services.llm_client import chat_stream
from services.mock_generator import mock_voice_reply
from prompts.voice import build_voice_prompt

router = APIRouter(prefix="/api/voice", tags=["voice"])


class VoiceReq(BaseModel):
    transcript: list = []   # [{role: user|assistant, content}]，不含待回复的最后一轮
    scene: str = ""         # 训练场景（如 campus_recruit / postgrad_interview），用于背景上下文
    level: str = ""         # 施压档位（gentle/standard/hard）
    # 注意：必须 Optional[dict] 而不是 dict——用户未填背景时前端会发 profile: null，
    # Pydantic v2 下 dict 类型不接受显式 null，会 422 导致语音对话全部失败
    profile: Optional[dict] = None   # 用户背景（简历文本 / 手填院校专业等），仅内存用于 prompt 上下文


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _format_history(items: list) -> str:
    lines = []
    for m in items[-40:]:   # 防 prompt 膨胀
        role = "用户" if m.get("role") == "user" else "助手"
        lines.append(f"{role}：{(m.get('content') or '').strip()[:500]}")
    return "\n".join(lines)


async def _gen(req: VoiceReq):
    try:
        messages = build_voice_prompt(
            _format_history(req.transcript or []),
            req.scene,
            req.level,
            req.profile,
        )
        if config.use_mock:
            last = next((m for m in reversed(req.transcript or []) if m.get("role") == "user"), None)
            reply = mock_voice_reply(last.get("content", "") if last else "", req.profile)
            for ch in reply:
                yield _sse("delta", {"delta": ch})
                await asyncio.sleep(0.008)   # 模拟流式逐字上屏
            yield _sse("done", {"full": reply, "done": True})
            return
        full = ""
        async for chunk in chat_stream(messages):
            if not chunk:
                continue
            full += chunk
            yield _sse("delta", {"delta": chunk})
        yield _sse("done", {"full": full, "done": True})
    except Exception as e:
        yield _sse("error", {"error": "gen_failed", "message": f"生成出错：{str(e)[:80]}"})


@router.post("/chat")
async def voice_chat(req: VoiceReq):
    return StreamingResponse(_gen(req), media_type="text/event-stream")
