# Meal Allowance Auto-Grant for Incomplete Logs + Admin Deny Override — Design

**Date:** 2026-06-25
**Status:** Approved (brainstormed with admin, design confirmed)

---

## 1. Problem

`computeMeal()` requires `hoursWorked >= 5`, computed as
`(lastOut - firstIn) / 3600000`. This is `0` (and thus blocks the meal
allowance) in two different situations that should be treated differently:

1. **Genuinely incomplete log** — only a Log In OR only a Log Out exists for
   that day (employee forgot to log the other side, or the GPS app failed,
   or the existing 20-hour sanity cap nulled `lastOut` for a stale-pairing
   day). `hoursWorked` is `0` here not because the visit was short, but
   because there's no real duration to compute.
2. **Complete log, short visit** — both Log In and Log Out exist, but the
   employee was at the destination for, say, 1.1 hours. `hoursWorked` is
   correctly low, and the 5-hour rule correctly should still block the meal.

Today both cases produce identical `meal: 0` output, with no way to
distinguish them or for the admin to override either case manually.

## 2. Scope

**In scope:**
- Case 1 (genuinely incomplete log, including 20-hour-cap-nulled days)
  auto-grants meal, bypassing the 5-hour rule, as long as
  `destination !== mother_branch`.
- Case 2 (complete log, short visit) keeps the existing 5-hour rule
  unchanged.
- Admin manual override: a reversible Allow/Deny toggle on every Period
  Sheet row where `meal > 0`, regardless of which rule granted it.

**Out of scope (explicitly):**
- Accommodation — no rule change, no hours threshold today, none added.
- Fare, midnight allowance — untouched.
- Any change to the 20-hour sanity cap's own behavior (commit `7d63294f`) —
  this design only consumes its existing output (a nulled `lastOut`), it
  does not change when or how the cap fires.

## 3. Design

### 3.1 Data model — new `MealDenials` Sheet tab

New tab, columns: `employee_name | date | denied_by | denied_at`.

One row = one denied day. A row's presence for `(employee_name, date)`
means that day's meal is forced to `0`, regardless of which rule (5-hour or
auto-grant) computed a non-zero value. Toggling "Deny" adds a row;
toggling "Allow" again removes it — this is a presence/absence flag, not a
status column, consistent with this project's "business-tunable data lives
in a Sheet, not in code" convention (`MidnightRates`/`LTFRBRates`/
`EmployeeRates`/`AreaCenters` precedent).

### 3.2 `Code.gs` — `handleGetPeriodSheet` / `computeMeal`

Compute the flag from the existing `firstIn`/`lastOut` locals **after** the
20-hour sanity cap has already run (the cap nulls the local `lastOut`
variable, not `day.out_record`):

```javascript
var wasLogComplete = !!(firstIn && lastOut); // AFTER the 20-hour cap
```

This must be captured post-cap, not from the raw `day.in_record`/
`day.out_record` presence. A cap-nulled day still has both raw records
present (the records exist; it's the 20-hour *gap* between them that's the
problem) — so checking raw record presence would put cap-nulled days in
the same bucket as a genuinely short, complete visit (case 2), which
contradicts the confirmed decision that cap-nulled days auto-grant exactly
like a missing Log Out. Reusing the already-capped `lastOut` local gets
this right for free: it's `null` for "no Log Out", "no Log In", AND
"capped" alike — exactly the three situations that should auto-grant.

Pass `wasLogComplete` into `computeMeal` as a new parameter. New logic:

```javascript
function computeMeal(hoursWorked, destination, motherBranch, wasLogComplete) {
  if (destination === motherBranch) return 0;
  if (!wasLogComplete) return MEAL_AMOUNT; // case 1: auto-grant
  if (hoursWorked >= 5) return MEAL_AMOUNT; // case 2: existing rule
  return 0;
}
```

(Exact constant/lookup for `MEAL_AMOUNT` matches whatever `computeMeal`
already uses today — no change to the amount itself, only to the
eligibility branching.)

After `meal` is computed for a row, check `MealDenials` for a matching
`(employee_name, date)` row. If found, force `meal = 0` for that row,
overriding either rule above.

### 3.3 New `doPost` action — `toggleMealDenial`

Request: `{ action: 'toggleMealDenial', employee_name, date, denied_by }`.

Behavior: if a `MealDenials` row exists for `(employee_name, date)`, delete
it (un-deny). If not, append one with `denied_by` and `denied_at` (server
timestamp). Idempotent toggle. Response: `{ denied: true/false }` (informational
only — see 3.4 for why the client always re-fetches rather than patching the
row in place).

### 3.4 `admin.html` — Period Sheet view

On every rendered row where `meal > 0`, add an Allow/Deny button:
- Label reflects current state: "Deny Meal" if currently allowed, "Allow
  Meal" if currently denied (requires the period-sheet response to include
  the per-row denial state — `handleGetPeriodSheet` adds a `meal_denied:
  true/false` field per row alongside the existing `meal` field).
- Clicking calls `toggleMealDenial`, then re-fetches the period sheet
  (`getPeriodSheet`) and re-renders. The client never knows the would-be
  `meal` amount for an un-denied row on its own (that value isn't sent down
  when a row is currently denied), so an optimistic in-place patch isn't
  possible — a full re-fetch is simplest and correct in both directions.
- Button appears when `meal > 0` OR `meal_denied` is `true`. The second
  condition is required because once a row is denied, the server forces
  its displayed `meal` to `0` — without checking `meal_denied` too, the
  button would disappear on deny and the admin could never re-allow it. A
  row with `meal === 0` and `meal_denied === false` (blocked by either
  rule, never denied) has nothing to toggle and shows no button.

## 4. Testing

- Genuinely incomplete log (Log In only, no Log Out, destination ≠ mother
  branch): `meal` shows the full meal amount even though `hoursWorked` is
  `0`.
- Complete log, 1.1-hour visit, destination ≠ mother branch: `meal` shows
  `0` — case 2 unaffected, 5-hour rule still applies.
- Day nulled by the 20-hour sanity cap (stale Log-In/distant Log-Out
  mispair): treated identically to "Log In only" — auto-grants meal.
- Admin clicks "Deny Meal" on an auto-granted row: `meal` becomes `0`,
  button now reads "Allow Meal".
- Admin clicks "Allow Meal" again on that same row: `meal` reverts to its
  previously-computed non-zero value, button reads "Deny Meal" again.
- A row with `meal === 0` (either rule legitimately blocking it, not
  denied): no toggle button rendered.
- A denied row (`meal === 0`, `meal_denied === true`): toggle button IS
  still rendered (reading "Allow Meal"), so the admin can reverse the
  denial.
- Accommodation, fare, and midnight allowance values are unchanged across
  all of the above scenarios.
