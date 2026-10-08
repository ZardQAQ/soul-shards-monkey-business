// 速通榜：按 NodeLoc nl:{id} 持久化到 data/profiles.json
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'profiles.json');
const NL_PREFIX = 'nl:';
/** 110 碎片通关合理下限（毫秒），过短视为异常 */
const MIN_TIME_MS = 30 * 1000;
const MAX_TIME_MS = 24 * 60 * 60 * 1000;

/** @type {Record<string, object>} */
let profiles = {};
let saveTimer = null;

function nlKey(id) {
  return NL_PREFIX + String(id);
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function blankProfile(name, nodelocId) {
  return {
    name: name || '',
    nodelocId: nodelocId != null ? Number(nodelocId) : null,
    bestTimeMs: null,
    runs: 0,
    last: 0,
  };
}

function load() {
  ensureDir();
  try {
    if (!fs.existsSync(FILE)) {
      profiles = {};
      fs.writeFileSync(FILE, '{}\n', 'utf8');
      return;
    }
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    profiles = raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    console.error('[leaderboard] load failed:', e.message || e);
    profiles = {};
  }
}

function saveNow() {
  ensureDir();
  try {
    fs.writeFileSync(FILE, JSON.stringify(profiles, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.error('[leaderboard] save failed:', e.message || e);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 400);
}

function formatTime(ms) {
  const t = Math.max(0, Math.floor(Number(ms) || 0));
  const mm = Math.floor(t / 60000);
  const ss = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function top(n = 20) {
  return Object.values(profiles)
    .filter((p) => p && p.name && p.bestTimeMs != null && p.bestTimeMs > 0)
    .map((p) => ({
      n: String(p.name).slice(0, 12),
      t: p.bestTimeMs | 0,
      tf: formatTime(p.bestTimeMs),
      runs: p.runs | 0,
    }))
    .sort((a, b) => a.t - b.t || a.n.localeCompare(b.n))
    .slice(0, n);
}

/**
 * @param {{ id: number|string, username?: string, name?: string }} user
 * @param {number} timeMs
 */
function submit(user, timeMs) {
  if (!user || user.id == null || user.id === '') {
    return { ok: false, error: '需要 NodeLoc 登录才能上榜' };
  }
  const ms = Math.round(Number(timeMs));
  if (!Number.isFinite(ms) || ms < MIN_TIME_MS) {
    return { ok: false, error: '成绩无效（用时过短）' };
  }
  if (ms > MAX_TIME_MS) {
    return { ok: false, error: '成绩无效（用时过长）' };
  }

  const name = String(user.username || user.name || '')
    .replace(/[<>&"']/g, '')
    .trim()
    .slice(0, 12);
  if (!name) return { ok: false, error: '无效的 NodeLoc 昵称' };

  const key = nlKey(user.id);
  let prof = profiles[key];
  if (!prof || typeof prof !== 'object') {
    prof = blankProfile(name, user.id);
    profiles[key] = prof;
  }

  // 名字始终强制同步为 NodeLoc 站点名
  prof.name = name;
  prof.nodelocId = Number(user.id) || user.id;
  prof.runs = (prof.runs | 0) + 1;
  prof.last = Date.now();

  const prev = prof.bestTimeMs;
  const improved = prev == null || ms < prev;
  if (improved) prof.bestTimeMs = ms;

  scheduleSave();
  return {
    ok: true,
    improved,
    bestTimeMs: prof.bestTimeMs,
    bestTime: formatTime(prof.bestTimeMs),
    submittedMs: ms,
    submitted: formatTime(ms),
    name,
    board: top(20),
  };
}

load();

module.exports = {
  top,
  submit,
  formatTime,
  MIN_TIME_MS,
};
