"""面试问题 / 模板题库：对接网络热门面试真题与结构化模板（STAR 等）。

用途：
- 面试官 / 语音陪练 prompt 引用，要求 LLM 优先从题库中选取与面试者
  背景（院校 / 专业 / 项目 / 实习 / 求职意向）最贴合的题目，并做"定制化改写"，
  使提问正式、贴合现实、指向其真实经历，而非泛泛而问。
- mock 生成器（无 LLM Key 的离线演示）也引用，保证无 Key 时发问仍然正规。

题目带 tags：场景适用性
- "campus_recruit"  校招面试
- "postgrad_interview" 考研复试
- "common"          通用（两场景都可用）
"""

BANK = [
    # —— 自我介绍 ——
    {"q": "请用 1 分钟做自我介绍，突出与应聘岗位最相关的 2-3 个亮点。", "tags": ["common"]},
    {"q": "如果用三个关键词形容你自己，你会选哪三个？为什么？", "tags": ["common"]},

    # —— 动机与匹配 ——
    {"q": "你为什么选择我们这个方向 / 岗位？为此做过哪些具体准备？", "tags": ["common"]},
    {"q": "你对我们公司和这个岗位了解多少？凭什么认为自己是合适的人选？", "tags": ["campus_recruit"]},
    {"q": "如果同时拿到多个 offer，你的优先级和判断标准是什么？", "tags": ["campus_recruit"]},
    {"q": "你为什么选择考研 / 这个专业？未来 3 年的研究兴趣是什么？", "tags": ["postgrad_interview"]},
    {"q": "你为什么选择我们学校 / 这位导师？你看过他哪些方向的工作？", "tags": ["postgrad_interview"]},

    # —— 项目经历深挖（STAR）——
    {"q": "请挑一个你最有成就感的项目，用 STAR 讲清楚：情境、你承担的任务、采取的行动、最终结果（最好给出量化指标）。", "tags": ["common"]},
    {"q": "这个项目里你遇到的最大技术 / 协作难题是什么？你是如何定位并解决的？", "tags": ["common"]},
    {"q": "你在项目中具体负责哪个模块？为什么这样设计，而不是其他方案？", "tags": ["common"]},
    {"q": "这个项目的量化成果是什么（性能提升 / 用户量 / 准确率 / 营收）？你是怎么衡量的？", "tags": ["campus_recruit"]},
    {"q": "如果重做这个项目，你会在哪些地方做得不一样？", "tags": ["common"]},
    {"q": "你在本科科研 / 毕设里最核心的贡献是什么？它和已有方法比好在哪里？", "tags": ["postgrad_interview"]},

    # —— 实习经历 ——
    {"q": "你在上一段实习中最大的收获是什么？", "tags": ["campus_recruit"]},
    {"q": "实习中你独立负责过最难的一个任务是什么？最终结果如何？", "tags": ["campus_recruit"]},
    {"q": "实习和校内课程最大的差异是什么？你是如何快速适应的？", "tags": ["campus_recruit"]},
    {"q": "你和导师 / 同事意见不一致时，是怎么沟通并推进的？", "tags": ["common"]},

    # —— 行为与软素质 ——
    {"q": "举一个你牵头或推动一件事完成的例子，你发挥了什么作用？", "tags": ["common"]},
    {"q": "说一次失败的经历，你从中学到了什么、后来怎么改进？", "tags": ["common"]},
    {"q": "当多个任务并行、deadline 很近时，你如何排定优先级？", "tags": ["common"]},
    {"q": "你如何在短时间内自学一个完全陌生的领域 / 技术？", "tags": ["common"]},

    # —— 压力 / 情境 ——
    {"q": "如果面试官说『你的经历很普通，凭什么选你』，你会怎么回应？", "tags": ["campus_recruit"]},
    {"q": "现场给你一个完全没准备过的问题，你会怎么思考并组织回答？", "tags": ["common"]},
    {"q": "你的成绩 / 科研产出并不突出，你是怎么看待这件事的？", "tags": ["postgrad_interview"]},

    # —— 行业认知 ——
    {"q": "你如何看待这个行业未来 3-5 年的趋势？对我们业务有什么影响？", "tags": ["campus_recruit"]},
    {"q": "你最近关注的一项新技术 / 论文是什么？它解决了什么问题？", "tags": ["common"]},

    # —— 反问环节 ——
    {"q": "你有什么想问我的吗？（引导候选人主动提问，考察主动性）", "tags": ["common"]},
]


def _tag_match(item, scene):
    return scene in item["tags"] or "common" in item["tags"]


def bank_questions(scene: str, cap: int = 14) -> list:
    """返回与场景相关的问题列表（场景专属优先，其次通用），限长 cap。"""
    out = []
    for it in BANK:
        if scene in it["tags"]:
            out.append(it["q"])
    for it in BANK:
        if "common" in it["tags"] and it["q"] not in out:
            out.append(it["q"])
    return out[:cap]


def fmt_bank(scene: str, cap: int = 14) -> str:
    """题库的可读文本（编号列表），直接嵌入 prompt。"""
    qs = bank_questions(scene, cap)
    return "\n".join(f"{i + 1}. {q}" for i, q in enumerate(qs))


def bank_opener(scene: str, profile: dict = None) -> str:
    """为 mock / 开场挑选一个贴合背景的首问：有项目或实习线索则优先深挖，否则自我介绍 / 动机。"""
    qs = bank_questions(scene)
    has_exp = bool(profile and (profile.get("resume_text") or profile.get("target") or profile.get("major")))
    if has_exp:
        for q in qs:
            if "项目" in q or "实习" in q or "经历" in q or "科研" in q:
                return q
    for q in qs:
        if "自我介绍" in q or "为什么" in q or "选择" in q:
            return q
    return qs[0] if qs else "请先做个简短的自我介绍。"
