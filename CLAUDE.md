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

1. **Jude Patani EmployeeRates name mismatch** — 14 rows say `"JUDE PATANI"` but `Users.name` is `"jude H patani"`. Needs manual fix in the live Sheet.
2. **Code.gs workstream-5 changes not yet redeployed** — `claim_details` field in `getPeriodSheet` response is committed but the live Web App doesn't have it yet. My Sheet tab's FROM/TO/MODE columns need this redeploy to show real data.

## Do not re-ask these decisions

See `Resume.md` → "Admin/product decisions confirmed" sections for the full list.
Key ones: app is expense-only (no OT/UT), GPS fallback never overrides substring match,
20-hour cap on log pairing, meal auto-grant only on incomplete logs (not short visits).
