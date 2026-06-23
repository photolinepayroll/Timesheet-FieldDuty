# Photoline Expense App

A small expense/attendance-allowance app for Photoline: employees log fare,
meal, accommodation, and overtime/offset claims; heads approve special
claims; admins generate printable/exportable period sheets. Frontend is
static HTML/JS (`index.html`, `admin.html`, `app.js`, `style.css`) talking to
a Google Apps Script backend (`Code.gs`) backed by a Google Sheet.

## First-time setup

Not done yet. See [`SETUP.md`](./SETUP.md) for the detailed, step-by-step
checklist (creating the Google Sheet with its exact tab headers, deploying
`Code.gs` as an Apps Script Web App, and wiring the resulting URL into
`app.js`'s `SCRIPT_URL`). Those steps require a human with a Google account
and a browser and have not been completed.

## Per-period tasks (admin does each period)

1. Update `period_start` and `period_end` in the `Config` sheet.
2. Add any new employees via `admin.html` → **Employees** tab.
3. Populate `MealRates` and `AccomRates` via `admin.html` → **Rate Tables**
   tab.
4. Approve or reject pending special claims via `admin.html` →
   **Approve Claims** tab.
5. Generate, print, and/or export period sheets via `admin.html` →
   **Period Sheets** tab.

## Exporting a period sheet as CSV

In `admin.html`'s **Period Sheets** tab, after clicking **Generate** to
build a sheet for an employee/period, click **Export CSV** (next to
**Print**) to download a `.csv` file of that sheet (one row per attendance
day, plus the same columns shown on screen — fare, meal, accommodation,
midnight allowance, OT/offset/UT, totals). Fields are CSV-quoted per
standard rules, so free-text fields (e.g. branch names) containing commas or
quotes won't break column alignment when opened in a spreadsheet. Clicking
**Export CSV** before generating a sheet shows an alert instead of failing
silently.

## When LTFRB changes fares

Update the 4 rows in the `LTFRBRates` tab — either directly in the Google
Sheet, or via `admin.html` → **Rate Tables** tab. No code change needed.
