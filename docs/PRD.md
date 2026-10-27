# PRD — Smart Inbox Triage

## User story
> As the inbox owner, each morning I open the tool, press one button, and immediately see the few emails that need me — with what to do about each — instead of scrolling through everything.

## Functional requirements
1. **FR1 Triage** — `POST /api/triage` accepts `{ emails: [...] }` and returns every email with a bucket (`NEEDS ACTION | FYI | NOISE`), a score, and a `nextStep`.
2. **FR2 Morning summary** — headline ("N emails need your action first"), counts per bucket, date.
3. **FR3 Grouped view** — cards grouped Needs Action → FYI → Noise, action items on top.
4. **FR4 Next step** — every Needs Action email shows a concrete next step (approve, RSVP, reply, deadline-first).
5. **FR5 Own data** — user can paste their own inbox as JSON.
6. **FR6 Dark mode** — toggle, persisted choice in localStorage.
7. **FR7 Sample inbox** — demo data loads with one click so the flow is testable.

## Classification rules (v1)
- **+2** per action phrase ("please approve", "can you", "action required", …)
- **+2** question in subject/body
- **+3** deadline words (deadline, due, EOD, ASAP, by tomorrow)
- **+2** VIP sender hint (client/manager/director/partner in the From line)
- **+1** CC'd someone
- **−4** noise patterns (unsubscribe, no-reply, newsletter, automated message, …)
- **Buckets:** score ≥ 5 → NEEDS ACTION · score ≤ −2 → NOISE · else FYI

## Non-functional
- Zero external dependencies; runs offline on `node server.js`.
- All logic unit-tested (`npm.cmd test`).
- UI loads in one file; no build step.

## Acceptance criteria
- [ ] A "please approve by Friday" email appears in Needs Action with "Approve or sign, then reply."
- [ ] A newsletter lands in Noise and is never in the summary headline count.
- [ ] Summary counts equal total emails.
- [ ] `npm.cmd test` passes.