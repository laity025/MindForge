"""本机语音识别（faster-whisper）：语音对话的"精准识别"通道。
音频仅发送到本机后端（localhost）处理，不离开设备、不落盘、不存储。
模型 lazy 加载（首次调用下载 base 模型约 145MB，之后缓存；HF 走国内镜像）。
"""
import io
import os
import wave

import numpy as np
from fastapi import APIRouter, HTTPException, UploadFile
from opencc import OpenCC

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")   # 模型国内镜像，避免外网超时
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")                # 关闭 Xet 存储（镜像无法代理），走普通 HTTP

router = APIRouter(prefix="/api/asr", tags=["asr"])

_model = None
_model_name = os.getenv("MF_WHISPER_MODEL", "base")   # base ~145MB / small ~460MB
_t2s = OpenCC("t2s")   # Whisper 中文输出常为繁体 → 统一转简体


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel(_model_name, device="cpu", compute_type="int8", cpu_threads=4)
    return _model


def _wav_to_float32(data: bytes) -> np.ndarray:
    try:
        w = wave.open(io.BytesIO(data))
    except Exception:
        raise HTTPException(status_code=400, detail="仅支持 WAV 音频")
    sr = w.getframerate()
    ch = w.getnchannels()
    n = w.getnframes()
    raw = w.readframes(n)
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="音频为空")
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        audio = audio.reshape(-1, ch).mean(axis=1)
    if sr != 16000 and len(audio) > 1:
        # 线性重采样到 16k（whisper 期望 16k）
        x = np.linspace(0, len(audio), int(len(audio) * 16000 / sr), endpoint=False)
        audio = np.interp(x, np.arange(len(audio)), audio).astype(np.float32)
    return audio


@router.post("/recognize")
async def recognize(file: UploadFile):
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="音频过大（≤10MB）")
    audio = _wav_to_float32(data)
    segments, _ = _get_model().transcribe(audio, language="zh", beam_size=1, vad_filter=True)
    text = _t2s.convert("".join(s.text for s in segments).strip())   # 繁体→简体
    return {"text": text}
