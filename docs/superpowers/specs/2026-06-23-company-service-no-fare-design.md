# Company Service (No Fare) Claim Type — Design

**Date:** 2026-06-23
**Status:** Approved (brainstormed with admin, all 3 sections confirmed)

---

## 1. Problem

The expense app auto-computes a fare for every day an employee clocks in/out
away from their mother branch, using GPS distance × the LTFRB formula. This
assumes the employee paid for their own public transport.

Some days, an employee is instead picked up by a **company service vehicle**
— they didn't pay for transport, so the auto-computed fare for that day is
wrong and shouldn't be paid out.

This varies day-to-day per employee (not a fixed per-employee setting), so
there needs to be a way to mark *specific dates* as "company service, no
fare" — with the same trust model as other variable claims: the employee
declares it, a head approves it before it takes effect.

## 2. Scope

**In scope:**
- A new claim type, "Company Service (No Fare)", submitted by the employee
  for a specific date via the existing claim form.
- Approval by a head via the existing Approve Claims queue — no new
  approval mechanism.
- Once approved, the auto-computed fare for that exact date is suppressed
  (set to ₱0) when the period sheet is generated.

**Out of scope (explicitly):**
- Does NOT affect meal, accommodation, midnight allowance, or OT/UT for that
  date — those are independent of how the employee got to the destination.
- Does NOT touch any separately-submitted special-fare claim for the same
  date — those are a different, independent claim type; both can coexist if
  the employee genuinely has both (e.g. company service for the morning,
  but paid for a side trip later the same day with a separate special-fare
  claim).
- Does NOT retroactively affect already-approved claims of other types.
- No new Sheet tab, no new approval workflow, no per-employee default
  setting.

## 3. Design

### 3.1 Data model — reuse `Claims`, no schema changes

The existing `Claims` sheet already has a free-form `type` column (currently
holding `'special-fare'` and `'accommodation'` for employee-submitted claims,
plus `'auto-fare'` for system-generated rows). Add a third employee-submittable
value: **`'company-service'`**.

No new columns, no new sheet. A company-service claim row looks like any
other Claims row, with `claimed_amount` left at `0`/blank (see 3.2) and
`from_loc`/`to_loc`/`vehicle_mode`/`notes` available but not required.

### 3.2 UI — `index.html` claim form

Add a third `<option>` to the existing `#cl-type` dropdown:

```html
<option value="special-fare">Special Trip / Special Pay</option>
<option value="accommodation">Accommodation</option>
<option value="company-service">Company Service (No Fare)</option>
```

When `company-service` is selected, the **Amount field becomes optional**.
Concretely, in `submitClaim()`:
- The required-field check becomes
  `if (!dateVal || (type !== 'company-service' && !amount)) { ...; return; }`
  — Amount is only mandatory for the other two types.
- `parseFloat('')` on an empty Amount field is `NaN`, which must not be sent
  as `claimed_amount` (NaN doesn't serialize meaningfully through
  `JSON.stringify`/back through `parseFloat` server-side). Explicitly
  normalize it: `claimed_amount: isNaN(amount) ? 0 : amount`.

This is the only behavior change to `submitClaim()`.

No changes needed to `handleSaveClaim` (Code.gs) — it already maps whatever
fields are present to the sheet's columns generically, type-agnostic.

### 3.3 Approval — `admin.html` Approve Claims tab

No changes. `loadClaims()`/`handleGetClaims()` already render claims
generically regardless of `type`; a company-service claim will appear in the
pending queue with `₱0` in the Computed/Claimed columns, which is correct
and requires no special-case rendering. Approve/Reject works identically to
existing claim types.

### 3.4 Period sheet computation — `Code.gs`, `handleGetPeriodSheet`

In the existing per-day loop, alongside the existing `specialClaims`/
`daySpecial` lookup (which already filters approved claims by employee +
date), add an equivalent check for an approved company-service claim on that
exact date. If found, skip the `buildAutoFareClaim` call entirely (saves an
unnecessary OSRM network call) and set `auto_fare = 0` for that row — exactly
the same outcome as today's "missing GPS data" path, just for a different
reason.

Everything else in that day's row (`meal`, `accom`, `midnight`, `ot_hours`,
etc.) is computed exactly as it is today — untouched by this check.

Pseudocode sketch (final implementation may structure the lookup slightly
differently to match existing code style):

```javascript
var hasCompanyService = allClaims.some(function(c) {
  return c['employee_name'] === payload.employee_name &&
         c['status'] === 'Approved' &&
         c['type'] === 'company-service' &&
         c['date'] === date;
});

var autoFare = 0;
if (!hasCompanyService && emp['mother_branch'] !== destination) {
  var claimResult = buildAutoFareClaim(day, 'Traditional Jeepney', ...);
  autoFare = claimResult ? claimResult.computed_amount : 0;
}
```

A company-service claim that exists but is still `'Submitted'` (not yet
approved) has **no effect** — the auto-fare computes normally until a head
approves it, exactly matching how `special-fare`/`accommodation` claims only
count once approved.

## 4. Testing

- Submit a company-service claim for a date with no Amount entered → saves
  with `claimed_amount` = 0/blank, `status` = `'Submitted'`.
- Before approval: period sheet for that date shows the normal auto-computed
  fare (no effect yet).
- After head approves it: regenerate the period sheet → that date's
  `auto_fare` is `0`; `meal`/`accom`/`midnight`/`ot_hours` for that date are
  unchanged from before approval.
- A date with both an approved company-service claim AND a separate approved
  special-fare claim: `auto_fare` = 0, but `special_fare` still reflects the
  special-fare claim's amount (independent fields, both can be non-zero/zero
  in any combination).
