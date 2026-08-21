"""MindForge 后端入口：FastAPI + 静态前端托管（一条命令跑通前后端）。"""
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from config import config
from routers import session, chat, coach, report, meta, profile, voice, asr

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
INDEX_HTML = FRONTEND_DIR / "index.html"

app = FastAPI(title="MindForge 心智锻造", version="1.0.0")

# CORS（生产改为自有前端域名）
origins = config.CORS_ORIGINS if config.CORS_ORIGINS != ["*"] else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(session.router)
app.include_router(chat.router)
app.include_router(coach.router)
app.include_router(report.router)
app.include_router(meta.router)
app.include_router(profile.router)
app.include_router(voice.router)
app.include_router(asr.router)


@app.get("/health")
def health():
    return {"status": "ok", "mock": config.use_mock, "model": config.FAST_MODEL}


# 静态托管前端（/styles、/js、/ 直接解析）；API 路由已先注册，优先级更高
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
