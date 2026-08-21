// api_client.js —— fetch 封装 + SSE 解析 + 超时/重试（AC-05 / AC-06）
const BASE = "";

async function _json(method, path, body, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      method, headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.detail || data;
      const code = err && err.error ? err.error : "gen_failed";
      return { ok: false, code, message: (err && err.message) || "请求失败", status: res.status };
    }
    return { ok: true, data };
  } catch (e) {
    clearTimeout(t);
    if (e.name === "AbortError") return { ok: false, code: "timeout", message: "网络超时，请检查网络后重试" };
    return { ok: false, code: "network", message: "网络异常，请重试" };
  }
}

export const ApiClient = {
  async startSession(scene, level) {
    return _json("POST", "/api/session/start", { scene, level }, 8000);
  },
  async pause() { return _json("POST", "/api/session/pause", {}, 5000); },
  async downgrade() { return _json("POST", "/api/session/downgrade", {}, 5000); },
  async setLevel(level) { return _json("POST", "/api/session/level", { level }, 5000); },
  async end() { return _json("POST", "/api/session/end", {}, 5000); },
  async coachFeedback(payload) { return _json("POST", "/api/coach/feedback", payload, 8000); },
  async generateReport(payload) { return _json("POST", "/api/report/generate", payload, 12000); },

  // 简历解析（上传 → 后端抽取文本；文件仅内存处理、不落盘）
  async extractProfile(file) {
    const fd = new FormData();
    fd.append("file", file);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(BASE + "/api/profile/extract", { method: "POST", body: fd, signal: ctrl.signal });
      clearTimeout(t);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail;
        const msg = typeof detail === "string" ? detail : (detail && detail.message) || "解析失败，请重试";
        return { ok: false, message: msg, status: res.status };
      }
      return { ok: true, data };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, message: e.name === "AbortError" ? "解析超时，请重试" : "网络异常，请重试" };
    }
  },

  // SSE 流式面试官（首字 < 2s；超时保留输入，可重试）
  interviewerStream({ session_id, scene, level, user_reply, transcript, profile, onDelta, onDone, onError, onNotice, firstByteMs = 2000 }) {
    const ctrl = new AbortController();
    let firstByte = false;
    const timer = setTimeout(() => {
      if (!firstByte) { ctrl.abort(); onError && onError({ code: "timeout", message: "网络超时，请检查网络后重试" }); }
    }, firstByteMs);

    (async () => {
      try {
        const res = await fetch(BASE + "/api/chat/interviewer", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id, scene, level, user_reply, transcript, profile }), signal: ctrl.signal,
        });
        if (!res.ok) {
          clearTimeout(timer);
          const data = await res.json().catch(() => ({}));
          onError && onError({ code: (data.detail && data.detail.error) || "gen_failed", message: (data.detail && data.detail.message) || "生成出错，请重试" });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop();
          for (const block of parts) {
            let ev = "message", dataStr = "";
            block.split("\n").forEach((line) => {
              if (line.startsWith("event:")) ev = line.slice(6).trim();
              else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
            });
            if (!dataStr) continue;
            if (!firstByte) { firstByte = true; clearTimeout(timer); }
            let data; try { data = JSON.parse(dataStr); } catch { continue; }
            if (ev === "error") { onError && onError(data); return; }
            if (typeof data.delta === "string") onDelta && onDelta(data.delta);
            else if (data.done) onDone && onDone(data.full);
            else if (data.notice) onNotice && onNotice(data);
          }
        }
        if (!firstByte) { clearTimeout(timer); onError && onError({ code: "gen_failed", message: "生成出错，请重试" }); }
      } catch (e) {
        clearTimeout(timer);
        if (!firstByte) onError && onError({ code: "timeout", message: "网络超时，请检查网络后重试" });
        else onError && onError({ code: "gen_failed", message: "生成出错，请重试" });
      }
    })();
    return ctrl; // 调用方可保存以便重试/中止
  },
};
