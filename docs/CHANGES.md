# CHANGES

## v1.0 — 2026-10-27
- First version of Smart Inbox Triage.
- Rules-based classifier (lib/triage.js): Needs Action / FYI / Noise + next-step suggestions.
- Zero-dependency Node server (server.js) with /api/triage and /api/sample.
- Single-file UI (public/index.html): morning summary card, grouped triage cards, dark mode, paste-your-own-inbox box.
- Sample inbox (data/sample-inbox.json) for one-click demos.
- Unit tests (test/triage.test.js) run with `npm.cmd test`.