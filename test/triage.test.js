const test = require('node:test');
const assert = require('node:assert');
const { classifyAll, score } = require('../lib/triage.js');

test('deadline + approval email lands in NEEDS ACTION with a next step', () => {
  const r = classifyAll([{
    from: 'Priya (Client)',
    subject: 'Contract approval needed by Friday',
    body: 'Please review and approve by Friday EOD.',
  }]);
  assert.equal(r.emails[0].bucket, 'NEEDS ACTION');
  assert.match(r.emails[0].nextStep, /Approve/i);
  assert.equal(r.summary.needsAction, 1);
});

test('newsletter is classified as NOISE', () => {
  const r = classifyAll([{
    from: 'no-reply@techdigest.com',
    subject: 'Weekly newsletter',
    body: 'Top stories of the week. Unsubscribe',
  }]);
  assert.equal(r.emails[0].bucket, 'NOISE');
});

test('informational heads-up lands in FYI', () => {
  const r = classifyAll([{
    from: 'Dana (Partner)',
    subject: 'Heads up: visit next month',
    body: 'FYI, no action yet.',
  }]);
  assert.equal(r.emails[0].bucket, 'FYI');
});

test('summary counts add up and headline mentions nothing-to-do when clean', () => {
  const r = classifyAll([{ from: 'x@y.com', subject: 'hi', body: 'ok' }]);
  assert.equal(r.summary.total, r.emails.length);
  assert.ok(r.summary.headline.includes('Nothing'));
});

test('noise penalty pulls the score down hard', () => {
  const noisy = score({ from: 'no-reply@x.com', subject: 'Sale 50% off', body: 'Unsubscribe' });
  const plain = score({ from: 'x@y.com', subject: 'hi', body: 'ok' });
  assert.ok(noisy < plain);
});