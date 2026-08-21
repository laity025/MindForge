# MindForge（心智锻造）开发规划文档

> 版本：v2.0（MVP 对齐 · 视觉对齐 UI/UX v2.0 浅色）
> 依据文档：`MindForge_PRD.md`（v1.0）、`MindForge_UIUX设计文档.md`（v2.0 浅色）
> 目标读者：个人开发者（人少、预算低、时间紧）
> 本期范围：纯文本交互 · 单页 Web + FastAPI + 单模型多角色 + 前后端正则统计
> 视觉基线：浅中性暖调主色 `#F7F5F2` + 非黑墨色 `#2B2B2B`/`#33312E` + 唯一强调色深青绿 `#1F4E4A`（**严禁纯黑作主色/大面积底色**）

---

## 1. 开发总纲

### 1.1 一句话目标
数周内交付一个**可演示的 MVP**：用户选场景→选档位→与「面试官」高压对话→每轮获「教练」表达力反馈→随时「暂停/降级/结束」→结束生成「分析师」成长报告。

### 1.2 技术铁三角（不可动摇）
| 维度 | 约束 | 本期落地 |
|---|---|---|
| 学习成本低 | 单语言、少概念 | 前端原生 HTML+JS（或极轻框架）；后端 Python FastAPI；同一人维护 |
| 开发效率高 | 数周出 MVP | 单模型多角色提示词（不引入 CrewAI/LangGraph）；指标用正则现算 |
| 成本可控 | 免费/极低价 | 大模型走 OpenAI 兼容 API（DeepSeek/国产），API Key 仅存服务端；无外部付费依赖 |

### 1.3 架构基线（来自 PRD §8 + UI/UX §8）
```
浏览器 → 单页 Web 前端（聊天界面 + 填充词正则统计 + 安全护栏状态机）
       → FastAPI 后端（单模型多角色提示词编排 + 档位校验 + 上下文压缩）
       → 大模型 API（同一基座，面试官/教练/分析师三角色 = 三套 system prompt）
```
- **共享上下文（黑板）**：前端维护 `transcript`，每次调用上送；后端拼装+校验，不长期持有状态。
- **模型分工**：对话用快模型流式（面试官/教练）；报告用强模型事后（分析师），二者隔离（AC-11）。
- **本地优先**：对话/指标存 localStorage，报告本地导出，不存原始音频（AC-12）。

### 1.4 开发四原则
1. **先跑通闭环，再打磨体验**：M1 必须出现「用户说话→面试官追问→ coach 建议」的最小闭环。
2. **指标零推理优先**：填充词/句长/停顿一律正则现算，LLM 只补定性，省 token。
3. **护栏前端状态机 + 后端校验**：模型永不越权加压（FR-02/AC-09）。
4. **浅色优先、非黑墨色**：严格遵循 UI/UX v2.0 设计 token（浅暖白主底 `#F7F5F2` + 深青绿唯一强调色 `#1F4E4A`，禁用纯黑主色），不引入额外装饰色。

---

## 2. 里程碑与任务分解

> 节奏假设：单人全职约 4 周；若兼职按比例放宽。每任务标注 `[P]` 优先级（P0 必做 / P1 重要 / P2 打磨）。

### M0 脚手架与规范（约 3 天）
- [P0] 初始化仓库：前端目录（原生 HTML/JS 或 Vite 轻框架）、后端（FastAPI+Uvicorn）、`.env` 存 Key。
- [P0] 落地 UI/UX v2.0 设计 token（CSS 变量：浅暖白主底 `#F7F5F2` + 深青绿强调 `#1F4E4A` + 非黑墨色 `#2B2B2B`/`#33312E` + 语义档位色 + 指标阈值色），**浅色为唯一主题（不提供暗色默认，规避纯黑）**。
- [P0] 后端骨架：FastAPI app、`/health`、CORS 配置、LLM Client 封装（OpenAI 兼容）。
- [P0] 建立 `prompts/` 三套模板占位（interviewer/coach/analyst）与 `regex/` 填充词词典。
- [P1] 约定 API 契约（见第 4 章）并 mock 返回，前后端可并行起步。

### M1 核心对话闭环（约 1 周）
- [P0] 场景选择卡（考研复试/校招面试）——FR-01、AC-01。
- [P0] 三档施压分段控件（温和/标准/高压）——FR-02、AC-02。
- [P0] 面试官开场 + 动态追问（SSE 流式，首字 <2s）——FR-03、AC-04。
- [P0] 用户文本作答 + 空提交拦截——FR-03、AC-03。
- [P0] `transcript` 黑板维护与后端拼装。
- [P0] 单轮单角色发言机制（生成中禁用发送/排队）——非功能「角色一致性」。

### M2 教练与实时指标（约 1 周）
- [P0] 前端/后端正则统计：填充词频次、平均句长、停顿/语速估算——FR-07、UI/UX 教练侧栏。
- [P0] 教练侧栏呈现指标（绿/黄/红阈值色，红仅提示）——FR-07、UI/UX §4.3。
- [P0] 每轮 1–3 条教练建议（填充词/逻辑/情绪线索），LLM 仅补定性——FR-04。
- [P1] 指标与建议的并发生成（正则同步现算 + LLM 异步补建议），互不阻塞。

### M3 安全护栏（约 3–4 天）
- [P0] 暂停（停追问 + 呼吸引导浮层 + 可恢复）——FR-06、UI/UX §4.5/§6.4。
- [P0] 降级（二次确认 + 切温和 + 注入放缓指令）——FR-06、AC-09。
- [P0] 结束（二次确认 + 触发分析师）——FR-06、AC-09/AC-10。
- [P0] 施压反噬检测（外露焦虑/退出信号→支持性弹窗建议降级/暂停）——FR-06、AC-08。
- [P0] 硬上限（单次最长时长/最大轮次→到点自动降级提示休息）——FR-06。
- [P0] 后端档位校验（模型不可自主上调）——FR-02、AC-09。

### M4 结案报告（约 3–4 天）
- [P0] 分析师强模型事后生成（四维：语言组织/逻辑清晰/情绪稳定/改进建议，<10s）——FR-05、AC-10。
- [P0] 本地填充词统计佐证并列展示——FR-05、UI/UX §4.6。
- [P0] 报告覆盖层 + 导出（本地生成，不上传）——FR-05、AC-12。
- [P1] 报告生成与对话流隔离（不阻塞）——AC-11。

### M5 打磨、异常与验收（约 3–4 天）
- [P0] 异常处理全覆盖：未选场景/档位、空提交、AI 异常中断、网络超时、超长会话压缩（>40 轮）——AC-05/06/07。
- [P0] 帮助中心（定位/流程/施压机制/护栏/隐私）——FR-08。
- [P0] 响应式三断点（桌面双栏/平板抽屉/移动单栏）——UI/UX §7.1。
- [P1] 无障碍（焦点环/reduced-motion/对比度 AA/语义色双通道）——UI/UX §7.2。
- [P1] 首屏 <2s、性能回归（首字<2s、报告<10s）——非功能「性能」。
- [P0] 隐私 by design 可见化（本地处理/可删除标识 + 数据管理入口）——FR-08、AC-12。

---

## 3. 组件 / 模块依赖树

### 3.1 前端模块树
```
AppShell（导航细条 + 数据管理）— 仅浅色主题，无主题切换
├── HeroView（首屏：Big Type 大标题 + 双 CTA + 真实训练对话浮层 + 轻微视差）
├── TrainingView（训练主界面，占满视口）
│   ├── SceneSelector（场景卡：考研复试/校招面试）   ← FR-01
│   ├── LevelSelector（三档分段控件）               ← FR-02
│   ├── ChatThread（主对话区）
│   │   ├── BubbleInterviewer（左·流式上屏）        ← FR-03
│   │   ├── BubbleUser（右·实心）                   ← FR-03
│   │   └── InputBar（文本输入 + 发送 + 空提交拦截） ← AC-03
│   ├── CoachSidebar（教练侧栏）                    ← FR-04/07
│   │   ├── MetricsPanel（填充词/句长/停顿·阈值色）  ← FR-07
│   │   ├── AdviceList（1–3 条建议）                ← FR-04
│   │   └── PrivacyBadge（本地处理标识）            ← FR-08
│   └── GuardrailBar（暂停/降级/结束常驻控件）      ← FR-06
│       ├── PauseOverlay（呼吸引导浮层）            ← FR-06
│       ├── DowngradeConfirm（二次确认）            ← FR-06
│       └── EndConfirm → 触发 ReportView           ← FR-06
├── ReportView（结案报告覆盖层）                    ← FR-05
│   ├── ScoreGrid（四维评分·单色+阈值色）           ← FR-05
│   ├── LocalStats（填充词佐证）                    ← FR-05
│   └── ExportButton（本地导出）                    ← FR-05
├── HelpCenter（抽屉/弹层）                         ← FR-08
└── 横切模块
    ├── ApiClient（fetch + SSE 解析 + 超时/重试）    ← AC-05/06
    ├── MetricsEngine（正则词典·前端现算）          ← FR-07
    ├── TranscriptStore（transcript 黑板 + 本地压缩）← AC-07
    ├── GuardrailStateMachine（暂停/降级/结束/反噬） ← FR-06
    └── Storage（localStorage 封装·可删除）         ← AC-12
```

### 3.2 后端模块树
```
FastAPI App
├── Routers
│   ├── session_router
│   │   ├── POST /api/session/start（场景+档位校验）     ← FR-01/02, AC-01/02
│   │   ├── POST /api/session/pause                    ← FR-06
│   │   ├── POST /api/session/downgrade（校验不可上调） ← FR-06, AC-09
│   │   └── POST /api/session/end → 触发 analyst        ← FR-06, AC-10
│   ├── chat_router
│   │   └── POST /api/chat/interviewer（SSE 流式）       ← FR-03, AC-04
│   ├── coach_router
│   │   └── POST /api/coach/feedback（定性建议）         ← FR-04
│   └── report_router
│       └── POST /api/report/generate（强模型·隔离）     ← FR-05, AC-11
├── Services
│   ├── LLMClient（OpenAI 兼容封装·快/强模型切换·超时）  ← 非功能
│   ├── Orchestrator（按 role 选 prompt 模板 + 注入档位变量）← FR-02/03
│   ├── TranscriptManager（历史拼装 + >40轮压缩）        ← AC-07
│   ├── SafetyService（档位边界校验 + 反噬信号检测）     ← FR-06, AC-08/09
│   ├── MetricsService（后端正则统计·与前端同源词典）    ← FR-07
│   └── ReportService（分析师批处理·JSON 结构化）        ← FR-05
├── Prompts（interviewer/coach/analyst 三模板 + 档位变量）
├── Regex（填充词词典·前后端共享一份定义）
└── Config（.env：API Key、模型名、超时、上限阈值）
```

### 3.3 关键依赖与接口边界
- **前端 MetricsEngine ↔ 后端 MetricsService**：共用同一份填充词正则定义（单一真相源，避免前后端口径不一致）。
- **前端 TranscriptStore ↔ 后端 TranscriptManager**：前端持全量 transcript 上送；后端负责 >40 轮压缩后回传精简版（AC-07）。
- **前端 GuardrailStateMachine ↔ 后端 SafetyService**：前端管 UI 状态（暂停/降级/结束）；后端管档位边界（任何降级/结束请求服务端强制校验，模型不可自提档，AC-09）。
- **Orchestrator ↔ Prompts**：档位（温和/标准/高压）作为变量注入面试官 prompt 模板，教练/分析师不感知档位。

---

## 4. API 契约

> 约定：JSON 请求/响应；流式接口用 SSE（`text/event-stream`）；所有写操作经服务端，Key 不落前端。

### 4.1 会话管理
**POST `/api/session/start`**
```jsonc
// Request
{ "scene": "postgrad_interview" | "campus_recruit", "level": "gentle"|"standard"|"hard" }
// Response 200
{ "session_id": "uuid", "level_validated": "gentle", "opening": "面试官开场白（流式端点另行拉取）" }
// 400 未选场景/档位 → { "error": "scene_required" | "level_required", "message": "请先选择场景/施压档位" }
```
**POST `/api/session/pause`** → `{ "status": "paused" }`
**POST `/api/session/downgrade`** → 服务端强制 `level` 设为 `gentle`，返回 `{ "status":"downgraded", "level":"gentle", "injected":"slow_down" }`（**拒绝任何上调请求**）
**POST `/api/session/end`** → `{ "status":"ended", "report_task_id":"uuid" }`

### 4.2 面试官流式（SSE）
**POST `/api/chat/interviewer`**
```jsonc
// Request
{ "session_id":"uuid", "transcript":[ {role,content}... ], "level":"standard", "user_reply":"用户本轮作答" }
// SSE 事件流
data: {"delta":"请"}      // 逐字，首字 <2s
data: {"delta":"谈谈"}
...
data: {"done":true, "full": "请谈谈你最大的挑战。"}
// 错误
event: error
data: {"code":"gen_failed"|"timeout", "message":"生成出错，请重试" | "网络超时，请检查网络后重试"}
```

### 4.3 教练反馈
**POST `/api/coach/feedback`**（可与面试官并行）
```jsonc
// Request
{ "user_reply":"用户本轮作答", "transcript":[...] }
// Response
{
  "metrics": { "filler_per_k": 8, "avg_sentence_len": 18, "pause_est":"normal" },
  "advice": [ "「然后/嗯」偏多，先亮观点", "结论先行再展开", "语气稳，可加 2s 停顿" ]  // 1–3 条
}
```
> 指标（`metrics`）后端/前端正则现算；`advice` 由 LLM 补定性（FR-04）。前端侧栏可仅用本地正则即时渲染，LLM 建议到达后追加。

### 4.4 结案报告
**POST `/api/report/generate`**（强模型，与对话隔离）
```jsonc
// Request
{ "session_id":"uuid", "transcript":[...], "local_metrics": { "filler_per_k":8, "avg_sentence_len":18 } }
// Response 200 (<10s)
{
  "scores": { "language":4, "logic":3, "emotion":4 },   // 各 1–5
  "improvements": [ "..." ],
  "local_stats": { "filler_per_k":8, "avg_sentence_len":18, "pause_est":"normal" }
}
// 错误 → { "code":"report_failed", "message":"报告生成失败，请重试" }
```

### 4.5 统一错误码
| code | 含义 | 前端反馈（非恐吓） |
|---|---|---|
| `scene_required` | 未选场景 | 内联提示阻止进入 |
| `level_required` | 未选档位 | 内联提示 |
| `empty_input` | 空提交 | 输入框微震 + 提示 |
| `gen_failed` | AI 异常/中断 | 横幅 + 重试，不丢上下文 |
| `timeout` | 网络超时 | 保留输入 + 提示 |
| `context_compressed` | 超长压缩 | 无感提示 |
| `level_forbidden` | 模型尝试上调档位 | 服务端拒绝（护栏） |

---

## 5. 开发规范

### 5.1 代码与目录
- 前端：`/frontend`（`index.html` + `/js` 模块 + `/styles` token.css）；原生优先，若用框架限 Vite+轻量。
- 后端：`/backend`（`main.py` + `/routers` + `/services` + `/prompts` + `/regex` + `config.py`）。
- 单一真相源：填充词正则词典前后端各引用同一份定义（后端 `regex/filler.json`，前端同步副本）。

### 5.2 提交与配置
- `.env`（git-ignored）仅存：`LLM_API_KEY`、`LLM_BASE_URL`、`FAST_MODEL`、`STRONG_MODEL`、`TIMEOUT_MS`、`MAX_TURNS`、`MAX_DURATION_MIN`。
- 提交信息 `type(scope): 简述`（feat/fix/docs/style/refactor）。
- 不提交 Key、不提交 `node_modules`/`__pycache__`。

### 5.3 提示词与指标规范
- 三套 prompt 模板独立文件，档位以变量 `{level}` 注入面试官模板；严禁在 prompt 中允许模型自改档位。
- 填充词词典含：嗯/啊/呃/然后/就是说/那个/其实呢/可能吧 等，维护 `per_k`（每千字频次）阈值：<15 绿 / 15–30 黄 / >30 红（红仅提示不渲染恐慌）。
- 平均句长阈值：10–42 字 绿 / <10 红（过碎）/ >42 黄（过长）。

### 5.4 性能与质量门槛
- 流式首字 <2s、报告 <10s、首屏 <2s（非功能）。
- 所有异常路径必须有 UI 反馈且**不崩溃、不丢上下文**（AC-05/06）。
- 单轮单角色：面试官生成期间禁用用户发送（防角色污染）。

### 5.5 安全与隐私
- API Key 仅服务端；CORS 限自有前端域名。
- 不存原始音频；对话/指标 localStorage；提供删除入口（AC-12）。
- 高压档文案边界：冷峻追问但**绝不人身攻击/侮辱**（FR-02）。

---

## 6. 风险矩阵

| 风险 | 可能性 | 影响 | 等级 | 缓解措施 |
|---|---|---|---|---|
| 大模型首字 >2s（网络/排队） | 中 | 中 | 🟡 | 服务端设超时+重试；前端显示生成中态；预连接保活 |
| 模型尝试突破档位上限（加压） | 中 | 高 | 🔴 | 后端 `SafetyService` 强制校验，档位变量只读注入，拒绝上调（AC-09） |
| 高压反噬致用户焦虑 | 中 | 高 | 🔴 | 反噬信号检测→支持性弹窗一键降级/暂停；教练侧栏恒定建设性语气对冲 |
| 超长会话上下文溢出/角色漂移 | 中 | 中 | 🟡 | >40 轮 `TranscriptManager` 自动压缩（AC-07） |
| 流式中断丢上下文 | 低 | 中 | 🟡 | 前端 `ApiClient` 保留已输入+已收 delta；错误横幅可重试（AC-05） |
| 单模型多角色「人格串味」 | 中 | 中 | 🟡 | 单轮单角色发言机制；prompt 明确角色边界；必要时升 LangGraph（PRD 路线图） |
| 成本失控（误用强模型走对话） | 低 | 中 | 🟡 | 对话=快模型、报告=强模型，配置隔离；监控 token 用量 |
| 浏览器兼容性（SSE/正则） | 低 | 中 | 🟢 | Chrome/Edge 优先；降级提示；正则用标准 ES2018 |
| 隐私合规争议 | 低 | 高 | 🟢 | 定位「训练工具非招聘决策」；不存音频；可删除；帮助中心明示（护城河） |
| 个人开发者时间/精力中断 | 中 | 高 | 🟡 | M1 闭环优先；每周可演示；砍 P2 保 P0 |

> 等级：🔴 必须前置缓解 / 🟡 监控+预案 / 🟢 低优先。

---

## 7. 验收标准

> 直接映射 PRD §7 的 AC-01~AC-12，并补充 UI/UX 落地项。

### 7.1 功能验收（AC 映射）
| 编号 | 验收点 | 来源 |
|---|---|---|
| AC-01 | 未选场景点「开始模拟」→ 提示阻止 | PRD |
| AC-02 | 已选场景未选档位 → 提示 | PRD |
| AC-03 | 空提交 → 提示不调模型 | PRD |
| AC-04 | 面试官首字 <2s | PRD |
| AC-05 | AI 异常/中断 → 重试不崩溃不丢上下文 | PRD |
| AC-06 | 网络超时 → 保留输入提示 | PRD |
| AC-07 | >40 轮 → 后端压缩保一致性 | PRD |
| AC-08 | 高压反噬信号 → 弹窗建议降级/暂停 | PRD |
| AC-09 | 暂停/降级/结束对应正确，模型不可越权加压 | PRD |
| AC-10 | 结束 → 10s 内四维+本地统计报告可导出 | PRD |
| AC-11 | 报告生成不阻塞对话流 | PRD |
| AC-12 | 不存音频；对话/指标本地可删除 | PRD |

### 7.2 UI/UX 验收（设计文档落地）
- 浅色为唯一主题（无暗色默认，规避纯黑），浅暖白主底 + 深青绿唯一强调 + 非黑墨色 token 生效，无额外装饰色（UI/UX §2）。
- Hero Big Type 大标题 + 双栏（文案 + 真实对话浮层 + 轻微视差）、训练区双栏（主对话 + 教练侧栏）（UI/UX §4）。
- 档位分段控件三档语义色、选中/未选态清晰（UI/UX §4.4/§5.5）。
- 护栏三态动效（暂停遮蔽/降级回退/结束收束）与反噬弹窗（UI/UX §4.5/§6.4）。
- 教练侧栏指标阈值色（红仅提示不恐慌）+ 隐私标识常驻（UI/UX §4.3/§5.8）。
- 响应式三断点（桌面双栏/平板抽屉/移动单栏）+ 无障碍（焦点环/reduced-motion/AA）（UI/UX §7）。
- 异常反馈友好非恐吓，全部 6 类场景有 UI 出口（UI/UX §6.5）。

### 7.3 性能验收
- 首屏 <2s、流式首字 <2s、结案报告 <10s（PRD 非功能）。

---

## 8. 开发节奏建议

### 8.1 单人 4 周排期（全职参考）
| 周次 | 聚焦 | 交付物 | 演示标准 |
|---|---|---|---|
| W0（3天） | 脚手架+M0 | 前后端运行、token 落地、API mock | 首页浅色壳 + 接口联调通 |
| W1 | M1 闭环 | 场景/档位/面试官流式/作答 | **能对话**（最小闭环） |
| W2 | M2 教练 | 正则指标+侧栏+1–3 建议 | 每轮有反馈 |
| W3 | M3 护栏 + M4 报告 | 暂停/降级/结束+反噬+分析师报告 | 全护栏+报告可导出 |
| W4 | M5 打磨 | 异常/帮助/响应式/无障碍/性能 | 可演示 MVP + 验收通过 |

### 8.2 关键节奏原则
1. **M1 优先于一切**：没有对话闭环，其余都无意义。W1 末必须能「说话→被追问」。
2. **每周五可演示**：固定一个能跑的版本，防止范围蔓延。
3. **P0 砍到底**：时间紧张时，先保证 FR-01~08 + AC-01~12 全绿；P2（动画细节、无障碍精细项）可后置到 v1.1。
4. **指标正则先行**：M2 第一天就把填充词正则跑通（零依赖、秒出数），LLM 建议随后叠。
5. **护栏贯穿**：M3 不孤立做，W1 起就在状态机里埋好暂停/降级/结束钩子，避免后期大改。
6. **模型省钱习惯**：对话只用快模型；报告强模型且仅在结束时调用一次；档位变量只读注入，杜绝「模型自作主张加压」既避险又省 token。

### 8.3 里程碑退出检查（每阶段末自测）
- M0 退出：前后端起得来、token 正确、API mock 返回符合契约 §4。
- M1 退出：AC-01/02/03/04 通过，transcript 黑板正确累积。
- M2 退出：FR-04/07 通过，侧栏阈值色正确。
- M3 退出：FR-06 + AC-08/09 通过，档位不可越权。
- M4 退出：FR-05 + AC-10/11/12 通过，报告可导出。
- M5 退出：AC-05/06/07 + 响应式 + 帮助中心通过，性能达标。

---

> 本文档与 PRD、UI/UX 设计文档、技术选型方案共同构成 MindForge 开发基线。下一步建议：将 M0/M1 拆为具体 commit 任务，或直接落地**前端 HTML/CSS 浅色原型 + FastAPI 三端点脚手架**。
