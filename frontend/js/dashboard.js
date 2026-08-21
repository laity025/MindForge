// dashboard.js —— 数据看板：训练 / 实时语音对话的评分趋势
//   纯前端、localStorage 数据，零依赖 SVG 图表（雷达 + 趋势），离线可用
import { Storage } from "./storage.js";

const $ = (s) => document.querySelector(s);

// 与报告结构一致的三维度
const DIMS = [
  { key: "language", label: "语言组织" },
  { key: "logic", label: "逻辑清晰度" },
  { key: "emotion", label: "情绪稳定性" },
];
// 维度配色（取自设计 token，避免纯黑）
const DIM_COLOR = {
  language: "#1F4E4A", // 深青绿 accent
  logic: "#6B7C8E",    // 标准档 lvl-std
  emotion: "#B08A4E",  // 高压档 lvl-hard
};
const SCENE_LABEL = { postgrad_interview: "考研复试", campus_recruit: "校招面试", voice: "实时语音对话" };
const LEVEL_LABEL = { gentle: "温和", standard: "标准", hard: "高压", voice: "语音陪练" };

const clamp = (v) => {
  v = Number(v);
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(5, Math.round(v)));
};

/* ---------- 视图切换 ---------- */
export function openDashboard() {
  $("#landing").style.display = "none";
  $("#training").classList.remove("show");
  $("#voiceView").style.display = "none";
  $("#dashboard").classList.add("show");
  renderDashboard();
}
export function closeDashboard() {
  $("#dashboard").classList.remove("show");
  $("#landing").style.display = "block";
}

/* ---------- 数据收集：带报告的训练 / 语音记录 ---------- */
function collectRecords() {
  const list = Storage.listSessions() || [];
  const recs = [];
  list.forEach((s) => {
    if (!s || !s.report || !s.report.scores) return;
    const sc = s.report.scores;
    if (sc.language == null && sc.logic == null && sc.emotion == null) return;
    const mode = s.mode === "voice" ? "voice" : "training";
    recs.push({
      id: s.id,
      mode,
      scene: s.scene || (mode === "voice" ? "voice" : "campus_recruit"),
      level: s.level || (mode === "voice" ? "standard" : "standard"),
      updatedAt: s.updatedAt || 0,
      sceneLabel: mode === "voice" ? "实时语音对话" : (SCENE_LABEL[s.scene] || s.scene || "训练"),
      levelLabel: mode === "voice" ? "语音陪练" : (LEVEL_LABEL[s.level] || s.level || "标准"),
      scores: {
        language: clamp(sc.language),
        logic: clamp(sc.logic),
        emotion: clamp(sc.emotion),
      },
      summary: s.report.summary || "",
      report: s.report,
      advice: s.advice || [],
      transcript: s.transcript || [],
    });
  });
  // 旧 → 新（趋势图 x 轴从左往右递增）
  recs.sort((a, b) => a.updatedAt - b.updatedAt);
  return recs;
}

/* ---------- 渲染 ---------- */
function renderDashboard() {
  const body = $("#dbBody");
  if (!body) return;
  body.innerHTML = "";
  const recs = collectRecords();

  if (!recs.length) {
    body.innerHTML = emptyStateHTML();
    const btn = $("#dbEmptyStart");
    if (btn) btn.onclick = () => document.dispatchEvent(new CustomEvent("mindforge:goto-training"));
    return;
  }

  const total = recs.length;
  const avg = {};
  DIMS.forEach((d) => {
    avg[d.key] = Math.round((recs.reduce((a, r) => a + r.scores[d.key], 0) / total) * 10) / 10;
  });
  const latest = recs[recs.length - 1];

  // 统计卡
  body.insertAdjacentHTML("beforeend", statsHTML(total, avg, latest));
  if (latest.summary) {
    body.insertAdjacentHTML("beforeend",
      '<div class="db-summary">最近一次总评：<b>' + escapeHtml(latest.summary) + "</b></div>");
  }

  // 图表区：雷达 + 趋势
  const chartWrap = document.createElement("div");
  chartWrap.className = "db-charts";
  const radarCard = document.createElement("div");
  radarCard.className = "db-card";
  radarCard.innerHTML =
    '<div class="db-card-h">能力雷达 · 最近一次 vs 历史均值</div>' + radarSVG(latest.scores, avg);
  const trendCard = document.createElement("div");
  trendCard.className = "db-card";
  const show = Math.min(recs.length, 12);
  trendCard.innerHTML =
    '<div class="db-card-h">评分趋势 · 近 ' + show + " 次</div>" + trendSVG(recs.slice(-show));
  chartWrap.append(radarCard, trendCard);
  body.append(chartWrap);

  // 近期记录列表（最新在前）
  const recent = recs.slice().reverse().slice(0, 10);
  const listCard = document.createElement("div");
  listCard.className = "db-card";
  listCard.innerHTML = '<div class="db-card-h">近期记录 <span class="tiny">点击查看完整报告</span></div>';
  const ul = document.createElement("div");
  ul.className = "db-rec-list";
  recent.forEach((r) => ul.insertAdjacentHTML("beforeend", recRowHTML(r)));
  listCard.append(ul);
  body.append(listCard);

  ul.querySelectorAll(".db-rec").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.id;
      const rec = recent.find((x) => x.id === id);
      if (rec) document.dispatchEvent(new CustomEvent("mindforge:open-report", { detail: rec }));
    };
  });
}

/* ---------- HTML 片段 ---------- */
function emptyStateHTML() {
  return (
    '<div class="db-empty">' +
    '<div class="db-empty-ic">📊</div>' +
    "<h3>还没有成长数据</h3>" +
    '<p>完成一次训练或一段实时语音对话后，这里会展示你的评分趋势与能力雷达。</p>' +
    '<button class="btn btn-primary" id="dbEmptyStart">开始第一次训练</button>' +
    "</div>"
  );
}
function statsHTML(total, avg, latest) {
  const card = (n, l) =>
    '<div class="db-stat"><div class="db-stat-n">' + n + '</div><div class="db-stat-l">' + l + "</div></div>";
  return (
    '<div class="db-stats">' +
    card(total, "训练 / 语音记录") +
    card(avg.language.toFixed(1), "平均 · 语言组织") +
    card(avg.logic.toFixed(1), "平均 · 逻辑清晰") +
    card(avg.emotion.toFixed(1), "平均 · 情绪稳定") +
    "</div>"
  );
}
function recRowHTML(r) {
  const date = new Date(r.updatedAt).toLocaleString("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const badge = r.mode === "voice"
    ? '<span class="db-badge voice">语音</span>'
    : '<span class="db-badge train">训练</span>';
  const chips = DIMS.map(
    (d) => '<span class="db-chip" style="--c:' + DIM_COLOR[d.key] + '">' + d.label.slice(0, 2) + " " + r.scores[d.key] + "</span>"
  ).join("");
  return (
    '<div class="db-rec" data-id="' + r.id + '">' +
    '<div class="db-rec-main">' +
    '<div class="db-rec-top">' + badge +
    '<span class="db-rec-scene">' + escapeHtml(r.sceneLabel) + " · " + escapeHtml(r.levelLabel) + "</span>" +
    '<span class="db-rec-date">' + date + "</span></div>" +
    '<div class="db-rec-chips">' + chips + "</div></div>" +
    '<div class="db-rec-go">›</div></div>'
  );
}

/* ---------- SVG 雷达图 ---------- */
function radarSVG(scores, avg) {
  const size = 320, cx = 160, cy = 152, R = 100;
  const n = DIMS.length;
  const ang = (i) => (-Math.PI / 2) + (2 * Math.PI * i) / n;
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const ring = (r) =>
    DIMS.map((d, i) => { const [x, y] = pt(i, r); return x.toFixed(1) + "," + y.toFixed(1); }).join(" ");
  const poly = (vals) =>
    DIMS.map((d, i) => { const [x, y] = pt(i, (vals[d.key] / 5) * R); return x.toFixed(1) + "," + y.toFixed(1); }).join(" ");

  let grid = "";
  for (let k = 1; k <= 5; k++) grid += '<polygon points="' + ring((R * k) / 5) + '" fill="none" style="stroke:var(--line)" stroke-width="1"/>';
  let axes = "";
  DIMS.forEach((d, i) => { const [x, y] = pt(i, R); axes += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" style="stroke:var(--line)" stroke-width="1"/>'; });

  let labels = "";
  DIMS.forEach((d, i) => {
    const [lx, ly] = pt(i, R + 24);
    labels += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" text-anchor="middle" font-size="12" style="fill:var(--ink-500)">' + d.label + "</text>";
    const [vx, vy] = pt(i, (scores[d.key] / 5) * R);
    labels += '<text x="' + vx.toFixed(1) + '" y="' + (vy - 8).toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="700" style="fill:var(--accent)">' + scores[d.key] + "</text>";
  });

  return (
    '<svg class="db-radar" viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="能力雷达图：最近一次与历史均值">' +
    grid + axes +
    '<polygon points="' + poly(avg) + '" style="fill:rgba(111,106,98,.12);stroke:var(--ink-500)" stroke-width="1.5" stroke-dasharray="4 3"/>' +
    '<polygon points="' + poly(scores) + '" style="fill:rgba(31,78,74,.18);stroke:var(--accent)" stroke-width="2.5"/>' +
    labels +
    "</svg>" +
    '<div class="db-legend">' +
    '<span><i class="lg-dot" style="background:var(--accent)"></i>最近一次</span>' +
    '<span><i class="lg-dot" style="background:var(--ink-500)"></i>历史均值</span>' +
    "</div>"
  );
}

/* ---------- SVG 趋势图 ---------- */
function trendSVG(records) {
  const W = 560, H = 240, padL = 32, padR = 14, padT = 16, padB = 26;
  const n = records.length;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const xAt = (i) => padL + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yAt = (v) => padT + innerH * (1 - v / 5);

  let grid = "", yl = "";
  for (let v = 0; v <= 5; v++) {
    const y = yAt(v);
    grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" style="stroke:var(--line)" stroke-width="1"/>';
    yl += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="10" style="fill:var(--ink-400)">' + v + "</text>";
  }

  let lines = "", dots = "";
  DIMS.forEach((d) => {
    const pts = records.map((r, i) => xAt(i).toFixed(1) + "," + yAt(r.scores[d.key]).toFixed(1)).join(" ");
    lines += '<polyline points="' + pts + '" fill="none" stroke="' + DIM_COLOR[d.key] + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
    records.forEach((r, i) => {
      dots += '<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(r.scores[d.key]).toFixed(1) + '" r="3" fill="' + DIM_COLOR[d.key] + '"/>';
    });
  });

  const xa =
    '<text x="' + padL + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" style="fill:var(--ink-400)">最早</text>' +
    '<text x="' + (W - padR) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" style="fill:var(--ink-400)">最新</text>';

  return (
    '<svg class="db-trend" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="评分趋势图（近几次三维度）">' +
    grid + yl + lines + dots + xa +
    "</svg>" +
    '<div class="db-legend">' +
    DIMS.map((d) => '<span><i class="lg-dot" style="background:' + DIM_COLOR[d.key] + '"></i>' + d.label + "</span>").join("") +
    "</div>"
  );
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ---------- 顶部按钮绑定（DOM 已就绪，模块脚本 defer 执行） ---------- */
$("#dbBack").onclick = closeDashboard;
$("#dbStart").onclick = () => document.dispatchEvent(new CustomEvent("mindforge:goto-training"));
