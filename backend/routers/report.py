"""结案报告：分析师强模型事后生成（FR-05 / AC-10 / AC-11 / AC-12）。"""
from fastapi import APIRouter
from pydantic import BaseModel

from services.report_service import generate_report

router = APIRouter(prefix="/api/report", tags=["report"])


class ReportReq(BaseModel):
    session_id: str = ""
    scene: str = "campus_recruit"
    level: str = "standard"
    transcript: list = []
    local_metrics: dict = {}


@router.post("/generate")
async def report_generate(req: ReportReq):
    try:
        report = await generate_report(req.scene, req.level, req.transcript, req.local_metrics)
        return report
    except Exception as exc:
        return {"code": "report_failed", "message": "报告生成失败，请重试", "detail": str(exc)[:200]}
