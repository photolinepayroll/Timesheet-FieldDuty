# Company Service (No Fare) Claim Type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Company Service (No Fare)" claim type so an employee can
declare a specific date had no personal transport cost (company vehicle
picked them up), which once head-approved suppresses just that date's
auto-computed fare in the period sheet — meal/accom/midnight/OT stay
unaffected.

**Architecture:** Reuses the existing `Claims` sheet, claim submission form,
and approval queue unchanged (just a new `type` value, same as
`'special-fare'`/`'accommodation'`). `handleGetPeriodSheet` gets one new
lookup, following the exact pattern already used for `specialClaims`.

**Tech Stack:** Same as the rest of the app — vanilla HTML/JS (`index.html`),
Google Apps Script ES5 (`Code.gs`). No build step, no test framework — this
codebase verifies via manual/synthetic tracing and, since a live Apps Script
deployment now exists for this project, direct calls to the deployed API.

**Reference:** Design spec at
`docs/superpowers/specs/2026-06-23-company-service-no-fare-design.md` — read
it before starting if anything below is unclear.

---

## Task 1: Add "Company Service" claim type to the submission form

**Files:**
- Modify: `index.html:31-33` (Type dropdown)
- Modify: `index.html:74-99` (`submitClaim()`)

- [ ] **Step 1: Add the new dropdown option**

  In `index.html`, find the `#cl-type` select (currently lines 31-33):

  ```html
  <select id="cl-type" style="width:100%;padding:7px;margin:4px 0 10px;">
    <option value="special-fare">Special Trip / Special Pay</option>
    <option value="accommodation">Accommodation</option>
  </select>
  ```

  Add a third option so it reads:

  ```html
  <select id="cl-type" style="width:100%;padding:7px;margin:4px 0 10px;">
    <option value="special-fare">Special Trip / Special Pay</option>
    <option value="accommodation">Accommodation</option>
    <option value="company-service">Company Service (No Fare)</option>
  </select>
  ```

- [ ] **Step 2: Make the Amount field optional for this type, with NaN normalized to 0**

  In `index.html`, `submitClaim()` currently reads (lines 74-78):

  ```javascript
  function submitClaim() {
    var user = currentUser();
    var dateVal = document.getElementById('cl-date').value;
    var amount  = parseFloat(document.getElementById('cl-amount').value);
    if (!dateVal || !amount) { alert('Date and amount are required.'); return; }
  ```

  Replace those 5 lines with:

  ```javascript
  function submitClaim() {
    var user = currentUser();
    var dateVal = document.getElementById('cl-date').value;
    var claimType = document.getElementById('cl-type').value;
    var amount  = parseFloat(document.getElementById('cl-amount').value);
    if (!dateVal || (claimType !== 'company-service' && !amount)) {
      alert('Date and amount are required.');
      return;
    }
    if (isNaN(amount)) amount = 0;
  ```

  Then, further down in the same function, the `claim` object literal
  (currently lines 81-99) reads `type: document.getElementById('cl-type').value,`
  — change that one line to reuse the variable you just introduced, so the
  dropdown is only read from the DOM once:

  ```javascript
  type:            claimType,
  ```

  (Every other line in the `claim` object — `employee_name`, `date`,
  `period_start`, `period_end`, `from_loc`, `to_loc`, `vehicle_mode`,
  `distance_km`, `computed_amount`, `claimed_amount: amount`, `receipt_url`,
  `gps_check`, `status`, `approver_name`, `approved_at`, `notes` — stays
  exactly as it is today. `claimed_amount` already reads the `amount`
  variable, which is now guaranteed to be `0` instead of `NaN` for a blank
  Amount field, so no change needed there.)

- [ ] **Step 3: Verify by reading the diff**

  There is no test framework in this codebase for client-side JS. Verify by
  re-reading the edited `submitClaim()` function top to bottom and confirming:
  - Selecting "Special Trip / Special Pay" or "Accommodation" with an empty
    Amount field still triggers the "Date and amount are required." alert
    (unchanged behavior for those two types).
  - Selecting "Company Service (No Fare)" with an empty Amount field does
    NOT trigger that alert, and the claim submits with `claimed_amount: 0`.
  - Selecting "Company Service (No Fare)" with date empty still alerts
    (date is required regardless of type).

- [ ] **Step 4: Commit**

  ```bash
  git add index.html
  git commit -m "feat: add Company Service (No Fare) claim type to submission form"
  ```

---

## Task 2: Suppress auto-fare for approved Company Service dates

**Files:**
- Modify: `Code.gs:498-504` (claims pre-filtering, add a sibling filter)
- Modify: `Code.gs:544-551` (the auto-fare block inside the per-day loop)

- [ ] **Step 1: Add a `companyServiceClaims` pre-filter alongside `specialClaims`**

  In `Code.gs`, immediately after the existing `specialClaims` filter (around
  line 500-504):

  ```javascript
  // Get approved special claims for this period
  var allClaims = sheetToObjects('Claims');
  var specialClaims = allClaims.filter(function(c) {
    return c['employee_name'] === payload.employee_name &&
           c['status'] === 'Approved' &&
           (c['type'] === 'special-fare' || c['type'] === 'accommodation');
  });
  ```

  Add right after it:

  ```javascript

  // Approved Company Service claims suppress that date's auto-computed
  // fare only — meal/accom/midnight/OT are unaffected (see
  // docs/superpowers/specs/2026-06-23-company-service-no-fare-design.md).
  // A claim that exists but isn't yet 'Approved' has no effect here.
  var companyServiceClaims = allClaims.filter(function(c) {
    return c['employee_name'] === payload.employee_name &&
           c['status'] === 'Approved' &&
           c['type'] === 'company-service';
  });
  ```

- [ ] **Step 2: Check for an approved Company Service claim before computing auto-fare**

  Find the existing auto-fare block inside the per-day loop (currently
  around lines 544-551):

  ```javascript
    // Auto-fare (LTFRB computed) — reuse buildAutoFareClaim (Task 6) rather than
    // re-deriving the round-trip-doubled fare logic inline. buildAutoFareClaim
    // itself does not know about mother-branch — that gate is enforced here,
    // matching the original inline draft's behavior (no auto-fare at mother branch).
    var autoFare = 0;
    if (emp['mother_branch'] !== destination) {
      // Default vehicle type: Traditional Jeepney — employee can override
      // via special claim; auto-fare uses the cheapest standard mode.
      var claimResult = buildAutoFareClaim(day, 'Traditional Jeepney',
        payload.employee_name, date, payload.period_start, payload.period_end);
      autoFare = claimResult ? claimResult.computed_amount : 0;
    }
  ```

  Replace it with:

  ```javascript
    // Auto-fare (LTFRB computed) — reuse buildAutoFareClaim (Task 6) rather than
    // re-deriving the round-trip-doubled fare logic inline. buildAutoFareClaim
    // itself does not know about mother-branch — that gate is enforced here,
    // matching the original inline draft's behavior (no auto-fare at mother branch).
    var hasCompanyService = companyServiceClaims.some(function(c) {
      return c['date'] === date;
    });
    var autoFare = 0;
    if (!hasCompanyService && emp['mother_branch'] !== destination) {
      // Default vehicle type: Traditional Jeepney — employee can override
      // via special claim; auto-fare uses the cheapest standard mode.
      var claimResult = buildAutoFareClaim(day, 'Traditional Jeepney',
        payload.employee_name, date, payload.period_start, payload.period_end);
      autoFare = claimResult ? claimResult.computed_amount : 0;
    }
  ```

  This skips the `buildAutoFareClaim` call entirely when a Company Service
  claim is approved for that date — no unnecessary OSRM network call, and
  `meal`/`accom`/`midnight`/`otResult` (computed earlier in the loop, lines
  530-535) are untouched by this change.

- [ ] **Step 3: Verify by reading the diff**

  Confirm:
  - `hasCompanyService` is computed from `companyServiceClaims` (the new,
    type-specific filter), not `specialClaims`.
  - The `!hasCompanyService` check is ANDed with the existing mother-branch
    check, not replacing it — a Company Service day at the mother branch
    still correctly shows `autoFare = 0` (it would have anyway).
  - No other line in the per-day loop changed.

- [ ] **Step 4: Commit**

  ```bash
  git add Code.gs
  git commit -m "feat: suppress auto-fare for approved Company Service dates"
  ```

---

## Task 3: Redeploy and verify against the live Apps Script

This project has a real, already-deployed Apps Script Web App (unlike most
of the original 12-task build, which had no live backend to test against).
Use it directly.

**Important:** by the time you run this task, `Code.gs` also contains an
unrelated bug fix (commit `8c649fa`) that renamed the approve/reject decision
field from `action` to `decision` inside `handleApproveClaim`, because it
collided with `doPost`'s own dispatch field of the same name. Make sure
whatever you paste into the Apps Script editor in Step 1 includes that fix
too (it's already in this repo's `Code.gs` — just paste the whole current
file, don't paste an older copy).

**Files:** None (verification only — no code changes in this task).

- [ ] **Step 1: Redeploy the updated Code.gs**

  This is a manual step for whoever has the Google account access:
  1. Open the Google Sheet → Extensions → Apps Script.
  2. Select all existing code in the `Code.gs` file, delete it, paste in the
     full updated contents of this repo's `Code.gs`.
  3. Save (Ctrl+S).
  4. Deploy → Manage deployments → edit the existing deployment (pencil
     icon) → Version: **New version** → Deploy. (This keeps the same
     `SCRIPT_URL` — no `app.js` change needed.)

- [ ] **Step 2: Submit a test Company Service claim via the live API**

  Using the existing test employee (`Louwin celis`, PIN `1111`, added during
  earlier live testing) and the current period (`2026-06-11`/`2026-06-25`),
  pick a date from his existing attendance that currently shows a non-zero
  `auto_fare` — e.g. `2026-06-13` (currently `auto_fare: 120` per the last
  live test run). Submit a claim:

  ```powershell
  $SCRIPT_URL = "<the deployed Web App URL from app.js's SCRIPT_URL>"
  $claimBody = @{
    action = "saveClaim"
    claim = @{
      employee_name = "Louwin celis"
      date = "2026-06-13"
      period_start = "2026-06-11"
      period_end = "2026-06-25"
      type = "company-service"
      claimed_amount = 0
    }
  } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri $SCRIPT_URL -Method POST -Body $claimBody -UseBasicParsing
  Write-Output $r.Content
  ```

  Expected: `{"ok":true,"data":"C<timestamp>"}` — note the returned id, you
  need it for Step 4.

- [ ] **Step 3: Confirm it has NO effect before approval**

  ```powershell
  $body = @{ action = "getPeriodSheet"; employee_name = "Louwin celis"; period_start = "2026-06-11"; period_end = "2026-06-25" } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri $SCRIPT_URL -Method POST -Body $body -UseBasicParsing
  Write-Output $r.Content
  ```

  Expected: the `2026-06-13` row's `auto_fare` is still `120` (claim exists
  but is `'Submitted'`, not yet `'Approved'` — no effect yet, per the design
  spec).

- [ ] **Step 4: Approve the claim**

  Use the `decision` field (not `action` — see the Task 3 intro note above
  for why `action` would collide with the dispatch key):

  ```powershell
  $approveBody = @{
    action = "approveClaim"
    claim_id = "<the id returned in Step 2>"
    approver_name = "Test Head"
    decision = "approve"
  } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri $SCRIPT_URL -Method POST -Body $approveBody -UseBasicParsing
  Write-Output $r.Content
  ```

  Expected: `{"ok":true,"data":"done"}`.

- [ ] **Step 5: Confirm the approved claim now suppresses the fare**

  Re-run the same `getPeriodSheet` call from Step 3. Expected: the
  `2026-06-13` row now shows `auto_fare: 0`, while `meal`, `accom`,
  `midnight`, `ot_hours` for that same row are unchanged from Step 3's
  values (still `150`, `150`, `100`, `2` respectively per the last live
  test run — confirm against whatever the actual current values are when
  you run this, since rate tables may have changed since).

- [ ] **Step 6: Report back**

  No commit in this task (verification only). Report whether Steps 2-5
  produced the expected results.

---

## Self-Review Against Spec

| Spec section | Task |
|---|---|
| 3.1 Data model (reuse Claims, no schema change) | No task needed — no code changes to the sheet schema itself |
| 3.2 UI — claim form dropdown + optional amount | Task 1 |
| 3.3 Approval — no changes needed | No task needed — confirmed by design, nothing to build |
| 3.4 Period sheet computation | Task 2 |
| Section 4 Testing (all 4 bullet points) | Task 3 covers the first 3 bullets live; the 4th (company-service + special-fare coexisting on the same date) is not covered by a dedicated step — both fields are independent in the code (confirmed by reading Task 2's diff: `hasCompanyService` only touches `autoFare`, never `specialFare`), so it doesn't need a separate live test, but flag this in Task 3's Step 6 report if you want extra confidence. |
