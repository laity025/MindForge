"""填充词 / 句长 / 停顿 正则统计（后端版，与前端同源词典）。

单一真相源：regex/filler.json。算法与 thresholds 与前端 metrics_engine.js 保持一致。
零依赖、零推理成本。
"""
import json
import re
from pathlib import Path

_FILLER_PATH = Path(__file__).resolve().parent.parent / "regex" / "filler.json"

with open(_FILLER_PATH, encoding="utf-8") as f:
    _CFG = json.load(f)

_FILLERS = sorted(_CFG["fillers"], key=len, reverse=True)
_THRESH = _CFG["thresholds"]
# 中文无词边界，用最长优先的 alternation 匹配，避免 "就是" 抢 "就是说"
_FILLER_RE = re.compile("(" + "|".join(re.escape(w) for w in _FILLERS) + ")+", re.IGNORECASE)
_NERVE_RE = re.compile("(" + "|".join(re.escape(w) for w in _CFG["nerve_signals"]) + ")")
_REBOUND_RE = re.compile("(" + "|".join(re.escape(w) for w in _CFG["rebound_signals"]) + ")")


def filler_regex():
    return _FILLER_RE


def filler_list():
    return list(_FILLERS)


def detect_nerve(text: str) -> bool:
    return bool(_NERVE_RE.search(text or ""))


def detect_rebound(text: str) -> bool:
    return bool(_REBOUND_RE.search(text or ""))


def compute_metrics(text: str) -> dict:
    """对单条用户作答计算指标。返回可直接渲染的字段。"""
    text = text or ""
    chars = len(re.sub(r"\s", "", text))
    fillers = len(_FILLER_RE.findall(text))
    filler_per_k = round(fillers / chars * 1000) if chars else 0

    sents = [s for s in re.split(r"[。！？!?；;\n]", text) if s.strip()]
    avg_len = round(chars / len(sents)) if sents else 0

    # 停顿/语速估算（无音频时以句长近似：过长=语速拖沓/停顿多，过碎=断续）
    if avg_len > _THRESH["avg_sentence_len"]["max_good"]:
        pause_est = "long"
    elif avg_len and avg_len < _THRESH["avg_sentence_len"]["min_good"]:
        pause_est = "short"
    else:
        pause_est = "normal"

    # 阈值色
    fg, fw = _THRESH["filler_per_k"]["good"], _THRESH["filler_per_k"]["warn"]
    filler_level = "bad" if filler_per_k > fw else ("warn" if filler_per_k > fg else "good")
    lo, hi = _THRESH["avg_sentence_len"]["min_good"], _THRESH["avg_sentence_len"]["max_good"]
    len_level = "good" if (lo <= avg_len <= hi) else "warn"

    return {
        "filler_count": fillers,
        "filler_per_k": filler_per_k,
        "avg_sentence_len": avg_len,
        "pause_est": pause_est,
        "filler_level": filler_level,
        "len_level": len_level,
        "chars": chars,
    }
