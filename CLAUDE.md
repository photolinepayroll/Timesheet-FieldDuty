# CLAUDE.md — Photoline Expense App

Quick-start context for Claude Code sessions on this project.

## What this project is

A field-duty expense and attendance-allowance app for Photoline employees.
- Employees log in via `index.html`, see their period sheet, submit fare/accommodation claims, view attendance.
- Admins use `admin.html` to approve claims, manage employees/rates, generate period sheets.
- Backend: Google Apps Script (`Code.gs`) deployed as a Web App, backed by a Google Sheet.
- No build step. No framework. Vanilla HTML/JS (ES5 in `Code.gs`, modern JS in frontend files).

## Critical: SCRIPT_URL

`app.js` line 3 has the real deployed Web App URL. It is now committed to git
(required for GitHub Pages). If you ever need to rotate the deployment URL,
update this line and push.

## Files

| File | Purpose |
|---|---|
| `Code.gs` | Google Apps Script backend — all `doPost` action handlers |
| `app.js` | Shared frontend JS — `api()`, auth helpers, `renderPeriodSheet()` |
| `index.html` | Employee self-service dashboard (login + 3-tab view) |
| `admin.html` | Admin panel (employees, rates, claims, period sheets) |
| `style.css` | Shared styles |
| `SETUP.md` | One-time Google Sheet + Apps Script setup checklist |
| `Resume.md` | Full session history, decisions, known gaps — READ THIS when resuming |

## Git remotes

- `origin` = `https://github.com/photolinepayroll/Timesheet-FieldDuty`
- Local branch `master` tracks `origin/master`
- GitHub Pages serves from `origin/main`
- After any commit: `git push` (updates master) + `git push origin master:main` (updates Pages)

## Deployment

`Code.gs` changes require a manual redeploy in the Apps Script editor:
paste → Save → Deploy → Manage deployments → edit → New version → Deploy.
Same URL every time (already in `app.js`).

Frontend changes (`index.html`, `admin.html`, `app.js`, `style.css`) only
need a `git push origin master:main` — GitHub Pages auto-redeploys.

**Known hiccup (seen 2026-07-03):** GitHub's own Pages deploy step can fail
with a generic `Error: Deployment failed, try again later.` even though the
build step succeeded and the source is correctly set to "GitHub Actions" —
this is GitHub-side, not a repo config problem. If the live site is stale,
check `github.com/<repo>/actions` (not just Settings → Pages, which only
shows the last *successful* deploy). A stuck `queued` run can be slow to
cancel; don't fight it — a fresh push usually supersedes/cancels it via the
Pages workflow's built-in concurrency group.

## Key conventions

- `sheetToObjects(tabName)` — per-request cache, reset at top of every `doPost`
- `escapeHtml()` used for employee-authored free text; admin-authored data renders unescaped
- `employee_name` matching against `EmployeeRates` is case-insensitive (`namesMatch()` helper)
- `employee_name` matching against `Claims` and attendance CSV is case-sensitive
- `Users.name` must exactly match the literal string the attendance app logs (no normalization)
- GPS fallback for area classification: `resolveAreaByGPS()` → `AreaCenters` sheet tab
- Meal auto-grant: incomplete logs (missing Log In or Log Out) bypass the 5-hour rule
- `renderPeriodSheet(sheet, opts)` shared by both pages: `opts.adminControls` for MEAL CTRL column, `opts.employeeControls` for employee FROM/TO/MODE view

## Open issues

1. **Jude Patani's `Users.mother_branch` is blank** — mother-branch meal/accom zeroing can't fire for him; his period sheet grants meal at Marquee Mall (his mother branch). Admin must set it to the exact attendance destination string (check `getAttendance` first). Audit other users for blank mother_branch too.
2. **Two rate values imported on assumption** (see Resume.md "STOP HERE FIRST"): Leah May Legaspi R. ANTIQUE 150/300 (PDF looked column-swapped), Jorwen Cacho SM OLONGAPO CENTRAL 150/0 (PDF ambiguous). Confirm with admin.

3. **Code.gs redeploy pending again** — several workstreams since the last confirmed redeploy (`checkNameMatches`, manual-fare-claims retirement of auto-fare, Approve Claims employee/date filters, `oneTimeImportAreaCenters`, `oneTimeStandardizeEmployeeRatesAreas`, `handleGetRates` now also returning `areaCenters`, per-segment fare claims below) are committed but the live Web App doesn't have them yet.

4. **Live `Claims` sheet needs a manual `segment_key` header cell added** (last column, after `notes`) before the per-segment fare claim feature below can be used live — see `SETUP.md`'s `Claims` tab section. Blank for legacy/day-level claims.

Resolved 2026-07-03: Jude Patani EmployeeRates name mismatch (fixed live + reimported); prior Code.gs redeploy completed (claim_details, approve-amount write, GET/CORS routing all live). Live EmployeeRates = 245 rows from the 2026-07-03 rate-book import; pre-import backup in `Md files/2026-07-03-rates-backup-before-import.json`.

Resolved 2026-07-05: **AreaCenters rows missing for broad area names** — rebuilt via `oneTimeImportAreaCenters` (`Code.gs`) using real store/mall GPS data from the admin's "Coordinates Employee rates.pdf". `AreaCenters` is now 5 columns (`area | lat | lng | province | region`, up from 3) with 135 rows: 118 per-store rows, 6 broad-region representative points, 8 legacy-area-name rows, and 3 rows added after the first live standardize run surfaced real unmatched names (`NCR BRANCH`, `VISAYAS / MINDANAO` as aliases; `RIZAL AREA` as new). Admin ran the import and confirmed live: header row, 136 total rows, and spot-checked coordinates all match. **`PROVINCIAL` is a permanent, intentional gap** — no single coordinate is sensible for a literal "any province" fallback name, so it's left unmapped (not a bug).

Resolved 2026-07-05: **EmployeeRates area standardization + region/province backfill** — `oneTimeStandardizeEmployeeRatesAreas` (`Code.gs`) case-insensitively matches each `EmployeeRates.area` against `AreaCenters`, corrects casing/spelling to the canonical form, and adds two new columns (`region`, `province`) backfilled from the matched `AreaCenters` row. `EmployeeRates` is now 7 columns (`employee_name | department | area | meal_amount | accom_amount | region | province`). Admin ran it live: 236 rows standardized/backfilled, 9 flagged unmatched — 7 are `PROVINCIAL` (the same permanent gap as above), 2 were stray fully-blank rows the admin then intentionally deleted. No employee's computed meal/accom amounts changed (matching was already case-insensitive before this pass — this is spelling cleanup only, not a rate change).

Resolved 2026-07-06: **admin.html Rate Tables tab given Region/Province columns + searchable Area dropdown, LTFRB Rates section removed, Employee fields made searchable.** Five commits: (1) `2212569` added Region/Province columns to the EmployeeRates block in Rate Tables — critical bug fix, since before this "Save All" would have silently blanked both columns on every save (payload only ever carried the 5 old keys, and `handleSaveRates` clear-then-rewrites strictly from payload keys); (2) `4b3b9ad` removed the now-unused LTFRB Rates section from the tab (backend `LTFRBRates` sheet/`computeFare`/`buildAutoFareClaim` untouched, still dormant per the 2026-07-05 manual-fare-claims retirement); (3) `f2b342a`/`757d79c` replaced the Employee `<select>` in Approve Claims and Period Sheets with a searchable field — first tried native `<input list>`+`<datalist>`, then replaced that with a fully custom-styled dropdown (`.emp-ac-list`/`.emp-ac-item` in `style.css`) once the admin pointed out a native datalist popup can't be restyled to match the app theme at all; (4) `614a6f3` gave EmployeeRates' Area column the same searchable-dropdown treatment, sourced from `AreaCenters` (now returned by `handleGetRates` as `areaCenters`), and made Region/Province read-only inputs that auto-fill from the picked Area — closes the same class of typo risk as the standardize pass above, but at data-entry time instead of via a one-time backfill.

Resolved 2026-07-06: **Employees tab Add/Edit Department field made context-aware.** Commit `f2701bf`. `admin.html`'s `openUserForm(u)` wraps the Department field in a container div (`uf-dept-wrap`) and calls new `setupDepartmentField(u)`, which fetches `getRates` + (for existing employees) `checkNameMatches` to read `rates_status`: employees with employee-specific `EmployeeRates` rows get a plain text input (`renderDepartmentPlain`, Department isn't used for rate lookup in that case); employees on department-fallback rates get a `<select>` of only the real fallback department names found in `EmployeeRates` (`renderDepartmentDropdown`) — same typo-prevention idea as the Area dropdown above, now applied at the point a department name is first assigned rather than only at rate-row entry. No `Code.gs` changes — reuses the existing `getRates`/`checkNameMatches` endpoints. **Not yet live-tested**: awaiting admin verification that editing an employee-specific-rates employee (e.g. jude H patani) shows plain text, and a fallback-rates employee (e.g. Emmerson) shows the dropdown.

Resolved 2026-07-06: **Per-segment itemized fare claims for multi-location ("roving") days.** `handleGetPeriodSheet` (`Code.gs`) now builds a `segments` array per day alongside the existing day-level fields (which are untouched — still first-in/last-out, still drive meal/accom/midnight). Segments come from the already-existing `day.ins[]`/`day.outs[]` pairing arrays, de-duplicated by exact-timestamp match (`dedupeExactTimestamps`) then index-zipped in chronological order; a day with one complete in/out pair produces exactly one segment (no visible change), while a day with genuinely multiple distinct-time pairs produces one segment per pair. `renderPeriodSheet` (`app.js`, shared by both `index.html` and `admin.html`) now renders one `<tr>` per segment, with day-level columns (DATE/BRANCH/HRS/MEAL/ACCOM/MIDNIGHT/TOTAL/MEAL CTRL/admin's fare totals) spanning all of a day's segment rows via `rowspan` — meal/accom/midnight/meal-deny all stay day-level, only fare claims are itemized. Each segment gets its own `+ Fare` button (composite `data-seg` key); accommodation stays one button per day. New `Claims.segment_key` column (see open issue #4 above) ties a fare claim to a specific segment — blank for legacy claims. **Not yet live-tested**: needs the `Code.gs` redeploy + the manual Sheet header addition, then verification against a real employee with a genuine multi-location day (see this file's open issue #4 and the design plan for the full before/after checklist).

## Do not re-ask these decisions

See `Resume.md` → "Admin/product decisions confirmed" sections for the full list.
Key ones: app is expense-only (no OT/UT), GPS fallback never overrides substring match,
20-hour cap on log pairing, meal auto-grant only on incomplete logs (not short visits).
