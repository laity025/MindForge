"""会话管理：开始 / 暂停 / 降级 / 结束（FR-01 / FR-02 / FR-06 / AC-01 / AC-02 / AC-09）。"""
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.safety_service import force_downgrade

router = APIRouter(prefix="/api/session", tags=["session"])

VALID_SCENES = {"postgrad_interview", "campus_recruit"}
VALID_LEVELS = {"gentle", "standard", "hard"}


class StartReq(BaseModel):
    scene: str
    level: str


class EmptyReq(BaseModel):
    pass


class LevelReq(BaseModel):
    level: str


@router.post("/start")
def session_start(req: StartReq):
    if req.scene not in VALID_SCENES:
        raise HTTPException(status_code=400, detail={"error": "scene_required", "message": "请先选择场景/施压档位"})
    if req.level not in VALID_LEVELS:
        raise HTTPException(status_code=400, detail={"error": "level_required", "message": "请先选择施压档位"})
    return {
        "session_id": str(uuid.uuid4()),
        "level_validated": req.level,
        "opening": "",  # 真实开场白由 /api/chat/interviewer 流式返回
    }


@router.post("/pause")
def session_pause(_: EmptyReq = None):
    return {"status": "paused"}


@router.post("/downgrade")
def session_downgrade(_: EmptyReq = None):
    # 安全护栏路径（反噬 / 硬上限自动触发）：服务端强制落到温和档（AC-09）
    return {"status": "downgraded", "level": force_downgrade(), "injected": "slow_down"}


@router.post("/level")
def session_set_level(req: LevelReq):
    """用户主动调整施压档位（温和/标准/高压），允许上调或下调，随时可切换。

    与 /downgrade 的区别：这是用户显式操作，不是护栏触发，因此不限制方向；
    模型仍无法自行改档（prompt 中档位为只读变量）。
    """
    if req.level not in VALID_LEVELS:
        raise HTTPException(status_code=400, detail={"error": "level_invalid", "message": "无效的施压档位"})
    return {"status": "level_changed", "level": req.level}


@router.post("/end")
def session_end(_: EmptyReq = None):
    return {"status": "ended", "report_task_id": str(uuid.uuid4())}
