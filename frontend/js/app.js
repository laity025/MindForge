// app.js —— MindForge 前端主控（训练闭环 + 护栏 + 报告）
import { MetricsEngine } from "./metrics_engine.js";
import { TranscriptStore } from "./transcript_store.js";
import { Guardrail } from "./guardrail_state.js";
import { ApiClient } from "./api_client.js";
import { Storage } from "./storage.js";
import { ASR } from "./asr.js";
import { EmotionEngine } from "./emotion_engine.js";
import { initVoiceMode, launchVoice } from "./voice_mode.js";
import { openDashboard, closeDashboard } from "./dashboard.js";

/* ---------- 基础工具 ---------- */
const $ = (s) => document.querySelector(s);
const chatScroll = $("#chatScroll");
const toastEl = $("#toast");
const bannerEl = $("#banner");

let toastTimer, bannerTimer;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}
function banner(msg, onRetry) {
  $("#bannerMsg").textContent = msg;
  $("#bannerRetry").onclick = onRetry || null;
  $("#bannerRetry").style.display = onRetry ? "" : "none";
  bannerEl.classList.add("show");
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => bannerEl.classList.remove("show"), 6000);
}
function hideBanner() { bannerEl.classList.remove("show"); }
function scrollBottom() { chatScroll.scrollTop = chatScroll.scrollHeight; }

const LEVEL_COLOR = { gentle: "var(--lvl-easy)", standard: "var(--lvl-std)", hard: "var(--lvl-hard)" };
const LEVEL_LABEL = { gentle: "温和", standard: "标准", hard: "高压" };
const SCENE_LABEL = { postgrad_interview: "考研复试", campus_recruit: "校招面试" };

/* ---------- 运行状态 ---------- */
const state = { scene: null, level: null };
let sessionId = null;
let streaming = false;
let userPaused = false;
let streamCtrl = null;
let lastReq = null;
let partialBubble = null;
let resumePendingReq = null;
let currentProfile = null;   // 训练前背景信息（院校/专业/求职意向/简历文本），仅本地

/* ---------- 气泡渲染 ---------- */
function newBubble(role) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "user" : "");
  const av = document.createElement("div");
  av.className = "av " + (role === "user" ? "usr" : "int");
  av.textContent = role === "user" ? "你" : "面";
  const b = document.createElement("div");
  b.className = "bubble " + (role === "user" ? "usr" : "int");
  wrap.append(av, b); chatScroll.append(wrap); scrollBottom();
  return b;
}
function makeTyping() {
  const ind = document.createElement("span");
  ind.className = "typing";
  ind.innerHTML = "<span></span><span></span><span></span>";
  return ind;
}

/* ---------- 面试官流式发言 ---------- */
function interviewerSpeak(user_reply, transcript) {
  const req = {
    session_id: sessionId,
    scene: state.scene,
    level: Guardrail.getLevel(),
    user_reply: user_reply || "",
    transcript: transcript || [],
    profile: currentProfile || undefined,
  };
  lastReq = req;
  streaming = true;
  $("#guardBar").classList.add("busy");
  $("#userInput").disabled = true;

  const b = newBubble("int");
  partialBubble = b;
  const ind = makeTyping(); b.append(ind);
  let started = false;

  streamCtrl = ApiClient.interviewerStream({
    ...req,
    onDelta(d) { if (!started) { ind.remove(); started = true; } b.textContent += d; scrollBottom(); },
    onDone(full) {
      b.textContent = full; partialBubble = null;
      streaming = false; $("#guardBar").classList.remove("busy"); $("#userInput").disabled = false;
      TranscriptStore.pushInterviewer(full);
      checkHardLimits();
    },
    onError(err) {
      if (userPaused) return; // 用户主动暂停导致的中断，忽略
      streaming = false; $("#guardBar").classList.remove("busy"); $("#userInput").disabled = false;
      if (partialBubble) { partialBubble.parentElement.remove(); partialBubble = null; }
      banner(err.message || "生成出错，请重试", () => {
        hideBanner();
        toast("正在重新连接…");   // 立即反馈，避免"点了没反应"的误判
        interviewerSpeak(req.user_reply, req.transcript);   // 重新发起请求 = 重新测试连通性
      });
    },
    onNotice(n) { toast(n.message); },
  });
}

/* ---------- 用户作答 ---------- */
async function sendUser() {
  if (streaming || userPaused) return;
  const ta = $("#userInput");
  const text = ta.value.trim();
  if (!text) { // AC-03 空提交拦截
    ta.classList.add("shake"); setTimeout(() => ta.classList.remove("shake"), 320);
    toast("请输入内容后提交"); ta.focus(); return;
  }
  ta.value = ""; ta.style.height = "auto";

  newBubble("user").textContent = text;
  const m = MetricsEngine.compute(text);
  MetricsEngine.render(m, { filler: $("#mFiller"), dotFiller: $("#dotFiller"), len: $("#mLen"), dotLen: $("#dotLen"), pace: $("#mPace"), dotPace: $("#dotPace") });
  TranscriptStore.pushUser(text, m);
  Guardrail.incTurn();

  // 教练建议（与面试官并行，互不阻塞，FR-04）
  ApiClient.coachFeedback({ user_reply: text, transcript: TranscriptStore.getTranscript(), metrics: m })
    .then((r) => {
      if (r.ok && Array.isArray(r.data.advice) && r.data.advice.length) renderAdvice(r.data.advice);
      else renderAdvice(fallbackAdvice(text, m));   // 模型偶发返回空建议 → 规则兜底并记录，报告不显示"无"
    })
    .catch(() => renderAdvice(fallbackAdvice(text, m)));

  // 高压反噬检测（AC-08）
  if (Guardrail.getLevel() === "hard" && MetricsEngine.detectRebound(text)) {
    showRebound();
  }

  // 面试官追问
  interviewerSpeak(text, TranscriptStore.getTranscript());
}

function fallbackAdvice(text, m) {
  const tips = [];
  if (m.filler_count >= 2) tips.push("填充词（嗯/然后/就是说）偏多，先亮观点再展开细节。");
  if (m.avg_sentence_len && (m.avg_sentence_len < 10 || m.avg_sentence_len > 42) && text.length > 30)
    tips.push("句长偏" + (m.avg_sentence_len < 10 ? "碎" : "长") + "，试着一句讲一个点。");
  if (!/(第一|首先|一方面|其次|最后|我认)/.test(text) && text.length > 30)
    tips.push("建议分点作答（第一/其次），逻辑结构更清楚。");
  if (MetricsEngine.detectNerve(text)) tips.push("放慢语速、句间留 2 秒，会更稳。");
  if (!tips.length) tips.push("表达流畅、结构清晰，保持这个节奏。");
  return tips.slice(0, 3);
}
function renderAdvice(list) {
  const ol = $("#adviceList"); ol.innerHTML = "";
  const items = (Array.isArray(list) && list.length) ? list : ["进入模拟后，教练会在这里给出表达力建议。"];
  items.forEach((t) => {
    const li = document.createElement("li"); li.textContent = t; ol.append(li);
  });
  if (Array.isArray(list) && list.length) TranscriptStore.recordAdvice(list); // 累积到会话，报告/历史回放使用
}

/* ---------- 硬上限检查（FR-06） ---------- */
function checkHardLimits() {
  const hit = Guardrail.checkLimits();
  if (hit) {
    doDowngrade(() => toast(hit.reason + "，" + hit.suggest));
  }
}

/* ---------- 安全护栏 ---------- */
function showPause() {
  if (streaming) { // 流式中暂停：中止当前追问，保留干净界面
    userPaused = true;
    if (streamCtrl) streamCtrl.abort();
    resumePendingReq = lastReq;
    if (partialBubble) { partialBubble.parentElement.remove(); partialBubble = null; }
  }
  Guardrail.pause();
  $("#pauseOverlay").classList.add("show");
}
function hidePause() {
  Guardrail.resume();
  $("#pauseOverlay").classList.remove("show");
  if (resumePendingReq) { const r = resumePendingReq; resumePendingReq = null; interviewerSpeak(r.user_reply, r.transcript); }
}
/* 训练中随时切换施压档位（温和/标准/高压，可上调也可下调） */
function applyLevel(lvl) {
  if (lvl === Guardrail.getLevel()) return;
  Guardrail.setLevel(lvl);
  updateLevelChip();
  ApiClient.setLevel(lvl).catch(() => {});   // 通知后端当前档位（用户显式操作，允许上调）
  if (userPaused) { userPaused = false; hidePause(); }
  if (streaming) { toast("已切换为" + LEVEL_LABEL[lvl] + "档，下一轮生效"); return; }
  toast("已切换为" + LEVEL_LABEL[lvl] + "档，面试官将按新强度提问");
  interviewerSpeak("", TranscriptStore.getTranscript());   // 立即按新档位发问
}
function doDowngrade(after) {
  ApiClient.downgrade().then((r) => {
    const lvl = (r.ok && r.data.level) || "gentle";
    Guardrail.setLevel(lvl);
    updateLevelChip();
    if (userPaused) { userPaused = false; hidePause(); }
    after && after();
    // 注入放缓提示语（仅当当前无进行中流式）
    if (!streaming) interviewerSpeak("", TranscriptStore.getTranscript());
  }).catch(() => { Guardrail.setLevel("gentle"); updateLevelChip(); after && after(); });
}
function confirmEnd() {
  showConfirm("结束并生成报告？", "结束后将触发分析师生成成长报告，会话归档。", () => doEnd());
}
function doEnd() {
  Guardrail.end();
  if (streamCtrl) { try { streamCtrl.abort(); } catch {} streamCtrl = null; }
  streaming = false; userPaused = false;
  $("#userInput").disabled = true;
  ApiClient.end().catch(() => {});
  const payload = {
    session_id: sessionId, scene: state.scene, level: Guardrail.getLevel(),
    transcript: TranscriptStore.getTranscript(), local_metrics: TranscriptStore.localMetrics(),
  };
  showReportLoading();   // 生成期间先弹加载态，界面不"卡住"
  ApiClient.generateReport(payload).then((r) => {
    if (r.ok) showReport(r.data);
    else banner("报告生成失败，请重试", () => doEnd());
  }).catch(() => banner("报告生成失败，请重试", () => doEnd()));
}
function showRebound() {
  Guardrail.pause(); userPaused = true;
  $("#reboundOverlay").classList.add("show");
}

/* ---------- 报告 ---------- */
let lastReportData = null;   // 最近一次渲染的完整报告（导出/回放用）
let lastReportCtx = null;    // 最近一次报告的场景/档位上下文
let lastReportCoach = [];    // 最近一次报告附带的本轮教练建议
let lastReportTranscript = [];  // 最近一次报告对应的对话转录（PDF「对话亮点」用）
let reportFromDash = false;  // 报告是否从「数据看板」打开（决定关闭后回到看板）
function showReportLoading() {
  // 生成期间立即给出反馈（带过渡动画出现），避免"画面卡住"的误判
  $("#reportLoading").style.display = "flex";
  $("#reportOverlay").classList.add("show");
}
function renderReport(data, scene, level, coachAdvice, transcript) {
  $("#reportLoading").style.display = "none";   // 数据就绪，移除加载态
  lastReportData = data;
  lastReportCtx = { scene: scene, level: level };
  lastReportCoach = (coachAdvice || []).filter(Boolean).slice(-12);
  lastReportTranscript = transcript || [];
  $("#reportTitle").textContent = scene === "voice"
    ? "你的成长报告 · 实时语音对话 · 语音陪练"
    : "你的成长报告 · " + (SCENE_LABEL[scene] || scene) + " · " + (LEVEL_LABEL[level] || level) + "档";
  const s = data.scores || {};
  const scoreColor = (v) => (v >= 4 ? "var(--metric-good)" : v >= 3 ? "var(--metric-warn)" : "var(--metric-bad)");
  $("#barLang").style.width = ((s.language || 0) / 5 * 100) + "%";
  $("#barLang").style.background = scoreColor(s.language || 0);
  $("#scoreLang").textContent = (s.language || 0) + "/5";
  $("#barLogic").style.width = ((s.logic || 0) / 5 * 100) + "%";
  $("#barLogic").style.background = scoreColor(s.logic || 0);
  $("#scoreLogic").textContent = (s.logic || 0) + "/5";
  $("#barEmo").style.width = ((s.emotion || 0) / 5 * 100) + "%";
  $("#barEmo").style.background = scoreColor(s.emotion || 0);
  $("#scoreEmo").textContent = (s.emotion || 0) + "/5";
  const ls = data.local_stats || {};
  const paceTxt = { normal: "适中", long: "偏长", short: "偏碎" }[ls.pause_est] || "—";
  $("#reportStats").innerHTML =
    "客观佐证（本地统计 · 未上传）：<br>填充词 " + (ls.filler_per_k ?? 0) + " 次/千字 · 平均句长 " + (ls.avg_sentence_len ?? 0) +
    " 字 · 停顿/语速 " + paceTxt + " · 完成轮次 " + (ls.turns ?? 0);
  const ol = $("#reportAdvice"); ol.innerHTML = "";
  (data.improvements || []).forEach((t) => { const li = document.createElement("li"); li.textContent = t; ol.append(li); });
  if (data.summary) { const sum = document.createElement("p"); sum.style.marginTop = "8px"; sum.style.color = "var(--ink-500)"; sum.textContent = "总评：" + data.summary; $("#reportStats").append(sum); }
  // 本轮教练建议（会话中累积的实时反馈）
  const box = $("#reportCoachBox"), olc = $("#reportCoachList");
  olc.innerHTML = "";
  lastReportCoach.forEach((t) => { const li = document.createElement("li"); li.textContent = t; olc.append(li); });
  box.style.display = lastReportCoach.length ? "" : "none";
  $("#reportOverlay").classList.add("show");
}
function showReport(data) {
  reportFromDash = false;   // 训练结束后的报告：关闭后回首页，而非看板
  renderReport(data, state.scene, Guardrail.getLevel(), TranscriptStore.adviceHistory, TranscriptStore.getTranscript());
  TranscriptStore.setReport(data);   // 仅本地持久化，供数据管理中的历史回放
}
/* ---------- 导出 PDF（jsPDF + Canvas 自绘，直接下载，中文零乱码） ---------- */
const PDF_W = 1240, PDF_H = 1754; // A4 @ 150dpi
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function _wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const raw of String(text || "").split("\n")) {
    let line = "";
    for (const ch of raw) {
      if (ctx.measureText(line + ch).width > maxWidth && line) { lines.push(line); line = ch; }
      else line += ch;
    }
    if (line) lines.push(line);
  }
  return lines;
}
function renderReportCanvas() {
  const d = lastReportData || {};
  const s = d.scores || {};
  const ls = d.local_stats || {};
  const ctx = lastReportCtx || { scene: state.scene, level: Guardrail.getLevel() };
  const paceTxt = { normal: "适中", long: "偏长", short: "偏碎" }[ls.pause_est] || "—";
  const tr = lastReportTranscript || [];
  const c = document.createElement("canvas");
  c.width = PDF_W; c.height = PDF_H;
  const g = c.getContext("2d");
  const FONT = '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif';
  const ACCENT = "#1F4E4A", INK = "#2B2B2B", MUTED = "#5B6B67", CARD = "#F5F7F6", LINE = "#E3EAE7";
  const good = "#2F7D6F", warn = "#C98A2D", bad = "#C0564F";
  const scoreColor = (v) => (v >= 4 ? good : v >= 3 ? warn : bad);
  const LEVEL_CHIP = { gentle: "#5E9A8D", standard: "#1F4E4A", hard: "#C0564F" };

  /* 卡片外壳：圆角底 + 左侧品牌色条 */
  const card = (x, y, w, h) => {
    g.fillStyle = CARD; _roundRect(g, x, y, w, h, 18); g.fill();
    g.fillStyle = ACCENT; _roundRect(g, x, y, 12, h, 6); g.fill();
  };
  const cardTitle = (x, y, txt) => {
    g.fillStyle = ACCENT; g.font = "700 27px " + FONT;
    g.fillText(txt, x + 34, y + 50);
  };
  /* 胶囊标签 */
  const chip = (x, yTop, label, color) => {
    g.font = "600 21px " + FONT;
    const tw = g.measureText(label).width, cw = tw + 46, chh = 34;
    g.fillStyle = color; _roundRect(g, x, yTop, cw, chh, 17); g.fill();
    g.fillStyle = "#FFFFFF"; g.textAlign = "center";
    g.fillText(label, x + cw / 2, yTop + 23); g.textAlign = "left";
    return x + cw + 14;
  };

  g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, PDF_W, PDF_H);

  /* —— 顶部品牌装饰带 —— */
  g.fillStyle = ACCENT; g.fillRect(0, 0, PDF_W, 62);
  g.fillStyle = "rgba(255,255,255,0.10)"; g.beginPath(); g.arc(PDF_W - 70, -30, 120, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(90, 100, 60, 0, Math.PI * 2); g.fillStyle = "rgba(31,78,74,0.05)"; g.fill();
  g.fillStyle = ACCENT; g.fillRect(0, 62, PDF_W, 6);

  const X = 90, W = PDF_W - 180;
  let y = 128;

  /* —— 头部 —— */
  g.fillStyle = ACCENT; _roundRect(g, X, y - 36, 54, 54, 14); g.fill();
  g.fillStyle = "#FFFFFF"; g.font = "800 30px " + FONT; g.textAlign = "center";
  g.fillText("M", X + 27, y - 2); g.textAlign = "left";
  g.fillStyle = ACCENT; g.font = "700 26px " + FONT;
  g.fillText("MindForge 心智锻造", X + 70, y - 14);
  g.fillStyle = MUTED; g.font = "400 21px " + FONT;
  g.fillText("高压表达力训练 · 成长报告", X + 70, y + 16);
  y += 34;

  g.fillStyle = INK; g.font = "800 58px " + FONT;
  y += 62; g.fillText("成长报告", X, y);
  g.fillStyle = MUTED; g.font = "400 24px " + FONT;
  y += 40;
  g.fillText(new Date().toLocaleString("zh-CN"), X, y);
  const isVoice = ctx.scene === "voice";
  const sceneChip = isVoice ? "实时语音对话" : (SCENE_LABEL[ctx.scene] || ctx.scene || "训练") + "模拟";
  const levelChip = isVoice ? "语音陪练" : (LEVEL_LABEL[ctx.level] || ctx.level || "标准") + "档";
  let cx = X + g.measureText(new Date().toLocaleString("zh-CN")).width + 40;
  cx = chip(cx, y - 27, sceneChip, ACCENT);
  chip(cx, y - 27, levelChip, LEVEL_CHIP[ctx.level] || ACCENT);
  y += 26;
  g.strokeStyle = LINE; g.lineWidth = 2;
  g.beginPath(); g.moveTo(X, y); g.lineTo(X + W, y); g.stroke();
  y += 30;

  /* —— ① 四维评分 —— */
  card(X, y, W, 196);
  cardTitle(X, y, "四维评分");
  const dims = [
    ["语言组织", s.language || 0, "表达流畅 · 填充词控制"],
    ["逻辑清晰度", s.logic || 0, "结构完整 · 先亮结论"],
    ["情绪稳定性", s.emotion || 0, "语速节奏 · 压力应对"],
  ];
  dims.forEach(([n, v, desc], i) => {
    const by = y + 92 + i * 38;
    g.fillStyle = INK; g.font = "600 25px " + FONT;
    g.fillText(n, X + 34, by);
    g.fillStyle = MUTED; g.font = "400 19px " + FONT;
    g.fillText(desc, X + 34, by + 27);
    g.fillStyle = "#E6ECE9"; _roundRect(g, X + 250, by - 16, W - 420, 20, 10); g.fill();
    const col = scoreColor(v);
    g.fillStyle = col; _roundRect(g, X + 250, by - 16, (W - 420) * (v / 5), 20, 10); g.fill();
    g.fillStyle = col; g.font = "800 26px " + FONT;
    g.fillText(v + "/5", X + W - 96, by + 3);
  });
  y += 196 + 30;

  /* —— ② 评分可视化（雷达图） —— */
  card(X, y, W, 428);
  cardTitle(X, y, "评分可视化 · 能力雷达");
  g.fillStyle = MUTED; g.font = "400 19px " + FONT;
  g.fillText("满分 5 分，越靠外能力越强", X + W - 260, y + 50);
  const cx2 = X + W / 2, cy2 = y + 252, R = 168;
  const angle = (i) => Math.PI / 2 + (2 * Math.PI * i) / 3;
  const pt = (i, r) => [cx2 + r * Math.cos(angle(i)), cy2 - r * Math.sin(angle(i))];
  for (let k = 1; k <= 5; k++) {
    const r = (R * k) / 5;
    g.beginPath();
    [0, 1, 2].forEach((i, j) => { const [px, py] = pt(i, r); j ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.closePath(); g.strokeStyle = "#D9E3E0"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "#AEBFBA"; g.font = "400 17px " + FONT;
    g.fillText(String(k), pt(0, r)[0] + 6, pt(0, r)[1] - 4);
  }
  g.strokeStyle = "#C2D1CD"; g.lineWidth = 2;
  [0, 1, 2].forEach((i) => { const [px, py] = pt(i, R); g.beginPath(); g.moveTo(cx2, cy2); g.lineTo(px, py); g.stroke(); });
  // 数据多边形（双色：填充 + 描边 + 顶点）
  g.beginPath();
  [0, 1, 2].forEach((i, j) => { const [px, py] = pt(i, R * (dims[i][1] / 5)); j ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.closePath(); g.fillStyle = "rgba(31,78,74,0.20)"; g.fill();
  g.strokeStyle = ACCENT; g.lineWidth = 4; g.lineJoin = "round"; g.stroke();
  [0, 1, 2].forEach((i) => {
    const [px, py] = pt(i, R * (dims[i][1] / 5));
    g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fillStyle = "#FFFFFF"; g.fill();
    g.strokeStyle = ACCENT; g.lineWidth = 3; g.stroke();
    const [lx, ly] = pt(i, R + 40);
    g.fillStyle = INK; g.font = "600 25px " + FONT; g.textAlign = "center";
    g.fillText(dims[i][0], lx, ly + 8);
    g.fillStyle = ACCENT; g.font = "800 28px " + FONT;
    g.fillText(dims[i][1], px, py - 18);
    g.textAlign = "left";
  });
  y += 428 + 30;

  /* —— ③ 客观佐证（本地统计） —— */
  card(X, y, W, 148);
  cardTitle(X, y, "客观佐证 · 本地统计（未上传）");
  const stats = [
    ["填充词", (ls.filler_per_k ?? 0) + " 次/千字"],
    ["平均句长", (ls.avg_sentence_len ?? 0) + " 字"],
    ["停顿 / 语速", paceTxt],
    ["完成轮次", (ls.turns ?? 0) + " 轮"],
  ];
  stats.forEach(([k, v], i) => {
    const sx = X + 34 + i * ((W - 68) / 4), sy = y + 90;
    g.fillStyle = ACCENT; _roundRect(g, sx, sy - 30, 8, 30, 4); g.fill();
    g.fillStyle = INK; g.font = "600 23px " + FONT;
    g.fillText(k, sx + 20, sy - 6);
    g.fillStyle = MUTED; g.font = "400 21px " + FONT;
    g.fillText(v, sx + 20, sy + 22);
  });
  if (d.summary) {
    const sum = String(d.summary).replace(/\s+/g, " ").slice(0, 60);
    g.fillStyle = MUTED; g.font = "400 21px " + FONT;
    g.fillText("总评：" + sum, X + 34, y + 130);
  }
  y += 148 + 30;

  /* —— ④ 对话亮点摘录（结合面试者发言） —— */
  const userMsgs = tr.filter((m) => m.role === "user" && (m.content || "").trim());
  const quotes = [];
  if (userMsgs.length) {
    const first = userMsgs[0];
    const longest = userMsgs.reduce((a, b) => ((b.content || "").length > (a.content || "").length ? b : a));
    const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
    quotes.push({ label: userMsgs.length === 1 ? "面试者发言" : "开场 · 自我介绍", text: clean(first.content).slice(0, 90) });
    if (longest !== first) quotes.push({ label: "最长发言", text: clean(longest.content).slice(0, 90) });
  }
  const quoteLines = [];
  quotes.forEach((q) => {
    quoteLines.push({ head: true, text: q.label });
    _wrapText(g, "「" + q.text + "」", W - 68).slice(0, 2).forEach((l) => quoteLines.push({ head: false, text: l }));
  });
  if (!quoteLines.length) quoteLines.push({ head: false, text: "本次会话暂无对话记录。" });
  let qCardH = 96 + quoteLines.length * 36 + 20;
  const qAvail = PDF_H - 60 - y;
  if (qCardH > qAvail - 30) { qCardH = Math.max(96, qAvail - 30); quoteLines.length = Math.max(0, Math.floor((qCardH - 116) / 36)); }
  card(X, y, W, qCardH);
  cardTitle(X, y, "对话亮点摘录");
  let qy = y + 96;
  quoteLines.forEach((ln) => {
    if (qy > y + qCardH - 20) return;
    if (ln.head) { g.fillStyle = ACCENT; g.font = "700 22px " + FONT; g.fillText("▸ " + ln.text, X + 34, qy); }
    else { g.fillStyle = INK; g.font = "400 23px " + FONT; g.fillText(ln.text, X + 56, qy); }
    qy += 36;
  });
  y += qCardH + 30;

  /* —— ⑤ 本轮教练建议 —— */
  const tips = lastReportCoach.length ? lastReportCoach : (d.improvements || []);
  const tipItems = tips.slice(0, 5).map((t) => _wrapText(g, t, W - 110).slice(0, 2));
  const tipLines = tipItems.flat();
  if (!tipLines.length) { tipItems.push(["保持节奏，继续练习。"]); tipLines.push("保持节奏，继续练习。"); }
  let tCardH = 96 + tipLines.length * 36 + 20;
  const tAvail = PDF_H - 60 - y;
  if (tCardH > tAvail - 30) { tCardH = Math.max(96, tAvail - 30); }
  card(X, y, W, tCardH);
  cardTitle(X, y, "本轮教练建议");
  let ty = y + 96;
  tipItems.forEach((item, i) => {
    if (ty > y + tCardH - 20) return;
    g.fillStyle = ACCENT; _roundRect(g, X + 34, ty - 24, 26, 26, 8); g.fill();
    g.fillStyle = "#FFFFFF"; g.font = "700 17px " + FONT; g.textAlign = "center";
    g.fillText(String(i + 1), X + 47, ty - 6); g.textAlign = "left";
    item.forEach((ln) => {
      if (ty > y + tCardH - 20) return;
      g.fillStyle = INK; g.font = "400 23px " + FONT;
      g.fillText(ln, X + 72, ty);
      ty += 36;
    });
    if (item.length === 1) ty += 36;   // 单行条目也留出行距
  });
  y += tCardH + 30;

  /* —— 页脚 —— */
  g.strokeStyle = LINE; g.lineWidth = 2;
  g.beginPath(); g.moveTo(X, PDF_H - 92); g.lineTo(X + W, PDF_H - 92); g.stroke();
  g.fillStyle = ACCENT; _roundRect(g, X, PDF_H - 78, 30, 30, 8); g.fill();
  g.fillStyle = "#FFFFFF"; g.font = "800 17px " + FONT; g.textAlign = "center";
  g.fillText("M", X + 15, PDF_H - 56); g.textAlign = "left";
  g.fillStyle = MUTED; g.font = "400 21px " + FONT;
  g.fillText("数据本地生成，未上传 · MindForge 训练工具，非招聘决策 · 第 1 页", X + 46, PDF_H - 56);
  return c;
}
function exportReport() {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("PDF 组件未加载");
    const canvas = renderReportCanvas();
    const doc = new window.jspdf.jsPDF({ orientation: "portrait", unit: "px", format: [PDF_W, PDF_H], hotfixes: ["px_scaling"] });
    doc.setProperties({
      title: "MindForge 成长报告",
      subject: (SCENE_LABEL[lastReportCtx?.scene] || "训练") + " · " + (LEVEL_LABEL[lastReportCtx?.level] || "标准") + "档",
      author: "MindForge 心智锻造",
      creator: "MindForge",
    });
    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, PDF_W, PDF_H);
    doc.save("MindForge_成长报告.pdf");
    toast("报告已导出为 PDF（本地）");
  } catch (e) {
    toast("PDF 导出失败：" + e.message);
  }
}

/* ---------- 通用确认弹层 ---------- */
let confirmOk = null, confirmCancel = null;
function showConfirm(title, text, ok, cancel) {
  $("#cfTitle").textContent = title; $("#cfText").textContent = text;
  $("#confirmOverlay").classList.add("show");
  confirmOk = ok || null; confirmCancel = cancel || null;
}
function closeConfirm() { $("#confirmOverlay").classList.remove("show"); confirmOk = null; confirmCancel = null; }

/* ---------- 进入训练 ---------- */
function updateGuardLevelUI() {
  const lvl = Guardrail.getLevel();
  document.querySelectorAll("#guardLevel .gl-opt").forEach((o) => o.classList.toggle("sel", o.dataset.level === lvl));
}
function updateLevelChip() {
  $("#thLevel").innerHTML = '<span class="dot" style="background:' + LEVEL_COLOR[Guardrail.getLevel()] + '"></span>' + LEVEL_LABEL[Guardrail.getLevel()];
  updateGuardLevelUI();
}
async function startTraining(scene, level) {
  if (streamCtrl) { try { streamCtrl.abort(); } catch {} streamCtrl = null; }
  streaming = false; userPaused = false; resumePendingReq = null;
  hideEmotionHint(); $("#micBtn").classList.remove("rec");
  collectProfile();   // 收集背景信息（简历/手填），供面试官针对性提问
  const r = await ApiClient.startSession(scene, level);
  if (!r.ok) {
    if (r.code === "scene_required" || r.code === "level_required") {
      $("#configErr").textContent = (r.message) || "请先选择场景与施压档位";
    } else toast("无法开始：" + (r.message || "请重试"));
    return;
  }
  sessionId = r.data.session_id;
  state.scene = scene; state.level = level;
  Guardrail.reset(level);
  TranscriptStore.reset(sessionId);
  TranscriptStore.setMeta(scene, level);
  $("#configOverlay").classList.remove("show");
  $("#landing").style.display = "none";
  $("#training").classList.add("show");
  $("#thScene").textContent = SCENE_LABEL[scene] || scene;
  updateLevelChip();
  chatScroll.innerHTML = "";
  renderAdvice(null);
  interviewerSpeak("", []); // 开场白
}

/* ---------- 配置弹层选择 ---------- */
let selScene = null, selLevel = null, selMode = "text";
function checkConfig() {
  const b = $("#configStart");
  if (selScene && selLevel) { b.disabled = false; b.style.opacity = "1"; }
  else { b.disabled = true; b.style.opacity = ".5"; }
}
document.querySelectorAll("#modeGrid .choice").forEach((c) => c.onclick = () => {
  document.querySelectorAll("#modeGrid .choice").forEach((x) => x.classList.remove("sel"));
  c.classList.add("sel"); selMode = c.dataset.mode;
});
document.querySelectorAll("#sceneGrid .choice").forEach((c) => c.onclick = () => {
  document.querySelectorAll("#sceneGrid .choice").forEach((x) => x.classList.remove("sel"));
  c.classList.add("sel"); selScene = c.dataset.scene; checkConfig();
});
document.querySelectorAll("#levelSeg .seg-opt").forEach((o) => o.onclick = () => {
  document.querySelectorAll("#levelSeg .seg-opt").forEach((x) => x.classList.remove("sel"));
  o.classList.add("sel"); selLevel = o.dataset.level; checkConfig();
});
$("#configStart").onclick = () => {
  if (!selScene || !selLevel) return;
  if (selMode === "voice") startVoiceTraining(selScene, selLevel);
  else startTraining(selScene, selLevel);
};
$("#configCancel").onclick = () => $("#configOverlay").classList.remove("show");

function showConfig() { selScene = null; selLevel = null; selMode = "text";
  document.querySelectorAll("#modeGrid .choice").forEach((x) => x.classList.toggle("sel", x.dataset.mode === "text"));
  document.querySelectorAll("#sceneGrid .choice").forEach((x) => x.classList.remove("sel"));
  document.querySelectorAll("#levelSeg .seg-opt").forEach((x) => x.classList.remove("sel"));
  checkConfig(); resetProfileUI(); $("#configOverlay").classList.add("show"); }

/* 实时语音对话训练：复用同一套场景/档位/背景信息，进入语音版块 */
function startVoiceTraining(scene, level) {
  collectProfile();   // 收集背景信息（简历/手填），让语音陪练基于你的基本情况提问
  state.scene = scene; state.level = level;
  $("#configOverlay").classList.remove("show");
  $("#landing").style.display = "none";
  launchVoice({ scene, level, profile: currentProfile });
}
function backHome() { $("#training").classList.remove("show"); $("#landing").style.display = "block"; }

/* ---------- 训练前背景信息（上传简历 / 手填，仅本地） ---------- */
function toggleProfileBox(mode) {
  $("#profileUploadBox").style.display = mode === "upload" ? "" : "none";
  $("#profileFormBox").style.display = mode === "form" ? "flex" : "none";
}
function profileInfoText(p) {
  if (!p) return "未提供背景信息，面试官将进行通用提问。";
  if (p.mode === "upload") return "已上传简历：" + (p.resume_file || "") + "（" + (p.resume_text ? p.resume_text.length : 0) + " 字）· 仅本地保存";
  const parts = [p.school, p.major, p.degree, p.target].filter(Boolean).join(" · ");
  return "已填写：" + (parts || "（空）") + " · 仅本地保存";
}
function resetProfileUI() {
  // 每次打开配置弹层都重置背景信息：清空手填表单与简历选择、丢弃本地缓存，
  // 避免上一次填写的文字一直残留（用户要求每次进入都从空白开始）。
  Storage.clearProfile();
  currentProfile = null;
  document.querySelectorAll("#profileMode .seg-opt").forEach((o) => o.classList.toggle("sel", o.dataset.mode === "upload"));
  toggleProfileBox("upload");
  ["pfSchool", "pfMajor", "pfDegree", "pfTarget"].forEach((id) => { $("#" + id).value = ""; });
  const rf = $("#resumeFile"); if (rf) rf.value = "";
  $("#resumeName").textContent = "未选择文件";
  $("#resumeStatus").textContent = "";
  $("#profileInfo").textContent = "未填写，面试官将进行通用提问。";
}
function collectProfile() {
  const mode = document.querySelector("#profileMode .seg-opt.sel")?.dataset.mode || "upload";
  let p = null;
  if (mode === "form") {
    const school = $("#pfSchool").value.trim(), major = $("#pfMajor").value.trim(),
          degree = $("#pfDegree").value.trim(), target = $("#pfTarget").value.trim();
    if (school || major || degree || target) p = { mode: "form", school, major, degree, target };
  } else if (mode === "upload") {
    const saved = Storage.getProfile();
    if (saved && saved.mode === "upload" && saved.resume_text) p = { mode: "upload", resume_file: saved.resume_file, resume_text: saved.resume_text };
  }
  currentProfile = p;
  Storage.saveProfile(p);
  return p;
}
function refreshProfileSummary() {
  // 实时预览当前手填内容（不落盘，仅展示）
  const mode = document.querySelector("#profileMode .seg-opt.sel")?.dataset.mode || "upload";
  if (mode === "form") {
    const v = [$("#pfSchool").value.trim(), $("#pfMajor").value.trim(), $("#pfDegree").value.trim(), $("#pfTarget").value.trim()].filter(Boolean);
    $("#profileInfo").textContent = v.length ? "已填写：" + v.join(" · ") + " · 仅本地保存" : "未填写，面试官将进行通用提问。";
  } else {
    const saved = Storage.getProfile();
    $("#profileInfo").textContent = profileInfoText(saved && saved.mode === "upload" ? saved : null);
  }
}
document.querySelectorAll("#profileMode .seg-opt").forEach((o) => o.onclick = () => {
  document.querySelectorAll("#profileMode .seg-opt").forEach((x) => x.classList.remove("sel"));
  o.classList.add("sel"); toggleProfileBox(o.dataset.mode); refreshProfileSummary();
});
["pfSchool", "pfMajor", "pfDegree", "pfTarget"].forEach((id) => $("#" + id).addEventListener("input", refreshProfileSummary));
$("#resumePick").onclick = () => $("#resumeFile").click();
$("#resumeFile").addEventListener("change", async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) {
    $("#resumeName").textContent = ""; $("#resumeStatus").textContent = "文件超过 5MB，请压缩后重试";
    $("#resumeStatus").style.color = "var(--metric-bad)"; return;
  }
  $("#resumeName").textContent = "解析中：" + f.name + " …";
  $("#resumeStatus").textContent = "";
  const r = await ApiClient.extractProfile(f);
  if (r.ok) {
    const p = { mode: "upload", resume_file: f.name, resume_text: r.data.text };
    currentProfile = p; Storage.saveProfile(p);
    $("#resumeName").textContent = "已选：" + f.name;
    $("#resumeStatus").textContent = "已解析 " + r.data.chars + " 字 · 仅本地保存，可在数据管理清除";
    $("#resumeStatus").style.color = "var(--metric-good)";
    $("#profileInfo").textContent = profileInfoText(p);
    toast("简历解析成功");
  } else {
    $("#resumeName").textContent = "已选：" + f.name;
    $("#resumeStatus").textContent = r.message || "解析失败";
    $("#resumeStatus").style.color = "var(--metric-bad)";
  }
});

/* ---------- 事件绑定 ---------- */
["#navStart", "#heroStart", "#footerStart"].forEach((s) => $(s).onclick = showConfig);
$("#heroHow").onclick = () => document.querySelector(".section").scrollIntoView();
$("#trainBack").onclick = () => {
  // 训练进行中（未结束）时，返回需二次确认，防止误触中断会话（AC-05 体验护栏）
  if (sessionId && !Guardrail.isEnded()) {
    showConfirm("退出训练？", "训练尚未结束，返回首页将中断本次会话且不会生成结案报告。确定要退出吗？", () => {
      if (streamCtrl) { try { streamCtrl.abort(); } catch {} streamCtrl = null; }
      streaming = false; userPaused = false;
      $("#userInput").disabled = false;
      if (sessionId) Storage.deleteSession(sessionId);   // 主动放弃 → 清理草稿，刷新时不再提示恢复
      backHome();
    });
  } else {
    backHome();
  }
};
$("#trainHelp").onclick = openHelp;
$("#navHelp").onclick = openHelp;
$("#helpClose").onclick = closeHelp;
$("#navData").onclick = openData;
$("#navDash").onclick = openDashboard;

/* ---------- 模型接入状态（真实 LLM / Mock） ---------- */
async function refreshModelStatus() {
  const pill = $("#modelPill");
  try {
    const r = await fetch("/api/config/model");
    if (!r.ok) throw new Error("config/model " + r.status);
    const m = await r.json();
    pill.dataset.mock = m.mock ? "1" : "0";
    pill.textContent = m.mock ? "演示模式 · Mock" : "已接入 " + (m.provider || "LLM");
    pill.title = m.mock
      ? "未配置 LLM_API_KEY，当前使用本地 Mock 生成器（零依赖演示）"
      : "快模型 " + m.fast_model + " · 报告强模型 " + m.strong_model;
    const st = $("#modelStatusText");
    if (st) st.textContent = m.mock
      ? "当前为 Mock 演示模式：未配置 LLM_API_KEY，对话与报告由本地生成。配置 backend/.env 后可接入真实模型。"
      : "已接入真实模型（" + (m.provider || "") + " · " + m.fast_model + "），点击「测试连接」可自检。";
  } catch (e) {
    pill.dataset.mock = "1"; pill.textContent = "离线演示"; pill.title = "无法获取模型状态";
  }
}
$("#modelProbe").onclick = async function () {
  const btn = this, box = $("#modelStatusBox");
  btn.disabled = true; btn.textContent = "检测中…";
  box.classList.remove("ok", "err");
  try {
    const r = await fetch("/api/config/model/probe", { method: "POST" });
    const j = await r.json();
    box.classList.add(j.ok ? "ok" : "err");
    $("#modelStatusText").textContent = j.message + (j.reply ? "（回复：" + j.reply + "）" : "");
    if (j.ok) {
      const m = await (await fetch("/api/config/model")).json();
      $("#modelPill").dataset.mock = "0";
      $("#modelPill").textContent = "已接入 " + (m.provider || "LLM");
      $("#modelPill").title = "快模型 " + m.fast_model + " · 报告强模型 " + m.strong_model;
    }
  } catch (e) {
    box.classList.add("err");
    $("#modelStatusText").textContent = "自检失败：无法连接后端服务";
  } finally {
    btn.disabled = false; btn.textContent = "测试连接";
  }
};
const ta = $("#userInput");
function resizeInput() {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
}
ta.addEventListener("input", resizeInput);
ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendUser(); } });
$("#sendBtn").onclick = sendUser;

/* ---------- 语音输入（浏览器原生 ASR，音频不上传） + 情绪提示信号 ---------- */
let micStartTime = 0;
function showEmotionHint(hint) {
  $("#emotionHintBody").textContent = hint.summary + "：" + hint.detail + "。本提示为本地近似信号，受环境、口音、设备影响，不构成任何评价。";
  $("#emotionHint").style.display = "";
}
function hideEmotionHint() { $("#emotionHint").style.display = "none"; }
function commitRecognition(text) {
  $("#micBtn").classList.remove("rec");
  EmotionEngine.stop();
  // 兜底：最终文本为空时保留输入框内已显示的实时文本（防止结束识别后文字消失）
  const t = ((text || "").trim()) || ta.value.trim();
  if (!t) { toast("未识别到语音，请重试"); return; }
  ta.value = t; resizeInput(); ta.focus();
  const elapsed = (Date.now() - micStartTime) / 1000;
  const hint = EmotionEngine.analyze(t, elapsed);
  if (hint) showEmotionHint(hint); else hideEmotionHint();
  toast("已识别（可编辑后发送）：" + (t.length > 14 ? t.slice(0, 14) + "…" : t));
}
$("#micBtn").onclick = async () => {
  if (ASR.active) { ASR.stop(); return; }   // 再点一次停止并提交
  if (!ASR.supported()) { toast("当前环境不支持语音输入，请使用 Chrome / Edge"); return; }
  await EmotionEngine.start();              // 预取麦克风（音量信号；失败不影响识别）
  $("#userInput").value = ""; resizeInput();
  micStartTime = Date.now();
  $("#micBtn").classList.add("rec");
  ASR.start({
    onInterim: (txt) => { $("#userInput").value = txt; resizeInput(); },
    onFinal: (txt) => commitRecognition(txt),
    onState: (s, msg) => {
      if (s === "error") { $("#micBtn").classList.remove("rec"); EmotionEngine.stop(); toast(msg || "语音输入出错"); }
      else if (s === "loading") toast("正在加载离线语音模型（本地 · 仅首次）…");
      else if (s === "fallback") toast("浏览器语音服务不可达，已切换离线识别（音频不出设备）");
      else if (s === "on") toast(ASR.usingVosk ? "正在聆听（离线识别 · 零延迟）…再点一次结束" : "正在聆听…再点一次结束");
    },
  });
};
$("#gPause").onclick = showPause;
$("#resumeBtn").onclick = hidePause;
$("#gEnd").onclick = confirmEnd;
document.querySelectorAll("#guardLevel .gl-opt").forEach((o) => o.onclick = () => applyLevel(o.dataset.level));
$("#cfCancel").onclick = () => { const c = confirmCancel; closeConfirm(); c && c(); };
$("#cfOk").onclick = () => {
  const ok = confirmOk;
  closeConfirm();
  if (ok) {
    try { ok(); }
    catch (e) { console.error("[MindForge] 确认回调异常:", e); toast("操作未完成：" + (e.message || "未知错误")); }
  }
};
$("#rbDown").onclick = () => { $("#reboundOverlay").classList.remove("show"); userPaused = false; doDowngrade(() => toast("已降低强度")); };
$("#rbKeep").onclick = () => { $("#reboundOverlay").classList.remove("show"); userPaused = false; Guardrail.resume(); };
$("#reportAgain").onclick = () => { $("#reportOverlay").classList.remove("show"); backHome(); showConfig(); };
$("#reportHome").onclick = () => {
  $("#reportOverlay").classList.remove("show");
  if (reportFromDash) { reportFromDash = false; openDashboard(); }
  else backHome();
};

/* 训练进行中刷新/关闭页面 → 浏览器先弹确认，防止误刷丢失会话 */
window.addEventListener("beforeunload", (e) => {
  if (sessionId && !Guardrail.isEnded()) {
    e.preventDefault();
    e.returnValue = "";   // 触发浏览器离开确认框
  }
});
$("#reportExport").onclick = exportReport;
$("#coachToggle").onclick = () => $("#coachCol").classList.toggle("open");

/* ---------- 帮助 / 数据管理 ---------- */
function openHelp() { $("#helpDrawer").classList.add("show"); }
function closeHelp() { $("#helpDrawer").classList.remove("show"); }
function openData() {
  const list = Storage.listSessions();
  const box = $("#dataList"); box.innerHTML = "";
  if (!list.length) { box.innerHTML = '<div class="dm-empty">暂无本地训练数据。</div>'; }
  else {
    list.forEach((s) => {
      const row = document.createElement("div"); row.className = "dm-row";
      const turns = (s.transcript || []).filter((m) => m.role === "user").length;
      const hasReport = !!(s.report && s.report.scores);
      const status = hasReport ? '<span class="dm-status done">已出报告</span>' : '<span class="dm-status run">训练中</span>';
      const isVoice = s.mode === "voice";
      const sceneTxt = isVoice ? "实时语音对话" : (SCENE_LABEL[s.scene] || s.scene);
      const levelTxt = isVoice ? "语音陪练" : (LEVEL_LABEL[s.level] || s.level);
      const vBadge = isVoice ? '<span class="dm-status run" style="background:#f1ecf6;color:#6b5a8e;border-color:#d8cde8">语音</span>' : "";
      row.innerHTML = '<div><div>' + vBadge + status + " " + sceneTxt + " · " + levelTxt +
        '</div><div class="dm-meta">轮次 ' + turns + " · " + new Date(s.updatedAt || Date.now()).toLocaleString() + "</div></div>";
      const acts = document.createElement("div"); acts.className = "dm-actions";
      // 查看对话记录（当时的训练场景与逐轮内容，仅本地）
      if ((s.transcript || []).length) {
        const vc = document.createElement("button"); vc.className = "btn btn-text"; vc.style.padding = "6px 10px"; vc.style.fontSize = "13px";
        vc.textContent = "查看对话";
        vc.onclick = () => openHistory(s);
        acts.append(vc);
      }
      if (hasReport) {
        const v = document.createElement("button"); v.className = "btn btn-text"; v.style.padding = "6px 10px"; v.style.fontSize = "13px";
        v.textContent = "查看报告";
        v.onclick = () => { reportFromDash = false; $("#dataOverlay").classList.remove("show"); renderReport(s.report, s.scene, s.level, s.advice, s.transcript); toast("已打开历史报告（本地）"); };
        acts.append(v);
      }
      const del = document.createElement("button"); del.className = "btn btn-ghost"; del.style.padding = "6px 14px"; del.style.fontSize = "13px";
      del.textContent = "删除"; del.onclick = () => { Storage.deleteSession(s.id); openData(); toast("已删除该本地数据"); };
      acts.append(del);
      row.append(acts); box.append(row);
    });
  }
  $("#dataOverlay").classList.add("show");
}
/* 查看历史对话记录（训练场景回放，仅本地） */
function openHistory(s) {
  const turns = (s.transcript || []).filter((m) => m.role === "user").length;
  $("#historyTitle").textContent = "训练记录 · " + (SCENE_LABEL[s.scene] || s.scene) + " · " + (LEVEL_LABEL[s.level] || s.level) + "档";
  $("#historySub").textContent = "对话 " + (s.transcript || []).length + " 条 · 完成轮次 " + turns + " · " +
    new Date(s.updatedAt || Date.now()).toLocaleString() + " · 仅本地存储";
  const box = $("#historyScroll"); box.innerHTML = "";
  (s.transcript || []).forEach((m) => {
    const isUser = m.role === "user";
    const wrap = document.createElement("div"); wrap.className = "msg " + (isUser ? "user" : "");
    const av = document.createElement("div"); av.className = "av " + (isUser ? "usr" : "int"); av.textContent = isUser ? "你" : "面";
    const b = document.createElement("div"); b.className = "bubble " + (isUser ? "usr" : "int"); b.textContent = m.content || "";
    wrap.append(av, b); box.append(wrap);
  });
  if (!(s.transcript || []).length) box.innerHTML = '<div class="dm-empty">该记录暂无对话内容。</div>';
  $("#historyOverlay").classList.add("show");
}
$("#historyClose").onclick = () => $("#historyOverlay").classList.remove("show");
$("#dataClose").onclick = () => $("#dataOverlay").classList.remove("show");
$("#dataDash").onclick = () => { $("#dataOverlay").classList.remove("show"); openDashboard(); };
$("#dataClear").onclick = () => { Storage.clearAll(); openData(); toast("已清空全部本地数据"); };

/* 看板 / 语音会话 → 打开报告弹层（与 dashboard.js / voice_mode.js 解耦） */
document.addEventListener("mindforge:open-report", (e) => {
  const rec = e.detail;
  if (!rec || !rec.report) return;
  // 保留底层视图（看板/语音视图）在报告遮罩之下；关闭后按来源决定去向
  $("#landing").style.display = "none";
  reportFromDash = !rec.fromVoiceSession;   // 语音会话结束：返回首页；看板回放：返回看板
  renderReport(rec.report, rec.scene, rec.level, rec.advice, rec.transcript);
});

/* 点击遮罩空白处关闭弹层（报告 / 历史对话 / 数据管理）
   仅当点击落在 .overlay 本身（即 modal 之外的空白区）时才关闭，避免误触 modal 内部 */
["reportOverlay", "historyOverlay", "dataOverlay"].forEach((id) => {
  const ov = document.getElementById(id);
  if (!ov) return;
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("show"); });
});
/* 三个弹层的显式 × 关闭按钮 */
$("#reportX").onclick = () => $("#reportOverlay").classList.remove("show");
$("#historyX").onclick = () => $("#historyOverlay").classList.remove("show");
$("#dataX").onclick = () => $("#dataOverlay").classList.remove("show");
document.addEventListener("mindforge:goto-training", () => {
  closeDashboard();
  showConfig();
});

/* ---------- 视差 ---------- */
window.addEventListener("scroll", () => {
  const c = $("#parallaxCard");
  if (c && window.scrollY < 600) c.style.transform = "translateY(" + (window.scrollY * 0.06) + "px)";
});

/* ---------- 启动 ---------- */
(async function init() {
  await MetricsEngine.init();
  refreshModelStatus();
  initVoiceMode();   // 实时语音对话版块（豆包式）
  maybeResume();     // 检测未完成的训练，刷新/断线后可直接继续
  console.log("[MindForge] frontend ready");
})();

/* ---------- 刷新/断线后的会话恢复 ---------- */
function maybeResume() {
  const drafts = Storage.listSessions();
  const active = drafts
    .filter((d) => d && !d.report && (d.transcript || []).length)   // 未结束（无报告）且有对话
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];    // 取最近一次
  if (!active) return;
  const turns = (active.transcript || []).filter((m) => m.role === "user").length;
  showConfirm(
    "继续上次训练？",
    "检测到一次未完成的训练（" + (SCENE_LABEL[active.scene] || active.scene) + " · " +
    (LEVEL_LABEL[active.level] || active.level) + "档 · 已完成 " + turns + " 轮）。要继续吗？",
    () => resumeSession(active),
    () => { Storage.deleteSession(active.id); toast("已放弃未完成的训练"); }
  );
}
function resumeSession(d) {
  // 先切换视图：后续任何一步异常都不影响进入训练界面
  $("#landing").style.display = "none";
  $("#training").classList.add("show");
  try {
    sessionId = d.id;
    state.scene = d.scene; state.level = d.level;
    Guardrail.reset(d.level);
    Guardrail.userTurns = (d.transcript || []).filter((m) => m.role === "user").length;
    TranscriptStore.restore(d);
    streaming = false; userPaused = false;
    $("#thScene").textContent = SCENE_LABEL[d.scene] || d.scene || "训练";
    updateLevelChip();
    chatScroll.innerHTML = "";
    (d.transcript || []).forEach((m) => {
      try {
        const b = newBubble(m.role === "user" ? "user" : "int");
        b.textContent = typeof m.content === "string" ? m.content : String(m.content || "");
      } catch (e) { console.error("[MindForge] 单条消息渲染跳过:", e); }   // 单条异常不阻断整体
    });
    scrollBottom();
    renderAdvice((d.advice || []).length ? d.advice : null);
    const lm = TranscriptStore.localMetrics();
    MetricsEngine.render(lm, { filler: $("#mFiller"), dotFiller: $("#dotFiller"), len: $("#mLen"), dotLen: $("#dotLen"), pace: $("#mPace"), dotPace: $("#dotPace") });
    $("#userInput").disabled = false;
    toast("已恢复上次训练，继续作答即可");
  } catch (e) {
    console.error("[MindForge] 恢复训练异常:", e);
    toast("已进入训练界面，部分历史内容未能还原");
  }
}
