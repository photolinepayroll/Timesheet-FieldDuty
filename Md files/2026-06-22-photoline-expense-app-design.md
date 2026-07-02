# Photoline Expense App — Design Spec

**Date:** 2026-06-22
**Status:** Final (approved for implementation planning)

---

## 1. Problem

Photoline has ~100 field employees nationwide who currently fill out a **paper
timesheet** (see sample: Shaira Mae Mendoza, Area Head, Operations). Each day on
that paper records: date, branch/destination, time IN/OUT with handwritten
signatures, breaktime, undertime/half-day (UT/HD), overtime (OT), offset, and a
**FARE** section (FROM → TO → AMT), mode of transport, MEAL, and accommodation
(ACCOM).

Because the times and money amounts are **handwritten after the fact with no data
to check them against**, the sheet is slow to process and easy to manipulate.
This is the admin's bottleneck.

An existing **attendance web app** (static PWA on GitHub Pages, backed by Google
Apps Script + Google Sheets) already solves the *timekeeping* half: employees
clock IN/OUT live with a **selfie + GPS + destination**, so times can no longer
be back-written. What's missing is the *money* half — fares, OT, accommodation,
meal — and a computed period sheet to replace the paper.

---

## 2. Goal

Build a **second, separate web app** that reads the attendance app's existing
data and handles the money side: fares (auto-computed nationwide using LTFRB
formula), meal allowance (auto-computed by position level × destination area),
accommodation (fixed by level × area, no hotel receipt required), OT/offset
(derived from clock times), midnight allowance (derived from clock-out time) —
with a light approval step only for special/variable claims.

Output: a **per-employee, per-period sheet** computed from live data that
replaces the manual paper timesheet entirely.

---

## 3. Scope

### In scope
- Reading attendance/time-log data from the existing app (read-only, via CSV).
- Auto-computing normal public-transport fares (GPS distance × LTFRB formula).
- Auto-computing meal allowance (position level × destination area table).
- Auto-computing accommodation allowance (position level × destination area
  table, no hotel receipt needed — fixed by table).
- Auto-computing midnight allowance from clock-out time brackets.
- OT / offset / undertime / half-day derived from actual clock IN/OUT times.
- Special trip / special pay claims (variable, receipt + single approval).
- A single-approver workflow (any one of the heads available).
- Admin setup: position levels, employee profiles (level + mother branch + OT
  type), meal/accommodation rate table, LTFRB rate config.
- Per-employee, per-period sheet (mirrors paper layout, computed).

### Out of scope (explicitly)
- **Any change to the existing attendance app.** Untouched.
- Payroll disbursement / actual payment of money.
- A native mobile app (web app only).
- Multi-step approval chains (one approver decided).
- Student/senior/PWD fare discounts.
- Hotel accommodation with receipt (accommodation is fixed-table, no receipt).

---

## 4. Two-app architecture

```
┌──────────────────────────┐         ┌──────────────────────────────────┐
│  ATTENDANCE APP (exists)  │         │    EXPENSE APP (this project)     │
│  - clock IN/OUT           │  CSV    │  - reads time logs (read-only)   │
│  - selfie + GPS           │ ──────► │  - auto: fare, meal, accom,      │
│  - destination            │  only   │    midnight allow, OT/offset/UT  │
│  - writes to Google Sheet │         │  - approval: special trips only  │
└──────────────────────────┘         │  - period sheet output            │
        (untouched)                  │  - admin: setup tables + levels   │
                                     └──────────────────────────────────┘
                                        (Google Sheets + Apps Script)
```

**Connection:** The attendance app publishes its Google Sheet as a public CSV
export URL (already used by its own admin page). The expense app reads that same
CSV — every attendance record (employee name, destination, IN/OUT, timestamp,
GPS lat/lng). Zero change to the attendance app.

**Tech stack:** Google Sheets + Google Apps Script, static front-end on GitHub
Pages. Free, proven in this org, correct for ~100 employees × ~20 days/period
(~5,000 rows/period — well within Sheets limits). The expense app has its own
separate Google Sheet for its data (employee profiles, rate tables, claims,
approvals).

---

## 5. Employee profile & setup (admin-only, done once per employee)

The admin tags each employee once at registration. These tags drive all
auto-computations:

| Field | Values | Purpose |
|-------|--------|---------|
| Name | text | Links to attendance CSV records |
| Department | text | Grouping |
| Mother Branch | branch name | Home base — no allowances apply here |
| Position Level | Level 1 / Level 2 / Level 3 (or more) | Selects meal & accom rate row |
| OT Type | FOR BAWI / DECLARED OT | Determines if overtime is offset or paid |
| Role | Employee / Head | Controls who can approve claims |

Admin sets these. Employees cannot change them.

---

## 6. Allowance auto-computation (the core)

All standard allowances are **auto-computed — no employee input, no receipt, no
approval.** The system reads clock times + destination + employee profile and
outputs the amounts. The employee cannot change them.

### 6a. Meal allowance

**Rule:** Only triggered if the employee worked **5 hours or more** at a
destination away from their Mother Branch that day. (Clock IN/OUT times from
attendance app give the hours worked — computed automatically.)

**Amount:** Looked up from the **Meal Rate Table** (admin-editable):

```
Meal Rate Table: Position Level × Destination Area → ₱ amount
```

Example (admin fills in actual amounts):

| Area | Level 1 | Level 2 | Level 3 |
|------|---------|---------|---------|
| NCR | ₱75 | ₱75 | ₱75 |
| Pampanga Area | ₱100 | ₱150 | ₱150 |
| Dagupan Area | ₱100 | ₱150 | ₱150 |
| Cavite Area | ₱100 | ₱100 | ₱100 |
| Bicol Area | ₱100 | ₱150 | ₱150 |
| VIZ/MIN Area | ₱150 | ₱200 | ₱300 |
| (etc.) | | | |

Admin maintains this table. Code only reads it.

**If at Mother Branch:** ₱0 (no allowance, regardless of hours).

### 6b. Accommodation allowance

**No hotel receipt required.** Fixed amount from table, same logic as meal.

**Rule:** Triggered when the employee is working at a destination away from
their Mother Branch (overnight implied by the nature of the trip — same
destination rules the paper uses).

**Amount:** Looked up from the **Accommodation Rate Table** (admin-editable):

```
Accommodation Rate Table: Position Level × Destination Area → ₱ amount (or ₱0)
```

Example (admin fills in actual amounts; dash = ₱0):

| Area | Level 1 | Level 2 | Level 3 |
|------|---------|---------|---------|
| NCR | ₱0 | ₱0 | ₱0 |
| Dagupan Area | ₱0 | ₱150 | ₱150 |
| Bicol Area | ₱150 | ₱150 | ₱200 |
| VIZ/MIN Area | ₱200 | ₱300 | ₱400 |
| (etc.) | | | |

**If at Mother Branch:** ₱0.

### 6c. Midnight allowance

Auto-computed from clock-out time (or clock-in for night shifts). No input
needed. Fixed brackets (admin-editable):

| Shift bracket | Allowance |
|---------------|-----------|
| 8:00 PM – 12:00 AM | ₱50 |
| 9:00 PM – 3:00 AM | ₱100 |
| 3:01 AM onwards | ₱150 |

### 6d. OT / Offset / Undertime

Derived from **actual clock IN/OUT times** vs. expected shift hours (admin-set
standard hours per day, e.g. 8 hours):

- **Extra hours worked** → checked against employee's OT Type:
  - **FOR BAWI** → logged as offset (to be used as leave, no additional pay)
  - **DECLARED OT** → logged as paid OT
- **Short hours** → logged as undertime (UT) or half-day (HD) per threshold

Exact thresholds (e.g. how many minutes = half-day vs. full undertime) to be
confirmed with admin before coding this task — parked in §10.

---

## 7. Fare logic

### 7a. Normal public transport — AUTO-COMPUTED, no receipt

- Attendance app captures **GPS at clock-in and clock-out** (already present).
- Expense app computes **distance in km** between the two GPS points using
  OpenStreetMap-based routing (OSRM — free, same OSM the attendance app already
  uses for geocoding).
- Applies the **LTFRB formula** (admin-editable config):

| Vehicle type | Base fare | Base covers | Per succeeding km |
|---|---|---|---|
| Traditional jeepney | ₱14.00 | first 4 km | ₱2.00 |
| Modern jeepney | ₱17.00 | first 4 km | ₱2.40 |
| Ordinary city bus | ₱15.00 | first 5 km | ₱2.49 |
| Aircon city bus | ₱18.00 | first 5 km | ₱2.98 |

  `Fare = base + max(0, distance_km − base_km) × per_km`

  Employee selects vehicle type (sets which formula row). Works **nationwide**
  — no per-route table needed, essential for 100 employees across the country.

- **No receipt required.** GPS confirms the trip happened; formula sets the
  amount.
- **Fraud guard:** if claimed fare exceeds expected (beyond admin-set tolerance
  %) or GPS doesn't match stated destination → auto-flagged → routed to
  approval.

> Note: LTFRB publishes a formula, not a per-route list. Verified during
> brainstorming. Admin updates only the 4 formula rows when government changes
> fares (e.g. the March 19, 2026 fare order above, which is provisional and will
> change again).

### 7b. Special trip / special pay — CLAIM + APPROVAL

- Variable amounts (van hire, taxi, extraordinary trip).
- Employee enters amount + uploads receipt or written justification.
- Routed to approval (§8).

---

## 8. Approval workflow

- **One approval only.** Any one of the three heads (Branch/Area Head or
  Audit/Senior Head) — whoever is available. Not a chain.
- **What needs approval:** special trip fares (§7b), and any auto-computed fare
  flagged by the fraud guard.
- **What does NOT need approval:** auto-computed fares (§7a), meal allowance,
  accommodation allowance, midnight allowance, OT/offset/UT. These are system-
  computed from tables the admin controls — no human sign-off needed per
  transaction.
- Implemented as a **status column** per claim record:
  `Submitted → Approved (by <name>) → Posted`
- A **users/roles table** in the Sheet controls who can approve. Employees
  cannot approve their own claims.

---

## 9. Output: the period sheet

Reproduces the paper timesheet layout, computed:

| DATE | BRANCH | IN | OUT | BREAKTIME | UT/HD | OT | OFFSET | FARE FROM→TO→AMT | MODE | MEAL | ACCOM | MIDNIGHT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

- Every value is computed from live attendance data or from the admin-controlled
  rate tables.
- Per-employee, per-period (admin selects date range).
- Exportable to CSV and printable.
- This is the artifact that replaces the manipulable paper sheet.

---

## 10. Data model (expense app's own Google Sheet — separate from attendance)

**Sheet: Users**
`name | department | mother_branch | position_level | ot_type | role | active`

**Sheet: MealRates**
`area | level_1 | level_2 | level_3` (admin fills amounts; add more level
columns if needed)

**Sheet: AccomRates**
`area | level_1 | level_2 | level_3`

**Sheet: MidnightRates**
`label | from_time | to_time | amount` (the 3 brackets)

**Sheet: LTFRBRates**
`vehicle_type | base_fare | base_km | per_km` (4 rows; admin updates on fare
hike)

**Sheet: Claims**
`id | employee | date | period | type | from | to | vehicle_mode |
computed_amount | claimed_amount | receipt_image_url | gps_check | status |
approver | approved_at | notes`

**Sheet: Config**
`key | value` (standard_hours_per_day, tolerance_pct, current_period_start,
current_period_end, attendance_csv_url, admin_password)

Attendance/time data is **never duplicated** — always read live from the
attendance app's CSV.

---

## 11. Key decisions (all locked)

1. Two separate apps. Attendance app untouched. ✔
2. Connection via existing CSV export. No change to attendance app. ✔
3. Google Sheets + Apps Script + GitHub Pages. Free. ✔
4. Fares auto-computed: GPS distance × LTFRB formula. Nationwide. ✔
5. Meal allowance: auto, fixed table, position level × area, 5-hour rule. ✔
6. Accommodation: auto, fixed table, position level × area, NO receipt. ✔
7. Midnight allowance: auto, 3 fixed brackets from clock-out time. ✔
8. OT type per employee (FOR BAWI vs DECLARED OT) set by admin once. ✔
9. Special trips only = claim + receipt + single approval. ✔
10. One approver, any available head. ✔
11. Admin tags position level per employee once at registration. ✔
12. Period sheet reproduces paper layout, computed. ✔

---

## 12. Open items — confirm with admin before coding relevant tasks

These do not block starting. Pin down before the task that uses each one:

- **OT/UT thresholds:** exact minutes for half-day vs. undertime vs. full OT
  (e.g. "more than 30 min early out = UT"); standard hours per day per role.
- **Accommodation trigger:** exact rule for when accommodation applies (just
  "not at mother branch"? or "more than X km away"? or overnight only?).
- **Round-trip handling:** does each leg (Terminal→Dest, Dest→Terminal) generate
  a separate fare row like on the paper, or is it one round-trip total?
- **Fare rounding:** nearest peso? round up always?
- **Fraud guard tolerance:** what % over expected fare triggers a flag?
- **Period definition:** cut-off dates (paper shows May 26 – June 10; is this
  always 1st–15th and 16th–end-of-month, or ad hoc)?
- **Authentication:** hardcoded password like attendance admin, or per-user
  login given approval roles? (Recommendation: per-user PIN per head, stored
  in Users sheet, since approvers need to be identified by name.)
- **Areas list:** canonical list of area names (NCR, Pampanga, Dagupan, Cavite,
  Bicol, VIZ/MIN, etc.) that maps to both the rate tables and the destinations
  in the attendance app. Admin provides the master list.
