"""LLM 客户端：仅封装 OpenAI 兼容 API（流式 + JSON）。无 Key 时由调用方回退 Mock。"""
import json
import re
from typing import AsyncGenerator, Optional

import httpx

from config import config

_OPENAI_CHAT = "/chat/completions"


async def chat_stream(messages: list, model: Optional[str] = None) -> AsyncGenerator[str, None]:
    """流式返回文本增量（面试官）。"""
    model = model or config.FAST_MODEL
    payload = {"model": model, "messages": messages, "stream": True, "temperature": 0.9}
    async with httpx.AsyncClient(timeout=config.TIMEOUT_MS / 1000 + 5) as client:
        async with client.stream(
            "POST",
            config.LLM_BASE_URL.rstrip("/") + _OPENAI_CHAT,
            headers={"Authorization": f"Bearer {config.LLM_API_KEY}", "Content-Type": "application/json"},
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                raise RuntimeError(f"LLM upstream {resp.status_code}: {body[:200]}")
            async for chunk in resp.aiter_lines():
                if not chunk.startswith("data:"):
                    continue
                data = chunk[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                    delta = obj["choices"][0]["delta"].get("content")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


async def chat_json(messages: list, model: Optional[str] = None) -> dict:
    """非流式，解析 JSON 结果（教练 / 分析师）。"""
    model = model or config.FAST_MODEL
    payload = {"model": model, "messages": messages, "stream": False, "temperature": 0.6}
    async with httpx.AsyncClient(timeout=config.TIMEOUT_MS / 1000 + 10) as client:
        resp = await client.post(
            config.LLM_BASE_URL.rstrip("/") + _OPENAI_CHAT,
            headers={"Authorization": f"Bearer {config.LLM_API_KEY}", "Content-Type": "application/json"},
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"LLM upstream {resp.status_code}: {resp.text[:200]}")
        content = resp.json()["choices"][0]["message"]["content"]
        return _extract_json(content)


async def chat_text(messages: list, model: Optional[str] = None) -> str:
    """非流式，返回原始文本（连接自检用，不要求 JSON）。"""
    model = model or config.FAST_MODEL
    payload = {"model": model, "messages": messages, "stream": False, "temperature": 0}
    async with httpx.AsyncClient(timeout=config.TIMEOUT_MS / 1000 + 10) as client:
        resp = await client.post(
            config.LLM_BASE_URL.rstrip("/") + _OPENAI_CHAT,
            headers={"Authorization": f"Bearer {config.LLM_API_KEY}", "Content-Type": "application/json"},
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"LLM upstream {resp.status_code}: {resp.text[:200]}")
        return resp.json()["choices"][0]["message"]["content"]


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise
