'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const oauthNl = require('../server/oauth-nodeloc');
const board = require('../server/leaderboard');

const PORT = Number(process.env.PORT) || 8765;
const ROOT = path.resolve(__dirname, '..');
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

function parseUrl(req) {
  const raw = req.url || '/';
  const u = new URL(raw, `http://${req.headers.host || '127.0.0.1'}`);
  const query = {};
  for (const [k, v] of u.searchParams.entries()) query[k] = v;
  return { pathname: u.pathname, query };
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath);
  const rel = decoded === '/' ? '/index.html' : decoded;
  const full = path.normalize(path.join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const filePath = safeJoin(ROOT, pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

async function handleApi(req, res, pathname, query) {
  if (pathname === '/oauth/nodeloc' && req.method === 'GET') {
    req.query = query;
    await oauthNl.route(req, res, query);
    return true;
  }
  if (pathname === '/api/oauth/me' && req.method === 'GET') {
    oauthNl.me(req, res);
    return true;
  }
  if (pathname === '/api/oauth/logout' && req.method === 'POST') {
    oauthNl.logout(req, res);
    return true;
  }
  if (pathname === '/api/leaderboard' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, board: board.top(20) });
    return true;
  }
  if (pathname === '/api/leaderboard/submit' && req.method === 'POST') {
    const user = oauthNl.userFromReq(req);
    if (!user) {
      sendJson(res, 401, { ok: false, error: '请先使用 NodeLoc 登录' });
      return true;
    }
    let payload = {};
    try {
      const raw = await readBody(req);
      payload = raw ? JSON.parse(raw) : {};
    } catch (_) {
      sendJson(res, 400, { ok: false, error: '无效的请求体' });
      return true;
    }
    const timeMs = payload.timeMs != null ? payload.timeMs : Math.round(Number(payload.time) * 1000);
    const result = board.submit(user, timeMs);
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname, query } = parseUrl(req);
    const handled = await handleApi(req, res, pathname, query);
    if (handled) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[serve]', e);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log('灵魂碎片 · Monkey Business');
  console.log(`Serving: ${ROOT}`);
  console.log(`Open:    ${url}`);
  console.log(`OAuth:   ${oauthNl.enabled() ? oauthNl.REDIRECT_URI : 'disabled'}`);
  console.log('Press Ctrl+C to stop.');
  if (process.env.NO_OPEN === '1') return;
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
});
