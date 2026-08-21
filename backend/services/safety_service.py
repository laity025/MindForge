"""安全护栏服务端校验：档位边界 + 反噬信号检测（FR-06 / AC-08 / AC-09）。"""
from services.metrics_service import detect_rebound

# 档位强度序：gentle < standard < hard；模型与请求均不可越过用户原始选择
_LEVEL_ORDER = {"gentle": 0, "standard": 1, "hard": 2}


def clamp_level(original: str, requested: str) -> str:
    """返回不高于 original 的档位（拒绝任何上调）。"""
    orig = _LEVEL_ORDER.get(original, 1)
    req = _LEVEL_ORDER.get(requested, 1)
    if req > orig:
        return original  # 护栏：拒绝上调
    return requested


def force_downgrade() -> str:
    """降级永远落到温和档（FR-06）。"""
    return "gentle"


def detect_rebound_signal(text: str) -> bool:
    """高压反噬：命中外露焦虑 / 退出信号 → 建议降级/暂停（AC-08）。"""
    return detect_rebound(text)
