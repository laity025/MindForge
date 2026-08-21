// emotion_engine.js —— 语音情绪"提示信号"（本地近似，非专业情绪识别）
// 信号源：① ASR 文本情绪词（紧张/激动/低落词典） ② 语速（识别字数/时长） ③ 麦克风音量 RMS
// 全部在本机计算，音频不上传。输出仅作提示，标注公平性局限（文化/性别/环境/设备差异可能误判），不做任何评价或决策依据。

let stream = null;
let audioCtx = null;
let analyser = null;
let rafId = 0;
let volSamples = [];
let lastRms = -60;   // 最新一帧 RMS（dB），供波形可视化实时读取

async function ensureMic() {
  if (stream) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    return true;
  } catch {
    return false;   // 无麦克风权限/设备时，仅保留文本+语速信号
  }
}

function _rmsDb() {
  if (!analyser) return -60;
  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length) || 1e-6;
  return 20 * Math.log10(rms);
}

function _monitor() {
  lastRms = _rmsDb();
  volSamples.push(lastRms);
  rafId = requestAnimationFrame(_monitor);
}

function _stopMonitor() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

// 文本情绪词典（与 nerve/rebound 信号互补；仅"提示"，不评判）
const LEXICON = {
  tension: ["紧张", "慌", "焦虑", "担心", "怕", "不行", "压力", "脑子一片空白", "忘词"],
  agitation: ["气死", "烦死", "受够了", "凭什么", "太过分", "火大", "忍不了"],
  low: ["没信心", "绝望", "垮", "崩", "撑不住", "放弃", "不想继续", "我完了", "太差了"],
};

export const EmotionEngine = {
  async start() {
    volSamples = [];
    const ok = await ensureMic();
    if (ok) _monitor();
    return ok;
  },
  stop() {
    _stopMonitor();
  },
  // 实时音量（dB，无分析器时返回 -60）—— 供波形可视化
  liveRms() {
    return analyser ? lastRms : -60;
  },

  // 综合文本/语速/音量 → 提示信号（text=识别文本，elapsedSec=录音时长）
  analyze(text, elapsedSec) {
    const t = (text || "").trim();
    if (!t) return null;

    // ① 文本情绪词
    const textHits = [];
    Object.entries(LEXICON).forEach(([k, words]) => {
      if (words.some((w) => t.includes(w))) textHits.push(k);
    });

    // ② 语速（字/秒）
    const cps = elapsedSec > 0 ? t.replace(/\s/g, "").length / elapsedSec : 0;
    const speed = cps < 1.2 ? "偏慢" : cps > 4.5 ? "偏快" : "正常";

    // ③ 音量（dBFS 均值）
    let volume = null;
    if (volSamples.length > 10) {
      const meanDb = volSamples.reduce((a, b) => a + b, 0) / volSamples.length;
      volume = meanDb > -18 ? "偏高" : meanDb < -36 ? "偏低" : "适中";
    }

    const parts = [];
    if (textHits.includes("agitation")) parts.push("文本含激动表达");
    else if (textHits.includes("tension")) parts.push("文本含紧张表达");
    else if (textHits.includes("low")) parts.push("文本含低落表达");
    if (speed !== "正常") parts.push("语速" + speed);
    if (volume && volume !== "适中") parts.push("音量" + volume);

    if (!parts.length) return null;   // 无明显信号 → 不打扰
    return {
      summary: "可能处于" + (textHits.includes("agitation") ? "激动" : textHits.includes("low") ? "低落" : "紧张") + "状态",
      detail: parts.join("、"),
    };
  },
};
