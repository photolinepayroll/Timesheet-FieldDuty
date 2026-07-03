# Resume — Photoline Expense App build

> Read this first if picking this project back up in a new session/after a
> context reset.

## STOP HERE FIRST: open data issues for the admin (none are code bugs)

1. **Jude Patani's blank `Users.mother_branch`** — verified live 2026-07-03:
   his period sheet granted ₱150 meal at "Marquee ter" (= Marquee Mall, his
   mother branch). The mother-branch zeroing rule compares the attendance
   destination string against `Users.mother_branch`, and his is **blank**, so
   the rule can never fire; the GPS fallback then classifies the day onto a
   paying area. Fix in the live Sheet's `Users` tab: set his `mother_branch`
   to the EXACT destination string the attendance app logs (looks like
   "Marquee ter" — verify via `getAttendance` first). Check other users for
   blank `mother_branch` too.
2. **New broad area names need `AreaCenters` rows** for GPS-fallback
   classification (they'll never substring-match a real destination):
   `PROVINCIAL`, `NORTH LUZON`, `SOUTH LUZON`, `VISMIN / MINDANAO`,
   `VIS/MIN AREA`, `OLONGAPO AREA`, `DAGUPAN AREA`, `BULACAN AREA`,
   `PAMPANGA AREA`, `LAGUNA AREA`, `BICOL AREA`, `NCR AREA`, `CAVITE AREA`
   (some may already exist — check the `AreaCenters` tab). Admin adds
   `area | lat | lng` rows for whichever are missing.
3. **Two rate-book ambiguities imported with defaults** (2026-07-03 import,
   confirm with admin): Leah May Legaspi's R. ANTIQUE read "300/150" in the
   PDF — imported as meal 150 / accom 300 (assumed swapped columns, matching
   every sibling row); Jorwen Cacho's SM OLONGAPO CENTRAL was ambiguous —
   imported as meal 150 / accom 0 (matching SM OLONGAPO DOWNTOWN). Also
   "SM CDO PEMIER" (PDF typo) was imported as "SM CDO PREMIER", and the PDF
   spells Walter "PUNSALAN" but rows keep the existing "WALTER PUNZALAN" —
   when he gets a Users account, the name must match the attendance app.

**RESOLVED (2026-07-03): the Jude Patani `EmployeeRates` name mismatch.**
The admin's manual fix was confirmed live (`getRates` showed 14 rows under
`"jude H patani"`), and the 2026-07-03 rate import (below) rewrote his rows
under the correct name. General rule stands: **`Users.name` must always
exactly match the literal string the attendance app logs** (case-sensitive,
no normalization) — check `getAttendance` before "cleaning up" any spelling.

---

## Status: app is live, expense-only (OT/UT removed), GPS-fallback area classification shipped, real per-employee rate data imported, meal-allowance incomplete-log auto-grant + admin deny override shipped, employee 3-tab self-service dashboard shipped, meal-control batching + clear status indicator shipped, receipt-photo mobile fix + admin receipt viewer/editable-claimed-amount shipped, 2026-07-03 full rate-book reimport applied live, admin Check Name Matches audit tool shipped. Ten workstreams below are DONE.

Ten big things shipped, all committed:

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
4. **Shipped meal-allowance auto-grant for incomplete attendance logs**,
   plus an admin "Deny Meal"/"Allow Meal" override toggle in the Period
   Sheet view.
5. **Employee 3-tab self-service dashboard** — `index.html` rebuilt as a
   proper dashboard with My Sheet / My Claims / Attendance tabs. Each
   employee can see their period sheet with FROM/TO/MODE columns per row
   (populated from `claim_details`), all their submitted claims with status
   badges, and their raw attendance log with GPS per day. Per-row `+ Fare` /
   `+ Accom` buttons open an inline claim form. `Code.gs`'s
   `handleGetPeriodSheet` gained a `claim_details` field per row (Approved +
   Submitted special-fare/accommodation claims), and `app.js`'s
   `renderPeriodSheet` gained an `employeeControls` opt that switches the
   column layout. Commits `9a24921`.
6. **Lazy load — manual date range, no auto-fetch on login** — the app was
   hanging on login because `loadEmployeePeriodSheet` fired automatically,
   downloading the entire attendance CSV before the employee did anything.
   Fix: date-range inputs (pre-filled from Config) + a "Load" button above
   the tab bar; nothing fetches until the employee clicks Load. `switchTab`
   no longer auto-fetches on tab switch; `loadEmployeeConfig` only pre-fills
   the inputs; new `loadCurrentTab()` dispatches to the active tab's loader.
   Commit `f32d5ea`.
7. **Meal-control batching + clear allow/deny status indicator** — the
   admin's Deny/Allow Meal button used to call `toggleMealDenial` on the
   server AND re-fetch the whole period sheet on every single click,
   making it slow to review a sheet row by row. Clicks now flip state
   only in the browser; a "💾 Save Meal Changes (N)" button (appears only
   when there are pending toggles) batches the actual `toggleMealDenial`
   calls and refreshes once. Also fixed a real UX bug found during
   testing: the button's label was the ACTION ("Allow Meal" = click to
   reverse a denial), not the current STATUS, so a denied row displaying
   "Allow Meal" read like the meal was currently allowed. Added an
   explicit colored ALLOWED/DENIED status word plus button background
   color so state is unambiguous regardless of button text. Commit
   `d11d599`.
8. **Receipt-photo mobile fix + admin receipt viewer/editable claimed
   amount** — three related fixes to the receipt-photo pipeline and
   Claims approval queue:
   - `index.html`: removed `capture="environment"` from the receipt file
     input — it was forcing mobile browsers straight to the camera,
     skipping the photo-album option entirely.
   - `index.html`: added `compressReceiptImage()` — resizes to max
     1600px on the longest side and re-encodes as JPEG at 70% quality via
     canvas before converting to base64, replacing the old
     raw-file-to-base64 path. This also fixes the previously-documented
     known gap where an uncompressed phone photo's base64 could exceed
     Google Sheets' ~50,000-char cell limit.
   - `admin.html`: Claims approval queue gained a receipt-photo popup
     viewer (new `#receipt-modal` overlay — first modal pattern in this
     codebase, plain fixed-position div, no framework) and an editable
     Claimed-amount `<input>` (was read-only). Approve now sends the
     admin's (possibly-corrected) amount along with the decision; Reject
     leaves the originally-submitted amount untouched (confirmed
     explicitly — only Approve should be able to change the paid amount).
   - `Code.gs`'s `handleApproveClaim` writes the corrected
     `claimed_amount` to the sheet, gated server-side on
     `payload.decision === 'approve'` (not just trusting the client to
     omit the field on reject).
   Commit `d2b7964`. **The `Code.gs` change needs a manual redeploy
   before it takes effect live** — see "What's deployed right now".
   (Redeploy was completed by the admin on 2026-07-03, verified live.)
9. **2026-07-03 full rate-book reimport, applied LIVE** — admin supplied two
   PDFs ("Meal Allowance Page1/Page2"); the live `EmployeeRates` table was
   fully replaced via the app's own `saveRates` API (no code changes needed —
   the position-based Head Office rates map to named-employee rows).
   Now 245 rows: 38 named employees + 5 dept fallbacks. Admin decisions:
   Page 2's TECHNICAL section wins over Page 1's conflicting tables for the
   six Technical employees; the 8 employees absent from the PDFs (Carol
   Beltran, Christian Caidoy, Jay Mark de Sahagun, Jiel Lumanta, Maricel
   Cayacap, Raymond Meniano, Robert Mendoza, Shaira Mae Mendoza) keep their
   prior rows verbatim; the Head Office STAFF table became the HR + ComTech
   + Technical dept fallbacks; Auditing + CARPENTERS got their own PDF
   tables. Officers imported as employee rows: Senior (Sally Borbon, Grace
   Escanlar, Cris Taglucop, Theresa Asumbrado — NCR 100, PROVINCIAL 300/500),
   Junior (Louwin Celis, Lanilyn Balane, Anthony Dimasuhid — NCR 100,
   PROVINCIAL 300/400). MidnightRates verified unchanged (50/100/150).
   Pre-import backup: `Md files/2026-07-03-rates-backup-before-import.json`
   (177 rows). Verified live: row count, 13 spot checks, retained-8
   byte-identical, ₱ rates on jude H patani's real period sheet. See "STOP
   HERE FIRST" for the ambiguities imported with defaults + AreaCenters
   follow-ups.
10. **Admin "Check Name Matches" audit tool** — new read-only
    `checkNameMatches` action (`Code.gs`) + button in admin.html's
    Employees tab. Cross-checks every `Users` row against the attendance
    CSV's names (exact/case-only/none — mirrors `handleGetAttendance`'s
    real case-sensitive filter) and against `EmployeeRates.employee_name`
    (employee-specific/dept-fallback/none — mirrors `namesMatch()` +
    `resolveEmployeeRate`'s fallback logic). Built specifically so the Jude
    Patani-style mismatch (silent 0-row/₱0-rate failure, no error shown)
    gets caught proactively instead of discovered per-incident. View-only —
    admin still fixes mismatches via the existing Users/EmployeeRates
    forms. Logic verified by replicating it in a script against real live
    `getUsers`/`getRates`/`getAttendance` data before commit — correctly
    flagged `jude H patani` as exact/employee, `Emmerson` as
    exact/dept-fallback, and incidentally surfaced that **`ANN CHRISTINE
    JOY TRIA`'s `Users.department` is blank** (she has no attendance
    records yet either — likely a new hire not fully set up). Commit
    `7e3a4a8`. **Needs the same pending manual Code.gs redeploy as always**
    before it's usable live.

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
- GPS fallback only ever looks at `day.in_record` (the day's first Log In)
  — confirmed this session: a day with ONLY an orphan Log Out (no Log In at
  all, e.g. employee "Emmerson" on 2026-06-19, destination `"SM TRECE"`)
  cannot be GPS-classified even though that Log Out itself carries valid
  GPS coordinates. `destinationArea` stays as the raw, unmatched destination
  string, and `meal` stays `0` purely because no `EmployeeRates` row exists
  for that literal string. Not a bug — consistent with the original design
  decision to use only the day's first Log In — but worth knowing this is a
  real, currently-occurring case, not just a hypothetical edge case.

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

## 4. Meal-allowance incomplete-log auto-grant + admin deny override

**Why:** `computeMeal()` required `hoursWorked >= 5`, but `hoursWorked`
comes out `0` in two different situations: (1) a genuinely incomplete
attendance log (missing Log In or Log Out — including a day nulled by the
20-hour sanity cap from workstream 1), or (2) a complete log with a
legitimately short visit (e.g. 1.1 hours). Only case 1 should auto-grant
meal; case 2 must keep the existing 5-hour rule.

**Design:** `docs/superpowers/specs/2026-06-26-meal-incomplete-log-auto-grant-design.md`.
**Plan:** `docs/superpowers/plans/2026-06-26-meal-incomplete-log-auto-grant.md`.

**What shipped:**
- `Code.gs`: `computeMeal()` gained a `wasLogComplete` parameter — the
  5-hour check now only applies `if (wasLogComplete && hoursWorked < 5)`.
  `wasLogComplete = !!(firstIn && lastOut)`, computed from the
  ALREADY-capped `firstIn`/`lastOut` (after the 20-hour cap may have
  nulled `lastOut`) — so a capped day naturally counts as incomplete too,
  no separate cap-awareness logic needed. Commit `c019aa6`.
- New `MealDenials` Sheet tab (`employee_name | date | denied_by |
  denied_at`) — one row = one denied day, written/deleted only by the app,
  never hand-edited. Schema documented in `SETUP.md`, commit `8e96a00`.
- New `toggleMealDenial` doPost action — idempotent toggle, deletes the row
  if found (un-deny), appends one if not (deny). `employee_name` matching
  here is intentionally case-SENSITIVE (unlike `EmployeeRates`) since this
  tab is written by the app from an already-resolved name, never
  hand-typed. Commit `8cb2118`.
- `app.js`'s shared `renderPeriodSheet(sheet, opts)` gained an opt-in
  `opts.adminControls` flag — when true, renders a `MEAL CTRL` column with
  a `Deny Meal`/`Allow Meal` button (class `meal-deny-btn`) on every row
  where `meal > 0` OR `meal_denied` is true (so the button stays visible
  to reverse a denial even after `meal` is forced to `0`). Commit `2fa5054`.
- `admin.html`: turned on `{ adminControls: true }` in `generatePeriodSheet()`'s
  `renderPeriodSheet` call, and added a click handler (event-delegated on
  `#period-sheet-output`, attached once inside the existing
  `DOMContentLoaded` callback) that calls `toggleMealDenial` then
  re-generates the sheet. Uses `currentUser().name` for `denied_by`, same
  pattern as `approveReject()`. Commits `49c23d2`, `746f08f`.
- `MealDenials` tab created live, `Code.gs` redeployed, `admin.html`
  reloaded. **Live-verified end-to-end**: incomplete-log days (no Log In or
  no Log Out) that previously showed `meal: 0` now correctly auto-grant
  (confirmed for employee "Emmerson" on 2026-06-06, 06-13, 06-20); a
  complete-log short-visit day (06-15, 1.1 hours) correctly stayed at
  `meal: 0`, unaffected; the deny/allow toggle round-trips correctly
  (`toggleMealDenial` → `meal: 0` → toggle again → `meal` returns to its
  auto-granted amount); confirmed in the `admin.html` browser UI too (MEAL
  CTRL column with working buttons).

**Note on this section's history:** most of this feature (the `Code.gs`/
`app.js`/`SETUP.md` pieces) was actually built and committed in an earlier,
interrupted session — that session got cut off before finishing
`admin.html`'s wiring, redeploying, or live-verifying, leaving this file's
"STOP HERE FIRST" section stuck describing it as "mid-brainstorm, not yet
approved" even though the design had already been implemented. This
session picked up from there: confirmed the design (it matched what had
already been built almost exactly), wrote the formal spec/plan docs to
match, found and fixed the one missing piece (`admin.html` wiring), then
redeployed and finished verification. **Lesson: when `Resume.md` says a
feature is "in progress," always check `git log` for matching commits
before assuming nothing was built yet** — this file can go stale if a
session gets interrupted mid-task.

**Known limitation carried over from workstream 2:** a day with ONLY an
orphan Log Out (no Log In at all — e.g. Emmerson's 2026-06-19) still can't
get an auto-granted meal even though `wasLogComplete` is correctly `false`
for it, because area resolution (substring + GPS fallback) needs
`day.in_record` to run the GPS fallback at all, and without it
`destinationArea` stays as the raw, unmatched destination string with no
`EmployeeRates` row. Not introduced by this feature — pre-existing GPS
fallback limitation, just newly visible because this feature removed the
5-hour rule that used to mask it on these specific days.

---

## Full commit log (newest first, this session's additions on top)

```
d2b7964 feat: receipt photo viewer + editable claimed amount, mobile album picker fix
d11d599 feat: batch meal-control saves, add clear allow/deny status indicator
37ec95c docs: update Resume.md for GitHub Pages, add CLAUDE.md project context
ad7d1c7 config: set live deployment URL for GitHub Pages
a82a6bf merge: resolve README conflict, combine title with app description
0957911 docs: add original planning and design md files
68cc9b9 docs: update Resume.md — employee dashboard + lazy load shipped
f32d5ea fix: manual date range entry + lazy load to prevent hang on login
9a24921 feat: employee 3-tab dashboard — My Sheet, My Claims, Attendance
0bf8365 docs: update Resume.md — meal incomplete-log auto-grant shipped, flag Jude Patani EmployeeRates name mismatch
746f08f fix: move meal-deny click handler inside DOMContentLoaded for consistency
49c23d2 feat: wire admin Period Sheet UI to meal-deny toggle
2fa5054 feat: add opt-in admin Allow/Deny meal column to renderPeriodSheet
8cb2118 feat: add toggleMealDenial doPost action
c019aa6 feat: auto-grant meal on incomplete logs, apply admin deny override
8e96a00 docs: document MealDenials schema for meal auto-grant + admin override
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
  `EmployeeRates` (179 rows, real company data), `AreaCenters` (8 rows),
  `MealDenials` (new this session, empty until admin uses the toggle),
  `MidnightRates`, `LTFRBRates`, `Claims`, `Config`, `RawRateImport`
  (scratch staging, reused each bulk-import — admin's call whether to keep
  as audit trail).
- **Live Apps Script Web App** — up to date as of the 2026-07-03 redeploy,
  **except workstream 10 (`checkNameMatches`) which is committed but not
  yet redeployed** — same manual redeploy step as always.
  The admin completed the manual redeploy (verified live: `doGet` answers
  JSON over GET), which picked up everything that had been pending:
  workstream 5's `claim_details`, workstream 8's `handleApproveClaim`
  corrected-amount write, and the GET-routing/CORS fix (`doGet` +
  `HANDLERS` dispatch, commit `3267339` — read-only actions now go over
  GET because Apps Script POST responses inconsistently carry the CORS
  header for GitHub Pages). Any future `Code.gs` edit needs the same
  manual redeploy: paste into the Apps Script editor → Deploy → Manage
  deployments → New version → Deploy, same URL as always.
  `app.js`'s `SCRIPT_URL` is **committed to git** (real URL in the
  repo) to enable GitHub Pages hosting — this is a change from prior
  convention where it was kept uncommitted.
- **GitHub Pages** — repo pushed to `github.com/photolinepayroll/Timesheet-FieldDuty`
  (public), GitHub Pages enabled on `main` branch. Live URL:
  `https://photolinepayroll.github.io/Timesheet-FieldDuty/` (may still be
  deploying on first run — check Actions tab for status). Future pushes to
  `main` redeploy automatically within ~1 minute. Push pattern: always push
  to both `master` AND `main` (`git push` for master, `git push origin master:main`
  for main), or set master's upstream to main.
- **Real Users**: `Louwin celis` (department Technical, real attendance,
  fully live-tested), `Emmerson` (department HR, real attendance,
  live-tested this session), `Admin`/`Test Head` (role `head`, for admin
  testing). `"jude H patani"` (department Technical, real attendance) also
  exists in `Users` with the correct literal name — but his 14
  `EmployeeRates` rows still say `"JUDE PATANI"` (see "STOP HERE FIRST"
  above), so his rates are not yet actually working.
- **EmployeeRates**: real company data for 15 Area Heads (PDF7-style
  roster), 6 more individually-named employees, Crispin Casil (no live
  Users account — rates exist but dormant until/unless he's added),
  Louwin Celis (3-area override + generic Technical fallback for the
  rest), and 5 department-fallback groups (Auditing, CARPENTERS, Technical,
  HR, ComTech).
- **Current period in Config**: `period_start = 2026-06-11`,
  `period_end = 2026-06-25`.

## Admin/product decisions confirmed 2026-06-26 session (don't re-ask)

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
10. **Meal auto-grants only on genuinely incomplete logs**, not on
    complete-but-short visits — this distinction is the whole point of
    workstream 4, confirmed explicitly, not assumed.
11. **A 20-hour-capped day also qualifies for the meal auto-grant** —
    confirmed explicitly when this implication was raised (it falls out
    naturally from how `wasLogComplete` is computed, no extra logic needed).
12. **Admin's "Deny Meal" toggle is available on every row with `meal > 0`**,
    not just incomplete-log rows — admin can deny any meal, confirmed
    explicitly. Reversible (deny, then allow again).
13. **`MealDenials.employee_name` matching is case-SENSITIVE**, unlike
    `EmployeeRates` — deliberate, since this tab is written by the app from
    an already-resolved name, never hand-typed from an external source.

## Admin/product decisions confirmed 2026-07-03 session (don't re-ask)

1. **Meal-control clicks batch locally, then save in one shot** — the
   admin explicitly asked for this after finding per-click server
   round-trips too slow: toggle buttons flip state in the browser only;
   a "Save Meal Changes" button sends the actual writes.
2. **Editing the Claimed amount only takes effect on Approve, never
   Reject** — confirmed explicitly when designing the Claims-queue amount
   edit; a rejected claim's amount is left as originally submitted.
3. **Receipt photo viewer is a popup overlay on the same page**, not a
   new-tab image link — confirmed explicitly (first modal pattern
   introduced into this codebase).
4. **Mobile receipt upload must offer the photo album, not just the
   camera** — `capture="environment"` was removed from the file input for
   this reason.

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
- ~~Base64 receipt photos in a `Claims` cell can exceed Sheets' ~50,000-char
  limit for large images~~ — **addressed 2026-07-03**: `index.html`'s
  `compressReceiptImage()` now resizes to max 1600px + re-encodes as JPEG
  @70% quality before upload, keeping base64 size well under the cap. Not
  a hard guarantee for an extreme source image, but no longer an
  unmitigated gap.
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
