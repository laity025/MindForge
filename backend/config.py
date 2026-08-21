"""MindForge 后端配置加载（仅服务端持有 Key）。"""
import os
from pathlib import Path
from dotenv import load_dotenv

# 项目根（backend/ 的上一级）
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / "backend" / ".env")


def _get_list(raw: str):
    return [s.strip() for s in raw.split(",") if s.strip()]


class Config:
    # LLM（OpenAI 兼容）
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://api.deepseek.com/v1")
    FAST_MODEL: str = os.getenv("FAST_MODEL", "deepseek-chat")
    STRONG_MODEL: str = os.getenv("STRONG_MODEL", "deepseek-chat")

    # 超时与上限（非功能门槛）
    TIMEOUT_MS: int = int(os.getenv("TIMEOUT_MS", "2000"))
    MAX_TURNS: int = int(os.getenv("MAX_TURNS", "40"))
    MAX_DURATION_MIN: int = int(os.getenv("MAX_DURATION_MIN", "20"))

    # CORS
    CORS_ORIGINS: list = _get_list(os.getenv("CORS_ORIGINS", "*"))

    # 无 Key 时启用本地 Mock 生成器（保证零依赖可演示）
    @property
    def use_mock(self) -> bool:
        # MF_MOCK=1 强制 Mock（测试/演示用，对 .env 免疫）
        if os.getenv("MF_MOCK", "").lower() in ("1", "true", "yes"):
            return True
        return not bool(self.LLM_API_KEY)

    @property
    def provider(self) -> str:
        """从 Base URL 解析厂商域名（不含 Key，可安全暴露给前端）。"""
        from urllib.parse import urlparse

        try:
            netloc = urlparse(self.LLM_BASE_URL).netloc
            return netloc or self.LLM_BASE_URL
        except Exception:
            return self.LLM_BASE_URL


config = Config()
