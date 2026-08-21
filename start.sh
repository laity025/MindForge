#!/usr/bin/env bash
# ============================================================
#  MindForge 一键启动（macOS / Linux）
#  优先级：已存在的隔离环境 -> 项目 .venv -> 自动创建
# ============================================================
set -e
cd "$(dirname "$0")/backend"

PY=""
# 1) 本机开发环境（已装依赖）
if [ -x "$HOME/.workbuddy/binaries/python/envs/default/bin/python" ]; then
  PY="$HOME/.workbuddy/binaries/python/envs/default/bin/python"
fi
# 2) 项目级虚拟环境
if [ -z "$PY" ] && [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
fi
# 3) 都没有 -> 创建项目级虚拟环境并安装依赖
if [ -z "$PY" ]; then
  echo "[首次运行] 创建虚拟环境并安装依赖，约 1-2 分钟..."
  python3 -m venv .venv || { echo "[错误] 未找到 Python3，请先安装 Python 3.10+"; exit 1; }
  PY=".venv/bin/python"
  "$PY" -m pip install -r requirements.txt || { echo "[错误] 依赖安装失败，请检查网络"; exit 1; }
fi

echo
echo "  MindForge 心智锻造 启动中 → http://127.0.0.1:8000"
echo "  未配置 LLM_API_KEY 时自动使用本地 Mock 演示模式。"
echo
"$PY" -m uvicorn main:app --host 127.0.0.1 --port 8000
