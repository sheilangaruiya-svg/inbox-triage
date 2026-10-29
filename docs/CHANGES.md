# CHANGES

## v4.5 — 2026-10-29 (Gemini AI summaries)
- scripts/gemini.py: Google Gemini writes the context, next step, and deadline for every email that needs action.
- AI fields land in data/live-inbox.json (e.ai flag) and the delivered digest footer notes "AI-written by Gemini".
- Graceful fallback: no GEMINI_API_KEY in .env.local, or an API failure, keeps the previous heuristic summaries — the morning sync never breaks.
- App cards show an ✨ AI badge on Gemini-written items.

## v1.0 — 2026-10-27
- First version of Smart Inbox Triage.
- Rules-based classifier (lib/triage.js): Needs Action / FYI / Noise + next-step suggestions.
- Zero-dependency Node server (server.js) with /api/triage and /api/sample.
- Single-file UI (public/index.html): morning summary card, grouped triage cards, dark mode, paste-your-own-inbox box.
- Sample inbox (data/sample-inbox.json) for one-click demos.
- Unit tests (test/triage.test.js) run with `npm.cmd test`.
## v2.0 — 2026-10-27 (Gmail-connected)
- Live Gmail integration: scripts/fetch-inbox.py pulls the last 3 days of the hermessi inbox,
  triages it with lib/triage.js, writes data/live-inbox.json.
- The app auto-loads the live inbox on open — zero pasting, zero manual steps (EA just reads & approves).
- Approval log persists via DATA_DIR (survives restarts on the hosted app).
- Triage rules tuned: auto-generated mail (meeting notes bots, no-reply notifications) can no longer land in Needs Action.
- "Load demo inbox" kept as fallback when no live sync exists yet.

## v2.1 — 2026-10-27 (branding + daily automation)
- Hermessi logo (winged-H SVG mark) in the header + favicon.
- Daily 7:00 AM ET automated sync: Gmail pull -> triage -> live app refresh -> morning summary.
