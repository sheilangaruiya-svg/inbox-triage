#!/usr/bin/env python3
"""
summarize.py — enriches triaged emails with self-explanatory detail
(context, owner, deadline, link, executive-vs-EA attention) and builds the
formatted morning summary (Slack text + per-email detail shown in the app).

Consumed by fetch-inbox.py to keep the pipeline one source of truth.
"""
import json, re, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

GREETINGS = re.compile(
    r'^(hi|hello|hey|dear|good\s?(morning|afternoon|evening)|to whom it may concern)[ ,:!.]*'
    r'(\s+[^,]+,)?', re.I)
SIGNOFFS = re.compile(
    r'\s*(best\s?regards|regards|thanks|thank you|cheers|sincerely|kind regards|warmly|sent from my)[^.]*\.?$',
    re.I)

DEADLINE_PAT = [
    (r'\b(before|by|due|deadline|no later than|needed by)\s+([^.\n]{1,40})', ''),
    (r'\b(by|before|due|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(\s+[^.\n]{0,20})?', ''),
    (r'\b(by|before|on)\s+(\d{1,2}(st|nd|rd|th)?\s+[a-z]+\s+\d{1,4}|[a-z]+\s+\d{1,2}(st|nd|rd|th)?|\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?)\b', ''),
    (r'\b(today|tomorrow|eod|eob|end of (day|business|week|month)|asap|this week|next week)\b', ''),
]
EMAIL = re.compile(r'[\w.+-]+@[\w.-]+\.\w+')

ACTION_WORDS = [
    ('approve|authori[sz]|sign\s?off|payment|invoice|purchase order|pay ', 'Approve or query the amount, then confirm to the sender.'),
    ('proposal|quote|estimate|pricing|contract|bid|rfi|rfp', 'Review the document, add any remaining detail, and send a response.'),
    ('meeting|schedule|calendar|invite|call|sync|catch.?up|agenda', 'Accept/decline the invite and confirm the time with the sender.'),
    ('deadline|due|overdue|expire|expiring|renewal|compliance|filing|tax|report due', 'Confirm the deadline and flag it on the calendar so it is not missed.'),
    ('approve|review|feedback|comment|input|sign', 'Review and give a decision or feedback in reply.'),
    ('question|query|clarif', 'Answer the question, or route it to the right person.'),
    ('draft|content|copy|graphics|design|campaign|creative', 'Reply with the requested asset or a status on when it will be ready.'),
]

TIME_NOW = datetime.datetime.now()


def clean(text):
    text = re.sub(r'\s+', ' ', (text or ''))
    text = GREETINGS.sub('', text).strip()
    text = SIGNOFFS.sub('', text).strip()
    return text.strip(' \r\n-–—:.')


def first_sentence(text, limit=220):
    t = clean(text)
    if not t:
        return ''
    # take up to the 2nd sentence
    parts = re.split(r'(?<=[.!?])\s+', t)
    out = ''
    for p in parts[:2]:
        if len(out) + len(p) > limit:
            break
        out = out + ' ' + p
    return out.strip() or t[:limit]


def deadline_of(email):
    blob = ' '.join([email.get('subject', ''), email.get('body', '')]).lower()
    blob = re.sub(r'\s+', ' ', blob)
    daywords = r'monday|tuesday|wednesday|thursday|friday|saturday|sunday'
    dateish = r'(?:' + daywords + r')|\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+|[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}[/\-]\d{1,2}(?:[/\-]\d{2,4})?|(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)\s*(?:today|tomorrow)'
    leads = [r'(by|before|due|deadline|no later than|needed by|on)\s+(?=' + dateish + r')',
             r'(till|until|by|before)\s+(?=' + daywords + r')',
             r'\b(today|tomorrow|next week|this week|eod|eob|asap|end of day|end of business|end of week|end of month)\b']
    for pat in leads:
        m = re.search(pat, blob)
        if m:
            lead = m.group(0).strip(' ,.;')
            tailm = re.search(dateish, blob[m.end():])
            frag = (lead + ' ' + tailm.group(0)).strip() if tailm else lead
            return frag[:40]
    m = re.search(dateish, blob)
    if m:
        return m.group(0)[:40]
    return 'No deadline stated'

def owner_of(email):
    frm = email.get('from', '')
    name = frm.split('<')[0].strip().strip('"')
    if name:
        return name
    m = EMAIL.search(frm)
    return m.group(0) if m else 'Unknown'


def attention_of(email):
    blob = (email.get('subject', '') + ' ' + email.get('body', '')).lower()
    exec_hits = ['strategy', 'client', 'board', 'investor', 'partnership', 'ceo', 'product',
                 'budget', 'forecast', 'pipeline', 'roadmap', 'hiring', 'executive', 'decision',
                 'launch', 'brand', 'positioning', 'trends', 'review of', 'approval for']
    if any(h in blob for h in exec_hits):
        return 'executive'
    return 'ea'


def next_step_of(email):
    # keyword-driven precise step
    blob = (email.get('subject', '') + ' ' + email.get('body', '')).lower()
    for pat, action in ACTION_WORDS:
        if re.search(pat, blob):
            return action
    sender = owner_of(email)
    topic = clean(email.get('subject', 'the email'))
    return f'Reply to {sender} about "{topic}" with the answer.'


def context_of(email):
    body = clean(email.get('body', ''))
    if not body:
        # fall back to a framing from the subject + sender
        return f'An email from {owner_of(email)} titled "{email.get("subject", "(no subject)")}".'
    return first_sentence(body)


def enrich(email):
    e = dict(email)
    e['owner'] = owner_of(email)
    e['link'] = f'https://mail.google.com/mail/u/0/#all/{e["threadId"] or e["id"]}'
    e['attention'] = attention_of(email)
    e['deadline'] = deadline_of(email)
    e['nextStep'] = next_step_of(email)
    e['context'] = context_of(email)
    if e['bucket'] == 'FYI':
        e['why'] = 'Status/notification — no action required, read for awareness.'
    elif e['attention'] == 'executive':
        e['why'] = 'Needs your decision or a response; the EA cannot close it alone.'
    else:
        e['why'] = 'Actionable by your EA once you give the go-ahead.'
    return e


def fmt_date():
    return datetime.datetime.now().strftime('%A, %B %-d')


def build_text(emails, summary):
    actions = [e for e in emails if e['bucket'] == 'NEEDS ACTION']
    execs = [e for e in actions if e['attention'] == 'executive']
    eas = [e for e in actions if e['attention'] == 'ea']
    fyi = [e for e in emails if e['bucket'] == 'FYI']
    noise = [e for e in emails if e['bucket'] == 'NOISE']

    lines = []
    lines.append(f'\U00002600\ufe0f Hermessi inbox summary \u2014 {fmt_date()}')
    lines.append(f'Filtered from {summary["total"]} emails last 3 days \u00b7 {len(noise)} filtered as noise\n')

    def block(items, label):
        if not items:
            return []
        out = [f'\U000026A1 {label} ({len(items)})']
        for i, e in enumerate(items, 1):
            out.append(f'{i}. \U0001F4E7 {e["subject"]}')
            out.append(f'   What happened: {e["context"]}')
            out.append(f'   Why it matters: {e["why"]}')
            out.append(f'   Next step: {e["nextStep"]}')
            out.append(f'   Owner: {e["owner"]} \u00b7 Deadline: {e["deadline"]}')
            out.append(f'   Open: {e["link"]}')
        out.append('')
        return out

    lines += block(execs, 'EXECUTIVE ATTENTION REQUIRED')
    lines += block(eas, 'EA ACTIONS')

    if fyi:
        lines.append(f'\U0001F4D6 FYI ({len(fyi)}) \u2014 read for awareness:')
        for e in fyi[:8]:
            lines.append(f'\u2022 {e["subject"]} \u2014 {e["context"][:90]}')
        if len(fyi) > 8:
            lines.append(f'\u2022 +{len(fyi)-8} more')
        lines.append('')
    lines.append(f'\u26A0\ufe0f Noise filtered: {len(noise)}')

    return '\n'.join(lines)


def run(live_path):
    data = json.loads(live_path.read_text())
    data['emails'] = [enrich(e) for e in data.get('emails', [])]
    data['summaryText'] = build_text(data['emails'], data.get('summary', {}))
    live_path.write_text(json.dumps(data, indent=2))
    return data


if __name__ == '__main__':
    run(ROOT / 'data' / 'live-inbox.json')
    print('enriched + summary built')