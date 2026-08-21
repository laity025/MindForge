"""元信息：暴露填充词词典与阈值、模型接入状态（前后端单一真相源）。"""
import asyncio
import json
from pathlib import Path

from fastapi import APIRouter

from config import config
from services.llm_client import chat_text

router = APIRouter(prefix="/api/config", tags=["config"])

_FILLER_PATH = Path(__file__).resolve().parent.parent / "regex" / "filler.json"


@router.get("/filler")
def get_filler():
    with open(_FILLER_PATH, encoding="utf-8") as f:
        return json.load(f)


@router.get("/model")
def get_model():
    """暴露是否已接入真实模型（绝不返回 Key）。"""
    return {
        "mock": config.use_mock,
        "configured": not config.use_mock,
        "provider": config.provider,
        "fast_model": config.FAST_MODEL,
        "strong_model": config.STRONG_MODEL,
    }


@router.post("/model/probe")
async def probe_model():
    """自检真实模型连通性：仅当已配置 Key 时发起一次极简调用。"""
    if config.use_mock:
        return {"configured": False, "ok": False, "message": "未配置 LLM_API_KEY，当前为 Mock 演示模式"}
    try:
        reply = await asyncio.wait_for(
            chat_text(
                [
                    {"role": "system", "content": "你是连接测试助手，只做简短回复。"},
                    {"role": "user", "content": "请只回复两个字：OK"},
                ],
                model=config.FAST_MODEL,
            ),
            timeout=max(config.TIMEOUT_MS / 1000 + 12, 15),  # 跟随 .env 的 TIMEOUT_MS，冷启动/高峰期留足余量
        )
        return {"configured": True, "ok": True, "message": "真实模型连接成功", "reply": str(reply)[:60]}
    except Exception as exc:  # 明确暴露错误，便于排查 Key / BaseURL / 网络
        return {"configured": True, "ok": False, "message": f"连接失败：{str(exc)[:200]}"}
