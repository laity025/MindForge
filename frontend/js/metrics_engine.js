// metrics_engine.js —— 填充词/句长/停顿 正则统计（与后端同源词典，前端即时渲染）
// 单一真相源：从后端 /api/config/filler 拉取；拉取失败回退内嵌副本。

const EMBEDDED = {
  fillers: ["嗯","啊","呃","额","哦","呀","那个","这个","就是说","然后","其实","其实呢","基本上","怎么说呢","你知道吧","对吧","是吧","可能吧","好像","大概","就是","的话","然后说"],
  thresholds: { filler_per_k: { good: 15, warn: 30 }, avg_sentence_len: { min_good: 10, max_good: 42 } },
  nerve_signals: ["紧张","怕","不会","不行","不确定","没信心","焦虑","慌","垮","崩","不敢"],
  rebound_signals: ["我不行了","想退出","受不了","崩溃","撑不住","放弃","太难了","想哭","不想继续","要退"],
};

let CFG = EMBEDDED;
let FILLER_RE = null;

async function loadConfig() {
  try {
    const r = await fetch("/api/config/filler");
    if (r.ok) CFG = await r.json();
  } catch { /* 离线回退内嵌 */ }
  const list = (CFG.fillers || []).slice().sort((a, b) => b.length - a.length);
  FILLER_RE = new RegExp("(" + list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")+", "gi");
}

function _re(signals) {
  return new RegExp("(" + (signals || []).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")");
}

export const MetricsEngine = {
  init: loadConfig,

  // 对单条用户作答计算指标（与后端算法一致）
  compute(text) {
    text = text || "";
    const chars = text.replace(/\s/g, "").length;
    const fillers = FILLER_RE ? (text.match(FILLER_RE) || []).length : 0;
    const filler_per_k = chars ? Math.round((fillers / chars) * 1000) : 0;
    const sents = text.split(/[。！？!?；;\n]/).filter((s) => s.trim());
    const avg_len = sents.length ? Math.round(chars / sents.length) : 0;

    const t = CFG.thresholds || EMBEDDED.thresholds;
    let pace = "normal", pace_level = "good";
    if (avg_len > t.avg_sentence_len.max_good) { pace = "long"; pace_level = "warn"; }
    else if (avg_len && avg_len < t.avg_sentence_len.min_good) { pace = "short"; pace_level = "warn"; }

    const fg = t.filler_per_k.good, fw = t.filler_per_k.warn;
    const filler_level = filler_per_k > fw ? "bad" : filler_per_k > fg ? "warn" : "good";
    const lo = t.avg_sentence_len.min_good, hi = t.avg_sentence_len.max_good;
    const len_level = lo <= avg_len && avg_len <= hi ? "good" : "warn";

    return {
      filler_count: fillers, filler_per_k, avg_sentence_len: avg_len,
      pause_est: pace, pace_level, filler_level, len_level, chars,
    };
  },

  detectNerve(text) { return _re(CFG.nerve_signals).test(text || ""); },
  detectRebound(text) { return _re(CFG.rebound_signals).test(text || ""); },

  // 渲染到教练侧栏（阈值色：绿/黄/红，红仅提示不恐慌）
  render(m, els) {
    const lvlColor = { good: "var(--metric-good)", warn: "var(--metric-warn)", bad: "var(--metric-bad)" };
    const lvlText = { good: "良好", warn: "留意", bad: "偏高" };
    if (els.filler) {
      els.filler.textContent = m.filler_per_k + " 次/千字";
      els.dotFiller.style.background = lvlColor[m.filler_level];
      els.filler.title = "填充词 " + lvlText[m.filler_level];
    }
    if (els.len) {
      els.len.textContent = (m.avg_sentence_len ? m.avg_sentence_len + " 字" : "— 字");
      els.dotLen.style.background = lvlColor[m.len_level];
    }
    if (els.pace) {
      const paceMap = { normal: ["适中", "good"], long: ["偏长", "warn"], short: ["偏碎", "warn"] };
      const [ptxt, pl] = paceMap[m.pause_est] || ["—", "good"];
      els.pace.textContent = ptxt;
      els.dotPace.style.background = lvlColor[pl];
    }
  },
};
