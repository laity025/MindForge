"""
MindForge - LLM endpoint preflight  (run this on YOUR machine)
==============================================================

Deployment smoke test for whatever OpenAI-compatible endpoint you configured.
It exists because the assistant sandbox cannot authenticate against
ModelScope - only your own machine (or the deployed container) can give a
trustworthy verdict.

What it checks
  1. /v1/models        - do the two configured model ids actually exist?
  2. non-stream FAST   - basic call + latency
  3. non-stream STRONG - the analyst-report model + latency
  4. streaming FAST    - SSE works? (the frontend types text live on this)
  5. JSON mode         - can it return parseable JSON? (the report needs this)

Usage (PowerShell)
  $env:MS_TOKEN = "ms-...."          # your ModelScope write-permission token
  & "C:\\Users\\laity\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe" `
      "D:\\WorkBuddy_Project\\MindForge\\tests\\verify_llm_endpoint.py"

  If MS_TOKEN is unset the script asks for it and hides what you type.
  Override the endpoint with LLM_BASE_URL / FAST_MODEL / STRONG_MODEL.

Exit code 0 = all passed, 1 = something failed.
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
                  "max_tokens": 24},
            timeout=90,
        )
        dt = time.time() - t0
        if r.status_code != 200:
            record(label, False, "http %s | %s" % (r.status_code, r.text[:180]))
            return
        d = r.json()
        txt = (d["choices"][0]["message"].get("content") or "").strip()
        record(label, True, "http 200 | %.2fs | reply=%r | usage=%s"
               % (dt, txt[:40], d.get("usage")))
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
    with httpx.stream(
        "POST",
        BASE.rstrip("/") + "/chat/completions",
        headers=HEAD,
        json={"model": FAST_MODEL,
              "messages": [{"role": "user",
                            "content": "Count from 1 to 10, single spaces, nothing else."}],
              "max_tokens": 60, "stream": True},
        timeout=90,
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
                    delta = json.loads(data)["choices"][0]["delta"].get("content")
                except Exception:  # noqa: BLE001
                    continue
                if delta:
                    if first_at is None:
                        first_at = time.time() - t0
                    chunks += 1
                    text.append(delta)
    if chunks:
        record("streaming", True,
               "chunks=%d | first chunk @ %.2fs | total %.2fs | text=%r"
               % (chunks, first_at or 0, time.time() - t0, "".join(text)[:60]))
        if chunks < 4:
            print("        NOTE: very few chunks - the platform may be buffering the stream.")
    else:
        record("streaming", False,
               "0 chunks received (streaming may be unsupported or buffered)")
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
              "max_tokens": 80},
        timeout=90,
    )
    if r.status_code != 200:
        record("json output", False, "http %s | %s" % (r.status_code, r.text[:180]))
    else:
        content = r.json()["choices"][0]["message"]["content"].strip()
        try:
            obj = json.loads(content)
            record("json output", isinstance(obj, dict), "parsed OK -> %s" % obj)
        except json.JSONDecodeError:
            record("json output", False, "not valid JSON: %r" % content[:120])
except Exception as e:  # noqa: BLE001
    record("json output", False, "%s: %s" % (type(e).__name__, e))

# --------------------------------------------------------------- summary
print()
print("=" * 68)
passed = sum(1 for _, ok, _ in RESULTS if ok)
print("SUMMARY: %d/%d passed" % (passed, len(RESULTS)))
for name, ok, _ in RESULTS:
    print("   [%s] %s" % ("x" if ok else " ", name))
print("=" * 68)
if passed == len(RESULTS):
    print("All good -> go create the Studio and upload dist/MindForge_studio.zip")
else:
    print("Something failed. Fix it BEFORE deploying, then re-run this script.")
    print("Hint: 401 'Authentication failed' -> wrong/partial token, or no Alibaba")
    print("      Cloud account bound / real-name verification still pending.")
sys.exit(0 if passed == len(RESULTS) else 1)
