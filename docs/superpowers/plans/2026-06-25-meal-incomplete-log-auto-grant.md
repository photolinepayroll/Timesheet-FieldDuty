# Meal Allowance Auto-Grant for Incomplete Logs + Admin Deny Override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-grant the meal allowance on days with a genuinely incomplete
attendance log (including 20-hour-cap-nulled days), while leaving the
existing 5-hour rule untouched for complete-but-short logs, and give the
admin a reversible per-day Allow/Deny override on top of either rule.

**Architecture:** A new `MealDenials` Sheet tab (`employee_name | date |
denied_by | denied_at`) holds denial rows, presence = denied. `Code.gs`'s
`computeMeal` gains a `wasLogComplete` parameter computed from the *already
20-hour-capped* `firstIn`/`lastOut` locals in `handleGetPeriodSheet`, so a
cap-nulled day is treated identically to a missing Log Out. After `meal` is
computed per row, `handleGetPeriodSheet` looks up `MealDenials` and forces
`meal = 0` if a denial row exists for that `(employee_name, date)`, exposing
the result via a new `meal_denied` field per row. A new `toggleMealDenial`
`doPost` action adds/removes the denial row. `app.js`'s shared
`renderPeriodSheet` gains an opt-in `adminControls` flag (used only by
`admin.html`, never `index.html`) that renders an Allow/Deny button per
row; clicking it calls the toggle action then re-fetches the period sheet.

**Tech Stack:** Same as the rest of the app — Google Apps Script ES5
(`Code.gs`), vanilla HTML/JS (`app.js`/`admin.html`). No build step, no test
framework — verify via live API calls against the already-deployed Web App
(see `Resume.md` for the established PowerShell `Invoke-WebRequest` pattern).

**Spec:** `docs/superpowers/specs/2026-06-25-meal-incomplete-log-auto-grant-design.md`

---

## Task 1: Add `MealDenials` sheet tab

**Files:**
- Modify: `SETUP.md`

- [ ] **Step 1: Create the `MealDenials` tab in the live Google Sheet** (manual)

  Header row:
  ```
  employee_name | date | denied_by | denied_at
  ```
  Row semantics: one row = one denied day. `employee_name` must exactly
  match `Users.name` (written by the app itself from the period-sheet
  request, never hand-typed — unlike `EmployeeRates.employee_name`, no
  case-insensitive matching is needed here). `date` is `'YYYY-MM-DD'`
  (Sheets will auto-convert it to a Date cell — same as `Claims.date`,
  read back via `claimDateKey()`). `denied_by` is the approving head's
  `Users.name`. `denied_at` is an ISO timestamp string.

  Leave data rows empty — populated only via the app's toggle action.

- [ ] **Step 2: Document the tab in `SETUP.md`**

  Add a new `### Tab: MealDenials` section, modeled on the existing
  `### Tab: AreaCenters` section (`SETUP.md:69-86`). Content:

  ```markdown
  ### Tab: `MealDenials`

  Row 1 headers:
  ```
  employee_name | date | denied_by | denied_at
  ```
  Admin override for the meal allowance, independent of whichever rule
  (5-hour or incomplete-log auto-grant) computed a day's `meal` amount.
  One row = one denied day for one employee. Presence of a row forces
  that day's `meal` to `0` regardless of how it was computed; absence
  means the computed value (whatever rule produced it) stands. Rows are
  only ever added/removed by the app itself (the `toggleMealDenial`
  action) — never hand-edited.
  - `employee_name` must exactly match `Users.name` (case-sensitive —
    this tab is written by the app from the already-resolved employee
    name, not hand-typed from an external source, so no
    case-insensitive matching is needed, unlike `EmployeeRates`).
  - `date` is `'YYYY-MM-DD'`. Sheets will auto-convert it to a real Date
    cell on write, same as `Claims.date` — always read it back through
    `claimDateKey()`, never compare the raw cell value to a string.

  Leave the rest of the rows empty for now (rows are added/removed only
  via the admin's "Deny Meal"/"Allow Meal" button in the Period Sheet
  view).
  ```

  Insert this section right after the existing `### Tab: AreaCenters`
  section (`SETUP.md:69-86`), before `### Tab: RawRateImport`.

- [ ] **Step 3: Commit**

  ```bash
  git add SETUP.md
  git commit -m "docs: document MealDenials schema for meal auto-grant + admin override"
  ```

---

## Task 2: `Code.gs` — incomplete-log auto-grant + denial override in the period sheet

**Files:**
- Modify: `Code.gs:332-339` (`computeMeal`)
- Modify: `Code.gs:507-715` (`handleGetPeriodSheet`)

(Line numbers verified against the current file as of this plan's writing.)

- [ ] **Step 1: Update `computeMeal`'s signature and eligibility logic**

  Replace the function currently at `Code.gs:332-339`:
  ```javascript
  function computeMeal(employeeName, department, destinationArea, hoursWorked, motherBranch, destination) {
    // Rule: no meal at mother branch; 5+ hours required
    if (destination === motherBranch) return 0;
    if (hoursWorked < 5) return 0;
    var row = resolveEmployeeRate(employeeName, department, destinationArea);
    if (!row) return 0;
    return parseFloat(row['meal_amount'] || 0);
  }
  ```
  with:
  ```javascript
  function computeMeal(employeeName, department, destinationArea, hoursWorked, motherBranch, destination, wasLogComplete) {
    // Rule: no meal at mother branch. A genuinely incomplete log (missing
    // Log In or Log Out, including a day nulled by the 20-hour sanity cap —
    // see handleGetPeriodSheet's wasLogComplete computation) auto-grants
    // the meal regardless of hoursWorked. A complete log still requires
    // 5+ hours, unchanged from before.
    if (destination === motherBranch) return 0;
    if (wasLogComplete && hoursWorked < 5) return 0;
    var row = resolveEmployeeRate(employeeName, department, destinationArea);
    if (!row) return 0;
    return parseFloat(row['meal_amount'] || 0);
  }
  ```

- [ ] **Step 2: Compute `wasLogComplete` in `handleGetPeriodSheet`, after the 20-hour cap**

  In `handleGetPeriodSheet`'s per-day loop, find this existing block
  (`Code.gs:625-630`):
  ```javascript
    if (firstIn && lastOut && (lastOut - firstIn) / 3600000 > 20) {
      lastOut = null;
    }

    var hoursWorked = (firstIn && lastOut) ? (lastOut - firstIn) / 3600000 : 0;
    var destination = day.destination || '';
  ```
  Add `wasLogComplete` right after `hoursWorked`, reusing the same
  already-capped `firstIn`/`lastOut` locals (this is what makes a
  cap-nulled day automatically count as incomplete, with no special-case
  needed):
  ```javascript
    if (firstIn && lastOut && (lastOut - firstIn) / 3600000 > 20) {
      lastOut = null;
    }

    var hoursWorked = (firstIn && lastOut) ? (lastOut - firstIn) / 3600000 : 0;
    // Computed from the already-capped firstIn/lastOut, not the raw
    // day.in_record/day.out_record — this makes a 20-hour-cap-nulled day
    // (lastOut forced null above) count as incomplete for meal purposes,
    // exactly like a day with no Log Out at all.
    var wasLogComplete = !!(firstIn && lastOut);
    var destination = day.destination || '';
  ```

- [ ] **Step 3: Load `MealDenials` and index denied dates for this employee**

  In `handleGetPeriodSheet`, find the existing `companyServiceClaims`
  block (`Code.gs:597-605`):
  ```javascript
    var companyServiceClaims = allClaims.filter(function(c) {
      return c['employee_name'] === payload.employee_name &&
             c['status'] === 'Approved' &&
             c['type'] === 'company-service';
    });
  ```
  Immediately after it, add:
  ```javascript
    // Admin meal-deny override (see docs/superpowers/specs/2026-06-25-
    // meal-incomplete-log-auto-grant-design.md). Indexed by date key so
    // the per-day loop below can do an O(1) lookup instead of re-filtering
    // the whole sheet for every day in the period.
    var mealDenials = sheetToObjects('MealDenials');
    var deniedDates = {};
    mealDenials.forEach(function(d) {
      if (d['employee_name'] === payload.employee_name) {
        deniedDates[claimDateKey(d['date'])] = true;
      }
    });
  ```

- [ ] **Step 4: Pass `wasLogComplete` into `computeMeal`, apply the denial override, and expose `meal_denied`**

  Find the existing `computeMeal` call (`Code.gs:655-656`):
  ```javascript
    var meal     = computeMeal(payload.employee_name, emp['department'], destinationArea,
                               hoursWorked, emp['mother_branch'], destination);
  ```
  Replace with:
  ```javascript
    var meal     = computeMeal(payload.employee_name, emp['department'], destinationArea,
                               hoursWorked, emp['mother_branch'], destination, wasLogComplete);
    var mealDenied = !!deniedDates[date];
    if (mealDenied) meal = 0;
  ```

  Then find the `rows.push({...})` call (`Code.gs:684-697`) and add
  `meal_denied` alongside the existing `meal` field:
  ```javascript
    rows.push({
      date:         date,
      branch:       destination,
      time_in:      firstIn  ? firstIn.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '',
      time_out:     lastOut  ? lastOut.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '',
      hours_worked: Math.round(hoursWorked * 10) / 10,
      auto_fare:    autoFare,
      special_fare: specialFare,
      total_fare:   autoFare + specialFare,
      meal:         meal,
      meal_denied:  mealDenied,
      accom:        accom + specialAccom,
      midnight:     midnight,
      total_allowance: (autoFare + specialFare) + meal + (accom + specialAccom) + midnight
    });
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add Code.gs
  git commit -m "feat: auto-grant meal on incomplete logs, apply admin deny override"
  ```

---

## Task 3: `Code.gs` — `toggleMealDenial` action

**Files:**
- Modify: `Code.gs:69-98` (`doPost` handler map)
- Modify: `Code.gs:472-501` area (add new handler function after `handleApproveClaim`)

- [ ] **Step 1: Add `handleToggleMealDenial`**

  Add this new function directly after `handleApproveClaim` (which ends at
  `Code.gs:501`), before the `// PERIOD SHEET` section comment:
  ```javascript
  function handleToggleMealDenial(payload) {
    // payload: { employee_name, date, denied_by }
    // Idempotent toggle: if a denial row already exists for this
    // (employee_name, date), remove it (un-deny). Otherwise add one
    // (deny). employee_name comes from the period sheet's own resolved
    // employee, not hand-typed, so exact === matching is correct here
    // (see SETUP.md's MealDenials section for why this differs from
    // EmployeeRates' case-insensitive matching).
    var sh = getSheet('MealDenials');
    var rows = sh.getDataRange().getValues();
    var headers = rows[0];
    var nameIdx = headers.indexOf('employee_name');
    var dateIdx = headers.indexOf('date');
    var dateKey = claimDateKey(payload.date);

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][nameIdx] === payload.employee_name &&
          claimDateKey(rows[i][dateIdx]) === dateKey) {
        sh.deleteRow(i + 1);
        return { denied: false };
      }
    }

    sh.appendRow([payload.employee_name, payload.date, payload.denied_by, new Date().toISOString()]);
    return { denied: true };
  }
  ```

- [ ] **Step 2: Register the new action in `doPost`'s handler map**

  In `doPost` (`Code.gs:69-98`), find:
  ```javascript
      'approveClaim': handleApproveClaim,
      'getPeriodSheet': handleGetPeriodSheet
  ```
  Replace with:
  ```javascript
      'approveClaim': handleApproveClaim,
      'getPeriodSheet': handleGetPeriodSheet,
      'toggleMealDenial': handleToggleMealDenial
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add Code.gs
  git commit -m "feat: add toggleMealDenial doPost action"
  ```

---

## Task 4: `app.js` — admin-only Allow/Deny control in `renderPeriodSheet`

**Files:**
- Modify: `app.js:76-121` (`renderPeriodSheet`)

`renderPeriodSheet` is shared by `index.html` (employee self-service —
must NOT show admin controls) and `admin.html` (must show them). Add an
opt-in second parameter so existing callers (including `index.html`,
which is not modified by this plan) are unaffected by default.

- [ ] **Step 1: Add the `opts` parameter and admin-only "MEAL CTRL" column**

  Replace `renderPeriodSheet` (`app.js:76-121`) with:
  ```javascript
  function renderPeriodSheet(sheet, opts) {
    opts = opts || {};
    var adminControls = !!opts.adminControls;
    var e = sheet.employee;
    var html = '<div id="printable-sheet">';
    html += '<div style="display:flex;justify-content:space-between;margin-bottom:12px;">';
    html += '<div><b>NAME:</b> ' + escapeHtml(e.name) + '<br><b>POSITION:</b> ' + escapeHtml(e.position_level) +
            '<br><b>DEPT:</b> ' + escapeHtml(e.department) + '</div>';
    html += '<div style="text-align:right;"><b>PERIOD:</b> ' + escapeHtml(sheet.period_start) + ' — ' + escapeHtml(sheet.period_end) + '<br>' +
            '<b>MOTHER BRANCH:</b> ' + escapeHtml(e.mother_branch) + '</div>';
    html += '</div>';
    html += '<div class="table-scroll"><table>';
    html += '<thead><tr>' +
      '<th>DATE</th><th>BRANCH</th><th>IN</th><th>OUT</th><th>HRS</th>' +
      '<th>AUTO FARE</th><th>SPECIAL FARE</th><th>TOTAL FARE</th>' +
      '<th>MEAL</th><th>ACCOM</th><th>MIDNIGHT</th><th>TOTAL</th>' +
      (adminControls ? '<th>MEAL CTRL</th>' : '') +
      '</tr></thead><tbody>';
    sheet.rows.forEach(function(r) {
      html += '<tr>' +
        '<td>' + escapeHtml(r.date) + '</td>' +
        '<td>' + escapeHtml(r.branch) + '</td>' +
        '<td>' + escapeHtml(r.time_in) + '</td>' +
        '<td>' + escapeHtml(r.time_out) + '</td>' +
        '<td>' + r.hours_worked + '</td>' +
        '<td>' + formatCurrency(r.auto_fare) + '</td>' +
        '<td>' + formatCurrency(r.special_fare) + '</td>' +
        '<td><b>' + formatCurrency(r.total_fare) + '</b></td>' +
        '<td>' + formatCurrency(r.meal) + '</td>' +
        '<td>' + formatCurrency(r.accom) + '</td>' +
        '<td>' + formatCurrency(r.midnight) + '</td>' +
        '<td><b>' + formatCurrency(r.total_allowance) + '</b></td>';
      if (adminControls) {
        // Button must remain visible on a denied row (meal forced to 0 by
        // the server) so the admin can reverse the denial — checking only
        // `r.meal > 0` would make the button disappear the moment a row
        // is denied. r.date is a plain 'YYYY-MM-DD' string (never
        // employee-authored free text), but it's escaped anyway for the
        // attribute value per this file's existing convention.
        if (r.meal > 0 || r.meal_denied) {
          html += '<td><button class="meal-deny-btn" data-date="' + escapeHtml(r.date) + '">' +
            (r.meal_denied ? 'Allow Meal' : 'Deny Meal') + '</button></td>';
        } else {
          html += '<td></td>';
        }
      }
      html += '</tr>';
    });
    // Totals row
    var t = sheet.totals;
    html += '<tr style="font-weight:bold;background:var(--blue2);color:#fff;">' +
      '<td colspan="5">TOTALS</td>' +
      '<td>' + formatCurrency(t.auto_fare) + '</td>' +
      '<td>' + formatCurrency(t.special_fare) + '</td>' +
      '<td>' + formatCurrency(t.total_fare) + '</td>' +
      '<td>' + formatCurrency(t.meal) + '</td>' +
      '<td>' + formatCurrency(t.accom) + '</td>' +
      '<td>' + formatCurrency(t.midnight) + '</td>' +
      '<td>' + formatCurrency(t.total) + '</td>' +
      (adminControls ? '<td></td>' : '') +
      '</tr>';
    html += '</tbody></table></div></div>';
    return html;
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add app.js
  git commit -m "feat: add opt-in admin Allow/Deny meal column to renderPeriodSheet"
  ```

---

## Task 5: `admin.html` — wire up the Allow/Deny button

**Files:**
- Modify: `admin.html:558-565` (`generatePeriodSheet`)
- Modify: `admin.html:125-130` (`DOMContentLoaded` listener)

- [ ] **Step 1: Pass `adminControls: true` when rendering the admin Period Sheet view**

  In `generatePeriodSheet` (`admin.html:558-565`), find:
  ```javascript
      api('getPeriodSheet', { employee_name: emp, period_start: start, period_end: end },
        function(err, sheet) {
          if (err) { out.innerHTML = '<p style="color:red;">' + escapeHtml(err.message) + '</p>'; return; }
          window._lastPeriodSheet = sheet;
          out.innerHTML = renderPeriodSheet(sheet);
        }
      );
  ```
  Replace the last line inside the callback:
  ```javascript
      api('getPeriodSheet', { employee_name: emp, period_start: start, period_end: end },
        function(err, sheet) {
          if (err) { out.innerHTML = '<p style="color:red;">' + escapeHtml(err.message) + '</p>'; return; }
          window._lastPeriodSheet = sheet;
          out.innerHTML = renderPeriodSheet(sheet, { adminControls: true });
        }
      );
  ```

- [ ] **Step 2: Add a delegated click handler for `.meal-deny-btn` and the toggle function**

  In the `DOMContentLoaded` listener (`admin.html:125-130`), find:
  ```javascript
    window.addEventListener('DOMContentLoaded', function() {
      var user = requireLogin('head');
      if (!user) return;
      loadUsers();
      initTabs();
    });
  ```
  Replace with:
  ```javascript
    window.addEventListener('DOMContentLoaded', function() {
      var user = requireLogin('head');
      if (!user) return;
      loadUsers();
      initTabs();
      // Delegated (not per-button) because the Period Sheet table is
      // replaced wholesale via innerHTML on every Generate/toggle —
      // listeners bound directly to buttons would be lost on each re-render.
      document.getElementById('period-sheet-output').addEventListener('click', function(e) {
        var btn = e.target.closest('.meal-deny-btn');
        if (!btn) return;
        toggleMealDenial(btn.dataset.date);
      });
    });
  ```

  Then add this new function next to `generatePeriodSheet` (after its
  closing brace, `admin.html:565`):
  ```javascript
    function toggleMealDenial(date) {
      var user = currentUser();
      var sheet = window._lastPeriodSheet;
      if (!sheet) return;
      api('toggleMealDenial', {
        employee_name: sheet.employee.name,
        date: date,
        denied_by: user.name
      }, function(err) {
        if (err) { alert(err.message); return; }
        // Re-fetch rather than patch in place: the client never learns the
        // would-be meal amount for a currently-denied row (the server only
        // ever sends 0 for it), so an optimistic in-place update can't
        // correctly restore the un-denied value. A full re-fetch is
        // simplest and correct in both directions.
        generatePeriodSheet();
      });
    }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add admin.html
  git commit -m "feat: wire admin Allow/Deny meal toggle button into Period Sheet view"
  ```

---

## Task 6: Redeploy and live-verify

**Files:** None (verification only).

**Migration sequencing:** `computeMeal`'s signature changed and
`handleGetPeriodSheet` now reads a new sheet — `Code.gs` must be
redeployed for any of this to take effect live. `app.js`/`admin.html` are
static local files (no deploy step), but the new `meal_denied` field and
`renderPeriodSheet` signature mean `Code.gs` and `app.js`/`admin.html`
should be tested together, not separately.

- [ ] **Step 1: Redeploy `Code.gs`** (manual — same procedure as prior
  redeploys documented in `Resume.md`: paste into the Apps Script editor,
  save, Deploy → Manage deployments → edit existing deployment → New
  version → Deploy. Same `SCRIPT_URL`.)

- [ ] **Step 2: Live-verify case 1 — genuinely incomplete log auto-grants meal**

  Pick (or temporarily create) an attendance day for a live-tested
  employee (e.g. `Louwin celis`, per `Resume.md`) with only a Log In and
  no Log Out, destination ≠ mother branch. Call:
  ```powershell
  $SCRIPT_URL = "<the deployed Web App URL from app.js's SCRIPT_URL>"
  $body = @{ action = "getPeriodSheet"; employee_name = "Louwin celis"; period_start = "2026-06-11"; period_end = "2026-06-25" } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri $SCRIPT_URL -Method POST -Body $body -UseBasicParsing
  Write-Output $r.Content
  ```
  Confirm that day's row has `hours_worked: 0` but `meal` is the full
  per-employee/department rate (not `0`), and `meal_denied: false`.

- [ ] **Step 3: Live-verify case 2 — complete log, short visit still blocks meal**

  Find (or temporarily create) a day with both Log In and Log Out
  present, duration under 5 hours, destination ≠ mother branch. Confirm
  `hours_worked` is correctly low (e.g. `1.1`) and `meal: 0`,
  `meal_denied: false`.

- [ ] **Step 4: Live-verify case 1b — 20-hour-cap-nulled day also auto-grants**

  Find (or temporarily create via two attendance rows) a day where the
  paired Log-In-to-Log-Out gap exceeds 20 hours (triggers the existing
  cap from commit `7d63294f`). Confirm `hours_worked: 0`, `time_out`
  blank, and `meal` is the full rate (not `0`) — same outcome as Step 2's
  no-Log-Out case.

- [ ] **Step 5: Live-verify the deny/allow toggle**

  ```powershell
  $body = @{ action = "toggleMealDenial"; employee_name = "Louwin celis"; date = "<date from Step 2>"; denied_by = "Admin" } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri $SCRIPT_URL -Method POST -Body $body -UseBasicParsing
  Write-Output $r.Content   # expect {"ok":true,"data":{"denied":true}}
  ```
  Re-run Step 2's `getPeriodSheet` call: confirm that date's `meal: 0`,
  `meal_denied: true`. Call `toggleMealDenial` again with the same
  payload (expect `{"denied":false}`), re-run `getPeriodSheet`, confirm
  `meal` reverts to its original non-zero value and `meal_denied: false`.

- [ ] **Step 6: Confirm the admin UI in the browser**

  Open `admin.html` → Period Sheets tab → generate the same employee's
  period sheet. Confirm:
  - The auto-granted row (Step 2) and the cap-nulled row (Step 4) each
    show a non-zero MEAL value and a "Deny Meal" button.
  - The short-visit row (Step 3) shows `₱0.00` MEAL and no button.
  - Clicking "Deny Meal" on the auto-granted row immediately updates that
    row to `₱0.00` MEAL with an "Allow Meal" button, and clicking "Allow
    Meal" reverts it.
  - Open `index.html` (employee view) for the same employee/period:
    confirm there is no MEAL CTRL column or button anywhere — the
    `adminControls` flag stays admin-only.

- [ ] **Step 7: Report back**

  Summarize pass/fail for Steps 2-6. If a live test row was temporarily
  added to attendance data for testing, note that it should be removed
  afterward (matching the precedent in `Resume.md`'s GPS-fallback
  verification, which added then removed a temporary test row).
