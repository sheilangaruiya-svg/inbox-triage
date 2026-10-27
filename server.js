/**
 * Smart Inbox Triage — server.js
 * Serves the UI and a /api/triage endpoint that classifies emails into
 * buckets: NEEDS ACTION, FYI, NOISE.
 *
 * Rules-based on purpose: no API keys, no cloud. Easy to demo, easy to extend.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const SAMPLE_PATH = path.join(__dirname, 'data', 'sample-inbox.json');
const triage = require('./lib/triage.js');
const https = require('https');

const SETTINGS_PATH = () => path.join(DATA, 'settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8')); } catch { return { accounts: [], slackWebhook: '' }; }
}
function writeSettings(s) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(s, null, 2)); } catch (e) { console.error(e.message); }
}

process.on('uncaughtException', (e) => console.error('caught:', e.message));
process.on('unhandledRejection', (e) => console.error('caught rejection:', e));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- API: triage a list of emails --------------------------------------
  if (req.method === 'POST' && url.pathname === '/api/triage') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { emails } = JSON.parse(body);
        if (!Array.isArray(emails)) throw new Error('Expected { emails: [...] }');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(triage.classifyAll(emails)));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ---- API: sample inbox so the demo works out of the box ----------------
  if (req.method === 'GET' && url.pathname === '/api/live') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(path.join(DATA, 'live-inbox.json'), 'utf8'));
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No live inbox synced yet' }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/sample') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(fs.readFileSync(SAMPLE_PATH, 'utf8'));
    return;
  }


  // ---- API: settings (Slack webhook + Gmail accounts) ---------------------
  if (url.pathname === '/api/settings') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readSettings()));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const s = JSON.parse(body);
          writeSettings({ accounts: s.accounts || [], slackWebhook: s.slackWebhook || '' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad json' }));
        }
      });
      return;
    }
  }

  // ---- API: send to Slack ------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/api/slack/send') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let text = '';
      try { text = JSON.parse(body).text || ''; } catch {}
      const hook = readSettings().slackWebhook;
      if (!hook || !/^https:\/\/hooks\.slack\.com\//.test(hook)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no valid Slack webhook saved' }));
        return;
      }
      const payload = JSON.stringify({ text });
      const u = new URL(hook);
      const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (resp) => {
        let b = '';
        resp.on('data', (c) => (b += c));
        resp.on('end', () => {
          const ok = resp.statusCode === 200 && b.trim() === 'ok';
          res.writeHead(ok ? 200 : 502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ok ? { ok: true } : { error: b.trim().slice(0, 160) || ('slack status ' + resp.statusCode) }));
        });
      });
      r.on('error', (e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); });
      r.write(payload); r.end();
    });
    return;
  }

  // ---- API: log approvals (the handover record) ---------------------------
  if (req.method === 'POST' && url.pathname === '/api/approve') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const entry = JSON.parse(body);
        const logPath = path.join(DATA, 'approvals.json');
        let log = [];
        try { log = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch {}
        log.push({ ...entry, approvedAt: new Date().toISOString() });
        fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ---- Static files from /public ------------------------------------------
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
    res.end(buf);
  });
});

server.listen(PORT, () => console.log(`Smart Inbox Triage running at http://localhost:${PORT}`));