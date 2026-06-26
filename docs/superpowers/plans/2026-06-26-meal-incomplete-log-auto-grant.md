# Meal Allowance Incomplete-Log Auto-Grant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish and ship the meal-allowance incomplete-log auto-grant +
admin deny-override feature designed in
`docs/superpowers/specs/2026-06-26-meal-incomplete-log-auto-grant-design.md`.

**Architecture:** Most of this was already built and committed in an
earlier, interrupted session (commits `8e96a00`, `c019aa6`, `8cb2118`,
`2fa5054` — backend logic in `Code.gs`, schema doc in `SETUP.md`, and an
opt-in admin column in the shared `app.js` renderer). What's missing:
`admin.html` never actually turns on `renderPeriodSheet`'s
`adminControls` option or wires a click handler for the `.meal-deny-btn`
buttons it would render — so the feature exists in the deployed code but
has no UI entry point, and the whole thing hasn't been redeployed/verified
live yet (confirmed: a live `getPeriodSheet` call for "Emmerson" on
2026-06-02 — no Log In that day — still returns `meal: 0`, proving the
live deployment predates these commits).

**Tech Stack:** Same as the rest of the app — Google Apps Script ES5
(`Code.gs`), vanilla HTML/JS (`admin.html`, `app.js`). No build step, no
test framework — verify via live API calls against the deployed Web App.

---

## Task 1: Wire `admin.html` to use the new admin meal-deny controls

**Files:**
- Modify: `admin.html:562` (the `renderPeriodSheet` call site)
- Modify: `admin.html` (add a click handler near wherever the period-sheet
  output is rendered)

- [ ] **Step 1: Locate the current call site**

  `admin.html:549-564`, inside `generatePeriodSheet()`, currently reads:
  ```javascript
  function generatePeriodSheet() {
    var emp   = document.getElementById('ps-employee').value;
    var start = document.getElementById('ps-start').value;
    var end   = document.getElementById('ps-end').value;
    if (!emp || !start || !end) { alert('Select employee and period dates.'); return; }

    var out = document.getElementById('period-sheet-output');
    out.innerHTML = '<p>Loading…</p>';

    api('getPeriodSheet', { employee_name: emp, period_start: start, period_end: end },
      function(err, sheet) {
        if (err) { out.innerHTML = '<p style="color:red;">' + escapeHtml(err.message) + '</p>'; return; }
        window._lastPeriodSheet = sheet;
        out.innerHTML = renderPeriodSheet(sheet);
      }
    );
  }
  ```

  Change the last line of the callback to:
  ```javascript
        out.innerHTML = renderPeriodSheet(sheet, { adminControls: true });
  ```

  This is the ONLY thing needed to make the `MEAL CTRL` column and its
  `Deny Meal`/`Allow Meal` buttons appear (the rendering logic already
  exists in `app.js`, committed in `2fa5054`). `index.html`'s employee
  self-service view must NOT gain this flag — employees should never see
  the admin-only column.

  Note `window._lastPeriodSheet = sheet;` already exists on the line
  above — this is how the click handler in Step 2 gets at the current
  sheet without needing a new module-level variable.

- [ ] **Step 2: Add the click handler for `.meal-deny-btn`**

  Add this new function in `admin.html`, anywhere near `generatePeriodSheet`
  (e.g. directly below it):

  ```javascript
  document.getElementById('period-sheet-output').addEventListener('click', function(ev) {
    var btn = ev.target.closest('.meal-deny-btn');
    if (!btn) return;
    var user = currentUser();
    api('toggleMealDenial', {
      employee_name: window._lastPeriodSheet.employee.name,
      date: btn.dataset.date,
      denied_by: user.name
    }, function(err) {
      if (err) { alert(err.message); return; }
      generatePeriodSheet(); // re-fetch and re-render to reflect the new state
    });
  });
  ```

  This listener is attached ONCE, directly to the stable
  `#period-sheet-output` element (the same element `generatePeriodSheet`
  repeatedly overwrites via `.innerHTML` — the element itself never gets
  replaced, only its contents, so event delegation works correctly across
  every re-render without re-attaching). Place this `addEventListener`
  call at the top level of the `<script>` block (same scope as other
  one-time setup code in this file), NOT inside `generatePeriodSheet`
  itself, so it only runs once when the page loads.

  `currentUser()` and `user.name` mirror the exact pattern already used by
  `approveReject()` (`admin.html:516-526`, `var user = currentUser();
  ... approver_name: user.name`) — reuse that same function, do not
  introduce a second way of tracking "who's logged in."

- [ ] **Step 3: Verify by reading the diff**

  Confirm: `index.html` is completely untouched by this commit — only
  `admin.html` changed. Confirm the click handler is attached once at
  script-load time (not inside `generatePeriodSheet`, not re-attached
  per render). Confirm `denied_by` uses `currentUser().name`, matching
  `approveReject`'s existing pattern exactly.

- [ ] **Step 4: Commit**

  ```bash
  git add admin.html
  git commit -m "feat: wire admin Period Sheet UI to meal-deny toggle"
  ```

---

## Task 2: Create the `MealDenials` Sheet tab (manual)

**Files:** None (Sheet UI only).

- [ ] **Step 1: Create the tab**

  In the live Google Sheet, add a new tab named exactly `MealDenials`
  with header row:
  ```
  employee_name | date | denied_by | denied_at
  ```
  Per `SETUP.md`'s already-committed documentation (`8e96a00`): leave data
  rows empty — they're only ever added/removed by the app itself via the
  `toggleMealDenial` action, never hand-edited.

- [ ] **Step 2: Report back**

  Confirm the tab exists with the exact header row above (case-sensitive,
  no extra spaces — `handleToggleMealDenial`/`handleGetPeriodSheet` both
  read these header names literally via `sheetToObjects`/`getSheet`).

---

## Task 3: Redeploy and live-verify the full feature

**Files:** None (verification only).

**Migration sequencing:** `Code.gs`'s changes (already committed) and
`admin.html`'s changes (Task 1) should redeploy/reload together, same as
every other `Code.gs`+frontend change this session — `Code.gs` already
returns `meal_denied` on every row regardless of whether `admin.html` is
ready to display it, so there's no breaking order requirement here, but
do both before calling this done.

- [ ] **Step 1: Redeploy `Code.gs`** (manual — paste into the Apps Script
  editor, save, Deploy → Manage deployments → edit existing deployment →
  New version → Deploy. Same `SCRIPT_URL`.)

- [ ] **Step 2: Reload `admin.html`** (static local file — just
  re-save/reopen, no separate deploy step)

- [ ] **Step 3: Live-verify the incomplete-log auto-grant — employee "Emmerson"**

  ```powershell
  $SCRIPT_URL = "<the deployed Web App URL from app.js's SCRIPT_URL>"
  $body = @{ action = "getPeriodSheet"; employee_name = "Emmerson"; period_start = "2026-06-01"; period_end = "2026-06-30" } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri $SCRIPT_URL -Method POST -Body $body -UseBasicParsing
  Write-Output $r.Content
  ```

  Expected changes vs. the pre-redeploy snapshot taken during planning:
  - `2026-06-02` ("Evo city", no Log In that day, `destination !==
    mother_branch`) — `meal` should now be > 0 (was `0`), `meal_denied`
    should be `false`.
  - `2026-06-06` ("Grace park", no Log Out that day) — `meal` should now
    be > 0 (was `0`), `meal_denied` should be `false`.
  - `2026-06-15` ("Sm Trece", COMPLETE log, only 1.1 hours) — `meal` must
    STAY `0` — this is case 2 from the design (complete log, short visit),
    explicitly unaffected by this feature. If this becomes non-zero, the
    `wasLogComplete` gating is broken — stop and investigate before
    proceeding.
  - Every row should now include a `meal_denied: false` field (new field,
    confirms the deployed code is the new version).

- [ ] **Step 4: Live-verify the toggle**

  ```powershell
  $body = @{ action = "toggleMealDenial"; employee_name = "Emmerson"; date = "2026-06-02"; denied_by = "Test Head" } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri $SCRIPT_URL -Method POST -Body $body -UseBasicParsing
  Write-Output $r.Content   # expect {"ok":true,"data":{"denied":true}}
  ```

  Then re-run Step 3's `getPeriodSheet` call: confirm `2026-06-02` now
  shows `meal: 0` and `meal_denied: true`. Toggle again with the same
  payload (expect `{"denied":false}`), re-run `getPeriodSheet` once more,
  confirm `2026-06-02`'s `meal` returns to its auto-granted amount and
  `meal_denied` is `false` again.

- [ ] **Step 5: Browser check of the admin UI**

  Open `admin.html`, generate Emmerson's period sheet for 2026-06-01 to
  2026-06-30: confirm a `MEAL CTRL` column appears with `Deny Meal`
  buttons on every row with `meal > 0` (including the newly-auto-granted
  06-02/06-06 rows), clicking one flips it to `Allow Meal` and zeroes that
  row's `MEAL` cell, clicking again reverses it. Confirm `index.html`
  (employee self-service view, if accessible for testing) does NOT show
  the `MEAL CTRL` column at all.

- [ ] **Step 6: Confirm complete-log, short-visit days are unaffected**

  Re-confirm `2026-06-15` (Sm Trece, 1.1 hours) still shows `meal: 0` in
  both the API response and the browser — this is the regression check
  for case 2 of the design, the most important thing NOT to break.

- [ ] **Step 7: Report back**

  Report the before/after `meal` values for Emmerson's 2026-06-02 and
  2026-06-06, confirm the toggle round-trips correctly, and confirm
  2026-06-15 stayed at `meal: 0` throughout.

---

## Self-Review Against Spec

| Spec requirement | Status / Task |
|---|---|
| Auto-grant meal on genuinely incomplete log (case 1) | Already implemented, `c019aa6` |
| Case 2 (complete log, short visit) unaffected | Already implemented (`wasLogComplete` gate), `c019aa6` — regression-checked in Task 3 Step 6 |
| 20-hour-capped day qualifies for auto-grant too | Already implemented — `wasLogComplete` derived from post-cap `firstIn`/`lastOut`, `c019aa6` |
| `MealDenials` Sheet tab, schema documented | Doc already committed (`8e96a00`); tab creation is Task 2 (manual, not yet done) |
| Admin deny/allow toggle, reversible | Backend already implemented (`8cb2118`); UI wiring is Task 1 (not yet done) |
| Toggle available on any `meal > 0` row, not just incomplete-log rows | Already implemented in `app.js`'s `r.meal > 0 \|\| r.meal_denied` check, `2fa5054` |
| Accommodation unaffected | Confirmed unchanged — `computeAccom` was not touched by any of the existing commits |
| Admin-only — employee self-service view must not show the control | `app.js`'s `adminControls` opt-in defaults to off; Task 1 only changes `admin.html`'s call site, not `index.html`'s |

## Verification (end-to-end)

1. Pre-redeploy snapshot (already taken during planning) vs. post-redeploy
   `getPeriodSheet` for "Emmerson": 06-02 and 06-06 flip from `meal: 0` to
   `meal > 0`; 06-15 stays at `meal: 0`.
2. `toggleMealDenial` round-trips correctly (deny → allow → deny again all
   reflected immediately in the next `getPeriodSheet` call).
3. `admin.html` shows the new column and buttons; `index.html` does not.
4. Update `Resume.md` after this ships — clear the "STOP HERE FIRST"
   section (the feature will no longer be in-progress) and fold this work
   into the main session summary, following this project's established
   practice.
