// guardrail_state.js —— 安全护栏前端状态机（暂停/降级/结束/反噬/硬上限）
export const Guardrail = {
  level: "standard",
  phase: "active",          // active | paused | ended
  sessionStart: 0,
  userTurns: 0,
  MAX_TURNS: 40,
  MAX_DURATION_MIN: 20,

  reset(level) {
    this.level = level || "standard";
    this.phase = "active";
    this.sessionStart = Date.now();
    this.userTurns = 0;
  },
  setLevel(l) { this.level = l; },
  getLevel() { return this.level; },
  pause() { if (this.phase === "active") this.phase = "paused"; },
  resume() { if (this.phase === "paused") this.phase = "active"; },
  end() { this.phase = "ended"; },
  isPaused() { return this.phase === "paused"; },
  isEnded() { return this.phase === "ended"; },
  incTurn() { this.userTurns += 1; },

  // 硬上限检查：超轮次/超时 → 返回需要自动降级的信息
  checkLimits() {
    if (this.phase !== "active") return null;
    const overTurns = this.userTurns >= this.MAX_TURNS;
    const overTime = (Date.now() - this.sessionStart) > this.MAX_DURATION_MIN * 60 * 1000;
    if (overTurns || overTime) {
      return { reason: overTurns ? "已达最大轮次" : "已达最长时长", suggest: "建议休息片刻，已为你降到温和档" };
    }
    return null;
  },
};
