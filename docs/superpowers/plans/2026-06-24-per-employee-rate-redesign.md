# Per-Employee Meal/Accommodation Rate Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

The Photoline Expense App (already built, deployed, and live-tested in an
earlier session) currently computes meal and accommodation allowance using a
single shared `MealRates`/`AccomRates` table keyed by `area` + a generic
`level_1`/`level_2`/`level_3` position-level band. This was the original
design's assumption (`Md files/2026-06-22-photoline-expense-app-design.md`
§6a/6b).

The admin supplied 7 real PDFs of the company's actual historical meal/
accommodation rate sheets (Excel exports). Analysis of these PDFs showed the
real-world process does **not** use a level-banded shared table at all — it
assigns **one specific meal amount and one specific accommodation amount per
(employee, destination area) pair**, individually, with no generic level
abstraction. Two real departments ("Audit Dept.", "Carpenter Dept.") have no
individually-named employees at all — just one shared rate list for everyone
in that department, which the new design must support as a fallback.

Two adjacent concepts found in the real data are explicitly **out of scope**,
confirmed with the admin:
- A flat **monthly ATM cash allowance** for the "Area Head" tier (PDF7) —
  handled by a separate HR/payroll process, not this app.
- A **hotel-booking cost reference table** (PDF6: nightly rates + contact
  numbers per area) — an offline admin reference document, not something the
  app computes or stores.

The admin confirmed PDF7 ("Area Heads" roster, shown to me as a screenshot)
is the current/authoritative source for that group's meal/accommodation
rates. For the remaining two groups (Technical/ComTech/Audit/Carpenter
depts; Visayas/Mindanao rank-and-file), the admin will resolve any data
conflicts themselves before the bulk-seed step (Task 5) — this plan does not
need to adjudicate those.

**Goal:** Replace the level-banded shared rate table with a per-employee
(with department-level fallback) rate table, update all call sites, give the
admin a usable editing UI at the new row volume (~50+ employees × 5-8 areas
each), and get the real data seeded.

**Architecture:** One new Sheet tab (`EmployeeRates`) replaces both
`MealRates` and `AccomRates`. A new `resolveEmployeeRate()` helper in
`Code.gs` does employee-specific lookup with department-fallback; `admin.html`
gets an employee-grouped accordion editor (not a flat table, which doesn't
scale to this row count) reusing the existing generic row-rendering/save
plumbing. Real data gets bulk-imported via a one-time Apps Script function
call rather than 300+ rows of manual UI entry.

**Tech Stack:** Same as the rest of the app — Google Apps Script ES5
(`Code.gs`), vanilla HTML/JS (`admin.html`). No build step, no test
framework — verify via live API calls against the already-deployed Web App
(this project has a real deployment, see `Resume.md`).

---

## Task 1: Add `EmployeeRates` sheet tab and scratch import tab

**Files:**
- Modify: `SETUP.md`

- [ ] **Step 1: Create the `EmployeeRates` tab in the live Google Sheet** (manual)

  Header row:
  ```
  employee_name | department | area | meal_amount | accom_amount
  ```
  Row semantics:
  - **Employee-specific row**: `employee_name` filled (exact match to `Users.name`), `department` blank. Checked first.
  - **Department-fallback row**: `employee_name` blank, `department` filled (exact match to `Users.department`). Used only when no employee-specific row matches for that area.
  - A row must have exactly one of the two non-blank — never both, never neither.
  - `area` uses the same free-text substring-match convention as today (e.g. `"NCR Area"`, `"Dagupan Area"`).
  - `meal_amount`/`accom_amount` are plain numbers, either can be `0`.

  Leave data rows empty — seeded in Task 5.

- [ ] **Step 2: Create the `RawRateImport` scratch tab** (manual)

  Same header row as `EmployeeRates`. This is where the admin pastes
  resolved real data before the one-time import script (Task 5) copies it
  over.

- [ ] **Step 3: Update `SETUP.md`**

  Add a `### Tab: EmployeeRates` section (model it on the existing
  `### Tab: MealRates` section) documenting the 5-column schema and the
  employee-row-vs-department-row convention above. Add a note above the
  existing `### Tab: MealRates`/`### Tab: AccomRates` sections marking them
  **deprecated — superseded by EmployeeRates, kept only until cutover is
  verified (see Task 4)**.

- [ ] **Step 4: Commit**

  ```bash
  git add SETUP.md
  git commit -m "docs: document EmployeeRates schema, deprecate MealRates/AccomRates"
  ```

---

## Task 2: `Code.gs` — replace level-banded rate lookup with employee/department resolver

**Files:**
- Modify: `Code.gs:153-161` (`handleGetRates`)
- Modify: `Code.gs:163` (`RATE_SHEET_NAMES`)
- Modify: `Code.gs:269-286` (`computeMeal`/`computeAccom`)
- Modify: `Code.gs:519-570` (`handleGetPeriodSheet` — area resolution + call sites)

(Line numbers verified against the current file as of this plan's writing.)

- [ ] **Step 1: Replace `computeMeal`/`computeAccom` with a shared resolver**

  Replace the two functions currently at `Code.gs:269-286`:
  ```javascript
  function computeMeal(employeeLevel, destinationArea, hoursWorked, motherBranch, destination) {
    if (destination === motherBranch) return 0;
    if (hoursWorked < 5) return 0;
    var rates = sheetToObjects('MealRates');
    var row = rates.filter(function(r) { return r['area'] === destinationArea; })[0];
    if (!row) return 0;
    return parseFloat(row[employeeLevel] || 0);
  }

  function computeAccom(employeeLevel, destinationArea, motherBranch, destination) {
    if (destination === motherBranch) return 0;
    var rates = sheetToObjects('AccomRates');
    var row = rates.filter(function(r) { return r['area'] === destinationArea; })[0];
    if (!row) return 0;
    return parseFloat(row[employeeLevel] || 0);
  }
  ```

  With:
  ```javascript
  // Resolves the EmployeeRates row for this employee+area: an employee-specific
  // row (employee_name matches, department blank) always wins over a
  // department-wide fallback row (employee_name blank, department matches) for
  // the same area. Returns null if neither exists.
  function resolveEmployeeRate(employeeName, department, destinationArea) {
    var rates = sheetToObjects('EmployeeRates');
    var empRow = rates.filter(function(r) {
      return r['employee_name'] === employeeName && r['area'] === destinationArea;
    })[0];
    if (empRow) return empRow;
    var deptRow = rates.filter(function(r) {
      return (!r['employee_name'] || r['employee_name'] === '') &&
             r['department'] === department && r['area'] === destinationArea;
    })[0];
    return deptRow || null;
  }

  function computeMeal(employeeName, department, destinationArea, hoursWorked, motherBranch, destination) {
    // Rule: no meal at mother branch; 5+ hours required
    if (destination === motherBranch) return 0;
    if (hoursWorked < 5) return 0;
    var row = resolveEmployeeRate(employeeName, department, destinationArea);
    if (!row) return 0;
    return parseFloat(row['meal_amount'] || 0);
  }

  function computeAccom(employeeName, department, destinationArea, motherBranch, destination) {
    // No accommodation at mother branch
    if (destination === motherBranch) return 0;
    var row = resolveEmployeeRate(employeeName, department, destinationArea);
    if (!row) return 0;
    return parseFloat(row['accom_amount'] || 0);
  }
  ```

  `position_level` stays in `Users` (unused by rates now, but nothing else
  currently consumes it, so leaving it is harmless — don't remove the column).

- [ ] **Step 2: Update area resolution and hoist it out of the per-day loop**

  In `handleGetPeriodSheet`, immediately after the existing employee profile
  lookup (`Code.gs:519-522`):
  ```javascript
  // Get employee profile
  var users = sheetToObjects('Users');
  var emp = users.filter(function(u) { return u['name'] === payload.employee_name; })[0];
  if (!emp) throw new Error('Employee not found: ' + payload.employee_name);
  ```

  Add (before the `// Get approved special claims` block):
  ```javascript

  // Candidate area rows for THIS employee: their own employee-specific rows
  // plus their department's fallback rows. Scoped per-employee (not the
  // whole EmployeeRates table) because different employees/departments can
  // use differently-named areas — a global lookup would risk matching
  // against some other employee's area name.
  var allEmployeeRates = sheetToObjects('EmployeeRates');
  var candidateAreaRows = allEmployeeRates.filter(function(r) {
    return r['employee_name'] === payload.employee_name ||
           ((!r['employee_name'] || r['employee_name'] === '') && r['department'] === emp['department']);
  });
  ```

  Then replace the per-day loop's area-resolution block, currently at
  `Code.gs:558-564`:
  ```javascript
    var mealRates = sheetToObjects('MealRates');
    var destinationArea = destination; // default fallback
    mealRates.forEach(function(r) {
      if (destination.toLowerCase().indexOf(r['area'].toLowerCase()) !== -1) {
        destinationArea = r['area'];
      }
    });
  ```

  With:
  ```javascript
    var destinationArea = destination; // default fallback
    candidateAreaRows.forEach(function(r) {
      if (destination.toLowerCase().indexOf(r['area'].toLowerCase()) !== -1) {
        destinationArea = r['area'];
      }
    });
  ```

  (This moves the `EmployeeRates` read and per-employee filter outside the
  loop — computed once per request instead of once per day.)

- [ ] **Step 3: Update the `computeMeal`/`computeAccom` call sites**

  Currently at `Code.gs:566-570`:
  ```javascript
    var otResult = computeOT(hoursWorked, emp['ot_type']);
    var meal     = computeMeal(emp['position_level'], destinationArea, hoursWorked,
                               emp['mother_branch'], destination);
    var accom    = computeAccom(emp['position_level'], destinationArea,
                                emp['mother_branch'], destination);
    var midnight = computeMidnight(lastOut);
  ```

  Replace the `meal`/`accom` lines:
  ```javascript
    var otResult = computeOT(hoursWorked, emp['ot_type']);
    var meal     = computeMeal(payload.employee_name, emp['department'], destinationArea,
                               hoursWorked, emp['mother_branch'], destination);
    var accom    = computeAccom(payload.employee_name, emp['department'], destinationArea,
                                emp['mother_branch'], destination);
    var midnight = computeMidnight(lastOut);
  ```

- [ ] **Step 4: Update `RATE_SHEET_NAMES` and `handleGetRates`**

  `Code.gs:163`, from:
  ```javascript
  var RATE_SHEET_NAMES = ['MealRates', 'AccomRates', 'MidnightRates', 'LTFRBRates'];
  ```
  to:
  ```javascript
  var RATE_SHEET_NAMES = ['EmployeeRates', 'MidnightRates', 'LTFRBRates'];
  ```

  `handleGetRates` (`Code.gs:153-161`), from:
  ```javascript
  function handleGetRates(payload) {
    return {
      meal:      sheetToObjects('MealRates'),
      accom:     sheetToObjects('AccomRates'),
      midnight:  sheetToObjects('MidnightRates'),
      ltfrb:     sheetToObjects('LTFRBRates'),
      config:    sheetToObjects('Config')
    };
  }
  ```
  to:
  ```javascript
  function handleGetRates(payload) {
    return {
      employeeRates: sheetToObjects('EmployeeRates'),
      midnight:       sheetToObjects('MidnightRates'),
      ltfrb:          sheetToObjects('LTFRBRates'),
      config:         sheetToObjects('Config')
    };
  }
  ```

- [ ] **Step 5: Verify by reading the diff**

  Confirm: no remaining `'MealRates'`/`'AccomRates'` string literals anywhere
  in `Code.gs`; `computeMeal`/`computeAccom` no longer take
  `employeeLevel`/`position_level`; `candidateAreaRows`/`allEmployeeRates`
  are computed once before the `dates.forEach` loop, not inside it.

- [ ] **Step 6: Commit**

  ```bash
  git add Code.gs
  git commit -m "feat: replace level-banded MealRates/AccomRates with per-employee/department EmployeeRates lookup"
  ```

---

## Task 3: `admin.html` — employee-grouped accordion editor for `EmployeeRates`

**Files:**
- Modify: `admin.html:210-245` (`RATE_TABLES`, `RATE_DATA_KEY`)
- Modify: `admin.html:247-256` (`loadRates`)
- Modify: `admin.html` (new functions, added near existing `buildRateTableBlock`/`buildRateRow`/`saveRateTable` at lines 258-340)

**Why a grouped accordion, not the existing flat table:** the existing
generic `buildRateTableBlock`/`buildRateRow` pattern renders one flat
`<table>` with every row visible and editable inline — fine for the current
4 small tables (≤15 rows each), but at 50+ employees × 5-8 areas (~300+
rows) a flat table is unfindable, error-prone to edit (no employee
boundary), and slow to verify after a bulk import. An accordion grouped by
employee (collapsed by default, with a name-filter search box) solves this
without inventing a new save mechanism — it reuses `buildRateRow()`'s
identical `<input data-key="...">` cell shape, so the save-side flattening
logic stays nearly the same as today's, just scanning multiple per-employee
`<table>`s instead of one shared `<tbody>`.

- [x] **Step 1: Update `RATE_TABLES` and `RATE_DATA_KEY`**

  Replace `admin.html:210-237`'s `RATE_TABLES` array — remove the
  `MealRates`/`AccomRates` entries, add one `EmployeeRates` entry with a
  `grouped: true` flag:
  ```javascript
  var RATE_TABLES = [
    { sheet: 'EmployeeRates', title: 'Employee Meal & Accommodation Rates', grouped: true, columns: [
      { key: 'employee_name', label: 'Employee' },
      { key: 'department',    label: 'Dept (fallback only)' },
      { key: 'area',          label: 'Area' },
      { key: 'meal_amount',   label: 'Meal ₱' },
      { key: 'accom_amount',  label: 'Accom ₱' }
    ]},
    { sheet: 'MidnightRates', title: 'Midnight Rates', columns: [
      { key: 'label',     label: 'Label' },
      { key: 'from_hour', label: 'From Hour' },
      { key: 'from_min',  label: 'From Min' },
      { key: 'to_hour',   label: 'To Hour' },
      { key: 'to_min',    label: 'To Min' },
      { key: 'amount',    label: 'Amount' }
    ]},
    { sheet: 'LTFRBRates',    title: 'LTFRB Rates', columns: [
      { key: 'vehicle_type', label: 'Vehicle Type' },
      { key: 'base_fare',    label: 'Base Fare' },
      { key: 'base_km',      label: 'Base KM' },
      { key: 'per_km',       label: 'Per KM' }
    ]}
  ];
  ```

  Replace `RATE_DATA_KEY` (`admin.html:240-245`):
  ```javascript
  var RATE_DATA_KEY = {
    EmployeeRates: 'employeeRates',
    MidnightRates: 'midnight',
    LTFRBRates: 'ltfrb'
  };
  ```

- [x] **Step 2: Branch `loadRates()` to use the grouped renderer for `grouped: true` entries**

  Replace `loadRates()` (`admin.html:247-256`):
  ```javascript
  function loadRates() {
    api('getRates', {}, function(err, data) {
      if (err) { alert(err.message); return; }
      var wrap = document.getElementById('rates-tables');
      wrap.innerHTML = '';
      RATE_TABLES.forEach(function(cfg) {
        wrap.appendChild(buildRateTableBlock(cfg, data[RATE_DATA_KEY[cfg.sheet]] || []));
      });
    });
  }
  ```
  With:
  ```javascript
  function loadRates() {
    api('getRates', {}, function(err, data) {
      if (err) { alert(err.message); return; }
      var wrap = document.getElementById('rates-tables');
      wrap.innerHTML = '';
      RATE_TABLES.forEach(function(cfg) {
        var rows = data[RATE_DATA_KEY[cfg.sheet]] || [];
        wrap.appendChild(cfg.grouped
          ? buildGroupedEmployeeRateBlock(cfg, rows)
          : buildRateTableBlock(cfg, rows));
      });
    });
  }
  ```

- [x] **Step 3: Add `buildGroupedEmployeeRateBlock`, `buildEmployeeRateGroup`, `saveGroupedEmployeeRates`**

  Add these new functions after the existing `saveRateTable` (after
  `admin.html:340`):

  ```javascript
  // Renders EmployeeRates grouped into one collapsible <details> block per
  // employee (plus a separate group per department for fallback rows), with
  // a name-filter search box. Each block has its own small <table> — NOT one
  // shared flat table — so 300+ rows stay navigable. "Save All" collects
  // every <tr> across every block's table and sends them in one saveRates
  // call, mirroring the flat-table path's flattening logic.
  function buildGroupedEmployeeRateBlock(cfg, rows) {
    var block = document.createElement('div');
    block.style.marginBottom = '28px';

    var title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = cfg.title;
    block.appendChild(title);

    var search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Filter by employee or department…';
    search.style.cssText = 'width:100%;padding:7px;margin-bottom:10px;box-sizing:border-box;';
    block.appendChild(search);

    var accordion = document.createElement('div');
    accordion.id = 'rates-employee-accordion';
    block.appendChild(accordion);

    // Group rows: employee-specific rows keyed by employee_name;
    // department-fallback rows (blank employee_name) keyed by
    // '[DEPT] ' + department, kept visually distinct from employee groups.
    var groups = {}; // key -> { label, employee_name, department, rows: [] }
    rows.forEach(function(row) {
      var isFallback = !row['employee_name'] || row['employee_name'] === '';
      var key = isFallback ? ('[DEPT] ' + row['department']) : row['employee_name'];
      if (!groups[key]) {
        groups[key] = {
          label: isFallback ? ('Department fallback: ' + row['department']) : row['employee_name'],
          employee_name: isFallback ? '' : row['employee_name'],
          department: isFallback ? row['department'] : '',
          rows: []
        };
      }
      groups[key].rows.push(row);
    });

    Object.keys(groups).sort().forEach(function(key) {
      accordion.appendChild(buildEmployeeRateGroup(cfg, groups[key]));
    });

    search.addEventListener('input', function() {
      var q = search.value.trim().toLowerCase();
      accordion.querySelectorAll('details.employee-rate-block').forEach(function(d) {
        var label = d.querySelector('summary').textContent.toLowerCase();
        d.style.display = (!q || label.indexOf(q) !== -1) ? '' : 'none';
      });
    });

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin-top:8px;display:flex;gap:8px;';

    var addEmpBtn = document.createElement('button');
    addEmpBtn.textContent = '+ Add new employee block';
    addEmpBtn.onclick = function() {
      var name = prompt('Employee name (must match Users sheet exactly):');
      if (!name) return;
      accordion.appendChild(buildEmployeeRateGroup(cfg, { label: name, employee_name: name, department: '', rows: [] }));
    };

    var addDeptBtn = document.createElement('button');
    addDeptBtn.textContent = '+ Add new department fallback block';
    addDeptBtn.onclick = function() {
      var dept = prompt('Department name (must match Users.department exactly):');
      if (!dept) return;
      accordion.appendChild(buildEmployeeRateGroup(cfg, { label: 'Department fallback: ' + dept, employee_name: '', department: dept, rows: [] }));
    };

    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save All';
    saveBtn.onclick = function() { saveGroupedEmployeeRates(cfg); };

    var msg = document.createElement('span');
    msg.id = 'rates-msg-' + cfg.sheet;
    msg.style.cssText = 'color:green;align-self:center;';

    btnRow.appendChild(addEmpBtn);
    btnRow.appendChild(addDeptBtn);
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(msg);
    block.appendChild(btnRow);

    return block;
  }

  function buildEmployeeRateGroup(cfg, group) {
    var details = document.createElement('details');
    details.className = 'employee-rate-block';
    details.style.cssText = 'border:1px solid #ddd;border-radius:6px;margin-bottom:6px;padding:6px 10px;';

    var summary = document.createElement('summary');
    summary.textContent = group.label + ' (' + group.rows.length + ' area' + (group.rows.length === 1 ? '' : 's') + ')';
    summary.style.cursor = 'pointer';
    details.appendChild(summary);

    var table = document.createElement('table');
    table.style.marginTop = '8px';
    var thead = document.createElement('thead');
    thead.innerHTML = '<tr>' + cfg.columns.map(function(c) { return '<th>' + c.label + '</th>'; }).join('') + '<th>Actions</th></tr>';
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    details.appendChild(table);

    group.rows.forEach(function(row) { tbody.appendChild(buildRateRow(cfg, row)); });

    var addRowBtn = document.createElement('button');
    addRowBtn.textContent = '+ Add area row';
    addRowBtn.style.marginTop = '6px';
    addRowBtn.onclick = function() {
      // Pre-fill employee_name/department so a new row can't end up
      // unscoped (neither field set) by accident.
      tbody.appendChild(buildRateRow(cfg, { employee_name: group.employee_name, department: group.department }));
    };
    details.appendChild(addRowBtn);

    return details;
  }

  function saveGroupedEmployeeRates(cfg) {
    var accordion = document.getElementById('rates-employee-accordion');
    var rows = [].slice.call(accordion.querySelectorAll('tbody tr')).map(function(tr) {
      var row = {};
      tr.querySelectorAll('input[data-key]').forEach(function(input) {
        row[input.dataset.key] = input.value;
      });
      return row;
    });
    api('saveRates', { sheet: cfg.sheet, rows: rows }, function(err) {
      var msg = document.getElementById('rates-msg-' + cfg.sheet);
      if (err) { alert(err.message); return; }
      if (msg) {
        msg.textContent = 'Saved!';
        setTimeout(function() { msg.textContent = ''; }, 2000);
      }
    });
  }
  ```

  This reuses `buildRateRow(cfg, row)` (`admin.html:314-321`) completely
  unchanged — same `<input data-key>` cell shape as the flat-table path.

- [x] **Step 4: Verify by reading the diff**

  Confirm: `buildRateTableBlock`/`buildRateRow`/`saveRateTable` (existing
  generic functions) are **unmodified** — still used as-is for
  `MidnightRates`/`LTFRBRates`. The new "+ Add area row" button pre-fills
  `employee_name`/`department` matching its own group. `RATE_TABLES`'s
  `EmployeeRates.columns` matches the schema from Task 1 exactly.

- [x] **Step 5: Commit** — `edeaf7e`

  ```bash
  git add admin.html
  git commit -m "feat: replace flat MealRates/AccomRates editor with grouped per-employee EmployeeRates accordion"
  ```

---

## Task 4: Redeploy and live-verify, then retire old sheets

**Files:** None (verification + one manual Sheet cleanup step).

**Migration sequencing (do not skip steps or run out of order):** there is no
incremental/partial-cutover mode — `computeMeal`/`computeAccom`'s signature
change is a breaking change to their only caller, and `Code.gs`/`admin.html`
must be redeployed together (old `admin.html` + new `Code.gs`, or vice versa,
breaks the Rate Tables tab, since `handleGetRates`'s response shape and
`RATE_DATA_KEY` are coupled). `MealRates`/`AccomRates` sheets are kept as an
inert rollback safety net until Step 5 below.

- [x] **Step 1: Redeploy `Code.gs`** (manual — same procedure as prior
  redeploys documented in `Resume.md`: paste into the Apps Script editor,
  save, Deploy → Manage deployments → edit existing deployment → New
  version → Deploy. Same `SCRIPT_URL`, no `app.js` change.) `admin.html`
  needed no separate "deploy" step — it's a static local file opened
  directly in the browser (`doGet` just returns a plain-text API ping), so
  re-saving/reopening the local file was sufficient.

- [x] **Step 2: Seed one employee-specific row and one department-fallback row for live testing**

  In `EmployeeRates`, add two test rows (reusing the existing test employee
  `Louwin celis` documented in `Resume.md`):
  ```
  Louwin celis |           | SM | 100 | 0
               | Test Dept | SM | 50  | 25
  ```

  Hit a snag first: the `EmployeeRates` tab itself had never actually been
  created in the live Sheet (Task 1's Step 1 manual step was skipped) —
  `getPeriodSheet` initially failed with `"Sheet not found: EmployeeRates"`.
  Fixed by creating the tab fresh (new sheet, not a rename of
  `MealRates`/`AccomRates`) with the exact header row, then re-adding the
  two test rows.

- [x] **Step 3: Call `getPeriodSheet` live and confirm meal/accom match the new row**

  ```powershell
  $SCRIPT_URL = "<the deployed Web App URL from app.js's SCRIPT_URL>"
  $body = @{ action = "getPeriodSheet"; employee_name = "Louwin celis"; period_start = "2026-06-11"; period_end = "2026-06-25" } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri $SCRIPT_URL -Method POST -Body $body -UseBasicParsing
  Write-Output $r.Content
  ```

  **PASSED.** The `2026-06-13` "SM sta rosa" day returned `meal: 100,
  accom: 0` — matching the new `EmployeeRates` row exactly, regardless of
  `Louwin celis`'s `position_level` (no longer consulted at all). Other
  SM-area days (06-18, 06-23) also picked up `meal: 100` correctly.

- [x] **Step 4: Confirm the Rate Tables tab renders correctly in the browser**

  **PASSED** (confirmed by the admin) — the "Employee Meal & Accommodation
  Rates" block renders as collapsible per-employee/department sections, not
  a flat table; the name filter works; `MidnightRates`/`LTFRBRates` blocks
  still render and save exactly as before.

- [x] **Step 5: Retire `MealRates`/`AccomRates`** (manual — only after Steps
  3-4 both pass)

  Done — the admin manually deleted both tabs from the live Sheet.

- [x] **Step 6: Report back**

  Steps 3-4 both passed as expected. No area-name mismatches to flag yet —
  real per-employee data hasn't been seeded (Task 5 is still pending), only
  the two synthetic test rows above.

---

## Task 5: One-time bulk seed of real per-employee rate data

**Files:** None committed — a temporary script run once in the Apps Script
editor, never added permanently to `Code.gs`.

- [ ] **Step 1: Prepare the `RawRateImport` scratch tab**

  Admin pastes the resolved real data (PDF7 "Area Heads" roster — confirmed
  current — plus the Technical/ComTech/Audit/Carpenter depts and
  Visayas/Mindanao rank-and-file groups, with any source conflicts resolved
  by the admin) into `RawRateImport`, using the same 5-column schema as
  `EmployeeRates`. Department-only rows (e.g. "Audit Dept.") get
  `employee_name` blank and `department` filled; everyone else gets
  `employee_name` filled and `department` blank.

- [ ] **Step 2: Run a one-time import script from the Apps Script editor**

  Temporarily paste into the Apps Script editor (delete after running once):
  ```javascript
  function oneTimeImportEmployeeRates() {
    var raw = sheetToObjects('RawRateImport');
    var bad = raw.filter(function(r) {
      var hasEmp = r['employee_name'] && r['employee_name'] !== '';
      var hasDept = r['department'] && r['department'] !== '';
      return (hasEmp && hasDept) || (!hasEmp && !hasDept) || !r['area'];
    });
    if (bad.length) {
      Logger.log('REFUSING TO IMPORT — ' + bad.length + ' invalid row(s) (must have exactly one of employee_name/department set, and area must be non-blank):');
      Logger.log(JSON.stringify(bad, null, 2));
      return;
    }
    handleSaveRates({ sheet: 'EmployeeRates', rows: raw });
    Logger.log('Imported ' + raw.length + ' rows into EmployeeRates.');
  }
  ```
  Run via the Apps Script editor's Run button; check `View → Logs` for the
  row count or validation failures.

- [ ] **Step 3: Spot-check the imported data**

  Open `EmployeeRates` directly: confirm a known Area Head (from PDF7) has
  correct `meal_amount`/`accom_amount` per area, and a known department-only
  group (e.g. "Audit Dept.") has exactly one fallback row per area with
  blank `employee_name`.

- [ ] **Step 4: Clean up** (manual — admin's call whether to keep
  `RawRateImport` as an audit trail or delete it; delete the temporary
  `oneTimeImportEmployeeRates` function from the Apps Script editor either
  way, since it's not meant to live in `Code.gs` permanently)

- [ ] **Step 5: Report back**

  No commit. Report the imported row count and any rows the validation step
  flagged.

---

## Self-Review Against Decisions

| Decision/requirement | Task |
|---|---|
| Per-employee rate model, department fallback | Task 1 (schema), Task 2 (`resolveEmployeeRate`) |
| Area Head monthly ATM allowance — out of scope | No task — correctly excluded |
| Hotel booking reference table — out of scope | No task — correctly excluded |
| `computeMeal`/`computeAccom` signature change | Task 2, Step 1 |
| `destinationArea` resolution scoped per-employee | Task 2, Step 2 |
| `handleGetPeriodSheet` call sites updated | Task 2, Step 3 |
| Admin UI scales to 300+ rows | Task 3 (grouped accordion, not flat table) |
| `MealRates`/`AccomRates` migration sequencing | Task 4 |
| Bulk data entry for ~50+ employees | Task 5 (one-time Apps Script import, not UI) |
| Live verification on real deployment | Task 4 |
| PDF7 confirmed authoritative for Area Heads | Task 5, Step 1 (admin resolves remaining groups) |

## Verification (end-to-end)

1. After Task 2/3 redeploy (Task 4): live API call to `getPeriodSheet` for
   the existing test employee shows meal/accom from the new table, not the
   old level-banded one.
2. Browser check of `admin.html`'s Rate Tables tab: accordion renders,
   filters, edits, and saves correctly; other two rate tables (Midnight,
   LTFRB) unaffected.
3. After Task 5's bulk import: spot-check at least one real Area Head's
   numbers against PDF7 directly, and confirm the Audit/Carpenter
   department-fallback rows resolve correctly for an employee with no
   individual row (no real such employee may exist by name in `Users` yet —
   acceptable to verify via a temporary synthetic `Users` row in that
   department if needed, removed after testing).
4. Update `Resume.md` after this work ships, following this project's
   established practice of keeping that file current after each significant
   change (not included as a task above since it's a standing practice, not
   a one-off step).
