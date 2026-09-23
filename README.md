# MindForge 心智锻造

面向高压场景（考研复试 / 校招面试）的「心理韧性与表达力训练器」Web 应用。

> 定位：**训练工具，非招聘决策**。在可控的施压模拟中把紧张练成从容——AI 面试官动态施压、教练实时反馈、分析师结构化成长报告。

---

## ✨ 功能一览

| 模块 | 说明 |
|---|---|
| 可调施压模拟 | 温和 / 标准 / 高压三档，档位只读注入提示词，模型永不越权上调 |
| 流式对话 | 面试官 SSE 流式追问，首字 < 2s；单轮单角色发言机制 |
| 表达力教练 | 前端正则实时统计：填充词频次 / 平均句长 / 停顿语速，绿黄红阈值 + 每轮 1-3 条建议 |
| 安全护栏 | 暂停（呼吸引导）/ 降级（二次确认）/ 结束（二次确认）；施压反噬弹窗；时长/轮次硬上限自动降级 |
| 结案报告 | 分析师强模型四维评分 + 本地统计佐证，可本地导出（不上传） |
| 报告导出 | **直接下载 PDF**（jsPDF + Canvas 自绘，含雷达图与打分条，中文零乱码） |
| 简历 / 背景信息 | 训练前可选**上传简历**（PDF/Word/TXT，后端解析抽文本）或**手填院校/专业/学历/求职意向**，面试官据此针对性提问 |
| 语音输入（v1.1） | 输入栏麦克风按钮：**Edge 默认本地离线识别**（零延迟、音频不出设备、自适应增益小声可识别）；Chrome 优先浏览器原生（zh-CN）、不可用/被网络屏蔽时自动降级离线；识别文本可编辑后发送 |
| 语音情绪提示（v1.2） | 录音音量 RMS + 语速 + 文本情绪词 → 教练面板「情绪提示」（本地近似信号，标注公平性局限，仅提示非评测）；升级路径：可接 SenseVoice（funasr）真实 SER |
| 实时语音对话（豆包式） | 首页「🎙️ 实时语音对话」版块：离线识别实时转写 + **本机 whisper 精准校准** + DeepSeek 流式回答 + **浏览器语音播报**（播完自动续听、点击可打断）；说"帮我模拟面试追问"可切换面试官模式；全程免费、音频不离开设备 |
| 会话历史 | 训练记录与报告仅存本地浏览器，可在数据管理查看对话/报告 / 删除 / 清空 |
| 模型自检 | 顶部状态药丸显示「演示模式 / 已接入」，配置弹层内一键测试真实模型连接 |

## 🧱 技术栈

- **后端**：Python 3.10+ · FastAPI · Uvicorn · httpx（OpenAI 兼容客户端）· pypdf / python-docx（简历文本抽取）
- **前端**：原生 HTML / CSS / ES Modules（零构建，后端静态托管，一条命令跑通前后端）· jsPDF（本地 vendor，报告导出 PDF）
- **大模型**：OpenAI 兼容 API（DeepSeek / Qwen 百炼 / Kimi / 混元…），**无 Key 自动回退本地 Mock 生成器**，零依赖可完整演示

## 🚀 快速开始

### 方式一：一键脚本（推荐）

- Windows：双击 `start.bat`
- macOS / Linux：`./start.sh`

脚本会自动选择已装依赖的隔离环境，否则创建 `backend/.venv` 并安装依赖，然后启动服务。

### 方式二：手动命令

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows
# .venv/bin/python -m pip install -r requirements.txt     # macOS/Linux
.venv/Scripts/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

浏览器打开 **http://127.0.0.1:8000** 即可开始训练。

## 🤖 接入真实大模型

1. 复制配置模板：`cd backend && copy .env.example .env`
2. 填写 `.env`：

```ini
LLM_API_KEY=sk-xxxxxxxx
LLM_BASE_URL=https://api.deepseek.com/v1   # 或 Qwen: https://dashscope.aliyuncs.com/compatible-mode/v1
FAST_MODEL=deepseek-chat                    # 对话快模型
STRONG_MODEL=deepseek-chat                  # 报告强模型（可换 deepseek-reasoner / qwen-max）
```

3. 重启服务。顶部出现「已接入 api.deepseek.com」药丸；在「开始训练 → 测试连接」可一键自检连通性（对应接口 `POST /api/config/model/probe`，不泄露 Key）。

> Key 只存服务端（`.env`），前端仅调用你自己的后端，永不接触 Key。留空 `LLM_API_KEY` 则全程本地 Mock，方便演示。

## ✅ 测试

```bash
# 单元 / 契约测试（77 条：API + SSE + 安全护栏 + 正则指标 + 静态样式校验）
python tests/run_tests.py

# 端到端浏览器测试（Playwright + Chromium，见 tests/e2e/）
node tests/e2e/run_e2e.cjs
```

## 🚢 部署

应用为「FastAPI 后端 + 静态前端」单进程结构，适合：

- **完全免费上线（0 元，参赛 / 演示首选）**：见根目录 [`MindForge_免费部署方案.md`](MindForge_免费部署方案.md)。仓库已自带 `Dockerfile` + `render.yaml`，可一键部署到 **Render 免费实例** 或 **魔搭创空间**（CPU 完全免费），大模型走魔搭推理 API 每日 2000 次免费额度。
- **轻量 VPS / 云主机**：

  ```bash
  cd backend
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
  # 前置 Nginx 反代 + HTTPS 即可
  ```

- **Serverless（Vercel / Cloudflare Functions）**：将 `backend/` 转为函数入口，前端静态托管。
- **纯静态托管不适用**：前端依赖后端 `/api/*` 接口，不能单独静态部署。

生产必做：

- `.env` 中 `CORS_ORIGINS` 改为自有前端域名（如 `https://mindforge.example.com`），不要用 `*`
- 通过反向代理提供 HTTPS；`LLM_API_KEY` 仅存在服务端环境变量中

## 🔒 隐私 by design

- 对话与指标仅存浏览器 `localStorage`，可在「数据管理」查看 / 单条删除 / 清空
- 原始音频不上传；报告本地生成、本地导出
- 训练工具，不做任何招聘决策

## 📁 目录结构

```
MindForge/
├─ backend/                 # FastAPI 后端（静态托管前端）
│  ├─ main.py               # 应用入口 + CORS + 静态托管
│  ├─ config.py             # 配置（Key 仅服务端）
│  ├─ routers/              # session / chat(SSE) / coach / report / meta
│  ├─ services/             # llm_client / mock_generator / orchestrator / safety / metrics / report / transcript
│  ├─ prompts/              # 面试官 / 教练 / 分析师三套模板（档位只读注入）
│  └─ regex/filler.json     # 填充词词典（前后端单一真相源）
├─ frontend/                # 原生前端（token.css 落地 UI/UX v2.0 设计规范）
│  ├─ styles/               # token.css + app.css（含响应式三断点 / reduced-motion）
│  └─ js/                   # api_client / metrics_engine / transcript_store / guardrail_state / storage / app
├─ tests/                   # run_tests.py（77 条）+ e2e/ + 分阶段测试用例文档
├─ start.bat / start.sh     # 一键启动
└─ docs（根目录 Markdown）：PRD / UIUX / 技术选型 / 开发规划 / 测试报告
```
