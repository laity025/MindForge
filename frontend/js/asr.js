// asr.js —— 语音输入双通道：
//   ① 浏览器原生（Web Speech API，zh-CN）：质量好，但依赖境外远程语音服务（大陆网络延迟敏感、精度飘）
//   ② Vosk 离线识别（WASM，模型本地 42MB）：完全离线、零延迟、音频不出设备
// 通道策略：Edge 默认走离线（远程服务在大陆体验差）；Chrome 原生优先，network / service-not-allowed
// 或浏览器不支持时自动降级离线。离线通道内置自适应音量增益（小声也能识别）。

let mode = null;              // "native" | "vosk"
let preferVosk = /Edg\//.test(navigator.userAgent);   // Edge 默认离线；原生网络失败后也置位
let active = false;

let onInterimCb = null, onFinalCb = null, onStateCb = null, onTurnCb = null, onFrameCb = null;

/* ---------- ① 浏览器原生通道 ---------- */
let rec = null, restarting = false, nativeFinal = "";

function _SR() { return window.SpeechRecognition || window.webkitSpeechRecognition; }

function _nativeRestart() {
  if (!active || mode !== "native") return;
  try { rec.start(); } catch { /* 已在运行则忽略 */ }
}

function startNative() {
  mode = "native"; active = true;
  const SR = _SR();
  rec = new SR();
  rec.lang = "zh-CN";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  nativeFinal = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) nativeFinal += r[0].transcript;
      else interim += r[0].transcript;
    }
    onInterimCb && onInterimCb(nativeFinal + interim);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      ASR.stop();
      onStateCb && onStateCb("error", "未获得麦克风权限，请在浏览器设置中允许后重试");
    } else if (e.error === "network") {
      // 原生语音服务不可达（常见于大陆网络）→ 自动降级离线识别
      ASR.stop();
      preferVosk = true;
      onStateCb && onStateCb("fallback");
      ASR.start({ onInterim: onInterimCb, onFinal: onFinalCb, onState: onStateCb });
    }
    // no-speech / audio-capture：交给 onend 重启续听
  };
  rec.onend = () => {
    if (active && mode === "native") {
      if (!restarting) {
        restarting = true;
        setTimeout(() => { restarting = false; _nativeRestart(); }, 200);
      }
    } else {
      onFinalCb && onFinalCb(nativeFinal);
    }
  };
  try {
    rec.start();
    onStateCb && onStateCb("on");
  } catch (e) {
    active = false;
    onStateCb && onStateCb("error", "语音启动失败：" + (e.message || "请重试"));
  }
}

function stopNative() {
  active = false;
  try { rec && rec.stop(); } catch {}
}

/* ---------- ② Vosk 离线通道（音频不出设备） ---------- */
let modelPromise = null;
let voskRec = null, voskCtx = null, voskNode = null, voskSink = null, voskStream = null, voskFinal = "";

function _getVoskModel() {
  if (!window.Vosk) return Promise.reject(new Error("离线语音组件未加载"));
  if (!modelPromise) modelPromise = window.Vosk.createModel("/vosk/model.tar.gz");
  return modelPromise;
}

async function startVosk() {
  mode = "vosk"; active = true;
  voskFinal = "";
  onStateCb && onStateCb("loading");   // 首次需加载模型（本地 42MB，之后缓存）
  try {
    const model = await _getVoskModel();
    if (!active || mode !== "vosk") return;   // 用户已取消或已切换
    voskRec = new model.KaldiRecognizer(16000);   // 必须传采样率，否则识别器不就绪、音频全被丢弃
    voskRec.on("partialresult", (m) => {
      const p = (m.result && m.result.partial) || "";
      onInterimCb && onInterimCb(voskFinal + p);   // 实时回显：已确认段 + 当前未定段
    });
    voskRec.on("result", (m) => {
      const t = (m.result && m.result.text) || "";
      voskFinal += t;   // 多段累加（此前覆盖导致只保留最后一段，其余丢失）
      onInterimCb && onInterimCb(voskFinal);
      onTurnCb && onTurnCb(t);   // 分段结束事件（语音对话自动轮转用，传当前段）
    });
    voskStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 16000 },
    });
    if (!active || mode !== "vosk") { stopVosk(); return; }
    voskCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const src = voskCtx.createMediaStreamSource(voskStream);
    voskNode = voskCtx.createScriptProcessor(4096, 1, 1);
    voskNode.onaudioprocess = (e) => {
      // 自适应增益（AGC）：目标 RMS≈0.18，小声自动放大（最多 8 倍≈18dB），限幅防削波；静音不放大避免噪声被抬升
      const data = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length) || 1e-6;
      const gain = rms < 0.012 ? 1 : Math.min(0.18 / rms, 8);
      for (let i = 0; i < data.length; i++) {
        let v = data[i] * gain;
        data[i] = v > 0.95 ? 0.95 : v < -0.95 ? -0.95 : v;
      }
      e.outputBuffer.getChannelData(0).set(data);
      onFrameCb && onFrameCb(data);   // 提供 16k 增益后的帧数据（语音对话精准识别用）
      try { voskRec.acceptWaveformFloat(data, 16000); }   // 显式传采样率与帧数据
      catch (err) { console.error("[MindForge] acceptWaveform 失败:", err); }   // 不再静默吞错
    };
    voskSink = voskCtx.createMediaStreamDestination();   // 静默汇点，避免回放造成啸叫
    src.connect(voskNode); voskNode.connect(voskSink);
    onStateCb && onStateCb("on");
  } catch (e) {
    active = false; mode = null;
    modelPromise = null;   // 加载失败允许下次重试
    onStateCb && onStateCb("error", "离线语音启动失败：" + (e.message || "请重试"));
  }
}

function stopVosk() {
  active = false; mode = null;
  if (voskNode) { try { voskNode.disconnect(); } catch {} voskNode = null; }
  if (voskSink) { try { voskSink.disconnect(); } catch {} voskSink = null; }
  if (voskCtx) { try { voskCtx.close(); } catch {} voskCtx = null; }
  if (voskStream) { try { voskStream.getTracks().forEach((t) => t.stop()); } catch {} voskStream = null; }
  if (voskRec) { try { voskRec.free && voskRec.free(); } catch {} voskRec = null; }
  onFinalCb && onFinalCb(voskFinal);
}

/* ---------- 对外接口 ---------- */
export const ASR = {
  supported() { return !!(_SR() || window.Vosk); },
  get active() { return active; },
  get usingVosk() { return mode === "vosk"; },
  start(cbs) {
    if (active) return;
    onInterimCb = cbs.onInterim; onFinalCb = cbs.onFinal; onStateCb = cbs.onState; onTurnCb = cbs.onTurn; onFrameCb = cbs.onFrame;
    if (_SR() && !preferVosk) startNative();
    else startVosk();
  },
  stop() {
    if (!active) return;
    if (mode === "vosk") stopVosk();
    else stopNative();
  },
};
