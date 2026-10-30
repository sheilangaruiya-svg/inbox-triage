#!/usr/bin/env python3
"""
fetch-inbox.py — pulls the last 3 days of the user's Gmail (hermessi address),
runs each email through the triage engine (lib/triage.js), and writes
data/live-inbox.json. The web app auto-loads this file, so the morning
summary is always the real inbox — zero pasting, zero EA work.
"""
import json, os, re, subprocess, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
GMAIL = ['python3', str(ROOT.parent / 'skills' / 'google-workspace' / 'scripts' / 'gmail.py')]

def run(args, **kw):
    p = subprocess.run(args, capture_output=True, text=True, **kw)
    if p.returncode != 0:
        print(p.stderr, file=sys.stderr); sys.exit(1)
    return p.stdout

# 0. Which accounts to scan?
settings_path = ROOT / 'data' / 'settings.json'
accounts = []
if settings_path.exists():
    try:
        accounts = json.loads(settings_path.read_text()).get('accounts', [])
    except Exception:
        accounts = []
connected = [a['email'] for a in accounts if a.get('connected')]
pending = [a['email'] for a in accounts if not a.get('connected')]
print('connected accounts:', connected or ['(default)'])
if pending:
    print('pending sign-in, skipped this run:', pending)

def token_for(email, env, primary):
    """Per-account token: the default connector token goes to the primary account;
    every other account needs its own GMAIL_TOKEN_<EMAIL> in .env.local."""
    if email == primary and env.get('VAULT_TOKEN_GMAIL_GOOGLEAPIS_COM'):
        return env.get('VAULT_TOKEN_GMAIL_GOOGLEAPIS_COM')
    key = 'GMAIL_TOKEN_' + re.sub(r'[^A-Z0-9]', '_', email.upper())
    return env.get(key, '').strip() or None


def scan_account(email, tok):
    """Scan one account's inbox (last 3 days) and return (emails, error)."""
    if not tok:
        return [], 'pending sign-in (no token)'
    # gmail.py reads the token from this env var; set it per account.
    env = dict(os.environ)
    env['VAULT_TOKEN_GMAIL_GOOGLEAPIS_COM'] = tok
    def arun(args):
        p = subprocess.run(args, capture_output=True, text=True, env=env)
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip()[:300])
        return p.stdout
    try:
        out = arun(GMAIL + ['search', 'in:inbox newer_than:3d', '--limit', '30'])
    except RuntimeError as e:
        return [], str(e)
    listing = [json.loads(l) for l in out.splitlines() if l.startswith('{')]
    found = []
    for m in listing:
        raw = arun(GMAIL + ['read', m['id'], '--full'])
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue
        body = (d.get('body') or d.get('snippet') or '').strip()
        found.append({
            'id': d.get('id') or m['id'],
            'from': d.get('from') or m.get('from', ''),
            'subject': d.get('subject') or '(no subject)',
            'body': body[:1200],
            'cc': d.get('cc') or [],
            'date': d.get('date') or '',
            'threadId': d.get('threadId') or '',
            'account': email,
        })
    return found, None


# 1. Search: last 3 days of every connected account we have a token for.
env = dict(os.environ)
for line in (ROOT / '.env.local').read_text().splitlines() if (ROOT / '.env.local').exists() else []:
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('=')
        env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
emails, seen, synced, pending, scanned = [], set(), [], [], []
primary = accounts[0]['email'] if accounts else ''
for a in [x for x in accounts if x.get('connected')]:
    tok = token_for(a['email'], env, primary)
    got, err = scan_account(a['email'], tok)
    if err:
        pending.append(a['email'])
        print(f'{a["email"]}: {err}')
        continue
    synced.append(a['email'])
    scanned.extend(got)
    print(f'{a["email"]}: found {len(got)} messages')
for e in scanned:
    if e['id'] not in seen:
        seen.add(e['id'])
        emails.append(e)
print(f'total {len(emails)} messages across {len(synced)} account(s)')

# 3. Triage with the project's own engine
tmp_in = ROOT / 'data' / 'raw-inbox.json'
tmp_in.write_text(json.dumps({'emails': emails}))
out = subprocess.run(['node', '-e', '''
  const t = require("./lib/triage.js");
  const { emails } = JSON.parse(require("fs").readFileSync("data/raw-inbox.json", "utf8"));
  const result = t.classifyAll(emails);
  result.syncedAt = new Date().toISOString();
  require("fs").writeFileSync("data/live-inbox.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.summary));
'''], capture_output=True, text=True, cwd=ROOT)
if out.returncode != 0:
    print(out.stderr, file=sys.stderr); sys.exit(1)
print(out.stdout.strip())
import sys as _sys
_sys.path.insert(0, str(ROOT / 'scripts'))
import summarize
data = summarize.run(ROOT / 'data' / 'live-inbox.json')
data['accounts'] = accounts
data['pendingAccounts'] = pending
data['syncedAccounts'] = synced
(ROOT / 'data' / 'live-inbox.json').write_text(json.dumps(data, indent=2))
import gemini
gemini.run(ROOT / 'data' / 'live-inbox.json')
print('wrote data/live-inbox.json + summary')