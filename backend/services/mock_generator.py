"""本地 Mock 生成器：无 LLM Key 时保证完整可演示。

与真实 LLM 接口语义一致：
- interviewer：流式逐字上屏的追问文本
- coach：1-3 条定性建议
- analyst：结构化四维报告 JSON
均可在 config.use_mock 下运行，无需任何外部依赖。
"""
import random

SCENE_QUESTIONS = {
    "postgrad_interview": [
        "请用两分钟做个自我介绍，重点说清楚你为什么选择这个专业。",
        "你本科成绩并不突出，你觉得这会影响复试表现吗？",
        "如果导师问了一个你完全不会的问题，你会怎么应对？",
        "你未来的研究方向是什么？为什么是它而不是别的？",
    ],
    "campus_recruit": [
        "请先做一下自我介绍。",
        "你为什么想加入我们公司？",
        "你最大的缺点是什么？准备怎么改进？",
        "如果同事和你在方案上激烈冲突，你会怎么处理？",
    ],
}

FOLLOWUPS = [
    "能展开说说吗，给我一个具体例子。",
    "你刚才说的，核心结论是什么？",
    "为什么是这个结果，而不是别的？",
    "换个角度，你怎么证明这一点？",
    "说得再具体一点，落到动作上。",
]

LEVEL_OPENER = {
    "hard": ["你这个回答不够有力。", "（沉默两秒，我等你。）", "我再追问一次。", "注意，我只看结论。"],
    "standard": ["好的，继续。", "我追问一下。", "这个角度有意思，再深入。"],
    "gentle": ["好的，我们慢慢来。", "别紧张，继续说就好。", "挺好的，再展开一点。"],
}


def mock_interviewer_line(scene: str, level: str, transcript_text: str, user_turns: int, profile: dict = None) -> str:
    qs = SCENE_QUESTIONS.get(scene, SCENE_QUESTIONS["campus_recruit"])
    if user_turns == 0:
        # 第一句话铁律：始终先请面试者做自我介绍；背景仅作简短确认，不提前抛具体问题
        openers = {
            "hard": "坐。我们直接开始，我会连续追问，别指望轻松。",
            "standard": "你好，我们开始模拟面试。",
            "gentle": "欢迎来练习，放轻松，我们一步步来。",
        }
        opener = openers.get(level, openers["standard"])
        hook = ""
        if profile:
            if profile.get("mode") == "form":
                bits = [profile.get("target"), profile.get("major"), profile.get("school")]
                bits = [b for b in bits if b]
                if bits:
                    hook = "看到你填了" + "、".join(bits[:2]) + "。"
            elif profile.get("mode") == "upload" and profile.get("resume_text"):
                hook = "我看过你的简历了。"
        return opener + " " + hook + "请先做一下自我介绍，挑你最想让我了解的两三点。"

    # 已进行若干轮：先题库再追问
    if user_turns < len(qs):
        base = qs[user_turns]
    else:
        base = random.choice(FOLLOWUPS)
    prefix = ""
    if level == "hard":
        prefix = random.choice(LEVEL_OPENER["hard"]) + " "
    elif level == "standard":
        if random.random() < 0.5:
            prefix = random.choice(LEVEL_OPENER["standard"]) + " "
    else:
        prefix = random.choice(LEVEL_OPENER["gentle"]) + " "
    return prefix + base


def mock_coach_advice(user_reply: str, metrics: dict) -> list:
    tips = []
    fillers = metrics.get("filler_count", 0)
    avg_len = metrics.get("avg_sentence_len", 0)
    if fillers >= 2:
        tips.append("填充词（嗯/然后/就是说）偏多，先亮观点再展开细节。")
    if avg_len and (avg_len < 10 or avg_len > 42) and len(user_reply or "") > 30:
        tips.append("句长偏" + ("碎" if avg_len < 10 else "长") + "，试着一句讲一个点，结构更清晰。")
    if not any(k in (user_reply or "") for k in ["第一", "首先", "一方面", "其次", "最后", "我认"]) and len(user_reply or "") > 30:
        tips.append("建议分点作答（第一/其次），逻辑结构更清楚。")
    from services.metrics_service import detect_nerve
    if detect_nerve(user_reply or ""):
        tips.append("注意到你有些紧张，放慢语速、句间留 2 秒会更稳。")
    if not tips:
        tips.append("表达流畅、结构清晰，保持这个节奏。")
    return tips[:3]


def mock_analyst_report(scene: str, level: str, transcript_text: str, local_metrics: dict) -> dict:
    filler = local_metrics.get("filler_per_k", 0)
    avg_len = local_metrics.get("avg_sentence_len", 0)
    from services.metrics_service import detect_nerve
    nerve = detect_nerve(transcript_text or "")

    language = 5 - max(0, int(filler / 20))
    language = max(1, min(5, language))
    logic = 4 if (12 <= avg_len <= 42) else 3
    emotion = 3 if nerve else 5 if filler < 15 else 4
    emotion = max(1, min(5, emotion))

    improvements = []
    if filler > 15:
        improvements.append("用停顿代替填充词，先说结论再展开。")
    if avg_len > 42:
        improvements.append("控制句长，一句话讲一个点，避免信息过载。")
    elif avg_len and avg_len < 10:
        improvements.append("适当展开，让观点更完整、更有说服力。")
    if nerve:
        improvements.append("入场前做 3 次深呼吸，把紧张当成正常信号。")
    if not improvements:
        improvements.append("整体表达稳健，建议增加专业术语与量化成果。")

    summary = "表达有骨架，" + ("赘词与节奏是最大可提升点。" if filler > 15 else "稳定从容，可进一步精炼。")
    return {
        "scores": {"language": language, "logic": logic, "emotion": emotion},
        "improvements": improvements[:5],
        "summary": summary,
    }


def mock_voice_reply(user_text: str, profile: dict = None) -> str:
    """语音陪练 Mock：简短口语化回应（便于语音播报）。"""
    t = (user_text or "").strip()
    if "模拟" in t or "面试" in t or "追问" in t:
        hook = ""
        if profile and profile.get("mode") == "form" and (profile.get("target") or profile.get("major")):
            hook = "你应聘的是" + (profile.get("target") or profile.get("major")) + "方向，"
        return hook + "好的，我来当面试官。先做个简单的开场：请用一分钟介绍你自己，挑你最想让我了解的三点。"
    if "紧张" in t or "焦虑" in t or "压力" in t:
        return "紧张很正常，说明你在乎这件事。试着把面试当成一场对话练习，先深呼吸，把节奏放慢一点。"
    if "谢谢" in t or "感谢" in t:
        return "不客气，能帮到你就好。还想接着聊，或者让我再考考你？"
    if not t:
        return "我在听。你可以继续说说，或者让我帮你模拟一场面试追问。"
    return f"嗯，我听到了。关于「{t[:20]}」这一点，你觉得最想让我追问哪个细节？"
