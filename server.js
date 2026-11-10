#!/usr/bin/env node
/* 抽屉工作台 · 本地服务（仅用 Node 内置模块 http/fs/path/crypto） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 4780;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'links.json');
const UNC = '未分类';
const GHOST_MD5 = 'b8a0bf372c762e966cc99ede8682bc71';

let data = { links: [], categories: [] };

/* ---------- 数据持久化 ---------- */

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    data = { links: [], categories: [] };
    saveData();
    return;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed)) data = { links: parsed, categories: [] };
    else if (parsed && typeof parsed === 'object') {
      data = {
        links: Array.isArray(parsed.links) ? parsed.links : [],
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      };
    } else data = { links: [], categories: [] };
  } catch {
    data = { links: [], categories: [] };
  }
  if (!Array.isArray(data.categories)) {
    const seen = new Set();
    for (const l of data.links) {
      const c = String(l.category || '').trim();
      if (c && c !== UNC && !seen.has(c)) seen.add(c);
    }
    data.categories = [...seen];
    saveData();
  }
}

/* ---------- 工具 ---------- */

function normalizeUrl(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hostname = u.hostname.toLowerCase();
  let out = u.toString();
  const i = out.indexOf('#');
  if (i !== -1) out = out.slice(0, i);
  if (u.pathname === '/') out = out.replace(/\/(?=\?|$)/, '');
  return out;
}

function profileOf(l) {
  return String(l.profile || '').trim() || '默认';
}

function inCat(c, cat) {
  c = String(c || '');
  return c === cat || c.startsWith(cat + '/');
}

function addCategory(name) {
  const c = String(name || '').trim();
  if (!c || c === UNC) return;
  if (!data.categories.includes(c)) data.categories.push(c);
}

function sendText(res, code, text) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const t = await readBody(req);
  if (!t.trim()) return {};
  try { return JSON.parse(t); } catch { throw new BadJson(); }
}

class BadJson extends Error {
  constructor() { super('invalid json'); this.status = 400; this.msg = '请求体不是有效的 JSON'; }
}

/* ---------- API ---------- */

async function api(req, res, pathname, sp) {
  const m = req.method;
  const seg = pathname.slice(4).split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });

  /* ----- /api/links ----- */
  if (seg[0] === 'links') {
    if (seg.length === 1) {
      if (m === 'GET') {
        return sendJson(res, 200, { links: data.links, categories: data.categories || [] });
      }
      if (m === 'POST') {
        let body;
        try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.msg || e.message }); }
        const url = normalizeUrl(body.url);
        if (!url) return sendJson(res, 400, { error: '网址格式不正确' });
        const profile = String(body.profile || '').trim() || '默认';
        const title = String(body.title || '').trim();
        const category = String(body.category || '').trim();
        const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
        const note = String(body.note || '');
        const source = String(body.source || 'manual');

        const existing = data.links.find((l) => l.url === url && profileOf(l) === profile);
        if (existing) {
          if (title) existing.title = title;
          if (category && category !== UNC) { existing.category = category; addCategory(category); }
          if (tags.length) {
            const set = new Set(existing.tags || []);
            tags.forEach((t) => set.add(t));
            existing.tags = [...set];
          }
          if (note) existing.note = note;
          saveData();
          return sendJson(res, 200, { link: existing, duplicated: true });
        }
        const link = {
          id: crypto.randomUUID(),
          title: title || url,
          url,
          category: category || UNC,
          profile,
          tags,
          note,
          source,
          createdAt: new Date().toISOString(),
        };
        data.links.unshift(link);
        addCategory(category);
        saveData();
        return sendJson(res, 201, { link });
      }
      if (m === 'DELETE') {
        const cat = sp.get('category');
        let deleted = 0;
        if (cat) {
          const before = data.links.length;
          data.links = data.links.filter((l) => l.category !== cat);
          deleted = before - data.links.length;
        } else {
          deleted = data.links.length;
          data.links = [];
        }
        saveData();
        return sendJson(res, 200, { ok: true, deleted });
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    /* /api/links/:id */
    const id = seg[1];
    if (!/^[\w-]+$/.test(id)) return sendJson(res, 404, { error: '条目不存在' });
    const idx = data.links.findIndex((l) => l.id === id);
    if (idx === -1) return sendJson(res, 404, { error: '条目不存在' });
    if (m === 'PUT') {
      let body;
      try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.msg || e.message }); }
      const link = data.links[idx];
      if ('title' in body) link.title = String(body.title);
      if ('note' in body) link.note = String(body.note);
      if ('url' in body) {
        const u = normalizeUrl(body.url);
        if (!u) return sendJson(res, 400, { error: '网址格式不正确' });
        link.url = u;
      }
      if ('category' in body) {
        link.category = String(body.category || '').trim() || UNC;
        addCategory(link.category);
      }
      if ('tags' in body) {
        if (Array.isArray(body.tags)) link.tags = body.tags.map(String);
      }
      saveData();
      return sendJson(res, 200, { link });
    }
    if (m === 'DELETE') {
      const [link] = data.links.splice(idx, 1);
      saveData();
      return sendJson(res, 200, { ok: true, link });
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  /* ----- /api/profiles ----- */
  if (seg[0] === 'profiles') {
    if (seg.length === 1 && m === 'GET') {
      const map = new Map();
      for (const l of data.links) {
        const p = profileOf(l);
        map.set(p, (map.get(p) || 0) + 1);
      }
      const profiles = [...map]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      return sendJson(res, 200, { profiles });
    }
    if (seg.length === 2 && m === 'PUT') {
      let body;
      try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.msg || e.message }); }
      const from = seg[1];
      const to = String(body.name || '').trim();
      if (!to) return sendJson(res, 400, { error: '资料名不能为空' });
      const affected = data.links.filter((l) => profileOf(l) === from);
      if (!affected.length) return sendJson(res, 404, { error: '资料不存在' });
      if (to !== from && data.links.some((l) => profileOf(l) === to)) {
        return sendJson(res, 409, { error: '资料名已存在' });
      }
      affected.forEach((l) => { l.profile = to; });
      saveData();
      return sendJson(res, 200, { ok: true, moved: affected.length });
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  /* ----- /api/categories ----- */
  if (seg[0] === 'categories') {
    if (seg.length === 1) {
      if (m === 'POST') {
        let body;
        try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.msg || e.message }); }
        const name = String(body.name || '').trim();
        if (!name) return sendJson(res, 400, { error: '分类名不能为空' });
        if (name === UNC || data.categories.includes(name)) {
          return sendJson(res, 409, { error: '分类已存在' });
        }
        data.categories.push(name);
        saveData();
        return sendJson(res, 201, { categories: data.categories });
      }
      if (m === 'DELETE') {
        data.categories = [];
        for (const l of data.links) l.category = UNC;
        saveData();
        return sendJson(res, 200, { cleared: true });
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    /* /api/categories/:name */
    const name = seg[1];
    if (m === 'PUT') {
      if (!data.categories.includes(name)) return sendJson(res, 404, { error: '分类不存在' });
      let body;
      try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.msg || e.message }); }
      const newName = String(body.name || '').trim();
      if (!newName) return sendJson(res, 400, { error: '分类名不能为空' });
      if (newName === name) return sendJson(res, 200, { categories: data.categories });
      if (newName === UNC || data.categories.some((c) => inCat(c, newName))) {
        return sendJson(res, 409, { error: '分类已存在' });
      }
      data.categories = data.categories.map((c) => (inCat(c, name) ? newName + c.slice(name.length) : c));
      for (const l of data.links) {
        if (inCat(l.category, name)) l.category = newName + l.category.slice(name.length);
      }
      saveData();
      return sendJson(res, 200, { categories: data.categories });
    }
    if (m === 'DELETE') {
      data.categories = data.categories.filter((c) => !inCat(c, name));
      for (const l of data.links) {
        if (inCat(l.category, name)) l.category = UNC;
      }
      saveData();
      return sendJson(res, 200, { categories: data.categories });
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  /* ----- /api/favicon ----- */
  if (seg[0] === 'favicon' && m === 'GET') return favicon(res, sp.get('host'));

  return sendJson(res, 404, { error: 'not found' });
}

/* ---------- favicon 代理 ---------- */

async function favicon(res, host) {
  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host)) {
    res.statusCode = 400;
    return res.end();
  }
  try {
    const r = await fetch(`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    if (!buf.length || md5 === GHOST_MD5) {
      res.statusCode = 404;
      return res.end();
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buf);
  } catch {
    res.statusCode = 404;
    res.end();
  }
}

/* ---------- 静态文件 ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.statusCode = 403;
    return res.end('forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- 路由 ---------- */

async function route(req, res) {
  let sp;
  let pathname;
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    pathname = u.pathname;
    sp = u.searchParams;
  } catch {
    return sendText(res, 400, 'bad request');
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) return api(req, res, pathname, sp);
  return serveStatic(req, res, pathname);
}

ensureData();

const server = http.createServer((req, res) => {
  Promise.resolve(route(req, res)).catch((err) => {
    if (!res.headersSent) sendJson(res, 500, { error: (err && err.message) || 'server error' });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`抽屉工作台已启动: http://127.0.0.1:${PORT}`);
  console.log(`数据文件: ${DATA_FILE}`);
});
