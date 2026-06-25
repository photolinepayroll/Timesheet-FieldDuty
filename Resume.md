# Resume — Photoline Expense App build

> Read this first if picking this project back up in a new session/after a
> context reset.

## STOP HERE FIRST: in-progress design as of this save — meal-allowance incomplete-log auto-grant + admin deny override

**Session continued past the previous "no open work" checkpoint below.** A
new feature is mid-brainstorm (design proposed, NOT yet formally approved by
the user via a written spec — they said "save in resume.md" right after
seeing the proposed design, before an explicit final confirmation). **Do
NOT start implementing until the design doc is written and the user
confirms it** (per `superpowers:brainstorming`'s hard gate).

**The problem:** `computeMeal()` requires `hoursWorked >= 5`, computed as
`(lastOut - firstIn) / 3600000`. This is `0` (and thus blocks meal) in TWO
different situations that the user wants treated differently:
1. Log is genuinely incomplete — only a Log In OR only a Log Out exists for
   that day (employee forgot to log the other side, or the GPS app failed).
2. Log is complete (both Log In and Log Out exist) but the visit was
   legitimately short (e.g. 1.1 hours) — the 5-hour rule SHOULD still apply
   here, this is not a target of the new feature.

**Decisions confirmed with the user so far (don't re-ask):**
- For case 1 (genuinely incomplete log) only: auto-grant meal regardless of
  the 5-hour computation, as long as `destination !== mother_branch`. Case
  2 (complete log, short visit) keeps the existing 5-hour rule unchanged —
  this distinction was explicitly confirmed, not assumed.
- A day capped by the existing 20-hour sanity-cap fix (`Code.gs`, commit
  `7d63294f`) — which nulls `lastOut` to treat the day as incomplete — will
  ALSO qualify for the auto-grant under this new rule, since the cap
  already treats it identically to "no Log Out at all." Not yet explicitly
  re-confirmed with the user after this implication was pointed out, but
  flagged as a natural consequence of the cap's existing design.
- Admin needs a manual override: a "Deny meal" / "Allow meal" toggle button
  in `admin.html`'s Period Sheet view, on EVERY row with `meal > 0` (not
  just incomplete-log days — admin should be able to deny any meal,
  confirmed explicitly).
- The toggle must be reversible (deny, then allow again) — not a one-way
  action.
- Accommodation is explicitly UNAFFECTED by any of this — no rule change
  there (it already has no hours threshold, only the mother-branch check).

**Proposed architecture (presented to user, awaiting final spec
confirmation):**
- New `MealDenials` Sheet tab: `employee_name | date | denied_by |
  denied_at`. One row = one denied day. Toggling adds/removes a row.
  Consistent with this project's established "business-tunable data lives
  in a Sheet, not in code" pattern (`MidnightRates`/`LTFRBRates`/
  `EmployeeRates`/`AreaCenters` precedent).
- `Code.gs`: `handleGetPeriodSheet` needs to track whether a day's log was
  "genuinely complete" (`day.in_record && day.out_record`, captured BEFORE
  the 20-hour cap potentially nulls `lastOut` — the cap's nulling must not
  be confused with genuine incompleteness when deciding whether to apply
  the new auto-grant vs. the old 5-hour rule). Pass this as a new parameter
  to `computeMeal`. After computing `meal`, check `MealDenials` for
  `(employee_name, date)` and force to `0` if a denial row exists.
- New `doPost` action `toggleMealDenial`.
- `admin.html`: new button per period-sheet row, calls the new action, then
  re-renders.

**Next action on resume:** finish the brainstorming flow — write the
design doc to `docs/superpowers/specs/<date>-meal-incomplete-log-auto-grant-
design.md`, get explicit user confirmation on the doc (not just the verbal
design summary above), then invoke `superpowers:writing-plans` to produce
an implementation plan, then `superpowers:subagent-driven-development` to
execute task-by-task (same pattern as every other `Code.gs` change this
session — fresh implementer subagent, spec-compliance review, then
code-quality review, for each task).

**Also fixed today, while investigating why meal allowance "wasn't
working" for the admin (turned out to be real, unrelated data bugs, not
the GPS-fallback feature, which was already working correctly):**
- A new `Users` row was added for an employee with two typos: name `"jude H
  patani"` mistyped once as `"Jude Patani"` (which broke attendance
  lookup — `handleGetAttendance`'s name filter is exact/case-sensitive, and
  the real attendance app logs him as `"jude H patani"` literally, with the
  middle initial) — reverted back. Department `"Techinical"` → corrected to
  `"Technical"` (this one was a genuine typo, kept fixed).
- **`Users.name` must always exactly match the literal string the
  attendance app logs** (case-sensitive, no normalization anywhere in the
  pipeline) — do not "clean up" a `Users.name` spelling without first
  checking what the attendance CSV actually has for that person via
  `getAttendance`, or you will silently break their period sheet (zero
  rows, no error).
- `EmployeeRates.employee_name` matching IS case-insensitive (this
  session's earlier fix, commit `4ebc0d0`) but still needs the literal text
  (modulo case) to match `Users.name` exactly — a middle initial or other
  literal difference still won't match even with the case-insensitive
  helper. If `Jude Patani`'s 14 `EmployeeRates` rows still say `"JUDE
  PATANI"` (no middle initial) as of this save, they need updating to
  `"jude H patani"` to actually match him — check this was done before
  trusting his rates work.

---

## Status: app is live, expense-only (OT/UT removed), GPS-fallback area classification shipped, real per-employee rate data imported. Three workstreams below are DONE; see "STOP HERE FIRST" above for what's in progress on top of this.

This session did three big things, all shipped, reviewed, redeployed, and
live-verified:

1. **Removed OT/UT/Offset entirely** — the app is now expense-only (fare,
   meal, accommodation, midnight allowance). Also fixed a real live bug
   (impossible 68hr/103hr `hours_worked` values).
2. **Added GPS-distance-based area classification** as a fallback to the
   existing text-substring area matching, fixing real `meal: 0` bugs for
   employees whose actual destinations (e.g. "Qc cityhall") don't textually
   contain a department-fallback area's regional name (e.g. "NCR AREA").
3. **Bulk-imported real per-employee rate data** from the company's actual
   rate sheets (2 images: ~15 Area Heads + 6 individually-named employees +
   ComTech department row), and fixed a real, previously-invisible bug where
   employee-specific `EmployeeRates` rows silently never matched due to a
   casing mismatch against `Users.name`.

---

## 1. OT/UT/Offset removal + hours-pairing sanity cap

**Why:** the user decided the app should stop computing OT (overtime)/UT
(undertime)/Offset hours entirely and become expense-only. Separately, while
tracing this, a real live bug surfaced: `hours_worked` showed 68 hours
(employee "Emmerson", 2026-06-06) and 103.2 hours (same employee, 2026-06-20)
— physically impossible for one day.

**Root cause of the hours bug:** `handleGetPeriodSheet`'s Log In/Log Out
pairing loop keeps a Log In "open" until the next Log Out arrives, however
many days later, if the employee forgot to log out and no further Log In
happened first. That distant Log Out gets bucketed into the stale day.

**Fix shipped:**
- `Code.gs`: added a 20-hour sanity cap — if a day's paired Log-In-to-Log-Out
  gap exceeds 20 hours, treat the day as incomplete (0 hours, blank
  `time_out`), same as the existing "no Log Out at all" case. Commit
  `7d63294f`.
- `Code.gs`: deleted `computeOT()` and all `ot_hours`/`offset_hours`/
  `ut_hours`/`ot_type` fields from `handleGetPeriodSheet`'s per-row/totals
  objects and `handleLogin`'s returned profile. Commit `d150af2`.
- `admin.html`: removed the OT Type table column, form field, and CSV
  export columns. Commit `74c05e5`.
- `app.js` (shared renderer for both `admin.html` and `index.html`): removed
  the OT/OFFSET/UT/OT TYPE table columns. Commit `dc02218`.
- **Incident during this work**: the `app.js` commit above accidentally
  swept in an unrelated, pre-existing uncommitted change (the real
  `SCRIPT_URL`, which is deliberately kept out of git as a private
  deployment URL). Caught and reverted in a follow-up commit `357ae48`, then
  restored as an uncommitted local-only change again, matching the
  established convention. **If you ever see `app.js` modified in `git
  status`, that's expected and correct — do not commit it.**
- `Users` sheet: `ot_type` column deleted manually from the live Sheet (no
  longer read/written anywhere in code). `SETUP.md` updated to match
  (commit `6059097`).

**Time_in/time_out/hours_worked were deliberately KEPT** (still drive the
5-hour meal-eligibility rule) — only OT/UT/Offset-specific fields and UI
were removed.

---

## 2. GPS-distance-based area classification (fallback)

**Why:** `EmployeeRates` department-fallback rows use broad regional area
names (`"NCR AREA"`, `"CAVITE AREA"`, etc.), but real attendance destinations
are specific place names (`"Qc cityhall"`, `"Sm trece"`) that don't
textually contain the region's name. The existing text-substring match
(`handleGetPeriodSheet`'s area-resolution loop) almost never matched these,
silently producing `meal: 0`/`accom: 0` for entire departments (confirmed
live for employee "Emmerson", department HR).

**Fix shipped (purely additive — substring match still always wins when it
matches; GPS is a fallback, never an override):**
- New `AreaCenters` Sheet tab (`area | lat | lng`) — one admin-edited
  reference point per regional area name. Documented in `SETUP.md`.
  Currently seeded with: NCR AREA (14.5995, 120.9842), CAVITE AREA (14.2456,
  120.8786), PAMPANGA AREA (15.0794, 120.6200), OLONGAPO AREA (14.8294,
  120.2828), DAGUPAN AREA (16.0433, 120.3439), LAGUNA AREA (14.2691,
  121.3700), BICOL AREA (13.1391, 123.7438), VIZ/MIN AREA (10.3157,
  123.8854) — provincial-capital/major-city defaults, admin-confirmed as-is.
- `Code.gs`: extracted a straight-line-only `haversineKm()` helper out of
  `getRoadDistanceKm`'s existing road-distance fallback (which still applies
  its own 1.3x road factor at its own call site — `haversineKm` itself has
  no factor, since area classification wants as-the-crow-flies distance).
  Added `resolveAreaByGPS(lat, lng, candidateAreaNames)` — finds the nearest
  `AreaCenters` row among only this employee's own candidate area names.
  Commit `ba68f83`.
- `Code.gs`: wired this into `handleGetPeriodSheet` as a fallback, gated on
  "substring loop found nothing" (`destinationArea === destination`) AND
  the day's first Log In having real GPS. Commit `78c26f1`.
- Redeployed and live-verified: Emmerson's NCR-area days (e.g. "Qc cityhall")
  now correctly show `meal: 75` instead of `0`.

**Known, accepted limitations (not bugs, deliberate scope decisions):**
- No maximum-distance cutoff — `resolveAreaByGPS` always returns the
  nearest candidate, however far away. An employee genuinely in a region
  with no close candidate area would still get force-matched to the
  nearest one.
- Days with `lat`/`lng` both `0` (no GPS) are unfixed — same as before, only
  text-substring matching applies, usually `meal: 0`.
- One representative point per region is a simplification, especially for
  `"VIZ/MIN AREA"` (spans Visayas AND Mindanao).
- `AreaCenters` row-name typos fail silently (no validation) — same
  no-validation-lookup convention as the rest of this codebase.

---

## 3. Bulk rate data import + case-insensitive employee_name fix

**Why:** the admin supplied 2 images of the real, authoritative company rate
sheets. Cross-checking against live `EmployeeRates` revealed 14 of 15 real
"Area Heads" (only Crispin Casil was previously imported) and 6 more
individually-named employees were completely missing, plus a "ComTech"
department had zero coverage, plus the one real live-tested employee
(Louwin Celis) had wrong numbers (relying on the generic "Technical"
fallback when his real rate differs on 3 areas).

**Imported via the existing `RawRateImport` → `oneTimeImportEmployeeRates`
one-time Apps Script function** (re-pasted each time it's needed — it's
intentionally not kept permanently in `Code.gs`). `handleSaveRates` does a
**full replace** of `EmployeeRates` (clears all data rows, writes only
what's passed), so every `RawRateImport` paste must include ALL rows that
should still exist, not just new ones — learned this the hard way mid-import
this session, now documented here so it isn't re-discovered painfully next
time.

**Final imported total: 179 rows** — 17 named employees (Crispin Casil +
15 Area Heads + Louwin Celis's 3-area override) plus 5 department-fallback
groups (Auditing, CARPENTERS, Technical, HR, ComTech — 42 rows total). All
spot-checked against the source images and confirmed exact.

**A real bug found and fixed during this import:** employee-specific
`EmployeeRates` rows were entered as `"LOUWIN CELIS"` (all caps, matching
the source image's style) while the canonical `Users.name` is `"Louwin
celis"` (mixed case). `resolveEmployeeRate`'s and `candidateAreaRows`'s
employee_name comparisons were case-SENSITIVE (`===`), so this silently
never matched — meaning **Louwin's employee-specific override rates had
never actually applied this whole time**, with zero error, quietly falling
through to the generic department rate instead. Fixed by adding a
`namesMatch()` case-insensitive helper, used in exactly those two
comparison sites only (not `Users.name` lookups elsewhere, not
`Claims.employee_name`, not the attendance CSV's name field — those are
flagged as having the same theoretical risk but explicitly left out of
scope since no live incident has been reported there). Commit `4ebc0d0`.
Live-verified via a temporary test row (added, confirmed it fired, then
removed) that substring match still correctly wins over GPS fallback even
with the case-insensitive comparison in place.

**If you ever add more rate data for a named employee, double-check the
`employee_name` spelling is otherwise correct (typos still won't match,
this fix only handles case) and that the source PDF/image's all-caps
convention doesn't introduce a new mismatch with how that name appears in
`Users`.**

---

## Full commit log (newest first, this session's additions on top)

```
4ebc0d0 fix: case-insensitive employee_name matching in EmployeeRates lookups
78c26f1 feat: GPS-distance fallback for area classification when substring match fails
ba68f83 feat: extract straight-line Haversine helper, add GPS-based area resolver
4e17187 docs: document AreaCenters schema for GPS-fallback area classification
6059097 docs: drop ot_type from Users sheet schema docs
357ae48 fix: revert accidentally-committed SCRIPT_URL, restore placeholder
dc02218 feat: remove OT/UT/Offset columns from shared period-sheet renderer
74c05e5 feat: remove OT/UT/Offset fields from admin Users UI and CSV export
d150af2 feat: remove OT/UT/Offset computation, descope app to expense-only
7d63294f fix: cap hours_worked at 20h to reject stale Log-In/distant Log-Out mispairs
--- (older history: per-employee rate redesign, Company Service claim type,
    live-testing bug fixes — see `git log` for full history before this
    session) ---
```

## What's deployed right now

- **Live Google Sheet**, tabs: `Users` (no `ot_type` column anymore),
  `EmployeeRates` (179 rows, real company data), `AreaCenters` (new, 8
  rows), `MidnightRates`, `LTFRBRates`, `Claims`, `Config`, `RawRateImport`
  (scratch staging, reused each bulk-import — admin's call whether to keep
  as audit trail).
- **Live Apps Script Web App**, deployed and reachable, redeployed multiple
  times this session with all changes above. `app.js`'s `SCRIPT_URL` has the
  real deployment URL — **this is an UNSTAGED, UNCOMMITTED local change**
  (deliberately left out of git, it's a private URL — see the incident
  note above if this ever looks "modified" in git status, that's correct).
- **Real Users**: `Louwin celis` (department Technical, real attendance,
  fully live-tested), `Emmerson` (department HR, real attendance,
  live-tested this session), `Admin`/`Test Head` (role `head`, for admin
  testing).
- **EmployeeRates**: real company data for 15 Area Heads (PDF7-style
  roster), 6 more individually-named employees, Crispin Casil (no live
  Users account — rates exist but dormant until/unless he's added),
  Louwin Celis (3-area override + generic Technical fallback for the
  rest), and 5 department-fallback groups (Auditing, CARPENTERS, Technical,
  HR, ComTech).
- **Current period in Config**: `period_start = 2026-06-11`,
  `period_end = 2026-06-25`.

## Admin/product decisions confirmed during this session (don't re-ask)

1. **App is expense-only now** — fare, meal, accommodation, midnight. No
   OT/UT/Offset tracking at all, anywhere.
2. **GPS fallback never overrides a working substring match** — confirmed
   both by code-level review and a live test (temporary test row on Louwin
   Celis, removed after verification).
3. **20-hour cap** on Log-In/Log-Out pairing — gaps beyond this are treated
   as incomplete days (0 hours), not capped/truncated.
4. **`AreaCenters` coordinates** use provincial-capital/major-city defaults
   as-is, admin-confirmed, no per-employee or finer-grained overrides
   requested.
5. **ComTech modeled as one shared department-fallback row** (not
   per-employee), since all current ComTech members share identical rates —
   same reasoning applied to Technical's other members besides Louwin.
6. **Jude Patani's two conflicting source listings** (personal 14-area list
   vs. a slightly different combo under "TECHNICAL DEPT.") — admin chose
   his personal listing as authoritative, the other was discarded.
7. **"NONE"-marked cells in the source images = ₱0/₱0**, same treatment as
   a dash.
8. **No `Users` rows created for the 20 newly-imported names** — their
   `EmployeeRates` rows sit dormant harmlessly until/if they're ever added
   as real users.
9. **`employee_name` matching against `EmployeeRates` is case-insensitive**;
   matching against `Claims`/attendance-CSV names is explicitly still
   case-sensitive (flagged as same-risk but out of scope, no live incident
   reported there yet).

## Admin/product decisions from earlier sessions (still valid, don't re-ask)

1. **Round-trip fares**: IN→OUT GPS leg is one-way; fare is DOUBLED via
   `buildAutoFareClaim`.
2. **Fare rounding**: nearest peso (`Math.round`).
3. **Fraud guard tolerance**: 20% (`Config.fraud_tolerance_pct`) — seeded but
   intentionally never gated on anywhere (pre-existing design gap, not a bug).
4. **Accommodation trigger**: "destination ≠ mother branch" is sufficient,
   no hours-worked threshold (unlike meal's 5-hour rule).
5. **Company Service fare suppression**: an approved `company-service`
   claim suppresses ONLY that date's auto-computed fare, nothing else.
6. **Per-employee rate model**: employee-specific `EmployeeRates` row always
   wins over a department-fallback row for the same area.

## Known, accepted gaps (deliberate or pre-existing — not bugs to silently "fix" later without asking)

- `employee_id` column in `Claims` is defined but never populated — keys off
  `name` instead everywhere. Harmless.
- Base64 receipt photos in a `Claims` cell can exceed Sheets' ~50,000-char
  limit for large images — documented inline, not fixed.
- `getRoadDistanceKm`'s OSRM-then-Haversine fallback swallows errors
  silently — no flagging if OSRM is down for an extended period.
- `c.id` is deliberately left unescaped in one `onclick` attribute in
  `admin.html`'s Claims table (server-generated, safe by construction).
- `escapeHtml()` is used for employee-authored free text; admin-authored
  data (`Users`, rate tables) renders unescaped — an intentional,
  not-retrofitted-everywhere distinction.
- `sheetToObjects()` caches per-`doPost`-request to avoid redundant sheet
  reads; cache resets at the top of every `doPost` call.
- Real attendance timestamps don't reliably zero-pad single-digit hours —
  any code that sorts/compares timestamps must parse via `Date`, never raw
  string comparison.
- Google Sheets auto-converts date-looking text to real Date cells unless
  you prefix with `'`.
- `resolveAreaByGPS` has no maximum-distance cutoff (see GPS section above).
- `Claims.employee_name` and the attendance CSV's `name` field are NOT
  case-insensitive (only `EmployeeRates.employee_name` is, as of this
  session) — same risk class, explicitly left unfixed pending a real
  reported incident.

## Misc context

- Working directory: `D:\Payoll(Audit+Tech+AH  )expenses\` (literal
  parentheses/spaces in the path — quote it in shell commands).
- Git user: Gilbert / gilbert.alontaga@gmail.com.
- No git remote added yet — local commits only, branch `master`. The
  pre-existing `Md files/` (original plan docs) and `files.zip` remain
  untracked/uncommitted, as always.
- The live deployment's `SCRIPT_URL` (in `app.js`, uncommitted) and the
  Google Sheet itself are the user's real, private infrastructure — when
  verifying things live, calling the deployed Web App directly via
  PowerShell `Invoke-WebRequest` POST requests with JSON bodies matching
  `Code.gs`'s `doPost` action dispatch is the established way to test
  without needing a browser.
- This session's work was executed via `superpowers:subagent-driven-
  development` (fresh implementer subagent per task, spec-compliance
  review, then code-quality review, for every `Code.gs`/`admin.html`/
  `app.js` change) — same pattern as prior sessions. Plans are saved at
  `C:\Users\Gilbert\.claude\plans\cge-trace-mo-bka-elegant-boot.md` (note:
  this is the harness's plan-mode scratch file, reused across this whole
  session for three different sub-plans in sequence — not meant as a
  permanent project doc, unlike the `docs/superpowers/plans/` files from
  earlier sessions).
