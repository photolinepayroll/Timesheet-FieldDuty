# Resume — Photoline Expense App build

> Read this first if picking this project back up in a new session/after a
> context reset. It tells you exactly what's done, what's left, and the
> decisions/corrections already locked in so they don't need re-deriving.

## What this project is

A Google Sheets + Apps Script web app that reads the existing **Photoline
attendance app's** CSV data and auto-computes fares (LTFRB formula), meal
allowance, accommodation allowance, midnight allowance, and OT/offset/UT —
replacing a manual paper timesheet. Full spec: `Md files/2026-06-22-photoline-expense-app-design.md`.
Full task-by-task plan being executed: `Md files/2026-06-22-photoline-expense-app.md`.
My own working plan (context + corrections + approach): `C:\Users\Gilbert\.claude\plans\i-have-an-implementation-buzzing-lightning.md`.

**Process being used:** `superpowers:subagent-driven-development` — for each
plan task: dispatch an implementer subagent with full task text + context,
then a spec-compliance reviewer subagent, then a code-quality reviewer
subagent. Cheap/clear fixes from review get applied directly (not via another
subagent round-trip) and committed separately. Continue task-by-task without
stopping to check in, per that skill's "continuous execution" instruction.

## Progress: Tasks 1–8 of 12 DONE. Tasks 9–12 remain.

All work is committed to git (repo was `git init`'d fresh for this project,
branch `master`, no remote yet). Commit log, newest first:

```
c732921 fix: document base64 receipt size limitation, dedupe submitClaim callback
9aee557 feat: special claim submission with receipt photo capture
df16370 feat: auto-compute meal, accommodation, midnight allowance, OT/offset/UT
2138c83 feat: fare auto-compute — OSRM distance + LTFRB formula + haversine fallback
be29f49 fix: compare date strings instead of Date objects in handleGetAttendance
193f237 feat: read attendance CSV from existing app, group by day
1ff3c5b fix: whitelist sheet names in handleSaveRates
0fdfa58 feat: rate table admin — meal, accom, midnight, LTFRB editable tables
af57241 fix: correct stale task-number labels in admin tab placeholders
6099c4f feat: employee setup — add/edit users with level, OT type, role, PIN
1d38205 feat: login with PIN, session auth, role-based redirect
2d5dc9a fix: add missing-sheet error guard, fix SETUP.md step numbering
3267baa feat: scaffold — sheet structure, Apps Script stub, styles
```

Files that exist so far: `Code.gs`, `app.js`, `style.css`, `manifest.json`,
`index.html`, `admin.html`, `SETUP.md`. Plus pre-existing `Md files/` (the two
plan docs) and `files.zip` (redundant zip of the same docs) — both untouched,
never committed, irrelevant to the app itself.

### Remaining tasks (in order)

- **Task 9** — Approval queue (admin/head side): `handleGetClaims`,
  `handleApproveClaim` in Code.gs; build the real `tab-claims` panel in
  `admin.html` (currently an inert placeholder labeled "Approval queue (Task 9)").
- **Task 10** — Period sheet build and display: `handleGetPeriodSheet` (the
  big assembly function — attendance + auto-allowances + approved claims);
  build the real `tab-periods` panel in `admin.html` (currently inert,
  labeled "Period sheets (Task 10)").
- **Task 11** — Employee self-service view: employee sees their own period
  sheet on `index.html` after login (reuses Task 10's `renderPeriodSheet`).
- **Task 12** — Polish, deploy, handoff: fill in real `SCRIPT_URL` in `app.js`
  (still the placeholder `'PASTE_YOUR_DEPLOYMENT_URL_HERE'` until the human
  deploys Apps Script — see "Manual steps" below), CSV export button, final
  README/handoff notes, push to GitHub Pages.

## How to resume the loop

1. Re-read this file and the plan file's Task 9 section in full (don't
   re-derive from memory — paste the full task text into the implementer
   subagent prompt, never make a subagent read the plan file itself).
2. Dispatch an implementer subagent (general-purpose) with: full task text,
   the "Context" block below (or whatever's still accurate), explicit
   corrections needed, and a request to self-verify + commit.
3. Dispatch a spec-compliance reviewer subagent (give it the exact
   requirements list + the implementer's claims; tell it not to trust the
   report, read the actual diff).
4. Dispatch a code-quality reviewer subagent (give it BASE_SHA/HEAD_SHA, the
   diff, the task description).
5. If either reviewer finds a small/cheap fix, just apply it directly with
   Edit + a small follow-up commit (don't spin a 3rd subagent round for
   trivial stuff) — that's the pattern used in every task so far (see e.g.
   `2d5dc9a`, `af57241`, `1ff3c5b`, `be29f49`, `c732921`).
6. Update TodoWrite, move to the next task.

## Corrections already verified against the REAL attendance app — reuse these, don't re-derive

The plan's draft code had a few placeholders/guesses that were checked against
the actual attendance app repo (`https://github.com/photolinepayroll/attendance-app.git`,
cloned temporarily, inspected, then deleted — it's not part of this repo).
**These corrections are already applied in Tasks 1–8 and must stay applied in
Tasks 9–12 wherever relevant:**

- **Real attendance CSV export URL** (already in `SETUP.md`'s Config
  instructions): `https://docs.google.com/spreadsheets/d/e/2PACX-1vRZHyqa-jPGZYgystWjoXi8nG1TCvmodSqXT675cY4xpA5jpWWVw-lYSBoLSbgWS0LNHgvyXxLcgZWt/pub?output=csv`
- **Real CSV column headers**: `Name, Destination, Type, Timestamp, Address,
  Latitude, Longitude, Photo Link` — `handleGetAttendance` in `Code.gs`
  already uses these correctly.
- **`Type` column values are `"Log In"` / `"Log Out"`**, not `"IN"`/`"OUT"` —
  `groupAttendanceByDay` in `app.js` already uses these correctly. If Task 10
  needs its own day-grouping logic server-side in `Code.gs` (it will, since
  `handleGetPeriodSheet` runs in Apps Script, not the browser), **re-derive
  the same `'Log In'`/`'Log Out'` matching there too** — don't reintroduce
  `'IN'`/`'OUT'`.
- **`Timestamp` format is `"YYYY-MM-DD HH:MM:SS"`** (space-separated, not ISO
  `T`-separated). Date-key extraction and date-range comparisons should
  compare `'YYYY-MM-DD'` string prefixes, not `Date` objects, to avoid
  timezone-parsing ambiguity (see the `be29f49` fix — `new Date('2026-06-10')`
  parses as UTC midnight while `new Date('2026-06-10 14:30:00')` parses as
  local time, so Date-object comparisons can silently misfile records near
  period boundaries). **Task 10's period-sheet date range filtering must use
  the same string-comparison approach**, not reintroduce Date-object
  comparison.
- **Real visual theme**: light blue/white (`--blue1: #f0f4ff`,
  `--blue2: #1e40af`, Segoe UI), already baked into `style.css` as CSS
  variables. Never reintroduce the plan-draft's placeholder dark navy
  `#1a1a2e` in any new HTML — use plain `<button>`/`<input>`/`class="card"`
  etc. so `style.css` applies automatically.

## Admin/product decisions already confirmed (don't re-ask)

Asked directly via AskUserQuestion during Tasks 6 and 7, all recommended
defaults were accepted:

1. **Round-trip fares**: the IN→OUT GPS leg is one-way; the fare is DOUBLED
   to cover the return trip (`buildAutoFareClaim` in `Code.gs` already does
   this — doubles the fare amount, NOT the distance_km field). **Task 10's
   `handleGetPeriodSheet` should call `buildAutoFareClaim` (Task 6) rather
   than duplicating its own inline fare-doubling logic** — the plan's own
   draft for Task 10 has a separate inline `computeFare(...) * 2` calculation
   that duplicates `buildAutoFareClaim`; prefer reusing the existing function
   over copy-pasting the plan's literal Task 10 draft. Flag this choice to
   reviewers as a deliberate simplification if you make it.
2. **Fare rounding**: nearest peso (`Math.round`) — already in `computeFare`.
3. **Fraud guard tolerance**: keep 20% (`Config.fraud_tolerance_pct`) — note
   this is seeded but **never actually gated on anywhere** in the whole plan
   (known, accepted gap — the design spec's "fraud guard" concept was never
   wired into any task's code). Don't invent fraud-detection logic that
   wasn't asked for.
4. **OT/UT rule**: continuous-hours math (no discrete half-day/minute
   buckets) — already in `computeOT`, used as-is.
5. **Accommodation trigger**: "destination ≠ mother branch" is sufficient
   (no overnight/distance check) — already in `computeAccom`, used as-is.

## Known, accepted gaps (do not "fix" without being asked — they're deliberate or pre-existing, not oversights)

- `employee_id` column in the `Claims` sheet is defined in the schema but
  never populated anywhere (no part of the app collects a numeric employee
  ID — everything keys off `name`). Harmless since nothing reads it.
- `tolerancePct` is computed in `buildAutoFareClaim` but never used to gate
  anything (see fraud-guard gap above).
- Base64 receipt photos stored directly in a `Claims` cell can exceed Google
  Sheets' ~50,000-char/cell limit for large images — documented with an
  inline comment in `index.html` (commit `c732921`), not fixed (no
  compression/Drive-upload added).
- `getRoadDistanceKm`'s OSRM-then-Haversine fallback swallows all errors
  silently (by design, per the plan) — no logging/flagging if OSRM is down
  for an extended period. Not fixed, just noted in Task 6's code review.
- The plan's own draft text has a few internal task-number inconsistencies
  (e.g. originally said "Task 7"/"Task 8" for what are actually Task 9/Task
  10 — already fixed once in `admin.html`'s placeholders via `af57241`, and
  `buildAutoFareClaim`'s doc comment in Code.gs notes the same "Task 8 →
  actually Task 10" mismatch). **When implementing Task 9/10, double-check
  the plan's own cross-references to other task numbers before trusting
  them.**
- Task 3's code review flagged that `loadUsers()`'s `innerHTML` string-concat
  rendering is fine for admin-authored data (Users, Rates) but **must NOT be
  copy-pasted unexamined into Task 9's Claims rendering**, since `Claims.notes`
  is free-text typed by ordinary employees (a real, if low-severity,
  injected-HTML-into-admin's-browser risk). **Add a small `escapeHtml()`
  helper to `app.js` when building Task 9's `loadClaims()`/`renderPeriodSheet`,
  and use it for any employee-authored free-text field** (`notes`, and
  possibly `from_loc`/`to_loc` if those ever become free-typed instead of
  GPS-derived). This was deferred from Task 3, not yet built — **build it in
  Task 9.**

## Apps Script / Google Sheets manual setup — still pending, human-only

There is still NO deployed Apps Script backend and NO real Google Sheet —
every task so far has been verified via static tracing / headless-browser
simulation with stubbed data, never against live Google infrastructure. The
human (you) needs to, whenever ready (doesn't block continuing Tasks 9-12):

1. Follow `SETUP.md` to create the Google Sheet with all 7 tabs + seed data.
2. Deploy `Code.gs` as an Apps Script Web App (Execute as: Me, Access: Anyone).
3. Paste the resulting deployment URL into `app.js`'s `SCRIPT_URL` (currently
   `'PASTE_YOUR_DEPLOYMENT_URL_HERE'`).
4. Only then can the "Verify" steps in each task's plan actually be exercised
   end-to-end in a browser — every task so far has explicitly skipped that
   live-verification step and substituted static/synthetic verification
   instead, flagged clearly in each implementer's report.

## Misc context

- Working directory: `D:\Payoll(Audit+Tech+AH  )expenses\` (note the literal
  parentheses/spaces in the path — quote it in shell commands).
- Git user configured: Gilbert / gilbert.alontaga@gmail.com (from existing
  global git config, not changed by this project).
- No remote has been added yet — this has all been local commits only.
