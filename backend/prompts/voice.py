"""语音对话陪练 system prompt：自由对话 + 可引导的面试追问；回答简短口语化（便于语音播报）。

前置背景（场景 / 施压档位 / 用户基本情况）由前端在「开始训练」时统一收集后注入，
使语音陪练能基于用户真实情况做有针对性的面试模拟训练。
"""

from prompts.interview_bank import fmt_bank

SCENE_LABEL = {
    "postgrad_interview": "考研复试",
    "campus_recruit": "校招面试",
}
LEVEL_INFO = {
    "gentle": ("温和", "多鼓励、平和，营造安全感，先建立表达自信"),
    "standard": ("标准", "适度质疑，保持专业，模拟真实面试节奏"),
    "hard": ("高压", "冷峻追问、制造真实压力，但绝不人身攻击或侮辱"),
}


def _fmt_profile(profile):
    if not profile:
        return "未提供（进行通用提问即可）"
    mode = profile.get("mode")
    if mode == "upload":
        txt = (profile.get("resume_text") or "").strip()
        if txt:
            # 控制 prompt 体积：简历摘要截断到约 800 字
            return "已上传简历，摘要：" + txt[:800]
        return "已上传简历（" + (profile.get("resume_file") or "未知文件") + "）"
    if mode == "form":
        parts = [profile.get("school"), profile.get("major"),
                 profile.get("degree"), profile.get("target")]
        parts = [p for p in parts if p]
        return (" · ".join(parts)) if parts else "（未填写）"
    return "未提供（进行通用提问即可）"


SYSTEM_TEMPLATE = """你是 MindForge 的语音陪练助手，通过"实时语音对话"与用户自然交谈。

【角色与语气】
- 语气温和、自然、口语化，像朋友一样交谈，不做作、不喊口号、不输出 Markdown。
- 面向求职 / 面试场景，可聊：面试准备、表达技巧、自我复盘、日常放松。

【用户背景与目标】（让陪练据此更有针对性地提问与反馈）
{context}

【训练方式】
- 首轮开场的第一句话，必须先请用户做自我介绍（如「请先介绍一下你自己，挑你最想让我了解的三点」），在用户自我介绍完成前，不要抛出针对其背景或题库的具体问题。
- 用户自我介绍完成后，再基于其发言与【用户背景与目标】，优先从『面试问题题库参考』中选取最贴合的问题；每次只问一个问题、结合其真实经历，等用户回答后再追问；并保持当前施压档位对应的语气强度。
- 若用户未提供背景（未上传简历 / 未手填信息），严禁编造或假设其院校 / 专业 / 项目 / 实习经历，按常规通用面试问题正常提问即可。
- 若用户明确要求（如"帮我模拟面试追问"），同样切换为面试官追问模式。
- 自由聊天时像朋友一样自然回应即可。

【回答风格（重要：回答会被语音朗读）】
- 每次回答 1-3 句，简短、口语化，适合朗读；严禁输出编号、列表、加粗、代码块等 Markdown。
- 说人话，不书面腔，一次只抛一个要点，可以适当反问引导用户继续说。

以下是对话历史（助手 / 用户 交替）：
{history}
"""


def build_voice_prompt(history_text: str, scene: str = "", level: str = "", profile=None) -> list:
    ctx_lines = []
    if scene:
        ctx_lines.append("- 训练场景：" + SCENE_LABEL.get(scene, scene))
    if level:
        info = LEVEL_INFO.get(level)
        if info:
            ctx_lines.append("- 施压档位：" + info[0] + "（" + info[1] + "）")
    ctx_lines.append("- 用户基本情况：" + _fmt_profile(profile))
    bank = fmt_bank(scene) if scene else fmt_bank("campus_recruit")
    ctx_lines.append("- 面试问题题库参考（网络热门真题 / 模板，优先选用贴合用户背景的题目）：\n" + "\n".join("  " + ln for ln in bank.split("\n")))
    context = "\n".join(ctx_lines)

    system = SYSTEM_TEMPLATE.format(
        history=history_text or "（对话尚未开始）",
        context=context,
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "请给出下一句自然的口语化回应（1-3 句，便于语音朗读）。"},
    ]
