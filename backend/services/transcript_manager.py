"""共享上下文（黑板）管理：历史拼装 + 超长会话压缩（AC-07）。"""
from config import config

_ROLE_LABEL = {"user": "用户", "interviewer": "面试官", "coach": "教练", "system": "系统"}


def format_transcript(messages: list) -> str:
    """把黑板拼装成可读文本，供 prompt 使用（仅含 面试官/用户 主线，教练不进主对话）。"""
    lines = []
    for m in messages or []:
        role = m.get("role")
        content = (m.get("content") or "").strip()
        if not content:
            continue
        if role == "coach":
            continue
        label = _ROLE_LABEL.get(role, role)
        lines.append(f"{label}：{content}")
    return "\n".join(lines)


def count_user_turns(messages: list) -> int:
    return sum(1 for m in messages or [] if m.get("role") == "user")


def compress_if_needed(messages: list):
    """超过 MAX_TURNS 轮则压缩前半段，保留最近轮次，返回 (新列表, 是否压缩)。"""
    max_turns = config.MAX_TURNS
    user_turns = count_user_turns(messages)
    if user_turns <= max_turns:
        return messages, False

    # 保留最后 max_turns 个用户轮对应的窗口
    keep = []
    user_seen = 0
    for m in reversed(messages or []):
        keep.append(m)
        if m.get("role") == "user":
            user_seen += 1
            if user_seen >= max_turns:
                break
    kept = list(reversed(keep))
    dropped = user_turns - max_turns
    compressed_head = {
        "role": "system",
        "content": f"[前面 {dropped} 轮对话已精简为要点，仅保留最近 {max_turns} 轮用于本次追问]",
    }
    return [compressed_head] + kept, True
