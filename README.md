# Timesheet-FieldDuty — Photoline Expense App

A small expense/attendance-allowance app for Photoline: employees log fare,
meal, accommodation, and overtime/offset claims; heads approve special
claims; admins generate printable/exportable period sheets. Frontend is
static HTML/JS (`index.html`, `admin.html`, `app.js`, `style.css`) talking to
a Google Apps Script backend (`Code.gs`) backed by a Google Sheet.

## First-time setup

See [`SETUP.md`](./SETUP.md) for the detailed, step-by-step checklist
(creating the Google Sheet with its exact tab headers, deploying `Code.gs`
as an Apps Script Web App, and wiring the resulting URL into `app.js`'s
`SCRIPT_URL`).

## Per-period tasks (admin does each period)

1. Update `period_start` and `period_end` in the `Config` sheet.
2. Add any new employees via `admin.html` → **Employees** tab.
3. Populate `EmployeeRates` via `admin.html` → **Rate Tables** tab.
4. Approve or reject pending special claims via `admin.html` → **Approve Claims** tab.
5. Generate, print, and/or export period sheets via `admin.html` → **Period Sheets** tab.

## When LTFRB changes fares

Update the 4 rows in the `LTFRBRates` tab — either directly in the Google
Sheet, or via `admin.html` → **Rate Tables** tab. No code change needed.
