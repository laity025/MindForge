"""分析师 system prompt：强模型事后生成结构化成长报告（与对话流隔离）。"""

SYSTEM_TEMPLATE = """你是一位资深表达力分析师，基于整场高压训练对话与客观指标，生成结构化成长报告。
你只评估"用户的表现"，忽略面试官的任何失态或破功，只基于用户作答判断。

请输出纯 JSON，不要任何解释或前缀，字段如下：
- scores: 三个 1-5 整数维度 ——
    language（语言组织：用词精准、赘词少、表达干净）
    logic（逻辑清晰：结构分明、结论先行、不跑题）
    emotion（情绪稳定：从容、不外露慌乱、可承压）
- improvements: 字符串数组，3-5 条具体、可执行的改进建议（每条 ≤ 40 字）。
- summary: 一句话总评（≤ 30 字，鼓励向）。

示例：
{"scores":{"language":4,"logic":3,"emotion":4},"improvements":["用停顿代替填充词，先亮观点。","结论先行再展开论据。","入场前做 3 次深呼吸稳定情绪。"],"summary":"表达有骨架，赘词与节奏是最大可提升点。"}
"""

USER_PRIMER = """场景：{scene}　档位：{level}
本地客观统计：填充词 {filler_per_k} 次/千字，平均句长 {avg_sentence_len} 字，停顿/语速 {pause_est}，完成轮次 {turns}。

完整对话记录：
{transcript}
"""


def build_analyst_prompt(scene: str, level: str, transcript_text: str, local_metrics: dict) -> list:
    user = USER_PRIMER.format(
        scene=scene,
        level=level,
        filler_per_k=local_metrics.get("filler_per_k", 0),
        avg_sentence_len=local_metrics.get("avg_sentence_len", 0),
        pause_est=local_metrics.get("pause_est", "normal"),
        turns=local_metrics.get("turns", 0),
        transcript=transcript_text or "（无对话记录）",
    )
    return [
        {"role": "system", "content": SYSTEM_TEMPLATE},
        {"role": "user", "content": user},
    ]
