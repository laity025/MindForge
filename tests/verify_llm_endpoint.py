"""
MindForge - LLM endpoint preflight  (run this on YOUR machine)
==============================================================

Deployment smoke test for whatever OpenAI-compatible endpoint you configured.
It exists because the assistant sandbox cannot authenticate against
ModelScope - only your own machine (or the deployed container) can give a
trustworthy verdict.

What it checks
  1. /v1/models        - do the two configured model ids actually exist?
  2. non-stream FAST   - basic call + latency + non-empty reply
  3. non-stream STRONG - the analyst-report model + latency + non-empty reply
  4. streaming FAST    - SSE works? (the frontend types text live on this)
  5. JSON mode         - can it return parseable JSON?
  6. report-shaped     - THE REAL PAYLOAD: same shape as llm_client.chat_json
                         (no max_tokens), asserting a complete report JSON comes
                         back. If this one fails the end-of-session report
                         silently falls back to the local template - the app
                         still "works", which is exactly why it needs testing.

Design rule: this script must NEVER crash with a raw TypeError. Any odd
response shape (e.g. `choices: null`) is reported together with the body,
because a crash hides the very evidence needed to diagnose it.
For picking a working STRONG_MODEL, run tests/verify_strong_model.py.

Usage (PowerShell)
  $env:MS_TOKEN = "ms-...."          # your ModelScope write-permission token
  & "<venv>\\Scripts\\python.exe" "D:\\WorkBuddy_Project\\MindForge\\tests\\verify_llm_endpoint.py"

  If MS_TOKEN is unset the script asks for it and hides what you type.
  Override the endpoint with LLM_BASE_URL / FAST_MODEL / STRONG_MODEL.

Exit code 0 = all passed, 1 = something failed.
"""
import json
import os
import re
import sys
import time

try:
    import httpx
except ImportError:
    print("httpx is not installed. Run:")
    print('  & "<venv>\\Scripts\\python.exe" -m pip install httpx')
    sys.exit(1)

BASE = os.environ.get("LLM_BASE_URL", "https://api-inference.modelscope.cn/v1")
FAST_MODEL = os.environ.get("FAST_MODEL", "deepseek-ai/DeepSeek-V4.1-Flash")
STRONG_MODEL = os.environ.get("STRONG_MODEL", "deepseek-ai/DeepSeek-V4-Pro")
TOKEN = os.environ.get("MS_TOKEN", "").strip()

if not TOKEN:
    import getpass
    TOKEN = getpass.getpass("ModelScope token (ms-...): ").strip()

HEAD = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}
RESULTS = []


def record(name, ok, detail):
    RESULTS.append((name, ok, detail))
    print("   %s %s" % ("PASS" if ok else "FAIL", name))
    if detail:
        print("        %s" % detail)


def mask(s, keep=8):
    return s if len(s) <= keep else s[:keep] + "..." + s[-4:]


def strip_fence(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


def parse_chat(resp):
    """Never raises. (shape_ok, info). On an odd shape, info carries the raw body."""
    try:
        d = resp.json()
    except Exception as e:  # noqa: BLE001
        return False, {"why": "body is not JSON (%s)" % type(e).__name__,
                       "raw": resp.text[:400]}
    if not isinstance(d, dict):
        return False, {"why": "JSON body is %s, not an object" % type(d).__name__,
                       "raw": resp.text[:400]}
    choices = d.get("choices")
    if not choices:
        shown = (d if len(json.dumps(d)) < 400
                 else {"keys": sorted(d.keys()), "usage": d.get("usage")})
        return False, {"why": "choices is %s" % ("null" if choices is None else repr(choices)),
                       "raw": json.dumps(shown, ensure_ascii=False)[:400]}
    ch = choices[0] or {}
    msg = ch.get("message") or {}
    return True, {"content": strip_fence(msg.get("content")),
                  "finish": ch.get("finish_reason"),
                  "reasoning": bool(msg.get("reasoning_content")),
                  "usage": d.get("usage") or {}}


print("=" * 68)
print("MindForge LLM preflight")
print("=" * 68)
print("  base_url  : %s" % BASE)
print("  token     : %s (len=%d)" % (mask(TOKEN), len(TOKEN)))
print("  fast      : %s" % FAST_MODEL)
print("  strong    : %s" % STRONG_MODEL)
print()

# ---------------------------------------------------------------- 1. models
print("[1] model list /v1/models  (public, needs no auth)")
try:
    r = httpx.get(BASE.rstrip("/") + "/models", timeout=30)
    ids = [m.get("id") for m in r.json().get("data", [])] if r.status_code == 200 else []
    ok_f = FAST_MODEL in ids
    ok_s = STRONG_MODEL in ids
    record("FAST_MODEL exists  (%s)" % FAST_MODEL, ok_f,
           "" if ok_f else "not in the %d-model list" % len(ids))
    record("STRONG_MODEL exists (%s)" % STRONG_MODEL, ok_s,
           "" if ok_s else "not in the %d-model list" % len(ids))
    if not (ok_f and ok_s):
        print("        deepseek ids currently served: %s"
              % [i for i in ids if "deepseek" in i.lower()])
except Exception as e:  # noqa: BLE001
    record("model list", False, "%s: %s" % (type(e).__name__, e))
print()


# ------------------------------------------------------- 2/3. non-stream
def non_stream(label, model):
    t0 = time.time()
    try:
        r = httpx.post(
            BASE.rstrip("/") + "/chat/completions",
            headers=HEAD,
            json={"model": model,
                  "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
                  "max_tokens": 300},
            timeout=90,
        )
        dt = time.time() - t0
        if r.status_code != 200:
            record(label, False, "http %s | %s" % (r.status_code, r.text[:180]))
            return
        shape_ok, info = parse_chat(r)
        if not shape_ok:
            record(label, False, "%.2fs | %s" % (dt, info["why"]))
            print("        body: %s" % info["raw"])
            return
        note = ""
        if info["reasoning"]:
            note += " | HAS reasoning_content -> this is a REASONING model"
        if info["finish"] == "length":
            note += " | TRUNCATED at max_tokens=300"
        if not info["content"]:
            # http 200 但内容为空：推理型模型把预算全花在 reasoning 上，或被截断。
            # 这种“成功”必须判失败 —— 否则会掩盖线上报告静默降级为模板。
            record(label, False,
                   "%.2fs | EMPTY CONTENT (finish_reason=%s) | usage=%s%s"
                   % (dt, info["finish"], info["usage"], note))
            return
        record(label, True, "%.2fs | finish_reason=%s | reply=%r | usage=%s%s"
               % (dt, info["finish"], info["content"][:40], info["usage"], note))
    except Exception as e:  # noqa: BLE001
        record(label, False, "%.2fs | %s: %s" % (time.time() - t0, type(e).__name__, e))


print("[2] non-stream FAST_MODEL (interviewer / coach)")
non_stream("non-stream FAST", FAST_MODEL)
print()
print("[3] non-stream STRONG_MODEL (analyst report)")
non_stream("non-stream STRONG", STRONG_MODEL)
print()

# ------------------------------------------------------------ 4. streaming
print("[4] streaming FAST_MODEL (the live typewriter effect depends on this)")
try:
    t0 = time.time()
    chunks, text, first_at = 0, [], None
    finish = None
    with httpx.stream(
        "POST",
        BASE.rstrip("/") + "/chat/completions",
        headers=HEAD,
        json={"model": FAST_MODEL,
              "messages": [{"role": "user",
                            "content": "Count from 1 to 10, single spaces, nothing else."}],
              "stream": True},
        timeout=120,
    ) as resp:
        if resp.status_code != 200:
            body = resp.read().decode("utf-8", "replace")
            record("streaming", False, "http %s | %s" % (resp.status_code, body[:180]))
        else:
            for line in resp.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    choice = json.loads(data)["choices"][0]
                    delta = (choice.get("delta") or {}).get("content")
                    finish = choice.get("finish_reason") or finish
                except Exception:  # noqa: BLE001
                    continue
                if delta:
                    if first_at is None:
                        first_at = time.time() - t0
                    chunks += 1
                    text.append(delta)
    joined = "".join(text)
    if not joined.strip():
        record("streaming", False, "0 chunks received (streaming unsupported or buffered)")
    else:
        record("streaming", True,
               "chunks=%d | first chunk @ %.2fs | total %.2fs | finish=%s | text=%r"
               % (chunks, first_at or 0, time.time() - t0, finish, joined[:60]))
        if chunks < 4:
            print("        NOTE: few chunks - the platform may buffer the stream.")
        if finish == "length":
            print("        WARNING: finish_reason=length -> the reply was CUT OFF at the output")
            print("                 cap (no max_tokens is sent, so this is the platform default).")
            print("                 On a reasoning model the reasoning shares that budget, so")
            print("                 real interviewer replies could end mid-sentence.")
except Exception as e:  # noqa: BLE001
    record("streaming", False, "%s: %s" % (type(e).__name__, e))
print()

# ---------------------------------------------------------------- 5. json
print("[5] JSON output (the analyst report is parsed as JSON)")
try:
    r = httpx.post(
        BASE.rstrip("/") + "/chat/completions",
        headers=HEAD,
        json={"model": STRONG_MODEL,
              "messages": [{"role": "user",
                            "content": 'Return exactly this JSON, no markdown fence, '
                                       'no extra words: {"score": 7, "note": "ok"}'}],
              "max_tokens": 300},
        timeout=90,
    )
    if r.status_code != 200:
        record("json output", False, "http %s | %s" % (r.status_code, r.text[:180]))
    else:
        shape_ok, info = parse_chat(r)
        if not shape_ok:
            record("json output", False, info["why"])
            print("        body: %s" % info["raw"])
        elif not info["content"]:
            record("json output", False,
                   "EMPTY CONTENT (finish_reason=%s) | usage=%s"
                   % (info["finish"], info["usage"]))
        else:
            try:
                obj = json.loads(info["content"])
                record("json output", isinstance(obj, dict), "parsed OK -> %s" % obj)
            except json.JSONDecodeError:
                record("json output", False, "not valid JSON: %r" % info["content"][:120])
except Exception as e:  # noqa: BLE001
    record("json output", False, "%s: %s" % (type(e).__name__, e))
print()

# ------------------------------- 6. THE REAL REPORT CALL (exact app payload)
# backend/services/llm_client.py 的 chat_json 发的是：
#   {"model":..., "messages":[...], "stream": False, "temperature": 0.6}
# 注意它 **不传 max_tokens** —— 输出预算完全由平台默认值决定。
# 分析师 prompt 只要求一个小 JSON（scores 3 个整数 + 3-5 条建议 + 一句总评）。
print("[6] report-shaped call - the exact payload shape the app uses")
try:
    fake_transcript = (
        "面试官：请做一分钟自我介绍。\n"
        "用户：然后我是钟同学，然后主要是做过校园社团的公众号运营，然后半年涨了三千粉。\n"
        "面试官：具体说说你的方法。\n"
        "用户：主要是内容选题吧，然后做了几期专题，嗯，还有就是跟其他社团互推。\n"
        "面试官：如果粉丝增长停滞了你会怎么办？\n"
        "用户：嗯……我会先看数据，然后看是哪类内容不行，然后再调整。"
    )
    msgs = [
        {"role": "system", "content": (
            '你是资深表达力分析师。请输出纯 JSON，不要任何解释或前缀，字段如下：'
            'scores{language,logic,emotion} 各为 1-5 整数；'
            'improvements 为 3-5 条字符串（每条 ≤40 字）；'
            'summary 为一句话（≤30 字）。')},
        {"role": "user", "content": (
            "场景：校招　档位：standard\n"
            "本地客观统计：填充词 38 次/千字，平均句长 21 字，停顿/语速 normal，完成轮次 3。\n\n"
            "完整对话记录：\n" + fake_transcript)},
    ]
    t0 = time.time()
    r = httpx.post(
        BASE.rstrip("/") + "/chat/completions",
        headers=HEAD,
        json={"model": STRONG_MODEL, "messages": msgs, "stream": False, "temperature": 0.6},
        timeout=180,
    )
    dt = time.time() - t0
    if r.status_code != 200:
        record("report-shaped call", False, "http %s | %s" % (r.status_code, r.text[:180]))
    else:
        shape_ok, info = parse_chat(r)
        if not shape_ok:
            record("report-shaped call", False, "%.1fs | %s" % (dt, info["why"]))
            print("        body: %s" % info["raw"])
            print("        -> if this says 'choices is null', the model accepted the request but")
            print("           produced nothing usable. Run tests/verify_strong_model.py to pick")
            print("           a STRONG_MODEL that actually writes the report.")
        else:
            if info["reasoning"]:
                print("        NOTE: reasoning_content present -> reasoning model; its reasoning")
                print("              also consumes the output budget")
            content = info["content"]
            if not content:
                record("report-shaped call", False,
                       "%.1fs | EMPTY CONTENT (finish_reason=%s) | usage=%s -> the report would "
                       "SILENTLY fall back to the local template" % (dt, info["finish"], info["usage"]))
            else:
                try:
                    obj = json.loads(content)
                    missing = [k for k in ("scores", "improvements", "summary") if k not in obj]
                    record("report-shaped call", not missing,
                           "%.1fs | finish_reason=%s | keys=%s | output_tokens=%s | latency_budget=%s"
                           % (dt, info["finish"], sorted(obj.keys()),
                              info["usage"].get("completion_tokens"),
                              "OK" if dt < 25 else "TIGHT - raise TIMEOUT_MS"))
                    if missing:
                        print("        missing required keys: %s" % missing)
                    elif info["finish"] == "length":
                        print("        WARNING: truncated (finish_reason=length) - the JSON above "
                              "parsed only by luck")
                except Exception as e:  # noqa: BLE001
                    record("report-shaped call", False,
                           "%.1fs | not JSON (%s): %r" % (dt, type(e).__name__, content[:150]))
except Exception as e:  # noqa: BLE001
    record("report-shaped call", False, "%s: %s" % (type(e).__name__, e))
print()

# --------------------------------------------------------------- summary
print("=" * 68)
passed = sum(1 for _, ok, _ in RESULTS if ok)
print("SUMMARY: %d/%d passed" % (passed, len(RESULTS)))
for name, ok, _ in RESULTS:
    print("   [%s] %s" % ("x" if ok else " ", name))
print("=" * 68)
if passed == len(RESULTS):
    print("All good -> go create the Studio and upload dist/MindForge_studio.zip")
else:
    failed = [n for n, ok, _ in RESULTS if not ok]
    print("Failed: %s" % ", ".join(failed))
    print()
    print("Read the 'body:' lines above - they are the actual upstream response.")
    print("  'choices is null'                       -> the model produced no usable completion")
    print("  EMPTY CONTENT + HAS reasoning_content   -> reasoning model ate the whole budget;")
    print("                                             run tests/verify_strong_model.py")
    print("  401 'Authentication failed'             -> only if the TOKEN itself is wrong; the")
    print("                                             three-way comparison (real / fake / none)")
    print("                                             is how you tell. A token that works in your")
    print("                                             own terminal is not the problem here.")
sys.exit(0 if passed == len(RESULTS) else 1)
