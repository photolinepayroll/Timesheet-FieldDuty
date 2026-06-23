# Photoline Expense App — Manual Setup Checklist

These steps must be done by a human with a Google account and a browser.
They cannot be automated by the assistant. Follow them in order.

---

## Step 1: Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new,
   blank spreadsheet.
2. Rename it to: **`Photoline Expense App`**
3. Create the following tabs (sheets) inside it. For each tab, rename the
   default "Sheet1"-style tab or add a new sheet, then type the header row
   **exactly** as shown into row 1 (one header per column, left to right).

### Tab: `Users`

Row 1 headers:
```
id | name | department | mother_branch | position_level | ot_type | role | pin | active
```
Notes:
- `role` = `employee` or `head`
- `pin` = 4-digit string (e.g. `0427`)
- `active` = `TRUE` or `FALSE`

Leave the rest of the rows empty for now (users will be added later).

### Tab: `EmployeeRates`

Row 1 headers:
```
employee_name | department | area | meal_amount | accom_amount
```
Row semantics:
- **Employee-specific row**: `employee_name` filled (exact match to
  `Users.name`), `department` blank. Checked first.
- **Department-fallback row**: `employee_name` blank, `department` filled
  (exact match to `Users.department`). Used only when no employee-specific
  row matches for that area.
- A row must have exactly one of the two non-blank — never both, never
  neither.
- `area` uses the same free-text substring-match convention as
  `MealRates`/`AccomRates` did (e.g. `"NCR Area"`, `"Dagupan Area"`).
- `meal_amount`/`accom_amount` are plain numbers, either can be `0`.

Leave the rest of the rows empty for now (rates will be added later).

### Tab: `RawRateImport` (scratch tab)

Same header row as `EmployeeRates`:
```
employee_name | department | area | meal_amount | accom_amount
```
This is a temporary staging tab — paste resolved real rate data here before
a one-time import script copies it into `EmployeeRates`. It is not read by
the app directly.

> **Deprecated tabs below:** `MealRates` and `AccomRates` are **deprecated
> — superseded by `EmployeeRates`, kept only until cutover is verified (see
> Task 4 of the per-employee-rate-redesign implementation plan)**. Do not
> remove them yet; they remain as a rollback safety net. They will be
> deleted manually once the new `EmployeeRates`-based flow is confirmed
> working in production.

### Tab: `MealRates` (deprecated)

Row 1 headers:
```
area | level_1 | level_2 | level_3
```
Leave the rest of the rows empty for now (rates will be added later).

### Tab: `AccomRates` (deprecated)

Row 1 headers:
```
area | level_1 | level_2 | level_3
```
Leave the rest of the rows empty for now (rates will be added later).

### Tab: `MidnightRates`

Row 1 headers:
```
label | from_hour | from_min | to_hour | to_min | amount
```
Seed rows (type these in starting at row 2):
```
8PM-12AM | 20 | 0 | 23 | 59 | 50
9PM-3AM  | 21 | 0 | 3  | 0  | 100
3AM+     | 3  | 1 | 6  | 0  | 150
```

### Tab: `LTFRBRates`

Row 1 headers:
```
vehicle_type | base_fare | base_km | per_km
```
Seed rows (type these in starting at row 2):
```
Traditional Jeepney | 14 | 4 | 2.00
Modern Jeepney      | 17 | 4 | 2.40
Ordinary City Bus   | 15 | 5 | 2.49
Aircon City Bus     | 18 | 5 | 2.98
```

### Tab: `Claims`

Row 1 headers:
```
id | employee_id | employee_name | date | period_start | period_end | type | from_loc | to_loc | vehicle_mode | distance_km | computed_amount | claimed_amount | receipt_url | gps_check | status | approver_name | approved_at | notes
```
Leave the rest of the rows empty (claims will be created by the app later).

### Tab: `Config`

Row 1 headers:
```
key | value
```
Seed rows (type these in starting at row 2) — **use the real values below,
not placeholders**:

| key | value |
|---|---|
| `attendance_csv_url` | `https://docs.google.com/spreadsheets/d/e/2PACX-1vRZHyqa-jPGZYgystWjoXi8nG1TCvmodSqXT675cY4xpA5jpWWVw-lYSBoLSbgWS0LNHgvyXxLcgZWt/pub?output=csv` |
| `standard_hours` | `8` |
| `fraud_tolerance_pct` | `20` |
| `period_start` | *(fill in the current pay period start date, format `YYYY-MM-DD`)* |
| `period_end` | *(fill in the current pay period end date, format `YYYY-MM-DD`)* |

> Note: `period_start` and `period_end` depend on Photoline's current pay
> period — fill in the actual dates when you do this step.

4. Save the sheet (Google Sheets auto-saves, but double check the title bar
   shows "Photoline Expense App" with no unsaved-changes indicator).

---

## Step 2: Deploy the Apps Script as a Web App

(Creating `Code.gs` is already done in this repo. You just need to copy it
into the Sheet's Apps Script project and deploy it.)

1. Open the `Photoline Expense App` Google Sheet from Step 1.
2. Go to **Extensions → Apps Script**. This opens the Apps Script editor
   bound to this Sheet.
3. In the Apps Script editor, open the default `Code.gs` file (or create one
   if it doesn't exist) and replace its contents with the contents of this
   repo's `Code.gs` file.
4. Click the **Save** icon (or `Ctrl+S` / `Cmd+S`).
5. Click **Deploy → New deployment**.
6. Next to "Select type," click the gear icon and choose **Web app**.
7. Fill in the deployment settings:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
8. Click **Deploy**.
9. You may be prompted to authorize the script — follow the prompts and
   grant access (this is your own script running under your own account).
10. After deployment, Google will show a **Web app URL**. Copy this URL —
    this is the `SCRIPT_URL` that later tasks (and the frontend) will use to
    talk to this backend.
11. Save `SCRIPT_URL` somewhere safe (e.g. paste it into a private note or
    send it to whoever is continuing this project) so it can be wired into
    the frontend in a later task.

### Verifying the deployment works

Once deployed, you can sanity-check it by visiting the `SCRIPT_URL` directly
in a browser. You should see the text:
```
Photoline Expense App API running.
```

This confirms `doGet` is responding. (There is no easy way to test `doPost`
from a browser address bar — that will be exercised by the frontend in a
later task.)

---

## When you're done

Once both steps above are complete, you should have:
- A Google Sheet named `Photoline Expense App` with all 7 tabs and their
  header rows/seed data as specified.
- A deployed Apps Script Web App URL (`SCRIPT_URL`).

Hand both of these off (the Sheet's URL/ID and the `SCRIPT_URL`) to whoever
picks up the next task in the implementation plan.
