/**
 * lib/triage.js — the brain of the tool.
 *
 * Classifies each email into one of three buckets and suggests a next step:
 *   NEEDS ACTION — asks you to do/approve/reply something, or has a deadline.
 *   FYI          — informational, from a person or a system you care about.
 *   NOISE        — newsletters, notifications, automated bulk mail.
 */

const ACTION_WORDS = [
  'please review', 'please approve', 'please confirm', 'please send', 'please sign',
  'action required', 'action needed', 'need your', 'needs your', 'need you to',
  'can you', 'could you', 'let me know', 'follow up', 'follow-up', 'asap', 'eod',
  'end of day', 'by tomorrow', 'by friday', 'deadline', 'due', 'rsvp', 'respond',
  'reply', 'sign off', 'sign-off', 'approve', 'budget', 'invoice', 'submit'
];

const QUESTION_PATTERN = /\?|\b(when|what time|which|can you|could you|will you|are you)\b/i;

const NOISE_PATTERNS = [
  /unsubscribe/i, /no[- ]?reply/i, /noreply/i, /newsletter/i, /digest/i,
  /promo|sale|discount|% off/i, /automated message/i, /no action needed/i,
  /linkedin|facebook|twitter|instagram/i
];

const VIP_HINTS = ['client', 'boss', 'manager', 'director', 'vp', 'ceo', 'founder', 'partner'];

// A simple 0–10 urgency score drives both the bucket and the suggested next step.
function score(email) {
  const text = `${email.subject || ''} ${email.body || ''}`.toLowerCase();
  const from = `${email.from || ''}`.toLowerCase();
  let s = 0;

  s += ACTION_WORDS.filter((w) => text.includes(w)).length * 2;
  if (QUESTION_PATTERN.test(text)) s += 2;
  if (/(deadline|due|by \w+day|eod|asap|today|tomorrow)/.test(text)) s += 3;
  if (VIP_HINTS.some((h) => from.includes(h))) s += 2;
  if (email.cc && email.cc.length) s += 1;
  if (NOISE_PATTERNS.some((p) => p.test(text))) s -= 4;
  if (NOISE_PATTERNS.some((p) => p.test(from))) s -= 4;
  return s;
}

function nextStep(email, bucket) {
  const text = `${email.subject} ${email.body}`.toLowerCase();
  if (bucket === 'NEEDS ACTION') {
    if (/(approve|sign|sign-?off)/.test(text)) return 'Approve or sign, then reply.';
    if (/(invoice|payment|budget)/.test(text)) return 'Check the numbers, then approve or query.';
    if (/(rsvp|meeting|call|invite)/.test(text)) return 'Accept/decline the invite and confirm time.';
    if (/(deadline|due|eod|asap|today|tomorrow)/.test(text)) return 'Do it now — there is a deadline attached.';
    return 'Reply with an answer or a status.';
  }
  if (bucket === 'FYI') return 'Skim now or batch-read after the action items.';
  return 'Auto-file or archive — no human needed.';
}

function classify(email) {
  const s = score(email);
  let bucket = 'FYI';
  if (s >= 5) bucket = 'NEEDS ACTION';
  else if (s <= -2) bucket = 'NOISE';
  return { ...email, bucket, score: s, nextStep: nextStep(email, bucket) };
}

function classifyAll(emails) {
  const classified = emails.map(classify);
  const needsAction = classified.filter((e) => e.bucket === 'NEEDS ACTION');
  const fyi = classified.filter((e) => e.bucket === 'FYI');
  const noise = classified.filter((e) => e.bucket === 'NOISE');
  return {
    summary: {
      generatedAt: new Date().toISOString(),
      total: classified.length,
      needsAction: needsAction.length,
      fyi: fyi.length,
      noise: noise.length,
      headline:
        needsAction.length === 0
          ? 'Nothing needs your action this morning.'
          : `${needsAction.length} email${needsAction.length === 1 ? '' : 's'} need your action first.`,
    },
    emails: classified,
  };
}

module.exports = { classify, classifyAll, score, nextStep };