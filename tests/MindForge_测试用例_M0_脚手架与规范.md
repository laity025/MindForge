# MindForge 测试用例 · M0 脚手架与规范

> 阶段目标：初始化仓库、落地 UI/UX v2.0 设计 token、搭建 FastAPI 后端骨架、约定并 mock 实现 API 契约。
> 对应文档：开发规划文档 §2 M0、§4 API 契约、UI/UX §2 色彩系统。

## 1. 测试环境
- 后端：`backend/`（FastAPI + Uvicorn），无 LLM Key 时自动启用本地 Mock 生成器（`config.use_mock`）。
- 启动：`python -m uvicorn main:app --port 8000`，访问 `http://localhost:8000/`。
- 前端：`frontend/`（原生 HTML+JS+CSS），由后端静态托管。
- 验证工具：curl / 浏览器。

## 2. 测试用例

| 编号 | 对应需求 | 前置 | 操作 | 预期结果 | 通过标准 |
|---|---|---|---|---|---|
| M0-TC01 | 后端骨架 | 服务已启动 | `GET /health` | 返回 `{"status":"ok","mock":true/false,"model":...}` | 200 + 字段存在 |
| M0-TC02 | API 契约·场景校验 | — | `POST /api/session/start` body `{"scene":"","level":""}` | 400，detail `{"error":"scene_required",...}` | 状态码 400 且 error 字段正确 |
| M0-TC03 | API 契约·档位校验 | — | `POST /api/session/start` body `{"scene":"campus_recruit","level":""}` | 400，`error:"level_required"` | 状态码 400 |
| M0-TC04 | API 契约·正常开始 | — | `POST /api/session/start` `{"scene":"postgrad_interview","level":"gentle"}` | 200，返回 `session_id`/`level_validated:"gentle"`/`opening:""` | 字段齐全 |
| M0-TC05 | 设计 token | 浏览器打开 `/` | 检查根变量 `--paper-bg:#F7F5F2`、`--accent:#1F4E4A`、墨色止于 `#2B2B2B` | 页面主底为暖白，强调色为深青绿，无纯黑主色 | 取色器校验通过 |
| M0-TC06 | 单一真相源 | 服务运行 | `GET /api/config/filler` | 返回填充词数组 + 阈值（与 `backend/regex/filler.json` 一致） | 前后端词典同源 |
| M0-TC07 | 静态托管 | 服务运行 | `GET /`、`/styles/token.css`、`/js/app.js` | 均 200，JS `text/javascript`、CSS `text/css` | MIME 正确 |
| M0-TC08 | CORS | 跨域前端 | 带 Origin 请求 API | 响应含 `Access-Control-Allow-Origin` | 不报跨域错误 |

## 3. 阶段退出检查（开发规划 §8.3）
- [x] 前后端起得来、`/health` 正常、token 正确、API mock 返回符合契约 §4。
- [x] 设计 token 落地（`frontend/styles/token.css` 与 UI/UX v2.0 一致）。
- [x] 填充词词典前后端同源（`backend/regex/filler.json` 单一来源，前端经 `/api/config/filler` 拉取）。
