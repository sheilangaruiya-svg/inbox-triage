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
const os = require('os');

const PORT = process.env.PORT || 3000;
// Load app.env (shipped with the app, gitignored) so the deployment keeps its
// config across publishes without baking secrets into the publish call.
(function loadAppEnv() {
  try {
    const f = path.join(__dirname, 'app.env');
    fs.readFileSync(f, 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* no app.env — env comes from the platform */ }
})();


function pickDataDir() {
  const candidates = [];
  if (process.env.DATA_DIR && process.env.DATA_DIR !== '$DATA_DIR') candidates.push(process.env.DATA_DIR);
  candidates.push('/data', path.join(os.tmpdir(), 'inbox-triage'));
  for (const c of candidates) {
    try { fs.mkdirSync(c, { recursive: true }); fs.accessSync(c, fs.constants.W_OK); return c; } catch (e) {}
  }
  return path.join(os.tmpdir(), 'inbox-triage');
}
const DATA = pickDataDir();
// Seed the persistent store from files shipped with the app when they are
// newer (a fresh publish brings a fresh snapshot of live-inbox + settings).
(function seedFromShipped() {
  for (const name of ['live-inbox.json', 'settings.json']) {
    const shipped = path.join(__dirname, 'data', name);
    const live = path.join(DATA, name);
    try {
      if (!fs.existsSync(shipped)) continue;
      if (fs.existsSync(live) && fs.statSync(live).mtimeMs >= fs.statSync(shipped).mtimeMs) continue;
      fs.mkdirSync(DATA, { recursive: true });
      fs.copyFileSync(shipped, live);
    } catch (e) { console.error('seed', name, e.message); }
  }
})();

const SAMPLE_PATH = path.join(__dirname, 'data', 'sample-inbox.json');
const triage = require('./lib/triage.js');
const https = require('https');

const SETTINGS_PATH = () => path.join(DATA, 'settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8')); } catch { return { accounts: [], slackWebhook: '', schedule: null }; }
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
      let raw;
      try { raw = fs.readFileSync(path.join(DATA, 'live-inbox.json'), 'utf8'); }
      catch { raw = fs.readFileSync(path.join(__dirname, 'data', 'live-inbox.json'), 'utf8'); }
      res.end(raw);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No live inbox synced yet' }));
    }
    return;
  }

  // ---- API: health (what the deployment actually has configured) ----------
  if (req.method === 'GET' && url.pathname === '/api/health') {
    let syncedAt = null;
    try { syncedAt = JSON.parse(fs.readFileSync(path.join(DATA, 'live-inbox.json'), 'utf8')).syncedAt || null; }
    catch {
      try { syncedAt = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'live-inbox.json'), 'utf8')).syncedAt || null; } catch {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      dataDir: DATA,
      schedulerConfigured: !!process.env.SYNC_HOOK_URL,
      slackConfigured: !!(process.env.SLACK_WEBHOOK || (readSettings().slackWebhook || '')),
      syncedAt,
      schedule: readSettings().schedule || null,
      uptimeSec: Math.round(process.uptime())
    }));
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
          writeSettings({ accounts: s.accounts || [], slackWebhook: s.slackWebhook || '', schedule: s.schedule || null });
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

  // ---- API: Sync now (asks Argus to pull Gmail and refresh this app) ------
  if (req.method === 'POST' && url.pathname === '/api/sync-now') {
    let argBody = '';
    req.on('data', (c) => (argBody += c));
    req.on('end', () => {
      const hookUrl = process.env.SYNC_HOOK_URL || '';
      const secret = process.env.SYNC_HOOK_SECRET || '';
      if (!hookUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'sync trigger not configured' }));
        return;
      }
      let wanted = null;
      try { wanted = JSON.parse(argBody || '{}').account || null; } catch {}
      const payload = JSON.stringify({ source: 'inbox-triage', account: wanted, requestedAt: new Date().toISOString() });
      const sig = require('crypto').createHmac('sha256', secret).update(payload).digest('hex');
      const u = new URL(hookUrl);
      const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload),
          'X-Signature': 'sha256=' + sig, 'X-Hub-Signature-256': 'sha256=' + sig } }, (resp) => {
        resp.on('data', () => {});
        resp.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: resp.statusCode < 300, status: resp.statusCode, account: wanted }));
        });
      });
      r.on('error', (e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); });
      r.write(payload); r.end();
    });
    return;
  }

  // ---- API: schedule change (asks Argus to reschedule the daily run) ------
  if (req.method === 'POST' && url.pathname === '/api/schedule') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const hookUrl = process.env.SYNC_HOOK_URL || '';
      const secret = process.env.SYNC_HOOK_SECRET || '';
      if (!hookUrl) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'scheduler not configured'})); return; }
      let sched = {};
      try { sched = JSON.parse(b || '{}'); } catch {}
      const payload = JSON.stringify({ source:'inbox-triage', action:'schedule', schedule: sched, requestedAt: new Date().toISOString() });
      const sig = require('crypto').createHmac('sha256', secret).update(payload).digest('hex');
      const u = new URL(hookUrl);
      const r = https.request({ hostname:u.hostname, path:u.pathname+u.search, method:'POST',
        headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'X-Signature':'sha256='+sig,'X-Hub-Signature-256':'sha256='+sig} }, (resp)=>{
        resp.on('data',()=>{});
        resp.on('end',()=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:resp.statusCode<300,status:resp.statusCode,schedule:sched})); });
      });
      r.on('error',(e)=>{ res.writeHead(502,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); });
      r.write(payload); r.end();
    });
    return;
  }

  // ---- API: send to Slack ------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/api/slack/send') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let text = '';
      try { text = JSON.parse(body).text || ''; } catch {}
      const hook = readSettings().slackWebhook || process.env.SLACK_WEBHOOK || '';
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