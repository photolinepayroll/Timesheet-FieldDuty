# Resume — Photoline Expense App build

> Read this first if picking this project back up in a new session/after a
> context reset.

## Status: all 12 plan tasks are DONE. Code is complete. Deployment is not.

Every task in `Md files/2026-06-22-photoline-expense-app.md` has been
implemented, spec-reviewed, code-quality-reviewed, and committed using
`superpowers:subagent-driven-development` (implementer subagent → spec
compliance reviewer subagent → code quality reviewer subagent per task; cheap
review fixes applied directly with a small follow-up commit rather than a 3rd
subagent round-trip). **There is no more app code to write** unless real-world
testing against a live deployment turns up a bug, or the human wants new
features beyond the original plan.

**What remains is entirely human/manual**: creating the Google Sheet,
deploying Apps Script, and deciding on git remote/GitHub Pages. See "What's
left for the human" below — that's the only section that still has open
action items.

## Full commit log (newest first)

```
64e2fcb feat: CSV export for period sheets, README as entry-point doc
dc782a3 feat: employee self-service — own period sheet visible after login
ffffeed perf: cache sheetToObjects() reads for the duration of one request
f5fafce feat: period sheet — assembled from attendance + auto-allowances + approved claims
cb45870 docs: explain why claim id is left unescaped in onclick attribute
46a1027 feat: approval queue — heads can approve/reject special claims
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

Final file set: `Code.gs`, `app.js`, `style.css`, `manifest.json`,
`index.html`, `admin.html`, `SETUP.md`, `README.md`. Plus pre-existing
`Md files/` (the two plan docs) and `files.zip` (redundant zip of the same
docs) — both untouched, never committed, irrelevant to the app itself.

## What's left for the human (the actual remaining work)

1. **Create the Google Sheet.** Follow `SETUP.md` step-by-step: a Sheet named
   `Photoline Expense App` with 7 tabs (`Users`, `MealRates`, `AccomRates`,
   `MidnightRates`, `LTFRBRates`, `Claims`, `Config`), exact header rows, and
   the seed data given there (including the real attendance CSV URL, already
   filled in — not a placeholder).
2. **Deploy `Code.gs` as an Apps Script Web App** bound to that Sheet
   (Extensions → Apps Script → paste `Code.gs` → Deploy → New deployment →
   Web app → Execute as: Me, Access: Anyone). Copy the resulting URL.
3. **Paste that URL into `app.js`'s `SCRIPT_URL`** (currently still the
   literal placeholder `'PASTE_YOUR_DEPLOYMENT_URL_HERE'` — intentionally
   never filled in by any task, since no real URL existed until step 2).
4. **Do a real end-to-end test** in a browser once 1-3 are done: log in as a
   test head/employee, add an employee, populate rate tables, submit a
   special claim, approve it, generate a period sheet, export CSV, print.
   Every task's plan "Verify" step was explicitly skipped throughout this
   build (no live backend existed) and replaced with static/synthetic
   tracing — this is the first point anything gets exercised for real.
5. **Decide on git remote + GitHub Pages.** This repo (`git init`'d fresh for
   this project) has never had a remote added or anything pushed anywhere —
   deliberately, since pushing/creating a remote needs your explicit
   go-ahead. Whenever you're ready: add a remote, push, enable GitHub Pages
   (Settings → Pages → branch/root) to host `index.html`/`admin.html`.

None of the above blocks anything else — they can happen whenever you're
ready, in roughly that order (1 → 2 → 3 unblock real testing; 5 is independent
and can happen before or after).

## Corrections verified against the REAL attendance app (already applied everywhere relevant)

The plan's draft code had a few placeholders/guesses that were checked against
the actual attendance app repo (`https://github.com/photolinepayroll/attendance-app.git`,
cloned temporarily, inspected, then deleted — it's not part of this repo).
These are baked into the final code, not just notes:

- **Real attendance CSV export URL** (in `SETUP.md`'s Config instructions):
  `https://docs.google.com/spreadsheets/d/e/2PACX-1vRZHyqa-jPGZYgystWjoXi8nG1TCvmodSqXT675cY4xpA5jpWWVw-lYSBoLSbgWS0LNHgvyXxLcgZWt/pub?output=csv`
- **Real CSV column headers**: `Name, Destination, Type, Timestamp, Address,
  Latitude, Longitude, Photo Link` — used correctly in `Code.gs`'s
  `handleGetAttendance`.
- **`Type` column values are `"Log In"` / `"Log Out"`**, not `"IN"`/`"OUT"` —
  used correctly in both `app.js`'s `groupAttendanceByDay` and `Code.gs`'s
  `handleGetPeriodSheet` (which independently re-derives day-grouping
  server-side).
- **`Timestamp` format is `"YYYY-MM-DD HH:MM:SS"`** (space-separated, not ISO
  `T`-separated). Date-range filtering in `handleGetAttendance` compares
  `'YYYY-MM-DD'` string prefixes, not `Date` objects, avoiding the
  UTC-midnight-vs-local-time parsing mismatch that string Date objects would
  hit (see commit `be29f49`).
- **Real visual theme**: light blue/white (`--blue1: #f0f4ff`,
  `--blue2: #1e40af`, Segoe UI) baked into `style.css` as CSS variables and
  used consistently everywhere — the plan-draft's placeholder dark navy
  `#1a1a2e` never made it into any shipped page.

## Admin/product decisions confirmed during the build (don't re-ask if extending this app)

Asked directly via `AskUserQuestion` during Tasks 6 and 7, all recommended
defaults were accepted:

1. **Round-trip fares**: the IN→OUT GPS leg is one-way; the fare is DOUBLED
   to cover the return trip. `buildAutoFareClaim` (Task 6) does this and is
   reused by `handleGetPeriodSheet` (Task 10) rather than the plan's
   original draft duplicating the doubling logic inline — this consolidation
   was a deliberate choice, flagged to and accepted by reviewers.
2. **Fare rounding**: nearest peso (`Math.round`).
3. **Fraud guard tolerance**: 20% (`Config.fraud_tolerance_pct`) — seeded but
   intentionally never gated on anywhere (see gaps below).
4. **OT/UT rule**: continuous-hours math (no discrete half-day/minute
   buckets).
5. **Accommodation trigger**: "destination ≠ mother branch" is sufficient.

## Known, accepted gaps (deliberate or pre-existing — not bugs to silently "fix" later without asking)

- `employee_id` column in the `Claims` sheet is defined in the schema but
  never populated anywhere (everything keys off `name` instead). Harmless.
- `fraud_tolerance_pct`/`tolerancePct` is computed in `buildAutoFareClaim` but
  never used to gate anything — the design spec's "fraud guard" concept was
  never wired into any task's actual code.
- Base64 receipt photos stored directly in a `Claims` cell can exceed Google
  Sheets' ~50,000-char/cell limit for large images (documented inline in
  `index.html`, commit `c732921`) — not fixed (no compression/Drive-upload).
- `getRoadDistanceKm`'s OSRM-then-Haversine fallback swallows all errors
  silently — no logging/flagging if OSRM is down for an extended period.
- `c.id` (claim ID) is deliberately left unescaped in one `onclick` attribute
  in `admin.html`'s Claims table — it's server-generated and safe by
  construction; HTML-entity escaping wouldn't actually close that sink anyway
  since browsers decode attribute entities before parsing `onclick` as JS
  (explained in a code comment, commit `cb45870`).
- `escapeHtml()` (added Task 9, in `app.js`) is used for all employee-authored
  free text rendered via `innerHTML` (`Claims.notes`/`from_loc`/`to_loc`/
  `vehicle_mode`, and the attendance app's free-typed `destination`/`branch`
  field in period sheets) — admin-authored data (`Users`, rate tables) is
  rendered unescaped in `loadUsers`, a deliberate distinction made early on
  and not retrofitted everywhere for consistency (noted in Task 10's review
  as a minor stylistic inconsistency, not a security gap).
- `sheetToObjects()` results are cached for the duration of one `doPost`
  request (added in a Task 10 follow-up, commit `ffffeed`) to avoid
  re-reading the same rate sheets ~15x in a period-sheet generation loop.
  Cache resets at the top of every `doPost` call.

## Misc context

- Working directory: `D:\Payoll(Audit+Tech+AH  )expenses\` (note the literal
  parentheses/spaces in the path — quote it in shell commands).
- Git user configured: Gilbert / gilbert.alontaga@gmail.com.
- No remote has been added yet — everything above is local commits only, on
  branch `master`.
