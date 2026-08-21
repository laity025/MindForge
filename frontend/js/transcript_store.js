// transcript_store.js —— 共享上下文（黑板）+ 本地指标聚合 + 持久化
import { Storage } from "./storage.js";
import { MetricsEngine } from "./metrics_engine.js";

export const TranscriptStore = {
  transcript: [],        // [{role:'user'|'interviewer', content}]
  agg: { userTurns: 0, fillerSum: 0, lenSum: 0, nerve: false, lastPace: "normal" },
  sessionId: null,
  report: null,          // 结案报告（仅本地持久化，供历史回放）
  adviceHistory: [],     // 本轮教练建议（累积，报告与回放共用）

  reset(sessionId) {
    this.transcript = [];
    this.agg = { userTurns: 0, fillerSum: 0, lenSum: 0, nerve: false, lastPace: "normal" };
    this.sessionId = sessionId;
    this.report = null;
    this.adviceHistory = [];
  },

  recordAdvice(items) {
    if (!Array.isArray(items) || !items.length) return;
    const seen = new Set(this.adviceHistory);
    const fresh = items.filter((t) => t && !seen.has(t));
    this.adviceHistory.push(...fresh);
    if (this.adviceHistory.length > 12) this.adviceHistory = this.adviceHistory.slice(-12); // 仅保留最近 12 条
    this._persist();
  },

  // 从本地草稿恢复会话（刷新/断线后继续训练）：重建对话与指标聚合
  restore(d) {
    this.sessionId = d.id;
    this._scene = d.scene; this._level = d.level;
    this.transcript = d.transcript || [];
    this.report = d.report || null;
    this.adviceHistory = Array.isArray(d.advice) ? d.advice : [];
    this.agg = { userTurns: 0, fillerSum: 0, lenSum: 0, nerve: false, lastPace: "normal" };
    this.transcript.forEach((m) => {
      if (m.role !== "user" || typeof m.content !== "string") return;
      try {
        const mm = MetricsEngine.compute(m.content);
        const a = this.agg;
        a.userTurns += 1;
        a.fillerSum += mm.filler_per_k;
        a.lenSum += mm.avg_sentence_len;
        a.lastPace = mm.pause_est;
        if (MetricsEngine.detectNerve(m.content)) a.nerve = true;
      } catch { /* 单条异常不影响整体恢复 */ }
    });
  },

  pushUser(text, metrics) {
    this.transcript.push({ role: "user", content: text });
    const a = this.agg;
    a.userTurns += 1;
    a.fillerSum += metrics.filler_per_k;
    a.lenSum += metrics.avg_sentence_len;
    a.lastPace = metrics.pause_est;
    if (MetricsEngine.detectNerve(text)) a.nerve = true;
    this._persist();
  },

  pushInterviewer(text) {
    this.transcript.push({ role: "interviewer", content: text });
    this._persist();
  },

  getTranscript() { return this.transcript.slice(); },

  // 汇总给分析师报告的本地客观统计
  localMetrics() {
    const a = this.agg;
    return {
      filler_per_k: a.userTurns ? Math.round(a.fillerSum / a.userTurns) : 0,
      avg_sentence_len: a.userTurns ? Math.round(a.lenSum / a.userTurns) : 0,
      pause_est: a.lastPace,
      turns: a.userTurns,
      nerve: a.nerve,
    };
  },

  setReport(report) { this.report = report; this._persist(); },

  _persist() {
    if (!this.sessionId) return;
    Storage.saveDraft({
      id: this.sessionId,
      scene: this._scene, level: this._level,
      transcript: this.transcript,
      metrics: this.localMetrics(),
      advice: this.adviceHistory,
      report: this.report,
      updatedAt: Date.now(),
    });
  },
  setMeta(scene, level) { this._scene = scene; this._level = level; this._persist(); },
};
