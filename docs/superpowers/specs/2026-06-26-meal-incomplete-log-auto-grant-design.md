# Meal Allowance — Incomplete-Log Auto-Grant + Admin Deny Override — Design

## Context

`computeMeal()` (`Code.gs`) currently requires `hoursWorked >= 5` before
granting any meal allowance. `hoursWorked` is computed as `(lastOut -
firstIn) / 3600000` and comes out to `0` in two distinct situations that
should be treated differently:

1. **Genuinely incomplete log** — only a Log In OR only a Log Out exists
   for that day (the employee forgot to log the other side, or the GPS
   attendance app failed to record it). This also includes a day that the
   existing 20-hour sanity cap (`Code.gs`, commit `7d63294f`) has nulled
   `lastOut` for — that cap already treats a stale, never-closed Log In
   (paired with an implausibly distant Log Out) identically to "no Log Out
   at all," so a capped day is indistinguishable from a genuinely-incomplete
   one by the time `computeMeal` would see it.
2. **Complete log, legitimately short visit** — both a Log In and Log Out
   exist, but the gap between them is under 5 hours (e.g. a 1.1-hour stop).
   The existing 5-hour rule is correct here and must not change.

The current code cannot distinguish these two cases — both produce
`hoursWorked: 0` and both currently block the meal allowance. This causes
real, incorrectly-zeroed meal allowances for employees whose attendance
logging is incomplete on a given day, even when they clearly worked away
from their mother branch.

## Goal

When a day's log is genuinely incomplete (case 1), auto-grant the meal
allowance regardless of the 5-hour computation — gated only on
`destination !== mother_branch` (the existing mother-branch rule still
applies; this feature does not bypass that). Case 2 (complete log, short
visit) keeps the current 5-hour rule completely unchanged.

Because auto-granting removes a manual gate, give the admin a manual
override: a per-row "Deny meal" / "Allow meal" toggle in the Period Sheet
view, available on **any** row where `meal > 0` — not just incomplete-log
rows, since the admin may want to deny a normally-qualified day too. The
toggle must be reversible (deny, then allow again).

Accommodation is explicitly out of scope — no rule change there. It
already has no hours threshold, only the mother-branch check.

## Architecture

### 1. New `MealDenials` Sheet tab

Schema: `employee_name | date | denied_by | denied_at`

One row = one denied day for one employee. Toggling "Deny" appends a row;
toggling "Allow" (on an already-denied day) removes that row. This follows
the project's established pattern of keeping business-tunable/admin-action
data in a Sheet rather than in code (`MidnightRates`, `LTFRBRates`,
`EmployeeRates`, `AreaCenters` precedent).

`date` is stored and compared via the existing `claimDateKey()` convention
used elsewhere in `Code.gs` (`'YYYY-MM-DD'` string), avoiding the
Sheets-auto-converts-dates trap already documented in this codebase.

### 2. `Code.gs` changes

**`handleGetPeriodSheet`'s per-day loop:** capture whether the day's log
was genuinely complete via `var logComplete = !!(firstIn && lastOut);`,
evaluated at the SAME point `hoursWorked` is computed — i.e. **after** the
20-hour sanity cap has had a chance to null `lastOut`. Because the cap
nulls the local `lastOut` variable (not `day.out_record`), using `firstIn`/
`lastOut` (not the raw `day.in_record`/`day.out_record`) means a
cap-nulled day naturally reports `logComplete = false`, identical to a
day with no Log Out at all — exactly the confirmed behavior (a
20-hour-capped day qualifies for the auto-grant) falls out of this for
free, with no separate cap-awareness logic needed.

**`computeMeal` signature change:** add a `logComplete` parameter:
```javascript
function computeMeal(employeeName, department, destinationArea, hoursWorked, motherBranch, destination, logComplete) {
  if (destination === motherBranch) return 0;
  if (logComplete && hoursWorked < 5) return 0; // 5-hour rule only applies to complete logs
  var row = resolveEmployeeRate(employeeName, department, destinationArea);
  if (!row) return 0;
  return parseFloat(row['meal_amount'] || 0);
}
```
When `logComplete` is `false`, the 5-hour check is skipped entirely — the
day still needs a resolvable `EmployeeRates` row (via substring match or
GPS fallback, unchanged) to get a non-zero amount, same as today.

**Denial check:** after computing `meal` in the per-day loop, look up
`MealDenials` for `(employee_name, date)` and force `meal = 0` if a denial
row exists — applied AFTER the auto-grant logic, so it can suppress any
`meal > 0` result regardless of why it was granted.

**New `doPost` action `toggleMealDenial`:** payload `{ employee_name, date,
approver_name }`. Checks `MealDenials` for an existing
`(employee_name, date)` row — if found, deletes it (un-deny); if not found,
appends one with `denied_by = approver_name`, `denied_at = ISO timestamp`.
Returns the new state (`'denied'` or `'allowed'`) so the caller can update
its button label without a full re-fetch.

### 3. `admin.html` changes

Add a "Deny meal" / "Allow meal" button to every Period Sheet row where
`meal > 0`, rendered via the shared `renderPeriodSheet` in `app.js` (the
function already shared by `admin.html` and `index.html` — but this button
is admin-only, so it must be conditionally rendered based on the viewer's
role, not added unconditionally to the shared renderer). Clicking it calls
`toggleMealDenial` then re-renders the period sheet to reflect the new
state.

## Testing approach

No test framework in this project — verification is live API calls against
the deployed Web App, same as every other change this session:
1. A genuinely incomplete day (one-sided log) for a real employee away from
   mother branch: confirm `meal > 0` after this change where it was `0`
   before.
2. A complete-log, short-visit day (e.g. 1.1 hours): confirm `meal` stays
   `0` — unaffected by this change.
3. A 20-hour-capped day: confirm it now also auto-grants `meal` (this is
   the explicitly-confirmed extension of the rule).
4. Toggle deny on an auto-granted day, re-fetch the period sheet, confirm
   `meal` is now `0`. Toggle allow again, confirm it returns to its granted
   amount.
5. Confirm `accom` is unaffected by every scenario above.
