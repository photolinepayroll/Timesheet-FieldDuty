# Design: Manual Fare Claims (remove LTFRB auto-fare), Mode Dropdown, Date Restriction

**Status:** Approved by admin 2026-07-05. Local-only change — do not push to
GitHub until the admin explicitly says to deploy (per this session's working
agreement).

**Addendum (2026-07-05, same day, superseded once more below):** the admin
first asked to expand the dropdown with Bus/Van/By Sea/Personal Gas Refill
(all receipt-required) — this was immediately replaced by the final shape
below before any deploy, kept here only for history.

**Final addendum (2026-07-05):** the dropdown settled on 8 options: Jeepney,
Tricycle, FX, Company Service (all exempt from both Receipt Photo and Notes
— unchanged since the original design above) plus **LAND, SEA, AIR, GAS
EXPENSE** — broad catch-all categories (a LAND claim could be a bus, a
company car, anything not covered by the specific Jeepney/Tricycle/FX
options). Because a receipt alone doesn't say which, these four require
**both** a receipt photo AND a non-empty Notes field naming the actual
vehicle or gas station, enforced client-side in `submitClaim()` via two
`RECEIPT_REQUIRED_MODES`/`NOTE_REQUIRED_MODES` arrays (currently identical
lists). The Receipt Photo and Notes labels dynamically switch to
"(required)" via a shared `updateReceiptVisibility()` helper called from
both `openClaimForm` and `onModeChange`. Accommodation claims are
unaffected — Receipt Photo stays visible-but-optional and Notes stays
optional, as always.

## Why

The admin wants employees to manually enter their fare instead of relying on
the GPS-distance + LTFRB-formula auto-computation, because the auto-fare
hardcodes "Traditional Jeepney" and doesn't match how employees actually
travel or report costs. Manual entry with a constrained Jeepney/Tricycle/
Company Service dropdown is simpler to audit and matches the physical reality
that jeepneys/tricycles don't issue receipts.

## Scope

1. Stop auto-computing fare in the period sheet (`Code.gs`).
2. Vehicle/Mode field in the employee's fare-claim form becomes a dropdown:
   Jeepney / Tricycle / Company Service.
3. Company Service locks Amount to ₱0 (read-only).
4. Receipt Photo upload is hidden entirely for fare claims (all three modes
   are receipt-exempt); unaffected for Accommodation claims.
5. The claim form's Date field becomes a `<select>` populated only from dates
   present in the currently-loaded period sheet — for both the per-row
   +Fare/+Accom buttons and the "+ Add Claim for Another Day" fallback.
6. Fix the stale/incorrect amount-required validation in `submitClaim()`.

## 1. Stop auto-computing fare — `Code.gs`

In `handleGetPeriodSheet`, replace:

```js
var autoFare = 0;
if (!hasCompanyService && emp['mother_branch'] !== destination) {
  var claimResult = buildAutoFareClaim(day, 'Traditional Jeepney',
    payload.employee_name, date, payload.period_start, payload.period_end);
  autoFare = claimResult ? claimResult.computed_amount : 0;
}
```

with:

```js
var autoFare = 0; // auto-fare (GPS + LTFRB) retired 2026-07-05 — fare is
                   // now always a manual employee claim (see
                   // docs/superpowers/specs/2026-07-05-manual-fare-claims-design.md)
```

`computeFare()`, `buildAutoFareClaim()`, `getRoadDistanceKm()`, and the
`LTFRBRates` sheet read stay defined and untouched — dormant, not deleted
(explicit admin decision: don't touch that backend code beyond un-wiring the
call site). `hasCompanyService`/`companyServiceClaims` computation above this
block is also left as-is even though it no longer gates anything meaningful,
since removing it isn't required to achieve the goal and the admin asked to
minimize backend churn.

**Effect on display:** the employee's My Sheet "FARE AMT" column already
renders `r.total_fare` (= `auto_fare + special_fare`), so once `auto_fare` is
always `0` it automatically shows only manual (special-fare) claims — no
`app.js` template change needed there. The admin's Period Sheets tab (the
non-`employeeControls` table) has a separate "AUTO FARE" column that will
just always read ₱0.00 — left in place, not removed, since the admin's
instruction was to stop the computation, not redesign that table.

## 2–4. Fare claim form — `index.html`

Current markup (`#emp-inline-claim`):

```html
<label>Vehicle / Mode</label>
<input id="cl-mode" type="text" placeholder="e.g. Van hire, Taxi, Grab" ...>
...
<label>Receipt Photo (optional)</label>
<input id="cl-receipt" type="file" accept="image/*" ...>
```

Changes:

- `#cl-mode` becomes a `<select>`:
  ```html
  <select id="cl-mode" onchange="onModeChange()" style="width:100%;padding:7px;margin:4px 0 10px;">
    <option value="">Select mode…</option>
    <option value="Jeepney">Jeepney</option>
    <option value="Tricycle">Tricycle</option>
    <option value="Company Service">Company Service</option>
  </select>
  ```
- New `onModeChange()` handler:
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
- Wrap the Receipt Photo label+input in a container (`#cl-receipt-row`) so it
  can be toggled as a block:
  ```html
  <div id="cl-receipt-row">
    <label>Receipt Photo (optional)</label>
    <input id="cl-receipt" type="file" accept="image/*" style="margin:4px 0 12px;">
  </div>
  ```
- In `openClaimForm(date, type)`, alongside the existing
  `cl-fare-fields` show/hide toggle, add:
  ```js
  document.getElementById('cl-receipt-row').style.display =
    type === 'accommodation' ? 'block' : 'none';
  ```
  and reset mode-dependent state on every open:
  ```js
  document.getElementById('cl-mode').value = '';
  document.getElementById('cl-amount').removeAttribute('readonly');
  ```
  (the existing reset lines for `cl-from`/`cl-to`/`cl-mode`/`cl-amount`/etc.
  already run on every `openClaimForm` call — this just ensures the
  Company-Service read-only lock doesn't leak into the next claim opened).

## 5. Date restricted to sheet dates — `index.html`

Current markup:
```html
<label>Date</label>
<input id="cl-date" type="date" style="width:100%;padding:7px;margin:4px 0 10px;">
```

Becomes:
```html
<label>Date</label>
<select id="cl-date" style="width:100%;padding:7px;margin:4px 0 10px;"></select>
```

`openClaimForm(date, type)` changes: instead of setting `.value` on a date
input and toggling `readonly`, it now populates the `<select>`'s options from
`window._lastPeriodSheet.rows` and either locks it to a single pre-selected
date (per-row buttons) or leaves all dates selectable (fallback button):

```js
function openClaimForm(date, type) {
  var sheet = window._lastPeriodSheet;
  var dateSel = document.getElementById('cl-date');
  var dates = sheet ? sheet.rows.map(function(r) { return r.date; }) : [];
  dateSel.innerHTML = dates.map(function(d) {
    return '<option value="' + d + '">' + d + '</option>';
  }).join('');
  if (date) {
    dateSel.value = date;
    dateSel.setAttribute('disabled', 'disabled');
  } else {
    dateSel.removeAttribute('disabled');
  }
  ...
}
```

`submitClaim()` currently reads `document.getElementById('cl-date').value` —
a `disabled` `<select>` still reports `.value` correctly via direct DOM
property access (this app never relies on native form submission/FormData,
so `disabled` not excluding it from a submit is a non-issue here).

**"+ Add Claim for Another Day" fallback button** (currently
`onclick="openClaimForm('','special-fare')"`):
- Guard added before opening: if `!window._lastPeriodSheet`, `alert('Load your period sheet first.')` and return, instead of opening a form with an empty date dropdown.
- Helper text next to the button changes from *"Use for trips not listed in
  the sheet above"* to *"Pick any date from your loaded period sheet"* — the
  old copy is no longer accurate since the date is now constrained to sheet
  dates, not free-form.

## 6. Validation fix — `submitClaim()`

Current (stale) guard:
```js
if (!dateVal || (claimType !== 'company-service' && !amount)) {
  alert('Date and amount are required.');
  return;
}
```
This references a `'company-service'` claim **type** that has no live UI
trigger (dead code from an earlier, never-fully-shipped plan) — and as
written it would incorrectly block a Company-Service **mode** fare claim,
since that claim's `type` is `'special-fare'` and its amount is intentionally
`0` (falsy).

Replacement:
```js
var mode = document.getElementById('cl-mode').value;
if (!dateVal) { alert('Date is required.'); return; }
if (claimType === 'special-fare' && !mode) { alert('Please select a vehicle/mode.'); return; }
var amountRequired = !(claimType === 'special-fare' && mode === 'Company Service');
if (amountRequired && (isNaN(amount) || amount <= 0)) { alert('Amount is required.'); return; }
if (isNaN(amount)) amount = 0;
```
(Accommodation claims are untouched by this — they still always require a
positive amount, same as today.)

## Data flow / what gets written to `Claims`

No `Claims` sheet schema changes. A Company Service claim is just a normal
`special-fare` row with `vehicle_mode: 'Company Service'` and
`claimed_amount: 0` — it flows through the existing submit → admin
approval-queue → `handleApproveClaim` path unchanged, and shows up in
`renderPeriodSheet`'s FARE CLAIM column exactly like any other special-fare
claim (Pending badge → Approved badge, or a fresh "+ Fare" button if none
exists yet for that date).

## Out of scope / explicitly not doing

- Not deleting `computeFare`/`buildAutoFareClaim`/`getRoadDistanceKm`/
  `LTFRBRates` sheet usage — left dormant per admin instruction.
- Not removing the admin Period Sheets tab's "AUTO FARE" column (will just
  always show ₱0.00).
- Not adding a receipt requirement for any mode — all three are exempt, so
  the Receipt Photo field is simply hidden for the whole fare-claim form,
  not conditionally per-mode.
- Not touching `admin.html` — it already displays `vehicle_mode` and
  `claimed_amount` generically, so a "Company Service" / ₱0.00 row needs no
  admin-side changes.

## Testing plan (manual, local — PowerShell + browser)

1. Load `index.html` locally (or against the deployed backend read-only),
   log in as a real employee with a loaded period sheet.
2. Click "+ Fare" on a specific row → confirm the Date select shows only
   that row's date and is disabled/locked.
3. Click "+ Add Claim for Another Day" → confirm it lists every date in the
   loaded sheet, and that clicking it before Load shows the new alert.
4. Select "Jeepney"/"Tricycle" → confirm Receipt Photo field is hidden,
   Amount is enabled and required (blocks submit at 0 or blank).
5. Select "Company Service" → confirm Amount snaps to `0` and becomes
   read-only, submit succeeds with amount 0, Receipt Photo stays hidden.
6. Submit an Accommodation claim → confirm Receipt Photo field is still
   shown (unaffected) and Amount is still required.
7. Reload the period sheet after each submit → confirm the new claim
   appears in `claim_details` / FARE CLAIM column as before (Pending badge).
8. Confirm the My Sheet "FARE AMT" column no longer includes any
   auto-computed jeepney fare (should equal only submitted special-fare
   claims' amounts).
