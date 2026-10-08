// NodeLoc OAuth2：授权码流程 + 签名会话 Cookie（无 express-session）
'use strict';
const crypto = require('crypto');

const BASE_URL = (process.env.NodeLoc_URL || process.env.NODELOC_URL || 'https://www.nodeloc.com').replace(/\/$/, '');
const CLIENT_ID = process.env.NodeLoc_CLIENT_ID || process.env.NODELOC_CLIENT_ID || '2c0fd492-c87d-4d30-8dcb-8cc721778b03';
const CLIENT_SECRET = process.env.NodeLoc_CLIENT_SECRET || process.env.NODELOC_CLIENT_SECRET
  || 'ecf6ca24bef08f0a617705ad8e713c908e478f072fc0a1a60b3a4fc346ee50ac';
const REDIRECT_URI = process.env.NodeLoc_REDIRECT_URI || process.env.NODELOC_REDIRECT_URI
  || 'http://pacman.zard.loc.cc/oauth/nodeloc';
const HOME_URL = process.env.HOME_URL || 'http://pacman.zard.loc.cc/';
const SCOPE = process.env.NodeLoc_SCOPE || process.env.NODELOC_SCOPE || 'openid profile';
const COOKIE_SESSION = 'ss_nl';
const COOKIE_STATE = 'ss_nl_state';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const SIGN_SECRET = process.env.NODELOC_SESSION_SECRET
  || process.env.SESSION_SECRET
  || CLIENT_SECRET
  || 'soul-shards-nodeloc';

function enabled() {
  return !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

function oauthOrigin() {
  try { return new URL(REDIRECT_URI).origin; } catch (_) { return ''; }
}

function homeRedirect(query) {
  try {
    const u = new URL(HOME_URL);
    if (query && typeof query === 'object') {
      for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== '') u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  } catch (_) {
    const q = query && query.oauth_error
      ? '?oauth_error=' + encodeURIComponent(query.oauth_error)
      : (query && query.oauth === '1'
        ? '?oauth=1&name=' + encodeURIComponent(query.name || '')
        : '/');
    return q.startsWith('?') ? '/' + q : q;
  }
}

function loginStartUrl() {
  try {
    return new URL(REDIRECT_URI).toString();
  } catch (_) {
    return '/oauth/nodeloc';
  }
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadObj) {
  const body = b64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', SIGN_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.indexOf('.');
  if (i < 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SIGN_SECRET).update(body).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data !== 'object') return null;
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function parseCookie(req, name) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return '';
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function bearerToken(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!h || typeof h !== 'string') return '';
  const m = /^Bearer\s+(\S+)/i.exec(h);
  return m ? m[1] : '';
}

function cookieSecure(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  if (String(REDIRECT_URI).startsWith('https://')) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

function cookieFlags(req, maxAgeSec) {
  const parts = [`Path=/`, `Max-Age=${maxAgeSec}`, `SameSite=Lax`, `HttpOnly`];
  if (cookieSecure(req)) parts.push('Secure');
  return parts.join('; ');
}

function appendCookie(res, line) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', line);
  else if (Array.isArray(prev)) res.setHeader('Set-Cookie', prev.concat(line));
  else res.setHeader('Set-Cookie', [prev, line]);
}

function makeSessionToken(user) {
  return sign({
    id: user.id,
    username: user.username || '',
    name: user.name || user.username || '',
    trust_level: user.trust_level | 0,
    avatar_url: user.avatar_url || '',
    exp: Date.now() + SESSION_TTL_MS,
  });
}

function setSessionCookie(res, req, user, tokenOpt) {
  const token = tokenOpt || makeSessionToken(user);
  appendCookie(res, `${COOKIE_SESSION}=${encodeURIComponent(token)}; ${cookieFlags(req, Math.floor(SESSION_TTL_MS / 1000))}`);
  return token;
}

function clearSessionCookie(res, req) {
  const secure = cookieSecure(req) ? '; Secure' : '';
  appendCookie(res, `${COOKIE_SESSION}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secure}`);
}

function setStateCookie(res, req, state) {
  const token = sign({ state, exp: Date.now() + STATE_TTL_MS });
  appendCookie(res, `${COOKIE_STATE}=${encodeURIComponent(token)}; ${cookieFlags(req, Math.floor(STATE_TTL_MS / 1000))}`);
}

function clearStateCookie(res, req) {
  const secure = cookieSecure(req) ? '; Secure' : '';
  appendCookie(res, `${COOKIE_STATE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secure}`);
}

function userFromToken(token) {
  const data = verify(token);
  if (!data || data.id == null || data.id === '') return null;
  return {
    id: data.id,
    username: String(data.username || ''),
    name: String(data.name || data.username || ''),
    trust_level: data.trust_level | 0,
    avatar_url: String(data.avatar_url || ''),
  };
}

function userFromReq(req) {
  return userFromToken(parseCookie(req, COOKIE_SESSION))
    || userFromToken(bearerToken(req));
}

function siteName(user) {
  if (!user) return '';
  return String(user.username || user.name || '').replace(/[<>&"']/g, '').trim().slice(0, 12);
}

function authorizeUrl(state) {
  const u = new URL(BASE_URL + '/oauth-provider/authorize');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('state', state);
  return u.toString();
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(BASE_URL + '/oauth-provider/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  if (!res.ok || !json || !json.access_token) {
    const msg = (json && (json.error_description || json.error)) || text.slice(0, 200) || ('HTTP ' + res.status);
    throw new Error('换取 token 失败: ' + msg);
  }
  return json;
}

async function fetchUserInfo(accessToken) {
  const res = await fetch(BASE_URL + '/oauth-provider/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  if (!res.ok || !json || json.id == null) {
    const msg = (json && (json.error_description || json.error || json.message)) || text.slice(0, 200) || ('HTTP ' + res.status);
    throw new Error('获取用户信息失败: ' + msg);
  }
  return {
    id: json.id,
    username: String(json.username || json.name || ('nl' + json.id)),
    name: String(json.name || json.username || ('nl' + json.id)),
    avatar_url: String(json.avatar_url || ''),
    trust_level: json.trust_level | 0,
    email: json.email ? String(json.email) : '',
  };
}

function pageMsg(title, body, href) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#120818;color:#f0e0ff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{max-width:420px;padding:28px;border:1px solid rgba(187,68,255,.35);border-radius:4px;background:rgba(20,8,28,.95)}
a{color:#bb44ff}</style></head><body><div class="card"><h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
<p style="line-height:1.5;color:#c0a8d0">${body}</p><p><a href="${href}">返回游戏</a></p></div></body></html>`;
}

function startLogin(req, res) {
  if (!enabled()) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pageMsg('未配置 NodeLoc OAuth', '缺少 Client ID / Secret / Redirect URI。', '/'));
    return;
  }
  const state = crypto.randomBytes(16).toString('hex');
  setStateCookie(res, req, state);
  res.writeHead(302, { Location: authorizeUrl(state) });
  res.end();
}

function readState(req) {
  return verify(parseCookie(req, COOKIE_STATE));
}

async function handleCallback(req, res, query) {
  const code = query.code;
  const state = query.state;
  const error = query.error;
  const errDesc = query.error_description;
  const stateData = readState(req);
  clearStateCookie(res, req);

  if (error) {
    const tip = error === 'access_denied' ? '你取消了 NodeLoc 授权。' : ('授权失败：' + (errDesc || error));
    res.writeHead(302, { Location: homeRedirect({ oauth_error: tip }) });
    res.end();
    return;
  }
  if (!code) {
    res.writeHead(302, { Location: homeRedirect({ oauth_error: '缺少授权码' }) });
    res.end();
    return;
  }
  if (!(stateData && stateData.state && state && stateData.state === state)) {
    res.writeHead(302, { Location: homeRedirect({ oauth_error: '登录状态校验失败，请重试' }) });
    res.end();
    return;
  }

  try {
    const token = await exchangeCode(code);
    const user = await fetchUserInfo(token.access_token);
    setSessionCookie(res, req, user);
    const nameHint = siteName(user);
    res.writeHead(302, { Location: homeRedirect({ oauth: '1', name: nameHint }) });
    res.end();
  } catch (e) {
    console.error('[oauth-nodeloc]', e.message || e);
    res.writeHead(302, { Location: homeRedirect({ oauth_error: e.message || '登录失败' }) });
    res.end();
  }
}

function logout(req, res) {
  clearSessionCookie(res, req);
  json(res, 200, { ok: true });
}

function me(req, res) {
  const user = userFromReq(req);
  json(res, 200, {
    ok: true,
    enabled: enabled(),
    loggedIn: !!user,
    user: user
      ? { id: user.id, username: user.username, name: user.name, avatar_url: user.avatar_url }
      : null,
    loginUrl: loginStartUrl(),
    redirectUri: REDIRECT_URI,
    oauthOrigin: oauthOrigin(),
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function route(req, res, query) {
  if (query.code || query.error) {
    try {
      await handleCallback(req, res, query);
    } catch (e) {
      console.error('[oauth-nodeloc] callback crash:', e);
      if (!res.headersSent) {
        res.writeHead(302, { Location: homeRedirect({ oauth_error: '登录回调异常，请重试' }) });
        res.end();
      }
    }
    return;
  }
  return startLogin(req, res);
}

module.exports = {
  enabled,
  userFromReq,
  siteName,
  logout,
  me,
  route,
  loginStartUrl,
  REDIRECT_URI,
  json,
};
