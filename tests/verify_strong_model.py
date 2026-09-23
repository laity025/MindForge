"""
MindForge - STRONG_MODEL candidate sweep  (run this on YOUR machine)
====================================================================

Why this exists
---------------
Preflight showed `deepseek-ai/DeepSeek-V4-Pro` returns HTTP 200 with an
unusable body for the analyst-report call, while `DeepSeek-V4.1-Flash`
returns real content. Both report `reasoning_content`, i.e. they are
reasoning models - and a reasoning model can burn the whole output budget
before it ever emits `content`.

The app calls `llm_client.chat_json` WITHOUT `max_tokens`, so the output
budget is whatever the platform defaults to. That is the variable being
tested here.

What it does
------------
  Phase A  every candidate gets ONE call shaped exactly like the app's
           report call (no max_tokens, temperature 0.6, a Chinese fake
           transcript + the real analyst output spec).
           => pass = complete JSON with scores / improvements / summary
  Phase B  the first failing candidate is re-probed WITH an explicit
           max_tokens, to separate "budget too small" from "model broken".
  Phase C  the streaming path (interviewer) is checked WITHOUT max_tokens,
           to make sure replies are not cut off mid-sentence.

Every unexpected response body is dumped, so an odd shape (e.g.
`choices: null`) is visible instead of guessed at.

Usage (PowerShell)
  $env:MS_TOKEN = "ms-...."
  & "<venv>\\Scripts\\python.exe" "D:\\WorkBuddy_Project\\MindForge\\tests\\verify_strong_model.py"

  Override the candidate list:
  $env:CANDIDATES = "model-a,model-b"
  Limit how many are tried (default 8):  $env:MAX_CANDIDATES = "4"

Exit code 0 = at least one candidate passed phase A, 1 = none did.
"""
import json
import os
import sys
import time

try:
    import httpx
except ImportError:
    print("httpx is not installed. Run:")
    print('  & "<venv>\\Scripts\\python.exe" -m pip install httpx')
    sys.exit(1)

BASE = os.environ.get("LLM_BASE_URL", "https://api-inference.modelscope.cn/v1").rstrip("/")
FAST_MODEL = os.environ.get("FAST_MODEL", "deepseek-ai/DeepSeek-V4.1-Flash")
CHAT = BASE + "/chat/completions"
TOKEN = os.environ.get("MS_TOKEN", "").strip()
if not TOKEN:
    import getpass
    TOKEN = getpass.getpass("ModelScope token (ms-...): ").strip()
HEAD = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}

# Ordered by expectation: verified-working first, then cheap/fast instruct-ish
# models, then the two known-troublesome ones for contrast.
DEFAULT_CANDIDATES = [
    "deepseek-ai/DeepSeek-V4.1-Flash",
    "Qwen/Qwen3.8-Flash-Next",
    "ZhipuAI/GLM-4.7-Flash",
    "stepfun-ai/Step-3.7-Flash",
    "meituan-longcat/LongCat-Flash-Lite",
    "deepseek-ai/DeepSeek-V4-Flash-0731",
    "MiniMax/MiniMax-M3",
    "mistralai/Mistral-Large-Instruct-2407",
    "deepseek-ai/DeepSeek-V4-Pro",
]
_env_cands = os.environ.get("CANDIDATES", "").strip()
CANDIDATES = ([c.strip() for c in _env_cands.split(",") if c.strip()]
              if _env_cands else DEFAULT_CANDIDATES)
MAX_C = int(os.environ.get("MAX_CANDIDATES", "12"))
CANDIDATES = CANDIDATES[:MAX_C]

# The report call exactly as backend/services/llm_client.py builds it:
# {"model", "messages", "stream": False, "temperature": 0.6}  -- no max_tokens
REPORT_MESSAGES = [
    {"role": "system", "content": (
        '你是资深表达力分析师。请输出纯 JSON，不要任何解释或前缀，字段如下：'
        'scores{language,logic,emotion} 各为 1-5 整数；'
        'improvements 为 3-5 条字符串（每条 ≤40 字）；'
        'summary 为一句话（≤30 字）。')},
    {"role": "user", "content": (
        "场景：校招　档位：standard\n"
        "本地客观统计：填充词 38 次/千字，平均句长 21 字，停顿/语速 normal，完成轮次 3。\n\n"
        "完整对话记录：\n"
        "面试官：请做一分钟自我介绍。\n"
        "用户：然后我是钟同学，然后主要是做过校园社团的公众号运营，然后半年涨了三千粉。\n"
        "面试官：具体说说你的方法。\n"
        "用户：主要是内容选题吧，然后做了几期专题，嗯，还有就是跟其他社团互推。\n"
        "面试官：如果粉丝增长停滞了你会怎么办？\n"
        "用户：嗯……我会先看数据，然后看是哪类内容不行，然后再调整。")},
]
REQUIRED_KEYS = ("scores", "improvements", "summary")


def strip_fence(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


def parse_chat(resp):
    """Never raises. Returns (shape_ok, info). Dumps the body when it is odd."""
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
        shown = d if len(json.dumps(d)) < 400 else {"keys": sorted(d.keys()), "usage": d.get("usage")}
        return False, {"why": "choices is %s" % ("null" if choices is None else repr(choices)),
                       "raw": json.dumps(shown, ensure_ascii=False)[:400],
                       "usage": d.get("usage") or {}}
    ch = choices[0] or {}
    msg = ch.get("message") or {}
    return True, {"content": strip_fence(msg.get("content")),
                  "finish": ch.get("finish_reason"),
                  "reasoning": bool(msg.get("reasoning_content")),
                  "usage": d.get("usage") or {}}


def report_call(model, max_tokens=None, timeout=180):
    payload = {"model": model, "messages": REPORT_MESSAGES,
               "stream": False, "temperature": 0.6}
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    t0 = time.time()
    r = httpx.post(CHAT, headers=HEAD, json=payload, timeout=timeout)
    return r, time.time() - t0


def grade(info):
    """Returns (ok, note). ok = usable analyst report."""
    content = info.get("content") or ""
    if not content:
        return False, "empty content (finish=%s)" % info.get("finish")
    try:
        obj = json.loads(content)
    except Exception as e:  # noqa: BLE001
        return False, "not JSON (%s): %r" % (type(e).__name__, content[:90])
    if not isinstance(obj, dict):
        return False, "JSON is %s, not an object" % type(obj).__name__
    missing = [k for k in REQUIRED_KEYS if k not in obj]
    if missing:
        return False, "JSON lacks %s -> %s" % (missing, sorted(obj.keys()))
    if info.get("finish") == "length":
        return False, "truncated (finish_reason=length) - parsed only by luck"
    return True, "keys=%s" % sorted(obj.keys())


print("=" * 72)
print("MindForge STRONG_MODEL candidate sweep")
print("=" * 72)
print("  endpoint   : %s" % CHAT)
print("  fast model : %s" % FAST_MODEL)
print("  candidates : %d" % len(CANDIDATES))
print()

# ------------------------------------------------ phase 0: does the id exist?
try:
    ids = [m.get("id") for m in httpx.get(BASE + "/models", timeout=30).json()["data"]]
    print("[0] /v1/models  (%d ids, public)" % len(ids))
    for c in CANDIDATES:
        print("   %s %s" % ("PASS" if c in ids else "FAIL", c))
    CANDIDATES = [c for c in CANDIDATES if c in ids]
    print("   -> %d candidates remain after the id check" % len(CANDIDATES))
except Exception as e:  # noqa: BLE001
    print("[0] /v1/models failed: %s: %s" % (type(e).__name__, e))
print()

# --------------------------------- phase A: the exact app payload, no max_tokens
print("[A] report-shaped call, no max_tokens (this is what the app sends)")
results = {}
for m in CANDIDATES:
    try:
        r, dt = report_call(m)
    except Exception as e:  # noqa: BLE001
        print("   FAIL %-42s transport %s: %s" % (m, type(e).__name__, e))
        results[m] = (False, "transport error")
        continue
    if r.status_code != 200:
        print("   FAIL %-42s http %s | %s" % (m, r.status_code, r.text[:110]))
        results[m] = (False, "http %s" % r.status_code)
        continue
    shape_ok, info = parse_chat(r)
    if not shape_ok:
        print("   FAIL %-42s %.1fs | %s" % (m, dt, info["why"]))
        print("        body: %s" % info["raw"])
        results[m] = (False, info["why"])
        continue
    ok, note = grade(info)
    tag = "PASS" if ok else "FAIL"
    print("   %s %-42s %.1fs | finish=%s | out_tokens=%s | reasoning=%s | %s"
          % (tag, m, dt, info["finish"], info["usage"].get("completion_tokens"),
             info["reasoning"], note))
    results[m] = (ok, note)

winners = [m for m in CANDIDATES if results.get(m, (False,))[0]]
print()

# ------------- phase B: is the first failure a budget problem or a broken model?
failures = [m for m in CANDIDATES if not results.get(m, (False,))[0]]
if failures:
    probe = failures[0]
    print("[B] %s failed -> re-probe WITH max_tokens=900" % probe)
    print("    (separates 'platform default budget too small' from 'model unusable')")
    try:
        r, dt = report_call(probe, max_tokens=900)
        if r.status_code != 200:
            print("    http %s | %s" % (r.status_code, r.text[:200]))
        else:
            shape_ok, info = parse_chat(r)
            if not shape_ok:
                print("    %.1fs | %s" % (dt, info["why"]))
                print("    body: %s" % info["raw"])
            else:
                ok, note = grade(info)
                print("    %s %.1fs | finish=%s | out_tokens=%s | reasoning=%s | %s"
                      % ("PASS" if ok else "FAIL", dt, info["finish"],
                         info["usage"].get("completion_tokens"), info["reasoning"], note))
                if ok:
                    print("    => the model CAN produce a report; the default output budget is the problem.")
                    print("       Fix: set max_tokens explicitly in the app, or keep this model but")
                    print("       ask ModelScope's support to raise the default. Easiest today: pick")
                    print("       a winner from phase A instead.")
    except Exception as e:  # noqa: BLE001
        print("    transport %s: %s" % (type(e).__name__, e))
    print()

# --------------------------- phase C: streaming with no max_tokens (interviewer)
print("[C] streaming %s WITHOUT max_tokens (interviewer replies must not be cut off)" % FAST_MODEL)
try:
    t0 = time.time()
    chunks, text, finish, first_at = 0, [], None, None
    with httpx.stream("POST", CHAT, headers=HEAD,
                      json={"model": FAST_MODEL,
                            "messages": [{"role": "user",
                                          "content": "用两句中文回答：你最大的优点是什么？"}],
                            "stream": True, "temperature": 0.9},
                      timeout=120) as resp:
        if resp.status_code != 200:
            body = resp.read().decode("utf-8", "replace")
            print("   FAIL http %s | %s" % (resp.status_code, body[:180]))
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
    print("   chunks=%d | first @ %.2fs | total %.2fs | finish=%s"
          % (chunks, first_at or 0, time.time() - t0, finish))
    print("   text: %r" % joined[:120])
    if not joined.strip():
        print("   FAIL: no text at all")
    elif finish == "length":
        print("   WARN: finish_reason=length -> the reply hit the output cap and was CUT OFF.")
        print("         On a reasoning model the reasoning shares this budget. If this happens")
        print("         in the app (which also sends no max_tokens), interviewer replies will end")
        print("         mid-sentence - consider a non-reasoning FAST_MODEL.")
    else:
        print("   PASS: streamed text, not truncated")
except Exception as e:  # noqa: BLE001
    print("   FAIL %s: %s" % (type(e).__name__, e))
print()

# --------------------------------------------------------------- summary
print("=" * 72)
if winners:
    best = winners[0]
    print("VERDICT: %d/%d candidates can produce the analyst report JSON." % (len(winners), len(CANDIDATES)))
    print("  usable   : %s" % ", ".join(winners))
    print("  unusable : %s" % (", ".join(failures) if failures else "(none)"))
    print()
    print("RECOMMENDED -> use the first winner (fastest of the passing ones):")
    print()
    print("  STRONG_MODEL = %s" % best)
    print()
    print("  ...unless a later candidate is clearly a better writer; watch the out_tokens")
    print("  and latency columns above. All winners are quota-equivalent (free daily pool).")
else:
    print("VERDICT: no candidate could produce the report JSON.")
    print("  Look at the phase A bodies above. If they all look like 'choices is null',")
    print("  the platform is rejecting this request shape - send the dump back for a look.")
print("=" * 72)
sys.exit(0 if winners else 1)
