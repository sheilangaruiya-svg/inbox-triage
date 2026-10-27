# Smart Inbox Triage — README

A lightweight morning-summary tool: paste or load your inbox, hit **Triage my inbox**, and see only what actually needs you — sorted into **Needs Action / FYI / Noise**, each with a suggested next step.

Built for the Week 1 course project ("My inbox is becoming impossible to manage in the mornings…").

## Run it

```powershell
npm.cmd install   # no dependencies, but keeps the workflow consistent
npm.cmd start     # → http://localhost:3000
```

## Test it

```powershell
npm.cmd test
```

## How it works

- `lib/triage.js` scores every email (action words, questions, deadlines, VIP senders, noise patterns) into three buckets and proposes a next step.
- `server.js` is a zero-dependency Node server: static UI + `POST /api/triage` + `GET /api/sample`.
- `public/index.html` is the whole UI — morning summary card, grouped cards, dark mode.
- `data/sample-inbox.json` is a demo inbox so the tool works out of the box; paste your own JSON for a real test.

## Extending it (course-ready next steps)

1. Connect to a real inbox (Gmail API or an email-export drag-and-drop).
2. Let the user mark triage decisions as "wrong" and feed them back into the rules.
3. Email the summary to yourself each morning (a cron job / scheduled task).

## Structure

```
inbox-triage/
├── server.js            # Node server + /api/triage
├── lib/triage.js        # classification rules (the brain)
├── public/index.html    # single-file UI
├── data/sample-inbox.json
├── test/triage.test.js  # node --test suite
└── docs/                # BRD, PRD, process notes
```