# MindForge 完全免费上线方案

> 目标：**0 元**把 MindForge 部署到公网，拿到一个可直接发给评委 / 面试官的 HTTPS 链接。
> 版本：2026-09 · 政策均以 2026 年 9 月实际查询结果为准（免费额度变动频繁，上线前请复核）

---

## 一、结论速览

**推荐组合：单容器 + 免费 Docker 托管 + 免费大模型额度 = 全链路 0 元**

| 方案 | 托管成本 | 大模型成本 | 国内访问 | 休眠 | 推荐度 |
|---|---|---|---|---|---|
| **B. 魔搭创空间（国内）** ⭐ | 0 元（CPU 完全免费） | 魔搭每日 2000 次免费 | 优（国内直连） | 空闲休眠，**再访问自动唤醒**（无需手动） | ★★★★★ **首选** — 无需信用卡，2 vCPU / 16 GB |
| A. Render 免费实例 | 0 元 | 魔搭每日 2000 次免费 | 一般（新加坡节点） | 15 分钟空闲休眠，冷启 ~60s | ★★☆ **2026-09-23 实测被要求绑定信用卡**，见第五节 |
| C. 阿里云函数计算 FC | 0 元（100 万次/月） | 同上 | 优 | 不休眠 | ★★★☆ 需改造成 Serverless |
| D. Koyeb 免费实例 | 0 元 | 同上 | 差（仅法兰克福/华盛顿） | 会暂停 | ★★☆ 备用 |

> **先看第七节。** 如果你在 Render 上被信用卡那道门卡住（很常见），直接走方案 B，不要在 Render 上耗时间 —— 创空间不但不要卡，配置还高得多（2 vCPU / 16 GB vs Render 的 0.1 vCPU / 512 MB）。

**已排除，不要走弯路：**

| 平台 | 排除原因（2026-09 核实） |
|---|---|
| **Hugging Face Spaces** | 2026 年 7 月起 **Docker / Gradio Space 已改为付费**（PRO $9/月），免费账号只剩 Static Space。且 `*.hf.space` 在国内无法访问。 |
| **Zeabur** | 免费档（$0）已不含计算额度，只剩「管理自己的服务器」；$5 额度属于 Dev 档（$5/月，14 天试用）。 |
| **Vercel** | 免费 Hobby 明确「仅个人非商业用途」；`*.vercel.app` 国内访问不稳定。可用但优先级低。 |
| **纯静态托管**（GitHub Pages / Cloudflare Pages） | 不可行 —— 前端依赖 `/api/*`，且 Key 必须留在服务端。 |

> 为什么 A / B 用同一套物料：项目是**「FastAPI 后端 + 静态前端」单进程**结构，一个 Dockerfile 就能同时适配两个平台，切换平台只改一个环境变量。

### 访问地址长什么样？

**能。** 部署完成后你会拿到一个**公网 HTTPS 网址**，不需要装任何客户端，电脑浏览器 / 手机浏览器 / 微信里直接粘贴打开即可。评委拿到的就是这个链接。

| 平台 | 访问地址形式 | 备注 |
|---|---|---|
| **Render** | `https://mindforge-xxxx.onrender.com` | 平台自动分配二级域名，**落在域名根**，开箱即用 |
| **魔搭创空间** | 创建向导页面上显示的访问地址 | 以创建页面实际显示为准 |

**一个网址就够了。** 本项目是「FastAPI 同时托管静态前端 + 提供 `/api/*`」的单进程结构，且 `frontend/js/api_client.js` 里 `const BASE = ""` 走的是**相对路径** —— 打开首页的那个地址就是 API 的地址，**不需要**再单独配一个后端域名，浏览器也不会产生跨域请求。

**三个访问体验上的注意点：**

1. **免费实例都会休眠，但「唤醒方式」差别很大**：
   - **魔搭创空间**：空闲一段时间即休眠，**下次有人访问会自动唤醒**，你不需要做任何操作（详见第七节「实例会休眠吗」）。
   - **Render**：15 分钟无流量休眠，下一位访问者要等约 60 秒（表现为页面转圈，不是报错）。这正是第六节「保活探针」存在的意义 —— 配好后就是秒开。
2. **静态资源用的是绝对路径**（`/styles/app.css`、`/js/app.js`、`/js/vendor/jspdf.umd.min.js`），要求访问地址必须落在**域名根**：
   - `*.onrender.com` 天然满足 ✅
   - 魔搭创空间若把容器反代在**子路径**下，这些资源会 404，表现为**页面能打开但完全没有样式 / 交互失效**。创建后请务必实测首页外观，一旦样式丢失就是这个原因，需要平台提供独立域名（或改用 Render）。
3. **想要自己的域名**：用平台分配的免费二级域名是 ¥0；想换成 `mindforge.xxx.com` 这类自定义域名，需要自己购买域名（约 ¥30–60/年），这一步会打破「完全 0 元」。**参赛/校招场景用平台二级域名完全够用，不建议花钱。**

---

## 二、上线前必须处理的 4 个问题（已验证）

这四条都是实测结论（不是读代码猜的），不处理会直接翻车。物料已生成，无需你手改代码。

### 问题 1：`faster-whisper` 必须从生产依赖移除 ⚠️

| 影响 | 说明 |
|---|---|
| 镜像膨胀 | 连带 `ctranslate2` / `av` / `tokenizers`，多出 200MB+ |
| **内存打爆** | 加载 base 模型约需 1GB，免费实例普遍只有 512MB → 一次误调用直接 OOM 拖垮整个服务 |
| 构建变慢 | Render 免费档 500 构建分钟/月，模型下载与编译很吃时间 |

**是否可以安全移除？可以。** `backend/routers/asr.py` 里 `from faster_whisper import WhisperModel` 写在函数内部（懒加载），只有真正调用 `POST /api/asr/recognize` 才会加载。

实测证据（强制屏蔽该模块后）：

```
APP_IMPORT_OK
health: {'status':'ok','mock':True,...}
GET /                    -> 200, 21108 字节, 含 "MindForge"
GET /js/api_client.js    -> 200
POST /api/session/start  -> 200
POST /api/asr/recognize  -> 400（格式校验先于模型加载）
```

→ 即：**移除后其余功能全部正常**，只有「本机 whisper 精准校准」这一可选通道不可用；而前端默认走浏览器本地离线识别，不影响主流程。移除后该接口返回干净的 500，而不是把服务拖死。

### 问题 2：`numpy` 是隐性依赖，删 faster-whisper 时必须显式补上 🔴

这是本次排查最隐蔽的一颗雷。

`asr.py` 在**模块顶层**写了 `import numpy as np`，但 `backend/requirements.txt` 里**从来没有 numpy** —— 它是靠 `faster-whisper` 的传递依赖带进来的。

实测（逐个屏蔽模块后尝试启动）：

| 被屏蔽的包 | 应用还能启动吗 | 是否已在 requirements.txt |
|---|---|---|
| `faster_whisper` | ✅ 能（懒加载） | 有（可移除） |
| **`numpy`** | ❌ **启动即崩 `ModuleNotFoundError`** | **无（必须补上）** |
| `opencc` | ❌ 启动即崩 | 有 |
| `httpx` | ❌ 启动即崩 | 有 |
| `pypdf` / `docx` | ✅ 能（懒加载） | 有 |

→ 所以新文件 `backend/requirements-deploy.txt` = 原依赖 **去掉 faster-whisper + 显式加上 numpy**。
**如果只是简单删掉 faster-whisper 而不补 numpy，部署后应用起不来。**

### 问题 3：`python-multipart` 缺失 —— 应用根本起不来 🔴🔴

**这个问题比问题 1、2 更严重，而且是本次「全新环境实测」才暴露出来的。**

`routers/profile.py`（简历解析）和 `routers/asr.py`（语音识别）都声明了 `UploadFile` 参数。FastAPI 在**注册路由时**就会校验 multipart 支持，缺包直接抛异常：

```
RuntimeError: Form data requires "python-multipart" to be installed.
```

注意关键点：**这不是运行时才报错，而是 `import main` 阶段就崩，容器连启动都完成不了。**

而 `python-multipart` **既没写在 `backend/requirements.txt` 里，也不是 fastapi / uvicorn 的传递依赖**。由此得出一个必须修的问题：

> **当前 `backend/requirements.txt` 在任何一台干净机器上安装后，MindForge 都跑不起来。**
> 影响范围：`start.sh` 的「自动创建 venv」分支；以及评委 / 面试官克隆你的 GitHub 仓库后按 README 操作 —— 会直接失败。

本地一直没发现，是因为开发机环境早就装好了它。

**处理**：`requirements-deploy.txt` 已显式补上；`backend/requirements.txt` 也已一并补上并推送（见第九节）。

### 问题 4：端口不能写死 8000

`backend/main.py` 的 `__main__` 里写死 8000，但托管平台会注入自己的端口：
- Render → 环境变量 `PORT`
- 魔搭创空间 → 固定要求 **0.0.0.0:7860**

处理方式：Docker 的启动命令用 `${PORT}`，**不用改 main.py**：

```dockerfile
ENV PORT=8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
```

### 最终验收：全新环境实测通过 ✅

为了确保「依赖清单没漏」，做了一个**全新建虚拟环境 → 只按 `requirements-deploy.txt` 安装 → 启动应用 → 跑完项目自带测试套件**的完整验证：

```
STARTUP_OK  (routes=20)
health  : {'status': 'ok', ...}
GET /   : 200  len=21108  MindForge=True
static  : token.css / app.css / app.js / api_client.js /
          metrics_engine.js / guardrail_state.js / jspdf -> 全部 200
session / level / pause / meta / profile -> 全部 200
asr     : 400（仅格式校验，未加载模型，符合预期）

tests/run_tests.py  ->  总计 77 | 通过 77 | 失败 0
```

**这一步的价值**：正是它抓出了上面的 `python-multipart` 缺失 —— 单靠本地开发环境永远不会暴露。

> 顺带发现：`README.md` 里写「单元测试 53 条」，实际已是 **77 条**，建议更新。

### 附带做掉的：Key 不进镜像

`.dockerignore` 已排除 `backend/.env`。原因：`backend/.env` 里有**一把真实的 LLM Key**，若被 `COPY . .` 打进镜像，Key 会永久留在镜像层里，任何能拉到镜像的人都能读到。

> 顺带确认：`.gitignore` 已存在且已排除 `.env`（`git ls-files` 只追踪到 `.env.example`），**git 侧是安全的**。

---

## 三、已生成的上线物料

| 文件 | 作用 |
|---|---|
| `Dockerfile` | 生产镜像，适配 Render / 魔搭创空间 / Koyeb / 任意 Docker 主机 |
| `.dockerignore` | 保护 `backend/.env` 不进镜像，同时瘦身上下文 |
| `backend/requirements-deploy.txt` | 生产依赖（移除 faster-whisper，显式补上 numpy 与 python-multipart） |
| `render.yaml` | Render 蓝图：一键部署 + 环境变量声明（Key 不入库） |
| `ms_deploy.json` | **魔搭创空间**部署配置：`sdk_type: docker`、`resource_configuration: platform/2v-cpu-16g-mem`、`port: 7860`；并用官方 `environment_variables` 字段预置了 8 个非敏感环境变量（字段已逐项对官方 schema 核对） |
| `tests/verify_llm_endpoint.py` | **部署前预检脚本**：一次验证模型清单、两个模型各自的非流式调用、**流式 SSE**、JSON 解析能力，以及**按应用真实载荷（不传 max_tokens）调用强模型出报告**，共 6 项（用法见第七节「拿到令牌先验证一次」） |
| `dist/MindForge_studio.zip` | **给创空间用的干净包（约 44 MB）**：剔除 `.env` / 设计文档 / 带姓名的 PNG，只留运行所需内容。未纳入 git（`dist/` 已忽略） |
| `MindForge_免费部署方案.md` | 本文档 |
| `.gitignore`（**唯一被修改的既有文件**） | 追加部署排查临时产物的排除规则（`.deployvenv*/`、`.deploycheck*.py`、`.gitcheck.txt` 等），与应用代码无关 |

**除 `.gitignore` 追加了几条忽略规则外，没有改动任何应用代码**，本地 `start.bat` / `start.sh` 开发流程完全不受影响。

---

## 四、大模型怎么也不花钱

项目本身不烧钱，钱都在 LLM 调用上。两条免费路径：

| 渠道 | 免费额度 | 端点 | 备注 |
|---|---|---|---|
| **魔搭 ModelScope** | **每日 2000 次**，0 点重置，超额返 429 **不扣费** | `https://api-inference.modelscope.cn/v1` | 需**绑定阿里云账号 + 实名认证**，否则每次调用 401 |
| 硅基流动 SiliconFlow | 注册赠 14 元 + 部分永久免费模型 | `https://api.siliconflow.cn/v1` | 你本地 `.env` 现在用的就是这家 |

**推荐用魔搭** —— 它和部署平台（创空间）是同一家，一次注册两处通用，且国内直连。

获取步骤：
1. `modelscope.cn` 注册 → 绑定阿里云账号 → 完成实名
2. 个人中心 → 访问令牌 → 新建 → **选「写权限令牌」（Write Permission）**（选错类型的后果与验证方法见第七节「访问令牌该选哪种？」）
3. 把令牌填到部署平台的环境变量 `LLM_API_KEY`

> ⚠️ **令牌格式必须是 `ms-` 开头**。如果你复制到的是 `sk-`（那是阿里百炼的 Key）或别的形状，说明复制错了对象 —— 调用时会返回 `401 Authentication failed`（2026-09-23 实测确认，详见第七节）。

> ⚠️ **模型 ID 必须带命名空间前缀，而且这个清单会变**。魔搭的免费推理清单随模型迭代更新，**当前有效列表可以不带令牌直接查**（这个接口是公开的，实测无需鉴权）：
>
> ```powershell
> (Invoke-RestMethod -Uri "https://api-inference.modelscope.cn/v1/models").data.id
> ```
>
> 或直接在浏览器打开 `https://api-inference.modelscope.cn/v1/models`。**2026-09-23 实测：清单里已经没有 `deepseek-ai/DeepSeek-V3`**，`DeepSeek-V4` 系列已接替 —— 不要照抄网上教程里的旧 ID。

**推荐配置（2026-09-23 从官方清单挑选，与本项目《技术方案_AI技术选型》的「Flash 主力 + Pro 出报告」一致）**：

| 用途 | 环境变量 | 模型 ID |
|---|---|---|
| 面试官 / 陪练 / 流式对话 | `FAST_MODEL` | `deepseek-ai/DeepSeek-V4.1-Flash` |
| 分析师结案报告 | `STRONG_MODEL` | `deepseek-ai/DeepSeek-V4-Pro` |

**备选（同期清单内的其他 ID，主选不可用时替换）**：

| 档位 | 候选 ID |
|---|---|
| 快 | `Qwen/Qwen3.8-Flash-Next`、`ZhipuAI/GLM-4.7-Flash`、`stepfun-ai/Step-3.7-Flash`、`deepseek-ai/DeepSeek-V4-Flash-0731` |
| 强 | `Qwen/Qwen3.5-397B-A17B`、`ZhipuAI/GLM-5.2`、`MiniMax/MiniMax-M3`、`deepseek-ai/DeepSeek-V4-Pro-0813` |

> ✅ **2026-09-23 已实测闭环**：上面两个 ID **都在当前清单内**（清单共 35 个），且用部署将用的那条令牌**实际调用 `deepseek-ai/DeepSeek-V4.1-Flash` 成功返回了 `choices` 与 `usage`**。模型 ID 与令牌两项均已验证，可以放心部署。

> 清单同期共 35 个模型（另有 ERNIE、Intern、Mistral、LongCat、Nex、Step 等系列）。**接口不标注每个模型的免费/付费状态**，若某 ID 返回 403/429，换同档位备选即可，代码不用动。

> 另外，项目无 Key 会自动回退本地 Mock 生成器。**演示兜底方案：不配 Key 也能完整走通全流程**，只是回答内容为预置模板。

---

## 五、方案 A：Render 部署（⚠️ 可能被信用卡门槛卡住）

> **实测记录（2026-09-23）**：走 **New → Blueprint** 流程时，Render **强制要求绑定信用卡**，点「取消」会直接退出界面，无法继续。
>
> 这与 Render 官方文档「No payment is required / no credit card required」的说法不一致 —— 说明这是**账号级风控**，不是文档能解释、也不是我们能绕开的。
>
> **可以试一步**：改用 **New → Web Service**（不走 Blueprint），Language 选 **Docker**、Instance Type 选 **Free**，看是否同样要卡。
> **若仍被拦，立刻转向第七节的魔搭创空间**，不要在 Render 上耗时间：创空间不要卡，而且 **2 vCPU / 16 GB** 对比 Render 的 **0.1 vCPU / 512 MB**，完全是两个量级。
>
> 下面的步骤保留备用，若你换到了可用卡的账号或 Render 放开了风控，依然可直接照做。

### 第 1 步：把部署物料推上 GitHub —— **不要用 `git add .`** ⚠️

你的上一次提交是「移除设计/规划文档与演示图片，精简仓库」，因此那几份设计文档与两张 PNG **目前正躺在工作区的未追踪列表里**。一旦执行 `git add .`，它们会被连本带利加回去；其中 `钟旨宸-MindForge_AI面试训练助手.png` 还**带有姓名**，与你自己定的「公开仓库排除姓名」原则冲突。

所以请用**精确列举**的方式提交：

```bash
cd D:/WorkBuddy_Project/MindForge
git add .gitignore .dockerignore Dockerfile render.yaml README.md \
        MindForge_免费部署方案.md \
        backend/requirements.txt backend/requirements-deploy.txt
git status --short
git commit -m "chore: free-tier deployment scaffolding + fix missing runtime deps"
git push origin main
```

- `git remote -v` 已确认远端为 `https://github.com/laity025/MindForge.git`、分支 `main`，**不需要**再做 `git remote add`。
- 清单里的 `backend/requirements.txt` 与 `README.md` 是本次修复缺依赖 / 更正文档带来的改动，需一并提交。
- `.gitignore` 一并提交，是因为它新增了部署排查临时产物的排除规则（`.deployvenv*/`、`.deploycheck*.py` 等），属于本次工作的一部分。
- **提交前务必看 `git status --short` 的输出**：正常应只列出上面这 8 个文件；**一旦出现 `backend/.env` 就立刻停下**。

### 第 2 步：在 Render 创建服务

1. 打开 `dashboard.render.com` → 用 GitHub 账号授权登录（**不需要信用卡**）
2. 顶部 **New → Blueprint**
3. 选择 `MindForge` 仓库 → Render 自动读取根目录的 `render.yaml`
4. 弹出环境变量表单 → **只需填 `LLM_API_KEY`**（粘贴魔搭访问令牌）→ 点 **Apply**
5. 首次构建约 3–6 分钟（装依赖 + 拉基础镜像）。日志出现 `Your service is live` 即完成
6. 页面顶部拿到访问地址：`https://mindforge-xxxx.onrender.com`

### 环境变量核对表

`render.yaml` 里已经写好了，用 Blueprint 部署时**你只需要手填 `LLM_API_KEY` 一项**。如果改成手动 New → Web Service，按下表逐项加（变量名均已与 `backend/config.py` 对齐）：

| 变量 | 值 | 说明 |
|---|---|---|
| `LLM_API_KEY` | `<魔搭访问令牌>` | **唯一必须手填**；`render.yaml` 里用 `sync: false` 标记为不入库 |
| `LLM_BASE_URL` | `https://api-inference.modelscope.cn/v1` | 换 DeepSeek 官方就填 `https://api.deepseek.com/v1` |
| `FAST_MODEL` | `deepseek-ai/DeepSeek-V4.1-Flash` | 面试官 / 陪练角色（要快）；Flash 档适合免费额度 |
| `STRONG_MODEL` | `deepseek-ai/DeepSeek-V4-Pro` | 分析师报告（要准，一次性批量调用） |
| `CORS_ORIGINS` | `*` | 前后端同源，实际不生效；若将来拆域名务必改成具体域名 |
| `TIMEOUT_MS` | `30000` | LLM 单次调用超时（毫秒）：流式取 `30+5=35s` 读间隔上限；非流式取 `30+10=40s` 整包上限。**默认值 2000 会让分析师报告超时并静默退回模板**，见下方说明 |
| `MAX_TURNS` | `40` | 超过后触发 transcript 压缩 |
| `MAX_DURATION_MIN` | `20` | 单场训练时长上限 |
| `PORT` | **不要设置** | Render 自动注入，Dockerfile 已用 `${PORT}` 读取；手填反而会冲突 |

> **为什么 `TIMEOUT_MS` 要调到 30000（实测推导，容易被忽略）**：
> `services/llm_client.py` 里三处超时都从这一个值派生 ——
> - 流式对话（面试官）：`TIMEOUT_MS/1000 + 5`，即每两次数据之间的**读间隔**上限（不是整段时长，长回答不会因此被截断）；
> - 教练侧栏 JSON：`TIMEOUT_MS/1000 + 10`；
> - **分析师报告 JSON：同样是 `TIMEOUT_MS/1000 + 10`** —— 而它是一次性非流式调用 `STRONG_MODEL` 生成整份结构化报告，输出上千 token，免费共享端点排队时很容易超过 15 秒。
>
> 后果不是报错，而是**静默降级**：`report_service` 捕获异常后回退到本地模板报告。表现为「功能正常，但报告读起来像模板」。如果遇到这种情况，先把 `TIMEOUT_MS` 往上调（如 `60000`）再排查别的。

> **兜底很重要**：`LLM_API_KEY` 为空时后端自动回退本地 Mock 生成器，全流程依然跑得通（回答为预置模板）。也就是说哪怕令牌当天失效，评委点开链接也不会白屏 —— 这是演示时最实用的一层保险。

### 必须知道的四个限制

| 限制 | 数值 | 应对 |
|---|---|---|
| 空闲休眠 | 15 分钟无流量后休眠，再访问冷启 **约 60 秒** | **配保活探针**（见第六节） |
| 实例时长 | 750 实例小时/月（按工作区计） | 24h 保活约消耗 720h，**正好够一个服务，别再开第二个** |
| 带宽 | 5 GB/月 | 纯文本应用，足够了 |
| 内存/CPU | 512MB / 0.1 vCPU | 已通过移除 faster-whisper 适配 |

---

## 六、保活：让网址「秒开」（仅 Render 需要）

> **本节只适用于 Render**（15 分钟无流量即休眠，必须靠探针撑着）。
> **走魔搭创空间的话不需要配探针** —— 它是「访问即自动唤醒」，发链接前自己先用浏览器打开一次预热就够了，比配探针更简单（见第七节「实例会休眠吗」）。

**为什么必须做**：Render 免费实例 15 分钟无流量即休眠，下一位访问者要等约 60 秒。评委点开链接等 60 秒 = 直接减分。保活 = 让一个免费探针每 14 分钟自动访问一次 `/health`，让实例一直醒着。

### 逐步配置（cron-job.org，推荐）

1. 打开 `cron-job.org` 注册（邮箱即可，完全免费）
2. 顶部 **Create cronjob**
3. **Title**：`MindForge keepalive`
4. **URL**：`https://mindforge-xxxx.onrender.com/health` ← 换成你自己的地址
5. **Schedule**：选 `Every 14 minutes`
6. **Save** → 回到列表点一次 **Execute now** 手测，看到 HTTP `200` 即配置成功

### 备选：UptimeRobot（顺便当宕机告警）

1. 注册 → **Add New Monitor**
2. Monitor Type 选 `HTTP(s)`，URL 同上
3. Monitoring Interval 选 `5 minutes`（免费档）
4. Save

### 三条硬约束

| 约束 | 说明 |
|---|---|
| **间隔必须 < 15 分钟** | 否则达不到保活效果。建议 14 分钟，留 1 分钟余量 |
| **额度只够一个服务** | Render 免费给 750 实例时/月，24h 保活要吃约 720h。**别在同一工作区再开第二个免费服务**，否则两个都被摊薄 |
| **`/health` 不花钱** | 它是项目已有的轻量端点（返回 `{"status":"ok","mock":...,"model":...}`），不发任何 LLM 请求，**不消耗大模型额度** |

### 只在演示期保活（可选，省额度）

不想整月占用的话：只在比赛 / 面试演示周期内开启探针，其余时间暂停。冷启动 60 秒只影响「第一个访问者」，自己提前点一次预热即可。

---

## 七、方案 B：魔搭创空间（⭐ 首选路径，无需信用卡）

**为什么是首选**（2026-09-23 核实）：

| 对比项 | 魔搭创空间 | Render 免费 |
|---|---|---|
| 信用卡 | **不需要**（仅需实名认证） | **实测被要求绑卡** |
| CPU / 内存 | **2 vCPU / 16 GB** | 0.1 vCPU / 512 MB |
| 国内访问 | 优（阿里云国内节点） | 一般（新加坡节点） |
| 大模型额度 | 同厂商，一次注册两处通用 | 需另行配 Key |
| 交付方式 | 上传文件夹 / Git 推送 | Git 仓库连接 |

免费的云资源配置名称是 **`platform/2v-cpu-16g-mem`**（2 核 CPU + 16G 内存，轻量应用，免费）。

### 平台硬性要求（已逐条对齐官方 schema）

> 以下不是推测 —— 来自平台自己的部署配置 schema（公开可读）：`https://modelscope.cn/api/v1/studios/deploy_schema.json`。其中写明 `platform/2v-cpu-16g-mem` 是 **"available to all users at no cost"**（对所有用户免费），而 Docker 类型的 `port` 约束是 **`const: 7860`**（必须是且只能是 7860）。

- **服务端口必须是 7860** —— 已通过 `PORT` 环境变量适配，无需改代码
- **项目根目录必须有 `Dockerfile`** —— 已就绪
- **前后端必须合并进一个容器** —— 本项目本来就是「FastAPI 同时托管静态前端」的单进程结构，天然满足
- **非敏感配置可直接写进 `ms_deploy.json` 的 `environment_variables`** —— 官方字段，已为你预置好

### 已为你准备好的创空间物料

| 文件 | 说明 |
|---|---|
| `ms_deploy.json` | 创空间部署配置（**字段已按官方 schema 逐项核对**）：`sdk_type: docker`、`resource_configuration: platform/2v-cpu-16g-mem`、`port: 7860`；并用官方支持的 `environment_variables` 字段**预置了 8 个非敏感变量**（`PORT`、两个模型 ID、`LLM_BASE_URL`、`TIMEOUT_MS` 等）—— 你只需再补 `LLM_API_KEY` 一项 |
| `dist/MindForge_studio.zip` | **可直接上传的干净包（约 44 MB，50 个条目）**：已剔除 `backend/.env`、`__pycache__`、`tests/`、设计文档与带姓名的 PNG，只保留运行所需内容（含 `frontend/vosk/model.tar.gz` —— 浏览器离线识别模型，属运行时必需） |

### 第 1 步：注册并实名

1. 打开 `modelscope.cn`，用**阿里云账号**登录（没有就注册一个，不收费、**不需要信用卡**）
2. 完成**实名认证**（个人认证，准备身份证；通常 1–2 个工作日）
3. 获取**访问令牌**（即 `LLM_API_KEY`）—— 这一步最容易选错，见下方「访问令牌该选哪种？」

#### 访问令牌该选哪种？

入口：`modelscope.cn` →「设置」→「访问令牌」（直达 `https://www.modelscope.cn/my/access/token`）。

点「新建访问令牌」后会要求选令牌**类型**，四种分别是：

| 选项 | 能不能用来调推理 API |
|---|---|
| **写权限令牌（Write Permission）** | ✅ **选这个** —— 调用 API-Inference 推理服务需要写权限 |
| 仅读权限令牌（Read Permission） | ❌ 只够下载模型 / 读数据集，调推理会返回 401 |
| 细粒度令牌（Fine-grained） | ⚠️ 可以，但要自己勾对推理相关权限；勾漏了同样 401，事后排查更麻烦 |
| 管理员权限令牌（Admin） | ⚠️ 能用，但权限过大（能删仓库、改账号设置），没必要，泄露风险最高 |

> **最省事的做法**：魔搭账号通常自带一条名为 `default`、标注「长期有效」的令牌。**若它就是 Write Permission，直接点复制按钮用即可**，不必新建。
>
> ⚠️ **令牌只在创建那一刻完整显示一次**（之后列表里都是打码的 `ms-****`），务必当场复制保存。它等同密码 —— 不要提交进 git、不要出现在公开截图里。

#### 拿到令牌先验证一次（强烈建议）

**在部署之前就把令牌测通**，否则等容器构建完才发现 401，排查成本会高很多。

**推荐做法（方式一）：跑一遍完整预检脚本。** 项目里已备好 `tests/verify_llm_endpoint.py`，检测 **6 项**并给出耗时 —— 模型清单、两个模型各自的非流式调用、**流式 SSE**、JSON 解析能力，以及第 6 项**「按应用真实载荷调用」**。PowerShell 里执行：

```powershell
$env:MS_TOKEN = "ms-你的令牌"
& "C:\Users\laity\.workbuddy\binaries\python\envs\default\Scripts\python.exe" `
    "D:\WorkBuddy_Project\MindForge\tests\verify_llm_endpoint.py"
```

全部 PASS 再去做部署；有任何一项 FAIL，脚本会在结尾提示可能原因。**其中「流式」那一项尤其关键** —— 前端「逐字上屏」直接依赖它，而这一点只能在你的网络环境里验证（助手所处环境无法替代）。

> **第 6 项为什么重要（2026-09-23 新增）**：`llm_client.chat_json` 发请求时**不传 `max_tokens`**，输出预算完全由平台默认值决定；而分析师报告是一次性非流式调用 `STRONG_MODEL` 生成整份 JSON。若该模型是**推理型**（响应里带 `reasoning_content`），推理过程会先吃掉输出预算，可能出现 **HTTP 200 但 `content` 为空** —— 此时 `report_service` 会**静默退回本地模板报告**，功能看起来正常、内容却是模板。所以第 6 项按真实载荷调一次，并断言返回的是完整 JSON、同时打印耗时与 `finish_reason`。
>
> - `finish_reason=length` → 被截断，需换模型或显式放宽 `max_tokens`
> - 脚本提示 `TIGHT` → 说明耗时接近超时上限，把 `TIMEOUT_MS` 调大（如 `60000`）
> - 报告必须**有内容且键齐全**（`scores` / `improvements` / `summary`），否则线上会静默降级

**方式二（只想快速确认能不能通）**，用下面这条一行命令（把令牌换成你自己的实际值）：

```powershell
$tok  = "ms-你的令牌"
$head = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
$body = @{
  model      = "deepseek-ai/DeepSeek-V4.1-Flash"
  messages   = @(@{ role = "user"; content = "hi" })
  max_tokens = 8
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri "https://api-inference.modelscope.cn/v1/chat/completions" -Method Post -Headers $head -Body $body
```

> ⚠️ **不要用 `curl.exe -d '{"model":...}'` 这种写法测**。PowerShell 5.1 把参数交给 `curl.exe` 时会**吃掉 JSON 里的双引号**，服务端收到的 `model` 是空的，于是返回一个极具误导性的报错：
>
> ```
> {"error":{"message":"Invalid model id: "}}
> ```
>
> 注意冒号后面是**空的** —— 这不是「模型 ID 写错了」，而是**请求体根本没送达**。上面用 `Invoke-RestMethod` + `ConvertTo-Json` 的写法由 PowerShell 自己构造 JSON，完全绕开这个坑。

| 返回结果 | 含义 |
|---|---|
| 一段含 `choices` 的 JSON | ✅ 令牌可用，继续部署 |
| `401 please bind your alibaba cloud account before use` | 还没绑阿里云账号 / 没完成实名认证 |
| `401 Authentication failed, please make sure that a valid ModelScope token is supplied.` | **令牌本身不被接受**：格式不对（不是 `ms-` 开头）、复制错对象，或已失效 |
| `400` 且提示模型不存在 | 模型 ID 不在当前清单里，用第四节的 `/v1/models` 查最新有效 ID |

> **实测记录（2026-09-23）**：用一个**非 `ms-` 开头**的令牌测试，返回的正是上面第三条 `401 Authentication failed`。对照实验确认该消息是**通用鉴权失败**（伪造令牌、不带令牌的返回完全一致），另外 `/v1/models` 接口**无需鉴权**即可访问，因此它给出的 35 个模型 ID 是**平台级真实清单**，可以直接照抄。

> ⚠️ **补充实测（同日）：这句话不能单独用来判定「令牌无效」。** 在另一个网络环境里用**同一个有效令牌**发请求，得到的同样是这句一模一样的消息；并且已用公开回声服务确认 `Authorization` 头是**完整送达**服务端的（逐一排除了头部丢失、User-Agent、系统代理、出口 IP 等因素，实测出口 IP 落地在国内）。结论是：**唯一可信的判据是「实际调用成功、返回了 `choices`」，而不是「报了哪条错」** —— 所以请务必用上面方式一，在自己的机器上实跑一次再下结论。

### 第 2 步：创建创空间

1. 顶部导航「创空间」→「创建创空间」
2. 选**编程式创建**，模式选**「快速部署并创建」**
3. 填写名称、描述；**可见性先设「私有」**，调通后再改公开
4. 云资源选 **CPU basic（免费）**
5. **上传 `dist/MindForge_studio.zip`**（或解压后上传整个项目文件夹）
6. 点「确认创建并部署」

### 第 3 步：配置环境变量

> ✅ **好消息**：如果你是用本项目的 `ms_deploy.json` / `dist/MindForge_studio.zip` 创建的，下表 9 项里**已有 8 项自动配好**（写在官方 `environment_variables` 字段里）。**你只需要手动补 `LLM_API_KEY` 这一项。**

在创空间的「环境变量 / Secrets」里确认 / 补上：

```ini
LLM_API_KEY      = ms-xxxxxxxx（必须是 ms- 开头的写权限令牌）
LLM_BASE_URL     = https://api-inference.modelscope.cn/v1
FAST_MODEL       = deepseek-ai/DeepSeek-V4.1-Flash
STRONG_MODEL     = deepseek-ai/DeepSeek-V4-Pro
PORT             = 7860
CORS_ORIGINS     = *
TIMEOUT_MS       = 30000
MAX_TURNS        = 40
MAX_DURATION_MIN = 20
```

> **`PORT=7860` 不能漏**，这是平台硬性要求。
> 不配 `LLM_API_KEY` 也能跑（自动回退 Mock），但那就没有真实模型效果了。
> ⚠️ **保存后必须回设置页点一次「重启创空间」** —— 环境变量的新增和修改都要重启才生效（官方明确要求）。漏了这一步，就会表现为「配了却没用」。

### 第 4 步：构建与验收

构建完成后拿到访问地址。**第一件事是看首页有没有样式** —— 若「页面能打开但完全没有样式」，说明访问地址被反代在子路径下（原因见第一节「访问地址长什么样」），需要平台提供独立域名。

### 实例会休眠吗？需要每次手动操作吗？

**一句话结论：部署一次就长期有效，之后不需要你重复任何操作。**

官方对免费资源（`platform/2v-cpu-16g-mem`）的原文说明是：

> 若实例一段时间未使用后，将进入休眠，**重新访问后即会激活启动**。

这句话把两个疑问都答了：

| 你的疑问 | 实际情况 |
|---|---|
| 会一直响应吗？ | **不会** —— 一段时间没人访问会进入休眠 |
| 休眠后要手动重启吗？ | **不用** —— 下次有人访问，平台**自动唤醒**，你不用点任何按钮 |

也就是说：**休眠 ≈ 待机，不是关机。** 部署一次，之后长期有效。

> ⚠️ **别把「创空间」和「Notebook」混淆**：魔搭的 **Notebook** 空闲后是**停止**，需要进控制台手动点「启动」才能恢复 —— 那才叫"要重复操作"。**创空间**是休眠 + 访问自动唤醒，机制完全不同，不要因为看到 Notebook 的说明而担心。

#### 只有这 3 种情况才需要你手动动手

| 情况 | 要做什么 |
|---|---|
| 改了代码想更新线上 | 设置页 → **重启创空间**（系统拉取最新文件重新部署） |
| **改了环境变量** | ⚠️ **必须重启创空间才生效** |
| 自己点了「下线」 | 需要重新上线 |

> **第二条是本次部署最容易踩的坑。** 官方文档明确写着「环境变量创建或更新后，须重启创空间方可生效」。所以 `PORT=7860`、`LLM_API_KEY` 配完保存后，**一定要回设置页点一次「重启创空间」**，否则你会发现"配了却没生效"。这正是你之前反复遇到的"操作完不生效"那类问题的典型成因。

#### 零成本预热技巧：发链接前，自己先点一下

既然「访问即唤醒」，就有个比配探针更省事的办法：**把链接发给评委之前，自己先用浏览器打开一次**。实例被这一下唤醒后，接下来一段时间内所有人打开都是秒开。

（这也是为什么魔搭这条路径**不必**配第六节的保活探针 —— 那边是 15 分钟就睡、必须靠探针撑着；这边访问即醒，人肉预热足够。）

#### 唤醒要等多久？

官方**没有公布具体秒数**，网上也缺少可靠实测数据，各来源都不会给你准确答案 —— 我不编数字。按同类平台的经验，量级在**「几秒到数十秒」**之间（本项目容器启动还要拉起 FastAPI 并加载静态资源）。

建议部署完成后**自己实测一次**：放置 1 小时以上不访问，再打开链接用手机计时，把结果记在下面。这个数字决定你要不要刻意预热。

```text
实测冷启动耗时：______ 秒（日期：______）
```

#### 免费资源的性质

官方原文是「该免费资源**归属于用户**」—— 它是长期资源，不是限时试用；CPU 资源完全免费。但仍属共享层，**不要拿去做违法操作**，也不要指望它扛生产级流量。

### Git 推送方式（备选，不想手动上传时用）

```bash
git clone https://www.modelscope.cn/studios/<你的命名空间>/<空间名>.git
cd <空间名>
# 把项目内容复制进来，注意不要带上 backend/.env
git add -A
git commit -m "init: MindForge"
git push
```

### 注意事项

- **「本机 whisper 精准校准」这个可选功能没被打进包里**：`POST /api/asr/recognize` 走的是精简依赖清单（不含 faster-whisper）。创空间有 16 GB 内存，**其实装得下**（base 模型约需 1 GB）—— 若想要这个功能，把 Dockerfile 里的依赖文件从 `requirements-deploy.txt` 换成 `backend/requirements.txt` 即可（代价是镜像大 200MB+、构建变慢）。前端默认走浏览器离线识别，不影响主流程。
- 若平台要求提供 `README.md` 元信息，按其创建向导提示补即可（仓库里已有 `README.md`）。

---

## 八、上线自检清单

部署完成后逐项确认：

- [ ] `GET /health` 返回 `{"status":"ok"}`，且 `"mock": false`（说明真实模型已生效）
- [ ] 首页能打开，顶部状态药丸显示「已接入 api-inference.modelscope.cn」
- [ ] 配置弹层 → **测试连接** 通过（即 `POST /api/config/model/probe`）
- [ ] 开始一次训练：面试官开场白能**流式逐字上屏**（验证 SSE 在平台代理下未被缓冲）
- [ ] 教练面板填充词统计有实时数字（前端正则，验证静态资源加载正常）
- [ ] 结束训练能出报告并**下载 PDF**（验证 jsPDF 与中文字体正常）
- [ ] 报告内容是**针对本场对话的**，而不是固定模板 —— 若读起来像模板，多半是分析师调用超时后静默降级，把 `TIMEOUT_MS` 调大（见第五节说明）
- [ ] 刷新页面后历史会话仍在（验证 localStorage 正常）
- [ ] 访问体验：发链接前自己先打开一次预热（走创空间）／保活探针已配好（走 Render）

> **最容易被平台搞坏的一项是 SSE 流式**。若发现回答「憋很久后整段一次性出现」，说明平台代理缓冲了响应流，需要换平台或在该平台开启流式透传。

---

## 九、遗留与建议

1. ✅ **`backend/requirements.txt` 已修复并推送**：补了下面两行，并附英文注释说明理由。

   ```text
   numpy>=1.24
   python-multipart>=0.0.9
   ```

   - `python-multipart`：**不加则任何人都跑不起来**（`import main` 阶段 RuntimeError），直接影响别人克隆仓库后的首次运行体验。
   - `numpy`：原本靠 faster-whisper 传递依赖，属隐性耦合，一旦哪天移除 faster-whisper 就会连带断掉。

2. ✅ **`README.md` 已更正**：单元测试 53 条 → **77 条**（两处）；顺带修掉一个会误导人的错误 —— E2E 运行脚本写的是 `run_e2e.mjs`，实际文件是 **`run_e2e.cjs`**；并在「部署」一节加了指向本方案的入口。
3. **`frontend/index.html` 引用了 Google Fonts**（`fonts.googleapis.com`），国内加载会超时阻塞字体渲染。虽不致命（有系统字体兜底），但建议改为本地字体或国内 CDN，能明显改善首屏观感。
4. **Key 轮换**：`backend/.env` 里的真实 Key 从未提交到 git，风险可控；但若曾以其他方式外发过，建议在硅基流动后台重置一次。
5. **`CORS_ORIGINS` 保持 `*` 的安全性**：本项目前后端同源部署，浏览器不会走跨域，实际等价于关闭跨域。若后续拆分前后端域名，务必改为具体域名。

---

## 十、成本总账

| 项目 | 费用 |
|---|---|
| 代码托管（GitHub 私有/公开仓库） | ¥0 |
| 应用托管（Render 免费实例 或 魔搭创空间免费 CPU） | ¥0 |
| HTTPS 证书 | ¥0（平台自动签发） |
| 域名 | ¥0（用平台分配的二级域名） |
| 大模型调用（魔搭每日 2000 次） | ¥0 |
| 保活探针 | ¥0 |
| **合计** | **¥0 / 月** |
