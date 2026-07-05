# Manual Fare Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GPS+LTFRB auto-computed fare with a manual employee
claim (Jeepney/Tricycle/Company Service dropdown), exempt fare claims from
receipt upload, restrict all claim-form date fields to dates already present
in the loaded period sheet, and fix the stale amount-required validation.

**Architecture:** No new sheets, no schema changes, no new backend actions.
One `Code.gs` edit un-wires the auto-fare call site inside the existing
`handleGetPeriodSheet` per-day loop (leaves `computeFare`/`buildAutoFareClaim`
defined but unused). The rest is `index.html`-only: the existing inline claim
form (`#emp-inline-claim`) gets a mode `<select>`, a date `<select>` sourced
from `window._lastPeriodSheet`, a hide/show toggle on the receipt field, and
a corrected validation guard in `submitClaim()`.

**Tech Stack:** Vanilla ES5 JS (`Code.gs`, Google Apps Script backend),
vanilla modern JS (`index.html`), no build step, no test framework — this
codebase verifies changes by manual browser testing and direct PowerShell
`Invoke-WebRequest` calls against the deployed backend (see `Resume.md`
"Misc context").

**Reference spec:** `docs/superpowers/specs/2026-07-05-manual-fare-claims-design.md`

**Local-only:** Per this session's working agreement, do not `git push` any
commit from this plan (neither `origin master` nor `origin master:main`)
until the admin explicitly says to deploy. Every task still commits locally.

---

### Task 1: Retire the auto-fare call site in `Code.gs`

**Files:**
- Modify: `Code.gs:807-817`

- [ ] **Step 1: Read the current block to confirm line numbers haven't shifted**

Open `Code.gs` and confirm lines 807-817 read exactly:

```js
    var hasCompanyService = companyServiceClaims.some(function(c) {
      return claimDateKey(c['date']) === date;
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

If the surrounding line numbers have drifted, use this exact code snippet to
locate the block instead of trusting the line numbers.

- [ ] **Step 2: Replace the block**

Replace the snippet above with:

```js
    var hasCompanyService = companyServiceClaims.some(function(c) {
      return claimDateKey(c['date']) === date;
    });
    // Auto-fare (GPS distance + LTFRB formula) retired 2026-07-05 — fare is
    // now always a manual employee claim (special-fare, vehicle_mode
    // Jeepney/Tricycle/Company Service). computeFare()/buildAutoFareClaim()
    // are left defined but unused; see
    // docs/superpowers/specs/2026-07-05-manual-fare-claims-design.md.
    var autoFare = 0;
```

(`hasCompanyService` is left in place even though it no longer gates
anything — removing it isn't required for this change and the admin asked to
minimize backend churn beyond un-wiring the auto-fare call.)

- [ ] **Step 3: Manually verify via PowerShell against a local copy check**

This repo has no local Apps Script runtime, so you cannot execute `Code.gs`
directly. Instead, re-read the edited block to confirm it's syntactically
valid JS (balanced braces, no dangling `claimResult` reference elsewhere in
the function — search the file for `claimResult` and confirm no other
references exist):

Run: `grep -n "claimResult" "Code.gs"`
Expected: no matches (the only reference was the one just deleted).

- [ ] **Step 4: Commit**

```bash
git add Code.gs
git commit -m "feat: retire auto-computed fare, always manual claim now"
```

---

### Task 2: Vehicle/Mode dropdown + Company Service amount lock

**Files:**
- Modify: `index.html:72-73` (markup)
- Modify: `index.html:167-192` (`openClaimForm`, reset logic)
- Create: new `onModeChange()` function near `openClaimForm`

- [ ] **Step 1: Replace the Vehicle/Mode text input with a dropdown**

In `index.html`, find (currently lines 72-73):

```html
          <label>Vehicle / Mode</label>
          <input id="cl-mode" type="text" placeholder="e.g. Van hire, Taxi, Grab" style="width:100%;padding:7px;margin:4px 0 10px;">
```

Replace with:

```html
          <label>Vehicle / Mode</label>
          <select id="cl-mode" onchange="onModeChange()" style="width:100%;padding:7px;margin:4px 0 10px;">
            <option value="">Select mode…</option>
            <option value="Jeepney">Jeepney</option>
            <option value="Tricycle">Tricycle</option>
            <option value="Company Service">Company Service</option>
          </select>
```

- [ ] **Step 2: Add the `onModeChange()` function**

In the `<script>` block, immediately after the `openClaimForm` function
(after the closing `}` currently on line 192, before `function hideClaimForm()`),
add:

```js
    function onModeChange() {
      var mode = document.getElementById('cl-mode').value;
      var amountEl = document.getElementById('cl-amount');
      if (mode === 'Company Service') {
        amountEl.value = '0';
        amountEl.setAttribute('readonly', 'readonly');
      } else {
        amountEl.removeAttribute('readonly');
        if (amountEl.value === '0') amountEl.value = '';
      }
    }
```

- [ ] **Step 3: Reset the read-only lock every time the form opens**

In `openClaimForm`, the existing reset line:

```js
      document.getElementById('cl-mode').value   = '';
```

stays as-is (setting a `<select>`'s `.value = ''` correctly re-selects the
blank "Select mode…" option). Immediately after it, add a line to clear any
leftover read-only lock from a previous Company-Service claim:

```js
      document.getElementById('cl-mode').value   = '';
      document.getElementById('cl-amount').removeAttribute('readonly');
```

- [ ] **Step 4: Manual browser test**

Open `index.html` in a browser (file:// is fine for this DOM-only check —
no backend call needed), open the browser console, and run:

```js
document.getElementById('emp-inline-claim').style.display = 'block';
document.getElementById('cl-mode').value = 'Company Service';
onModeChange();
document.getElementById('cl-amount').value === '0' &&
document.getElementById('cl-amount').hasAttribute('readonly')
```

Expected: `true`. Then run:

```js
document.getElementById('cl-mode').value = 'Jeepney';
onModeChange();
document.getElementById('cl-amount').hasAttribute('readonly')
```

Expected: `false`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: Vehicle/Mode dropdown (Jeepney/Tricycle/Company Service), auto-zero amount"
```

---

### Task 3: Hide Receipt Photo for fare claims

**Files:**
- Modify: `index.html:79-80` (wrap in container)
- Modify: `index.html:167-192` (`openClaimForm` — add show/hide toggle)

- [ ] **Step 1: Wrap the Receipt Photo field in a container**

Find (currently lines 79-80):

```html
        <label>Receipt Photo (optional)</label>
        <input id="cl-receipt" type="file" accept="image/*" style="margin:4px 0 12px;">
```

Replace with:

```html
        <div id="cl-receipt-row">
          <label>Receipt Photo (optional)</label>
          <input id="cl-receipt" type="file" accept="image/*" style="margin:4px 0 12px;">
        </div>
```

- [ ] **Step 2: Toggle it in `openClaimForm`**

In `openClaimForm`, find the existing FROM/TO/MODE visibility toggle:

```js
      // Show FROM/TO/MODE only for fare claims
      document.getElementById('cl-fare-fields').style.display =
        type === 'accommodation' ? 'none' : 'block';
```

Immediately after it, add:

```js
      // Fare claims (Jeepney/Tricycle/Company Service) are all receipt-exempt
      // — only Accommodation claims still show the Receipt Photo field.
      document.getElementById('cl-receipt-row').style.display =
        type === 'accommodation' ? 'block' : 'none';
```

- [ ] **Step 3: Manual browser test**

With the browser console still open on `index.html`:

```js
openClaimForm('2026-06-11', 'special-fare');
document.getElementById('cl-receipt-row').style.display
```

Expected: `'none'`. Then:

```js
openClaimForm('2026-06-11', 'accommodation');
document.getElementById('cl-receipt-row').style.display
```

Expected: `'block'`.

(This test can run in isolation without `window._lastPeriodSheet` set,
since Task 4 hasn't changed `openClaimForm`'s date handling yet at this
point in the plan — the date select population happens in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: hide Receipt Photo field for fare claims (all modes receipt-exempt)"
```

---

### Task 4: Restrict claim-form Date field to loaded period-sheet dates

**Files:**
- Modify: `index.html:64-65` (markup)
- Modify: `index.html:167-192` (`openClaimForm`)
- Modify: `index.html:85-89` (fallback button + helper text)

- [ ] **Step 1: Replace the date input with a select**

Find (currently lines 64-65):

```html
        <label>Date</label>
        <input id="cl-date" type="date" style="width:100%;padding:7px;margin:4px 0 10px;">
```

Replace with:

```html
        <label>Date</label>
        <select id="cl-date" style="width:100%;padding:7px;margin:4px 0 10px;"></select>
```

- [ ] **Step 2: Rewrite the date-handling part of `openClaimForm`**

Find (currently lines 167-175):

```js
    function openClaimForm(date, type) {
      var dateEl = document.getElementById('cl-date');
      if (date) {
        dateEl.value = date;
        dateEl.setAttribute('readonly', 'readonly');
      } else {
        dateEl.value = '';
        dateEl.removeAttribute('readonly');
      }
```

Replace with:

```js
    function openClaimForm(date, type) {
      var sheet   = window._lastPeriodSheet;
      var dates   = sheet ? sheet.rows.map(function(r) { return r.date; }) : [];
      var dateSel = document.getElementById('cl-date');
      dateSel.innerHTML = dates.map(function(d) {
        return '<option value="' + d + '">' + d + '</option>';
      }).join('');
      if (date) {
        dateSel.value = date;
        dateSel.setAttribute('disabled', 'disabled');
      } else {
        dateSel.removeAttribute('disabled');
      }
```

- [ ] **Step 3: Guard the fallback button against no loaded sheet**

Find (currently lines 85-89):

```html
      <!-- Fallback: for trips with no matching attendance row in the period -->
      <div style="margin-top:20px;">
        <button onclick="openClaimForm('','special-fare')" style="font-size:.85em;">+ Add Claim for Another Day</button>
        <span style="margin-left:10px;font-size:.82em;color:#666;">Use for trips not listed in the sheet above</span>
      </div>
```

Replace with:

```html
      <!-- Fallback: pick any date already in the loaded period sheet -->
      <div style="margin-top:20px;">
        <button onclick="openClaimForAnyDate()" style="font-size:.85em;">+ Add Claim for Another Day</button>
        <span style="margin-left:10px;font-size:.82em;color:#666;">Pick any date from your loaded period sheet</span>
      </div>
```

- [ ] **Step 4: Add the `openClaimForAnyDate()` guard function**

Add this new function immediately before `function openClaimForm(date, type) {`:

```js
    function openClaimForAnyDate() {
      if (!window._lastPeriodSheet) {
        alert('Load your period sheet first.');
        return;
      }
      openClaimForm('', 'special-fare');
    }
```

- [ ] **Step 5: Manual browser test (against the real deployed backend)**

Log in as a real employee in a browser, load a period sheet with at least
two dates, then:
1. Click "+ Fare" on a specific row → confirm the Date dropdown shows only
   that row's date and is greyed out/disabled.
2. Click "+ Add Claim for Another Day" → confirm the Date dropdown lists
   every date from the loaded sheet, all selectable.
3. Log out, log back in without loading a sheet, click "+ Add Claim for
   Another Day" immediately → confirm the alert "Load your period sheet
   first." appears and no form opens.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: restrict claim-form Date field to loaded period-sheet dates"
```

---

### Task 5: Fix the amount-required validation in `submitClaim()`

**Files:**
- Modify: `index.html:198-207`

- [ ] **Step 1: Replace the stale validation guard**

Find (currently lines 198-207):

```js
    function submitClaim() {
      var user      = currentUser();
      var dateVal   = document.getElementById('cl-date').value;
      var claimType = document.getElementById('cl-type').value;
      var amount    = parseFloat(document.getElementById('cl-amount').value);
      if (!dateVal || (claimType !== 'company-service' && !amount)) {
        alert('Date and amount are required.');
        return;
      }
      if (isNaN(amount)) amount = 0;
```

Replace with:

```js
    function submitClaim() {
      var user      = currentUser();
      var dateVal   = document.getElementById('cl-date').value;
      var claimType = document.getElementById('cl-type').value;
      var mode      = document.getElementById('cl-mode').value;
      var amount    = parseFloat(document.getElementById('cl-amount').value);
      if (!dateVal) {
        alert('Date is required.');
        return;
      }
      if (claimType === 'special-fare' && !mode) {
        alert('Please select a vehicle/mode.');
        return;
      }
      var amountRequired = !(claimType === 'special-fare' && mode === 'Company Service');
      if (amountRequired && (isNaN(amount) || amount <= 0)) {
        alert('Amount is required.');
        return;
      }
      if (isNaN(amount)) amount = 0;
```

(The old guard referenced a `claimType === 'company-service'` case that has
no live UI trigger — dead code from an earlier, never-fully-shipped plan.
The new guard checks `mode === 'Company Service'`, which is the field this
plan's dropdown actually sets.)

- [ ] **Step 2: Manual browser test against the real deployed backend**

1. Open a Fare claim, leave mode unselected, enter an amount, click Submit
   → expect alert "Please select a vehicle/mode."
2. Select "Jeepney", leave amount blank, click Submit → expect alert
   "Amount is required."
3. Select "Company Service" (amount auto-locks to 0), click Submit →
   expect success ("Submitted! ID: ...", no alert).
4. Open an Accommodation claim, leave amount blank, click Submit → expect
   alert "Amount is required." (unaffected by this change).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "fix: correct amount-required validation for Company Service mode"
```

---

### Task 6: Full end-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Verify the My Sheet FARE AMT column no longer includes auto-fare**

Log in as a real employee with existing attendance data for a period that
previously showed a non-zero auto-computed fare (per `Resume.md`, employee
"Emmerson" or "Louwin celis" have real tested attendance). Load that period
and confirm the FARE AMT column for those days now shows ₱0.00 (no
submitted claims yet) instead of the old auto-computed jeepney fare.

- [ ] **Step 2: Submit one claim of each type and confirm it flows through**

1. Submit a Jeepney fare claim on one date (amount > 0, no receipt field
   shown) → reload the sheet → confirm a "⏳ Pending" badge appears in the
   FARE CLAIM column for that date, and FARE AMT for that row is still
   ₱0.00 (claim not yet Approved — matches existing `specialClaims`
   Approved-only logic in `Code.gs`, unchanged by this plan).
2. Submit a Company Service claim on a different date (amount forced 0,
   no receipt field shown) → reload → confirm the same Pending badge
   behavior.
3. Submit an Accommodation claim → confirm the Receipt Photo field was
   present and (if a file is attached) the claim still round-trips
   correctly, unaffected by this plan's changes.

- [ ] **Step 3: Confirm dead code is inert, not broken**

Run: `grep -n "computeFare\|buildAutoFareClaim\|LTFRBRates" "Code.gs"`

Expected: `computeFare` and `buildAutoFareClaim` function definitions still
present, `LTFRBRates` sheet name still referenced in `sheetToObjects` calls
at the top of the file — confirming nothing was deleted, only the one call
site in `handleGetPeriodSheet` (Task 1) was un-wired.

- [ ] **Step 4: Report status to the admin**

Summarize which of the above passed/failed. Do **not** run `git push`
(neither `origin master` nor `origin master:main`) — this plan's commits
stay local until the admin explicitly says to deploy, per this session's
working agreement. Remind the admin that `Code.gs`'s Task 1 change will
also need the usual manual Apps Script redeploy once they do decide to
deploy (same as every other pending `Code.gs` change currently queued —
see `Resume.md` "What's deployed right now").

---

## Self-review notes (for whoever executes this plan)

- **Spec coverage:** Task 1 covers spec §1, Task 2 covers §2–3, Task 3
  covers §4, Task 4 covers §5, Task 5 covers §6. Spec's "Out of scope"
  section is intentionally not a task — nothing to do there.
- **Type/name consistency:** `cl-mode` values are the literal strings
  `"Jeepney"`, `"Tricycle"`, `"Company Service"` throughout (Task 2's HTML,
  Task 2's `onModeChange`, Task 5's `submitClaim` guard) — verify no task
  drifted to a different casing or spelling before committing.
- **Ordering matters:** Task 4 depends on `window._lastPeriodSheet` being
  populated by `loadEmployeePeriodSheet` (existing code, untouched) —
  Task 4's Step 5 manual test explicitly loads a sheet first for this
  reason.
