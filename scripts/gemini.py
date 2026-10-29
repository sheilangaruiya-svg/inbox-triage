#!/usr/bin/env python3
"""
gemini.py — AI enrichment for the inbox digest.

For every email that needs action, asks Google Gemini to write the one-line
context, the precise next step, and the deadline. Falls back to the existing
heuristic fields when no API key is set or the API is unreachable, so the
morning summary always works.

Consumed by fetch-inbox.py after summarize.run().
"""
import json, os, pathlib, time, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent.parent

API = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash']  # tried in order; first that answers wins

PROMPT = """You are the executive assistant's summarizer for a CEO inbox digest.
For the email below, return ONLY valid JSON with exactly these keys:
- "context": one sentence (<=22 words) saying what the email is about / what happened, plain and specific.
- "nextStep": one precise action sentence (<=18 words) saying what the CEO should do next, imperative, no fluff.
- "deadline": the deadline as a short phrase ("today", "by Thursday", "Friday 5pm"). If none is stated, exactly "not stated".
Never invent deadlines or facts that are not in the email. Do not include the sender name in the context.

Email:
From: {sender}
Subject: {subject}
Body: {body}"""


def load_env():
    """Tiny .env.local reader — no dependencies."""
    env = {}
    p = ROOT / '.env.local'
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def ask_gemini(sender, subject, body, api_key, model=None):
    """One call to Gemini (with retries); returns dict or None on any failure."""
    prompt = PROMPT.format(sender=sender[:80], subject=subject[:200], body=(body or '')[:900])
    payload = {
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'temperature': 0.2, 'maxOutputTokens': 200,
                             'responseMimeType': 'application/json'},
    }
    models = [model] if model else MODELS
    last_err = None
    for m in models:
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    API.format(model=m) + '?key=' + api_key,
                    data=json.dumps(payload).encode(),
                    headers={'Content-Type': 'application/json'}, method='POST')
                with urllib.request.urlopen(req, timeout=25) as resp:
                    out = json.loads(resp.read().decode())
                text = (out.get('candidates') or [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
                data = json.loads(text)
                data['context'] = str(data.get('context', '')).strip()
                data['nextStep'] = str(data.get('nextStep', '')).strip()
                data['deadline'] = str(data.get('deadline', '') or 'not stated').strip()
                if not data['context'] or not data['nextStep']:
                    return None
                return data
            except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError, json.JSONDecodeError) as e:
                last_err = e
                # transient "API just enabled / quota" 403s: back off and retry
                if isinstance(e, urllib.error.HTTPError) and e.code == 403:
                    time.sleep(3)
    print(f'  [gemini] no model answered ({last_err!r}); keeping heuristic fields')
    return None


def run(live_path=None):
    """Enrich NEEDS ACTION emails with Gemini. Returns the live data dict."""
    live_path = live_path or (ROOT / 'data' / 'live-inbox.json')
    env = load_env()
    key = env.get('GEMINI_API_KEY', '').strip()
    if not key:
        print('[gemini] no GEMINI_API_KEY in .env.local — heuristic summaries this run')
        return None

    data = json.loads(live_path.read_text())
    actions = [e for e in data.get('emails', []) if e.get('bucket') == 'NEEDS ACTION']
    if not actions:
        print('[gemini] no action emails to enrich')
        return data

    import summarize
    ai_count = 0
    for e in actions:
        result = ask_gemini(e.get('from', ''), e.get('subject', ''), e.get('body', ''), key)
        if not result:
            continue
        e['context'] = result['context']
        e['nextStep'] = result['nextStep']
        e['deadline'] = 'No deadline stated' if result['deadline'] == 'not stated' else result['deadline'].capitalize()
        e['ai'] = True
        ai_count += 1

    data['aiEnabled'] = ai_count > 0
    data['summaryText'] = summarize.build_text(data['emails'], data.get('summary', {}))
    live_path.write_text(json.dumps(data, indent=2))
    print(f'[gemini] AI-written summaries for {ai_count} of {len(actions)} action emails')
    return data


if __name__ == '__main__':
    run()
    print('done')
