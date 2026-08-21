// voice_mode.js —— 实时语音对话（豆包式体验，零费用）：
//   Vosk 离线 ASR（说→转文字） + DeepSeek 流式回答 + 浏览器 speechSynthesis 播报
//   流程闭环：聆听中（波形随真实音量跳动）→ 识别到句子（停顿 0.9s 判定说完）→ 思考中 → 播报中（波形随语音律动，点击可打断）→ 自动续听
import { ASR } from "./asr.js";
import { EmotionEngine } from "./emotion_engine.js";
import { Storage } from "./storage.js";
import { MetricsEngine } from "./metrics_engine.js";
import { ApiClient } from "./api_client.js";

const $ = (s) => document.querySelector(s);
const SCENE_LABEL = { postgrad_interview: "考研复试", campus_recruit: "校招面试" };
const WAVE_BARS = 28;
let running = false;        // 语音会话进行中
let listening = false;      // 正在聆听
let speaking = false;       // 播报中
let history = [];           // 对话历史 [{role, content}]
let voskBuffer = "";        // 当前轮识别文本（累积）
let pcmChunks = [];         // 当前轮录音 PCM 帧（16k 单声道，用于精准识别）
let submitting = false;     // 正在上传识别
let turnTimer = null;
let voiceCtrl = null;       // SSE AbortController
let waveBars = [];
let waveRaf = 0;
let toastTimer = 0;
let voiceCtx = null;        // 训练上下文 {scene, level, profile}，由统一开始界面注入

/* ---------- TTS（浏览器本地语音合成，免费离线） ----------
   三种施压档位对应不同音色/语速/音调：
   - 温和 gentle：温柔女声（如晓晓/婷婷），语速稍慢、音调偏高，营造安全感
   - 标准 standard：中性专业声（如云希/晓伊），正常语速
   - 高压 hard：低沉严肃声（如云扬/康康），语速稍快、音调偏低，制造压力感
   具体可用音色取决于系统已安装的语音，找不到首选时自动回退到任意中文声。 */
const LEVEL_VOICE = {
  gentle: ["xiaoxiao", "xiaoyi", "tingting", "huihui", "yaoyao"],
  standard: ["yunxi", "xiaoyi", "yunyang", "xiaoxiao"],
  hard: ["yunyang", "kangkang", "yunjian", "cheng", "yunxi"],
};
const LEVEL_TTS = {
  gentle: { rate: 0.95, pitch: 1.08 },
  standard: { rate: 1.0, pitch: 1.0 },
  hard: { rate: 1.06, pitch: 0.88 },
};
function pickVoiceForLevel(level) {
  try {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    const zh = vs.filter((v) => /^zh[-_]CN/i.test(v.lang));
    if (!zh.length) return null;
    const prefs = LEVEL_VOICE[level] || LEVEL_VOICE.standard;
    for (const p of prefs) {
      const hit = zh.find((v) => v.name.toLowerCase().includes(p));
      if (hit) return hit;
    }
    return zh[0];
  } catch { return null; }
}
function speak(text, onEnd, level) {
  if (!("speechSynthesis" in window)) { onEnd && onEnd(); return; }
  const u = new SpeechSynthesisUtterance(text || "");
  const v = pickVoiceForLevel(level);
  if (v) { u.voice = v; u.lang = v.lang; }
  u.lang = u.lang || "zh-CN";
  const tune = LEVEL_TTS[level] || LEVEL_TTS.standard;
  u.rate = tune.rate; u.pitch = tune.pitch;
  u.onend = () => { speaking = false; onEnd && onEnd(); };
  u.onerror = () => { speaking = false; onEnd && onEnd(); };
  speaking = true;
  try { speechSynthesis.cancel(); } catch {}
  speechSynthesis.speak(u);
}

/* ---------- 状态光环 + 波形条 ---------- */
const ORB_EMOJI = { idle: "🎙️", listen: "🎧", think: "💭", speak: "🔊", err: "⚠️" };
function setStatus(kind, text) {
  const el = $("#voiceStatus");
  el.textContent = text;
  el.className = "vw-status" + (kind === "err" ? " err" : "");
  const orb = $("#voiceOrb");
  orb.className = "vw-orb " + kind;
  orb.textContent = ORB_EMOJI[kind] || "🎙️";
}
function _barAmp() {
  // 返回 0..1 的振幅：聆听=真实麦克风音量（数据不可用时模拟律动保证有反馈）；播报=模拟语音律动；其他=0
  if (listening) {
    const db = EmotionEngine.liveRms();
    if (db <= -59) return 0.3 + 0.25 * Math.sin(performance.now() / 150);   // 无音量数据 → 模拟跳动
    return Math.max(0, Math.min(1, (db + 60) / 50));
  }
  if (speaking) return 0.5 + 0.3 * Math.sin(performance.now() / 140);
  return 0;
}
function waveLoop() {
  if (!running) { cancelAnimationFrame(waveRaf); waveRaf = 0; return; }
  const amp = _barAmp();
  const t = performance.now() / 160;
  waveBars.forEach((b, i) => {
    // 有机律动：每个条有独立相位，叠加真实振幅
    const phase = Math.sin(t + i * 0.55) * 0.5 + 0.5;
    const h = amp > 0 ? 6 + (8 + 42 * amp) * (0.25 + 0.75 * phase) : 6;
    b.style.height = Math.round(h) + "px";
  });
  waveRaf = requestAnimationFrame(waveLoop);
}
function buildWave() {
  const box = $("#voiceWave");
  box.innerHTML = "";
  waveBars = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    const b = document.createElement("span");
    b.className = "bar" + (i % 2 ? " alt" : "");
    b.style.height = "6px";
    box.append(b);
    waveBars.push(b);
  }
}
function resetWave() {
  waveBars.forEach((b) => { b.style.height = "6px"; });
}
function addBubble(role, text, live) {
  const w = document.createElement("div");
  w.className = "msg" + (role === "user" ? " user" : "");
  const av = document.createElement("div");
  av.className = "av " + (role === "user" ? "usr" : "int");
  av.textContent = role === "user" ? "你" : "陪";
  const b = document.createElement("div");
  b.className = "bubble " + (role === "user" ? "usr" : "int");
  b.textContent = text || "";
  w.append(av, b);
  $("#voiceChat").append(w);
  scrollV();
  if (live) { av.style.visibility = "hidden"; b.classList.add("live"); }
  return b;
}
function scrollV() { const c = $("#voiceChat"); c.scrollTop = c.scrollHeight; }

/* ---------- 对话闭环 ---------- */
function startListening() {
  if (!running || listening || speaking || ASR.active) return;
  listening = true;
  voskBuffer = "";
  pcmChunks = [];   // 重新开始录音采集
  setStatus("listen", "聆听中…");
  ASR.start({
    onInterim: (txt) => { $("#voicePartial").textContent = txt || ""; },   // vosk 已回传累加文本，直接展示
    onFinal: () => { /* 语音对话用 onTurn 自动轮转，无需手动停止 */ },
    onTurn: (text) => handleTurn(text),
    onFrame: (chunk) => { if (listening && !submitting) pcmChunks.push(chunk.slice()); },
    onState: (s, msg) => {
      if (s === "error") { stopAll(); setStatus("err", msg || "识别出错，已停止"); }
      else if (s === "loading") setStatus("listen", "加载语音模型中…");
      else if (s === "on") setStatus("listen", "聆听中…");
    },
  });
}
function handleTurn(text) {
  const t = (text || "").trim();
  if (!t || !running) return;
  voskBuffer = (voskBuffer ? voskBuffer + t : t).trim();
  $("#voicePartial").textContent = voskBuffer;
  clearTimeout(turnTimer);
  // 停顿 0.9s 未继续说 → 判定本轮说完，提交识别
  turnTimer = setTimeout(() => {
    if (!running) return;
    const voskText = voskBuffer.trim();
    voskBuffer = "";
    $("#voicePartial").textContent = "";
    if (!voskText) { if (!listening) startListening(); return; }
    submitTurn(voskText);
  }, 900);
}
/* 精准识别：把本轮录音上传本机 whisper，替换 vosk 文本；失败回退 vosk 文本 */
async function submitTurn(voskText) {
  listening = false;
  submitting = true;
  ASR.stop();
  setStatus("think", "正在识别…");
  let text = voskText;
  try {
    const blob = buildWav(pcmChunks);
    if (blob.size > 0) {
      const fd = new FormData();
      fd.append("file", blob, "turn.wav");
      const r = await fetch("/api/asr/recognize", { method: "POST", body: fd });
      if (r.ok) {
        const d = await r.json();
        if (d.text && d.text.trim()) text = d.text.trim();
      }
    }
  } catch { /* whisper 不可用时用 vosk 文本 */ }
  finally { submitting = false; pcmChunks = []; }
  if (!running) return;
  const txt = (text || voskText).trim();
  if (!txt) { setStatus("err", "未识别到语音"); if (running) startListening(); return; }
  askAI(txt);
}
/* 16k 单声道 16bit PCM → WAV Blob */
function buildWav(chunks) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  if (!n) return new Blob([]);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); wstr(8, "WAVE");
  wstr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wstr(36, "data"); v.setUint32(40, n * 2, true);
  let off = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++) {
    const s = Math.max(-1, Math.min(1, c[i]));
    v.setInt16(off, s * 32767, true); off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

async function askAI(text) {
  history.push({ role: "user", content: text });
  addBubble("user", text);
  await requestAIReply();
}
/* 发起/重发 AI 回复请求（失败时显示重试按钮，与文本训练体验一致） */
async function requestAIReply() {
  if (!running) return;
  const last = history[history.length - 1];
  if (!last || last.role !== "user" || !(last.content || "").trim()) return;
  hideVoiceBanner();
  setStatus("think", "正在思考…");
  const ab = addBubble("ai", "", true);
  let full = "";
  const ctrl = new AbortController();
  voiceCtrl = ctrl;
  try {
    const res = await fetch("/api/voice/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: history.slice(0, -1),
        scene: (voiceCtx && voiceCtx.scene) || "",
        level: (voiceCtx && voiceCtx.level) || "",
        profile: (voiceCtx && voiceCtx.profile) || undefined,   // 无背景时不发送该字段（undefined 会被 JSON.stringify 丢弃）
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error("gen_failed");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();
      for (const block of parts) {
        let ev = "message", dataStr = "";
        block.split("\n").forEach((l) => {
          if (l.startsWith("event:")) ev = l.slice(6).trim();
          else if (l.startsWith("data:")) dataStr += l.slice(5).trim();
        });
        if (!dataStr) continue;
        let d; try { d = JSON.parse(dataStr); } catch { continue; }
        if (ev === "error") throw new Error(d.message || "出错了");
        if (typeof d.delta === "string") { full += d.delta; ab.textContent = full; scrollV(); }
        else if (d.done) { full = d.full || full; ab.textContent = full; scrollV(); }
      }
    }
  } catch (e) {
    // 用户主动结束（abort）→ 静默；网络超时/请求失败 → 提供重试
    if (!running) return;
    if (ab.parentElement) ab.parentElement.remove();
    setStatus("err", "网络超时或请求失败");
    voiceBanner("语音对话请求失败，请检查网络后重试", () => requestAIReply());
    return;
  }
  finally { voiceCtrl = null; }
  if (!full) {
    if (!running) return;
    if (ab.parentElement) ab.parentElement.remove();
    setStatus("err", "没有收到回复");
    voiceBanner("没有收到 AI 回复，请重试", () => requestAIReply());
    return;
  }
  history.push({ role: "assistant", content: full });
  setStatus("speak", "播报中…（点击可打断）");
  const lvl = (voiceCtx && voiceCtx.level) || "standard";
  speak(full, () => { if (running) startListening(); }, lvl);
}

/* ---------- 打断：播报中点击状态栏 → 停止朗读并立即续听 ---------- */
function interrupt() {
  if (!speaking) return;
  try { speechSynthesis.cancel(); } catch {}
  speaking = false;
  if (running) startListening();
}

/* ---------- 生命周期 ---------- */
function startAll() {
  if (running) return;
  running = true;
  history = [];
  hideVoiceBanner();
  $("#voiceChat").innerHTML = "";
  $("#voicePartial").textContent = "";
  EmotionEngine.start();   // 启动音量监测（驱动波形；失败不影响识别）
  waveRaf = requestAnimationFrame(waveLoop);
  // 第一句话铁律：开场先请面试者做自我介绍（可点明场景与档位语气）
  let openLine = "你好，我是你的语音陪练。首先，请先介绍一下你自己，挑你最想让我了解的两三点。";
  if (voiceCtx && voiceCtx.scene) {
    const label = SCENE_LABEL[voiceCtx.scene] || voiceCtx.scene;
    openLine = "你好，我是你的语音陪练，我们来进行" + label + "模拟。首先，请先介绍一下你自己，挑你最想让我了解的两三点。";
  }
  addBubble("ai", openLine);
  $("#voiceToggle").textContent = "结束对话";
  startListening();
}
function stopAll() {
  const wasRunning = running;
  running = false;
  clearTimeout(turnTimer);
  hideVoiceBanner();
  if (speaking) { try { speechSynthesis.cancel(); } catch {} speaking = false; }
  if (ASR.active) ASR.stop();
  if (voiceCtrl) { try { voiceCtrl.abort(); } catch {} voiceCtrl = null; }
  listening = false;
  submitting = false;
  voskBuffer = "";
  pcmChunks = [];
  $("#voicePartial").textContent = "";
  EmotionEngine.stop();
  resetWave();
  setStatus("idle", "已结束");
  $("#voiceToggle").textContent = "开始对话";
  // 结束一段真实语音对话 → 先弹"分析师正在生成报告…"等待窗口（与文本训练一致），
  // 再异步生成成长报告（仅本地归档，供数据看板展示趋势）
  if (wasRunning && history.some((m) => m.role === "user")) {
    showReportLoading();
    archiveVoiceReport();
  }
}
function openVoice() {
  $("#landing").style.display = "none";
  $("#voiceView").style.display = "flex";
  resetWave();
  setStatus("idle", "点击「开始对话」即可交谈");
}
/* 由 app.js 的统一开始界面调用：携带场景/档位/背景上下文进入语音训练 */
export function launchVoice(ctx) {
  voiceCtx = ctx || null;
  openVoice();
}
function closeVoice() {
  stopAll();
  $("#voiceView").style.display = "none";
  $("#landing").style.display = "block";
}

/* ---------- 轻量 toast（与 app.js 的 toast 视觉一致） ---------- */
function toastMsg(m) {
  const t = $("#toast"); if (!t) return;
  t.textContent = m; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}
/* 网络超时/请求失败 → 复用全局 #banner 显示重试按钮（与文本训练体验一致） */
function voiceBanner(msg, onRetry) {
  const b = $("#banner"); if (!b) return;
  $("#bannerMsg").textContent = msg || "请求失败，请重试";
  const rb = $("#bannerRetry");
  if (rb) { rb.style.display = onRetry ? "" : "none"; rb.onclick = onRetry || null; }
  b.classList.add("show");
}
function hideVoiceBanner() {
  const b = $("#banner"); if (b) b.classList.remove("show");
}
/* 结束语音对话 → 生成报告前的等待窗口：与文本训练完全一致（复用 #reportLoading / #reportOverlay） */
function showReportLoading() {
  const l = $("#reportLoading"); if (l) l.style.display = "flex";
  const o = $("#reportOverlay"); if (o) o.classList.add("show");
}
/* 离线 / API 失败时的本地兜底报告（三维度启发式，与报告结构一致） */
function fallbackVoiceReport(lm) {
  const f = lm.filler_per_k, al = lm.avg_sentence_len;
  const language = f <= 15 ? 4 : f <= 30 ? 3 : 2;
  const logic = (al >= 12 && al <= 38) ? 4 : (al >= 8 && al <= 46) ? 3 : 2;
  const emotion = lm.nerve ? 3 : 4;
  const imp = [];
  if (f > 30) imp.push("填充词偏多，先亮观点再展开细节。");
  if (al && (al < 10 || al > 42)) imp.push("句长" + (al < 10 ? "偏碎" : "偏长") + "，试着一句讲一个点。");
  if (lm.nerve) imp.push("放慢语速、句间留 2 秒，会更稳。");
  if (!imp.length) imp.push("表达流畅、结构清晰，保持这个节奏。");
  return {
    scores: { language, logic, emotion },
    improvements: imp.slice(0, 4),
    summary: "语音对话完成，表达有骨架，继续打磨节奏。",
    local_stats: lm,
  };
}
/* 结束语音对话后生成并持久化报告（mode:'voice'，数据看板可读取） */
async function archiveVoiceReport() {
  try {
    const userTurns = history.filter((m) => m.role === "user");
    if (!userTurns.length) return;
    let fillerSum = 0, lenSum = 0, nerve = false;
    userTurns.forEach((m) => {
      const mm = MetricsEngine.compute(m.content || "");
      fillerSum += mm.filler_per_k; lenSum += mm.avg_sentence_len;
      if (MetricsEngine.detectNerve(m.content || "")) nerve = true;
    });
    const local_metrics = {
      filler_per_k: Math.round(fillerSum / userTurns.length),
      avg_sentence_len: Math.round(lenSum / userTurns.length),
      pause_est: "normal",
      turns: userTurns.length,
      nerve,
    };
    // 角色映射：user→user，assistant(陪练)→interviewer，供报告 prompt 拼装
    const transcript = history.map((m) => ({ role: m.role === "assistant" ? "interviewer" : "user", content: m.content || "" }));
    let report = null;
    try {
      const r = await ApiClient.generateReport({ session_id: "voice-" + Date.now(), scene: "voice", level: "standard", transcript, local_metrics });
      if (r && r.ok && r.data && r.data.scores) report = r.data;
    } catch { /* API 不可达 → 本地兜底 */ }
    if (!report) report = fallbackVoiceReport(local_metrics);
    const transcriptFull = history.map((m) => ({ role: m.role, content: m.content || "" }));
    Storage.saveDraft({
      id: "voice-" + Date.now(),
      mode: "voice",
      scene: "voice",
      level: "standard",
      transcript: transcriptFull,
      metrics: local_metrics,
      advice: [],
      report,
      updatedAt: Date.now(),
    });
    // 结束即弹出成长报告：复用文本训练的报告弹层模板（由 app.js 的 mindforge:open-report 渲染）
    document.dispatchEvent(new CustomEvent("mindforge:open-report", {
      detail: {
        report,
        scene: "voice",
        level: "standard",
        advice: [],
        mode: "voice",
        transcript: transcriptFull,
        fromVoiceSession: true,   // 语音会话结束来源：关闭报告后回首页（看板回放不设此标记）
      },
    }));
    toastMsg("成长报告已生成");
  } catch (e) {
    // 兜底：意外错误也要关掉等待窗口，避免卡在"分析师正在生成报告…"
    const o = $("#reportOverlay"); if (o) o.classList.remove("show");
    const l = $("#reportLoading"); if (l) l.style.display = "none";
    toastMsg("报告生成失败，请稍后重试");
  }
}

export function initVoiceMode() {
  buildWave();
  $("#voiceBack").onclick = closeVoice;
  $("#voiceToggle").onclick = () => { running ? stopAll() : startAll(); };
  $("#voiceStatus").onclick = interrupt;
  $("#voiceOrb").onclick = interrupt;
  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};
}
