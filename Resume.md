# Resume — Photoline Expense App build

> Read this first if picking this project back up in a new session/after a
> context reset.

## Status: original 12-task build is DONE and DEPLOYED LIVE. Company Service feature is DONE — all 3 tasks complete, verified working live.

Big change since the last version of this file: **the app is no longer just
code — it's deployed and has been live-tested with real data.** The human
created the Google Sheet, deployed `Code.gs` as an Apps Script Web App, and
pasted the real `SCRIPT_URL` into `app.js` (uncommitted locally, on purpose
— it's a private deployment URL, not committed to git, currently sitting as
an unstaged working-tree change). Live testing against a real employee
(`Louwin celis`) surfaced and fixed several real bugs (see below) that had
never been caught by static/synthetic review during the original build.

## Full commit log (newest first)

```
375bdd7 fix: normalize Claims.date before comparing against period-sheet dates
f0c3971 docs: update Resume.md — live deployment, bugs found/fixed, Company Service in progress
2f972fc feat: suppress auto-fare for approved Company Service dates
6a993ac docs: clarify why Amount is conditionally required in submitClaim
834c769 feat: add Company Service (No Fare) claim type to submission form
75d455d docs: add implementation plan for Company Service (No Fare) claim type
8c649fa fix: rename approve/reject decision field from "action" to "decision"
f0d43d4 docs: add design spec for Company Service (No Fare) claim type
42a208b fix: sort attendance records by parsed Date, not raw timestamp string
906c7d0 fix: pair Log In/Log Out chronologically instead of bucketing by own date
8c7a720 docs: update Resume.md — all 12 plan tasks complete
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

## What's deployed right now

- **Live Google Sheet** with all 7 tabs, seeded per `SETUP.md`.
- **Live Apps Script Web App**, deployed and reachable. `app.js`'s
  `SCRIPT_URL` has the real deployment URL — **this is an UNSTAGED, UNCOMMITTED
  local change** (deliberately left out of git, it's a private URL). Don't
  let a future `git status` cleanup accidentally discard it.
- **One test employee** in the `Users` sheet: `Louwin celis` / PIN `1111` /
  role `employee` — a REAL employee name matched against real attendance
  records (verified exact spelling against the live attendance CSV: capital
  `L`, lowercase `c`, nothing else). Also a `Test Head` user should exist for
  admin-side testing (added earlier in the session — verify it's still there
  if picking this up cold).
- **Rate tables seeded with one row each**: `MealRates`/`AccomRates` both
  have area `"SM"` → level_1/2/3 = `100/150/150` (Meal) and `0/150/150`
  (Accom) — these are TEST values the user chose during live testing, not
  necessarily final real company rates. `LTFRBRates`/`MidnightRates` have
  their original `SETUP.md` seed data.
- **Current period in Config**: `period_start = 2026-06-11`,
  `period_end = 2026-06-25` (real values, entered as text via a leading `'`
  to prevent Sheets auto-converting them to Date objects — this matters,
  see "Known gaps" below).

## Critical bugs found via live testing (all fixed, but redeploy required — see below)

These were NEVER caught during the original build's spec/quality review,
because that review only ever traced code statically or against synthetic
data — none of it caught these until real GPS/timestamp data from the real
attendance app was run through the live deployment:

1. **Overnight-shift day-grouping bug** (commits `906c7d0`, `42a208b`).
   `handleGetPeriodSheet` used to bucket attendance records by each record's
   OWN calendar date, so a shift crossing midnight (clock in 10PM, clock out
   3AM next day) got split into two separate days, BOTH showing as 0 hours
   worked / full undertime. Fixed by sorting all records chronologically (via
   `Date` parsing, NOT string comparison — the real attendance app does NOT
   always zero-pad single-digit hours, e.g. `"2026-06-19 3:19:44"`, which
   broke a first attempt at this fix that used string sort) and pairing each
   Log In with the next Log Out that follows it, attributing the whole shift
   to the date it started on.
2. **Approve/Reject buttons completely non-functional** (commit `8c649fa`).
   `api()` in `app.js` does `Object.assign({action: dispatchAction}, params)`
   — later sources win, so `admin.html`'s `approveReject()` sending its own
   `action: 'approve'/'reject'` field silently overwrote the dispatch key
   `'approveClaim'` before `doPost` ever saw it. Every Approve/Reject click
   failed with `"Unknown action: approve"`. This bug existed since Task 9
   (commit `46a1027`) — copied verbatim from the original plan document's
   own example code — and was only discovered while writing live-API test
   steps for the NEW Company Service feature below. **Fixed by renaming the
   field to `decision`** in both `admin.html`'s call and `Code.gs`'s
   `handleApproveClaim`. If you ever add another `api()` call that needs a
   param also called `action`, rename it — this collision pattern WILL
   recur otherwise.
3. **Sheet data-entry typos** (not code bugs, fixed directly in the live
   Sheet, not via commit): `Config.attendance_csv_url` had a stray trailing
   backtick character (likely from copy-pasting a markdown-formatted URL out
   of a chat message) which broke the CSV fetch entirely; `LTFRBRates`'
   header cell had a trailing space (`"vehicle_type "` instead of
   `"vehicle_type"`), which broke `computeFare`'s lookup for every call. Both
   fixed by the user directly in the Sheet UI. **If `getAttendance` or
   `getPeriodSheet` ever start failing again with no obvious code cause,
   check the Sheet cells for invisible whitespace/stray characters first** —
   these are easy to introduce via copy-paste and hard to spot visually.
4. **Claims.date silently never matched any period-sheet date** (commit
   `375bdd7`) — the biggest one. Google Sheets auto-converts a date-shaped
   string written into a cell into a real Date value, EVEN when the app
   itself writes it via `appendRow` (not just manual typing). So every claim
   saved via `handleSaveClaim` got its `date` field silently turned into a
   Date object; reading it back via `sheetToObjects()` returned that Date,
   which (via `JSON.stringify`) serializes as a UTC ISO timestamp that can
   even land on the WRONG calendar day (`"2026-06-13"` local became
   `"2026-06-12T16:00:00.000Z"` — an 8-hour UTC offset shift). Every
   `c['date'] === date` comparison in `handleGetPeriodSheet` — used for
   `special-fare`, `accommodation`, AND `company-service` claims — silently
   never matched. **This means no special-fare/accommodation claim had ever
   actually been applying to a period sheet, this whole time**, not just the
   new Company Service feature. Fixed with a `claimDateKey()` helper that
   normalizes either a Date object (via `Utilities.formatDate` with the
   script's own timezone — NOT `toISOString()`/UTC, which would reintroduce
   the same day-shift bug) or a plain string to a `'YYYY-MM-DD'` key before
   comparing. **If you ever add a new comparison against `Claims.date` (or
   any other Sheets column that might hold date-shaped text), use
   `claimDateKey()` — don't compare raw values.**

## Done: Company Service (No Fare) claim type

A new feature, brainstormed, planned, and fully shipped mid-session after
live testing was already underway. Full docs:
- Design: `docs/superpowers/specs/2026-06-23-company-service-no-fare-design.md`
- Plan: `docs/superpowers/plans/2026-06-23-company-service-no-fare.md`

**What it does:** lets an employee declare that a specific date had no
personal transport cost (a company vehicle picked them up). Once a head
approves it (same existing approval queue, no new mechanism), that exact
date's auto-computed fare becomes ₱0 — meal/accommodation/midnight/OT are
explicitly unaffected (confirmed with the user as in-scope boundary).

**Implementation approach:** reuses the existing `Claims` sheet/form/
approval-queue infrastructure unchanged — just a new `type` value
(`'company-service'`), exactly like `'special-fare'`/`'accommodation'`.

**Status: ALL 3 tasks DONE, reviewed, committed, and verified live:**
- Task 1 (`834c769`, `6a993ac`): `index.html`'s claim form has the new
  dropdown option; Amount field is optional for this type only (normalizes
  blank/NaN to `0`).
- Task 2 (`2f972fc`): `Code.gs`'s `handleGetPeriodSheet` now checks for an
  approved company-service claim on each date before calling
  `buildAutoFareClaim`, skipping it entirely (and its OSRM network call) when
  one exists — ANDed with the existing mother-branch check, not replacing it.
- Task 3: live-verified end-to-end against the real deployment (submitted a
  company-service claim for `Louwin celis` on `2026-06-13`, confirmed no
  effect before approval, approved it using the `decision` field, confirmed
  `auto_fare` became `0` after approval while
   meal/accom/midnight/ot_hours stay unchanged).

## Admin/product decisions confirmed during the build (don't re-ask if extending this app)

1. **Round-trip fares**: IN→OUT GPS leg is one-way; fare is DOUBLED via
   `buildAutoFareClaim`, reused (not duplicated) by `handleGetPeriodSheet`.
2. **Fare rounding**: nearest peso (`Math.round`).
3. **Fraud guard tolerance**: 20% (`Config.fraud_tolerance_pct`) — seeded but
   intentionally never gated on anywhere (pre-existing design gap, not a bug).
4. **OT/UT rule**: continuous-hours math (no discrete half-day/minute buckets).
5. **Accommodation trigger**: "destination ≠ mother branch" is sufficient,
   no hours-worked threshold (unlike meal's 5-hour rule) — confirmed this is
   intentional, not a bug, even when it produces accommodation on a
   0-recorded-hours day (e.g. an orphan Log Out with no matching Log In).
6. **Company Service fare suppression** (new, this session): suppresses
   ONLY the auto-computed fare for that date, nothing else — see above.

## Known, accepted gaps (deliberate or pre-existing — not bugs to silently "fix" later without asking)

- `employee_id` column in `Claims` is defined but never populated — keys off
  `name` instead everywhere. Harmless.
- Base64 receipt photos in a `Claims` cell can exceed Sheets' ~50,000-char
  limit for large images — documented inline (`c732921`), not fixed.
- `getRoadDistanceKm`'s OSRM-then-Haversine fallback swallows errors
  silently — no flagging if OSRM is down for an extended period.
- `c.id` is deliberately left unescaped in one `onclick` attribute in
  `admin.html`'s Claims table (server-generated, safe by construction —
  escaping wouldn't actually help there anyway; see comment at `cb45870`).
- `escapeHtml()` is used for employee-authored free text (`Claims.notes`,
  attendance's free-typed `destination`/`branch`); admin-authored data
  (`Users`, rate tables) renders unescaped in `loadUsers` — an intentional,
  not-retrofitted-everywhere distinction.
- `sheetToObjects()` caches per-`doPost`-request (`ffffeed`) to avoid
  redundant sheet reads in the period-sheet loop; cache resets at the top of
  every `doPost` call.
- Real attendance timestamps don't reliably zero-pad single-digit hours —
  confirmed via live data (`"2026-06-19 3:19:44"`). Any future code that
  sorts/compares timestamps must parse via `Date`, never raw string
  comparison, or it WILL silently misorder things (this is exactly what
  broke commit `906c7d0`'s first attempt, fixed in `42a208b`).
- Google Sheets auto-converts date-looking text to real Date cells unless
  you prefix with `'` — already done correctly for `Config.period_start`/
  `period_end`, but worth remembering for any future date-valued cell.

## Misc context

- Working directory: `D:\Payoll(Audit+Tech+AH  )expenses\` (literal
  parentheses/spaces in the path — quote it in shell commands).
- Git user: Gilbert / gilbert.alontaga@gmail.com.
- No git remote added yet — local commits only, branch `master`. The
  pre-existing `Md files/` (original plan docs) and `files.zip` remain
  untracked/uncommitted, as always.
- The live deployment's `SCRIPT_URL` (in `app.js`, uncommitted) and the
  Google Sheet itself are the user's real, private infrastructure — when
  verifying things live, you (the assistant) have been calling the deployed
  Web App directly via PowerShell `Invoke-WebRequest` POST requests with
  JSON bodies matching `Code.gs`'s `doPost` action dispatch — this works and
  is the established way to test without needing a browser.
