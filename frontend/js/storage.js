// storage.js —— localStorage 封装（隐私 by design，数据可删除，AC-12）
const NS = "mindforge:";
const INDEX_KEY = NS + "index";
const PROFILE_KEY = NS + "profile";   // 训练前填写的背景信息/简历文本

function _read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function _write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export const Storage = {
  // 当前进行中的会话（草稿）
  saveDraft(session) {
    if (!session || !session.id) return;
    _write(NS + "session:" + session.id, session);
    const idx = _read(INDEX_KEY, []);
    if (!idx.includes(session.id)) { idx.push(session.id); _write(INDEX_KEY, idx); }
  },
  getDraft(id) { return _read(NS + "session:" + id, null); },
  listSessions() {
    const idx = _read(INDEX_KEY, []);
    return idx.map((id) => _read(NS + "session:" + id, null)).filter(Boolean);
  },
  deleteSession(id) {
    localStorage.removeItem(NS + "session:" + id);
    const idx = _read(INDEX_KEY, []).filter((x) => x !== id);
    _write(INDEX_KEY, idx);
  },
  clearAll() {
    const idx = _read(INDEX_KEY, []);
    idx.forEach((id) => localStorage.removeItem(NS + "session:" + id));
    localStorage.removeItem(INDEX_KEY);
    localStorage.removeItem(PROFILE_KEY);   // 背景信息一并清除（隐私 by design）
  },
  // 训练前背景信息（院校/专业/求职意向/简历文本）
  saveProfile(p) { if (p) _write(PROFILE_KEY, p); },
  getProfile() { return _read(PROFILE_KEY, null); },
  clearProfile() { localStorage.removeItem(PROFILE_KEY); },
};
