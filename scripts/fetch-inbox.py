#!/usr/bin/env python3
"""
fetch-inbox.py — pulls the last 3 days of the user's Gmail (hermessi address),
runs each email through the triage engine (lib/triage.js), and writes
data/live-inbox.json. The web app auto-loads this file, so the morning
summary is always the real inbox — zero pasting, zero EA work.
"""
import json, subprocess, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
GMAIL = ['python3', str(ROOT.parent / 'skills' / 'google-workspace' / 'scripts' / 'gmail.py')]

def run(args, **kw):
    p = subprocess.run(args, capture_output=True, text=True, **kw)
    if p.returncode != 0:
        print(p.stderr, file=sys.stderr); sys.exit(1)
    return p.stdout

# 1. Search: last 3 days of the real inbox
out = run(GMAIL + ['search', 'in:inbox newer_than:3d', '--limit', '30'])
listing = [json.loads(l) for l in out.splitlines() if l.startswith('{')]
print(f'found {len(listing)} messages')

# 2. Read each in full
emails = []
for m in listing:
    raw = run(GMAIL + ['read', m['id'], '--full'])
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        continue
    body = (d.get('body') or d.get('snippet') or '').strip()
    emails.append({
        'id': d.get('id') or m['id'],
        'from': d.get('from') or m.get('from', ''),
        'subject': d.get('subject') or '(no subject)',
        'body': body[:1200],
        'cc': d.get('cc') or [],
        'date': d.get('date') or '',
        'threadId': d.get('threadId') or '',
    })

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
print('wrote data/live-inbox.json')