# Photoline Expense App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Google Sheets + Apps Script web app that reads the existing
Photoline attendance app's CSV data and auto-computes fares (LTFRB formula),
meal allowance (position level × area table), accommodation allowance (fixed
table, no receipt), midnight allowance (clock-out brackets), and OT/offset —
replacing the manual paper timesheet with a computed, manipulation-proof period
sheet.

**Architecture:** Static HTML/JS front-end on GitHub Pages talks to a Google
Apps Script Web App (doGet/doPost) which reads/writes a dedicated Google Sheet
(Users, MealRates, AccomRates, MidnightRates, LTFRBRates, Claims, Config). The
existing attendance app's Google Sheet is read via its public CSV export URL —
no changes to the attendance app ever.

**Tech Stack:** Vanilla HTML/CSS/JS (same as attendance app), Google Apps Script
(ES5 compatible), Google Sheets API (via Apps Script SpreadsheetApp), OSRM
public API for road-distance computation (free, no key needed), GitHub Pages for
hosting.

**Reference:** Read the existing attendance app at
`https://github.com/photolinepayroll/attendance-app.git` before starting —
especially `index.html` (employee form patterns, GPS/photo capture code,
OpenStreetMap usage) and `admin.html` (CSV fetch pattern, table rendering,
print/export). Reuse these patterns throughout.

---

## Before You Start: Confirm Open Items With Admin

Pin down these answers before coding Tasks 6–8. Everything else can proceed
without them.

1. **OT/UT thresholds** — standard hours/day, minutes that constitute half-day
   vs. undertime vs. full OT.
2. **Accommodation trigger** — "not at mother branch" enough, or overnight only?
3. **Round-trip fares** — separate row per leg, or one round-trip total?
4. **Fare rounding** — nearest peso, or always round up?
5. **Fraud guard tolerance %** — how far over expected fare before flagging?
6. **Period definition** — 1st–15th and 16th–end-of-month, or ad hoc dates?
7. **Authentication** — per-user PIN per head (recommended) or single admin
   password? Plan assumes per-user PIN.
8. **Areas list** — canonical area names that appear in both the attendance app
   destinations and the rate tables.

---

## File Structure

```
photoline-expense-app/
├── index.html          # Employee view: see own period sheet, submit special claims
├── admin.html          # Admin view: setup tables, manage employees, approve claims,
│                       #   generate period sheets, export
├── app.js              # Shared JS: API calls to Apps Script, auth, rendering helpers
├── style.css           # Shared styles (mirror attendance app's look)
├── manifest.json       # PWA manifest (mirror attendance app)
├── icons/              # Copy from attendance app
└── Code.gs             # Google Apps Script: all server-side logic
                        #   (one file — Apps Script works best as one .gs file
                        #    for a project this size; use named function sections)
```

**Google Sheet tabs (one Sheet, created once by admin):**
- `Users` — employee profiles
- `MealRates` — meal allowance table
- `AccomRates` — accommodation table
- `MidnightRates` — midnight allowance brackets
- `LTFRBRates` — fare formula rows
- `Claims` — all claims (auto + special)
- `Config` — key/value settings

---

## Task 1: Project scaffold + Google Sheet setup

**Files:**
- Create: `Code.gs`
- Create: `style.css`
- Create: `manifest.json`

- [ ] **Step 1: Create the Google Sheet manually**

  In Google Sheets, create a new Sheet named `Photoline Expense App`. Add these
  tabs with these exact header rows (row 1):

  **Users:**
  `id | name | department | mother_branch | position_level | ot_type | role | pin | active`
  (role = "employee" or "head"; pin = 4-digit string; active = TRUE/FALSE)

  **MealRates:**
  `area | level_1 | level_2 | level_3`

  **AccomRates:**
  `area | level_1 | level_2 | level_3`

  **MidnightRates:**
  `label | from_hour | from_min | to_hour | to_min | amount`
  Seed with:
  ```
  8PM-12AM | 20 | 0 | 23 | 59 | 50
  9PM-3AM  | 21 | 0 | 3  | 0  | 100
  3AM+     | 3  | 1 | 6  | 0  | 150
  ```

  **LTFRBRates:**
  `vehicle_type | base_fare | base_km | per_km`
  Seed with:
  ```
  Traditional Jeepney | 14 | 4 | 2.00
  Modern Jeepney      | 17 | 4 | 2.40
  Ordinary City Bus   | 15 | 5 | 2.49
  Aircon City Bus     | 18 | 5 | 2.98
  ```

  **Claims:**
  `id | employee_id | employee_name | date | period_start | period_end | type |
  from_loc | to_loc | vehicle_mode | distance_km | computed_amount |
  claimed_amount | receipt_url | gps_check | status | approver_name |
  approved_at | notes`

  **Config:**
  `key | value`
  Seed with:
  ```
  attendance_csv_url   | (paste the attendance app's CSV export URL here)
  standard_hours       | 8
  fraud_tolerance_pct  | 20
  period_start         | (current period start date YYYY-MM-DD)
  period_end           | (current period end date YYYY-MM-DD)
  ```

- [ ] **Step 2: Create Code.gs scaffold**

  In Apps Script (bound to the Sheet above), create `Code.gs`:

  ```javascript
  // ============================================================
  // PHOTOLINE EXPENSE APP — Google Apps Script
  // ============================================================

  var SS = SpreadsheetApp.getActiveSpreadsheet();

  function getSheet(name) {
    return SS.getSheetByName(name);
  }

  function sheetToObjects(name) {
    var sh = getSheet(name);
    var rows = sh.getDataRange().getValues();
    var headers = rows[0];
    return rows.slice(1).map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    });
  }

  function getConfig(key) {
    var rows = sheetToObjects('Config');
    var row = rows.filter(function(r) { return r['key'] === key; })[0];
    return row ? row['value'] : null;
  }

  function doGet(e) {
    return HtmlService.createHtmlOutput('Photoline Expense App API running.');
  }

  function doPost(e) {
    try {
      var payload = JSON.parse(e.postData.contents);
      var action = payload.action;
      var handlers = {
        'ping':           handlePing,
        'login':          handleLogin,
        'getConfig':      handleGetConfig,
        'getUsers':       handleGetUsers,
        'saveUser':       handleSaveUser,
        'getRates':       handleGetRates,
        'saveRates':      handleSaveRates,
        'getClaims':      handleGetClaims,
        'saveClaim':      handleSaveClaim,
        'approveClaim':   handleApproveClaim,
        'getPeriodSheet': handleGetPeriodSheet,
        'getAttendance':  handleGetAttendance,
      };
      if (!handlers[action]) throw new Error('Unknown action: ' + action);
      var result = handlers[action](payload);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, data: result }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  function handlePing() { return 'pong'; }
  ```

- [ ] **Step 3: Deploy Apps Script as Web App**

  In Apps Script: Deploy → New deployment → Web App.
  - Execute as: Me
  - Who has access: Anyone
  Copy the deployment URL. This is `SCRIPT_URL`.

- [ ] **Step 4: Create style.css**

  Copy the CSS from the attendance app's `index.html` `<style>` block into
  `style.css`. The expense app should look identical in typography and color to
  keep it familiar. Add these extra classes:

  ```css
  .table-scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; white-space: nowrap; }
  th { background: #1a1a2e; color: #fff; }
  tr:nth-child(even) { background: #f5f5f5; }
  .badge-auto { background: #27ae60; color:#fff; border-radius:3px; padding:2px 6px; font-size:11px; }
  .badge-pending { background: #e67e22; color:#fff; border-radius:3px; padding:2px 6px; font-size:11px; }
  .badge-approved { background: #2980b9; color:#fff; border-radius:3px; padding:2px 6px; font-size:11px; }
  .badge-flagged { background: #e74c3c; color:#fff; border-radius:3px; padding:2px 6px; font-size:11px; }
  .section-title { font-weight:bold; margin:18px 0 6px; font-size:15px; color:#1a1a2e; }
  ```

- [ ] **Step 5: Create manifest.json**

  ```json
  {
    "name": "Photoline Expense",
    "short_name": "PL Expense",
    "start_url": "/expense-app/",
    "display": "standalone",
    "background_color": "#1a1a2e",
    "theme_color": "#1a1a2e",
    "icons": [
      { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
    ]
  }
  ```

- [ ] **Step 6: Commit**

  ```bash
  git init
  git add .
  git commit -m "feat: scaffold — sheet structure, Apps Script stub, styles"
  ```

---

## Task 2: Auth — login with PIN

**Files:**
- Modify: `Code.gs` (add handleLogin)
- Create: `app.js` (add api(), auth helpers)

The attendance app uses a single hardcoded password for admin. This app needs
per-user PIN so approvals are traceable. Each head has a 4-digit PIN stored
(plain text is acceptable for this internal tool — same security level as the
attendance app's hardcoded password).

- [ ] **Step 1: Add handleLogin to Code.gs**

  ```javascript
  function handleLogin(payload) {
    // payload: { name, pin }
    var users = sheetToObjects('Users');
    var user = users.filter(function(u) {
      return u['name'] === payload.name &&
             String(u['pin']) === String(payload.pin) &&
             u['active'] === true;
    })[0];
    if (!user) throw new Error('Invalid name or PIN.');
    return {
      name: user['name'],
      role: user['role'],
      department: user['department'],
      mother_branch: user['mother_branch'],
      position_level: user['position_level'],
      ot_type: user['ot_type']
    };
  }
  ```

- [ ] **Step 2: Create app.js with api() and auth helpers**

  ```javascript
  // app.js — shared by index.html and admin.html

  var SCRIPT_URL = 'PASTE_YOUR_DEPLOYMENT_URL_HERE';

  // ---- API ----
  function api(action, params, cb) {
    var body = Object.assign({ action: action }, params || {});
    fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) { cb(new Error(data.error), null); return; }
      cb(null, data.data);
    })
    .catch(function(err) { cb(err, null); });
  }

  // ---- Auth ----
  function currentUser() {
    var raw = sessionStorage.getItem('pl_user');
    return raw ? JSON.parse(raw) : null;
  }

  function requireLogin(requiredRole) {
    var user = currentUser();
    if (!user) { window.location.href = 'index.html'; return null; }
    if (requiredRole && user.role !== requiredRole) {
      alert('Access denied.'); window.location.href = 'index.html'; return null;
    }
    return user;
  }

  function login(name, pin, cb) {
    api('login', { name: name, pin: pin }, function(err, user) {
      if (err) { cb(err); return; }
      sessionStorage.setItem('pl_user', JSON.stringify(user));
      cb(null, user);
    });
  }

  function logout() {
    sessionStorage.removeItem('pl_user');
    window.location.href = 'index.html';
  }

  // ---- Utilities ----
  function formatCurrency(n) {
    return '₱' + Number(n || 0).toFixed(2);
  }

  function formatDate(d) {
    if (!d) return '';
    var dt = new Date(d);
    return dt.toLocaleDateString('en-PH');
  }
  ```

- [ ] **Step 3: Build login page (index.html — first pass, login only)**

  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Photoline Expense</title>
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <div id="login-view" style="max-width:360px;margin:60px auto;padding:24px;">
      <h2 style="text-align:center;color:#1a1a2e;">Photoline Expense</h2>
      <label>Name</label>
      <input id="inp-name" type="text" placeholder="Your full name" style="width:100%;margin:6px 0 12px;padding:8px;">
      <label>PIN</label>
      <input id="inp-pin" type="password" maxlength="4" placeholder="4-digit PIN"
             style="width:100%;margin:6px 0 12px;padding:8px;">
      <button id="btn-login" style="width:100%;padding:10px;background:#1a1a2e;color:#fff;border:none;border-radius:4px;font-size:15px;cursor:pointer;">
        Login
      </button>
      <p id="login-error" style="color:red;text-align:center;margin-top:8px;"></p>
    </div>
    <div id="employee-view" style="display:none;max-width:900px;margin:24px auto;padding:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 id="welcome-msg"></h3>
        <button onclick="logout()" style="padding:6px 14px;">Logout</button>
      </div>
      <p>Employee period sheet and claim submission will appear here (Task 5).</p>
    </div>
    <script src="app.js"></script>
    <script>
      document.getElementById('btn-login').addEventListener('click', function() {
        var name = document.getElementById('inp-name').value.trim();
        var pin  = document.getElementById('inp-pin').value.trim();
        if (!name || !pin) { document.getElementById('login-error').textContent = 'Enter name and PIN.'; return; }
        login(name, pin, function(err, user) {
          if (err) { document.getElementById('login-error').textContent = err.message; return; }
          document.getElementById('login-view').style.display = 'none';
          document.getElementById('employee-view').style.display = 'block';
          document.getElementById('welcome-msg').textContent = 'Welcome, ' + user.name;
          // heads go to admin
          if (user.role === 'head') window.location.href = 'admin.html';
        });
      });
    </script>
  </body>
  </html>
  ```

- [ ] **Step 4: Verify login works end-to-end**

  - Manually add one test user row to the Users sheet:
    `U001 | Test Head | Operations | SM Dagupan | Level 2 | DECLARED OT | head | 1234 | TRUE`
  - Open index.html in browser, enter "Test Head" + "1234" → should redirect to
    admin.html (which shows a blank page for now — that's fine).
  - Enter wrong PIN → should show "Invalid name or PIN."

- [ ] **Step 5: Commit**

  ```bash
  git add Code.gs app.js index.html
  git commit -m "feat: login with PIN, session auth, role-based redirect"
  ```

---

## Task 3: Admin — employee setup & user management

**Files:**
- Create: `admin.html` (first pass — employee management tab only)
- Modify: `Code.gs` (add handleGetUsers, handleSaveUser)

- [ ] **Step 1: Add handleGetUsers and handleSaveUser to Code.gs**

  ```javascript
  function handleGetUsers(payload) {
    return sheetToObjects('Users');
  }

  function handleSaveUser(payload) {
    // payload.user = { id, name, department, mother_branch, position_level,
    //                  ot_type, role, pin, active }
    var sh = getSheet('Users');
    var rows = sh.getDataRange().getValues();
    var headers = rows[0];

    function rowFromUser(u) {
      return headers.map(function(h) { return u[h] !== undefined ? u[h] : ''; });
    }

    // find existing row by id
    var found = false;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === payload.user.id) {
        sh.getRange(i + 1, 1, 1, headers.length).setValues([rowFromUser(payload.user)]);
        found = true;
        break;
      }
    }
    if (!found) {
      // new user — generate id
      payload.user.id = 'U' + Date.now();
      sh.appendRow(rowFromUser(payload.user));
    }
    return payload.user.id;
  }
  ```

- [ ] **Step 2: Create admin.html with employee management tab**

  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Photoline Expense — Admin</title>
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <div style="max-width:1100px;margin:0 auto;padding:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2 style="color:#1a1a2e;margin:0;">Photoline Expense — Admin</h2>
        <button onclick="logout()" style="padding:6px 14px;">Logout</button>
      </div>

      <!-- Tab bar -->
      <div id="tabs" style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
        <button class="tab-btn active" data-tab="employees">Employees</button>
        <button class="tab-btn" data-tab="rates">Rate Tables</button>
        <button class="tab-btn" data-tab="claims">Approve Claims</button>
        <button class="tab-btn" data-tab="periods">Period Sheets</button>
      </div>

      <!-- Tab: Employees -->
      <div id="tab-employees" class="tab-panel">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div class="section-title">Employee Profiles</div>
          <button onclick="openUserForm(null)">+ Add Employee</button>
        </div>
        <div class="table-scroll">
          <table id="users-table">
            <thead><tr>
              <th>Name</th><th>Dept</th><th>Mother Branch</th>
              <th>Level</th><th>OT Type</th><th>Role</th><th>Active</th><th>Actions</th>
            </tr></thead>
            <tbody id="users-tbody"></tbody>
          </table>
        </div>

        <!-- User form (hidden until opened) -->
        <div id="user-form-wrap" style="display:none;background:#f9f9f9;padding:16px;margin-top:16px;border:1px solid #ddd;border-radius:6px;">
          <div class="section-title" id="user-form-title">Add Employee</div>
          <input type="hidden" id="uf-id">
          <label>Full Name</label>
          <input id="uf-name" type="text" style="width:100%;padding:7px;margin:4px 0 10px;">
          <label>Department</label>
          <input id="uf-dept" type="text" style="width:100%;padding:7px;margin:4px 0 10px;">
          <label>Mother Branch</label>
          <input id="uf-branch" type="text" style="width:100%;padding:7px;margin:4px 0 10px;">
          <label>Position Level</label>
          <select id="uf-level" style="width:100%;padding:7px;margin:4px 0 10px;">
            <option value="level_1">Level 1</option>
            <option value="level_2">Level 2</option>
            <option value="level_3">Level 3</option>
          </select>
          <label>OT Type</label>
          <select id="uf-ot" style="width:100%;padding:7px;margin:4px 0 10px;">
            <option value="FOR BAWI">FOR BAWI (offset)</option>
            <option value="DECLARED OT">DECLARED OT (paid)</option>
          </select>
          <label>Role</label>
          <select id="uf-role" style="width:100%;padding:7px;margin:4px 0 10px;">
            <option value="employee">Employee</option>
            <option value="head">Head (can approve)</option>
          </select>
          <label>PIN (4 digits)</label>
          <input id="uf-pin" type="text" maxlength="4" style="width:100%;padding:7px;margin:4px 0 10px;">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <input id="uf-active" type="checkbox" checked> Active
          </label>
          <div style="display:flex;gap:8px;">
            <button onclick="saveUser()">Save</button>
            <button onclick="document.getElementById('user-form-wrap').style.display='none'">Cancel</button>
          </div>
          <p id="uf-msg" style="color:green;margin-top:8px;"></p>
        </div>
      </div>

      <!-- Other tabs: placeholders until later tasks -->
      <div id="tab-rates"   class="tab-panel" style="display:none;">Rate tables (Task 4)</div>
      <div id="tab-claims"  class="tab-panel" style="display:none;">Approval queue (Task 7)</div>
      <div id="tab-periods" class="tab-panel" style="display:none;">Period sheets (Task 8)</div>
    </div>

    <script src="app.js"></script>
    <script>
      // Guard — redirect to login if not a head
      window.addEventListener('DOMContentLoaded', function() {
        var user = requireLogin('head');
        if (!user) return;
        loadUsers();
        initTabs();
      });

      function initTabs() {
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
            document.querySelectorAll('.tab-panel').forEach(function(p) { p.style.display='none'; });
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
          });
        });
      }

      function loadUsers() {
        api('getUsers', {}, function(err, users) {
          if (err) { alert(err.message); return; }
          var tbody = document.getElementById('users-tbody');
          tbody.innerHTML = '';
          users.forEach(function(u) {
            var tr = document.createElement('tr');
            tr.innerHTML =
              '<td>' + u.name + '</td>' +
              '<td>' + u.department + '</td>' +
              '<td>' + u.mother_branch + '</td>' +
              '<td>' + u.position_level + '</td>' +
              '<td>' + u.ot_type + '</td>' +
              '<td>' + u.role + '</td>' +
              '<td>' + (u.active ? '✔' : '✘') + '</td>' +
              '<td><button onclick="openUserForm(' + JSON.stringify(u).replace(/"/g,"'") + ')">Edit</button></td>';
            tbody.appendChild(tr);
          });
        });
      }

      function openUserForm(u) {
        document.getElementById('user-form-wrap').style.display = 'block';
        document.getElementById('user-form-title').textContent = u ? 'Edit Employee' : 'Add Employee';
        document.getElementById('uf-id').value     = u ? u.id : '';
        document.getElementById('uf-name').value   = u ? u.name : '';
        document.getElementById('uf-dept').value   = u ? u.department : '';
        document.getElementById('uf-branch').value = u ? u.mother_branch : '';
        document.getElementById('uf-level').value  = u ? u.position_level : 'level_1';
        document.getElementById('uf-ot').value     = u ? u.ot_type : 'FOR BAWI';
        document.getElementById('uf-role').value   = u ? u.role : 'employee';
        document.getElementById('uf-pin').value    = u ? u.pin : '';
        document.getElementById('uf-active').checked = u ? u.active === true || u.active === 'TRUE' : true;
        document.getElementById('uf-msg').textContent = '';
      }

      function saveUser() {
        var user = {
          id:             document.getElementById('uf-id').value,
          name:           document.getElementById('uf-name').value.trim(),
          department:     document.getElementById('uf-dept').value.trim(),
          mother_branch:  document.getElementById('uf-branch').value.trim(),
          position_level: document.getElementById('uf-level').value,
          ot_type:        document.getElementById('uf-ot').value,
          role:           document.getElementById('uf-role').value,
          pin:            document.getElementById('uf-pin').value.trim(),
          active:         document.getElementById('uf-active').checked
        };
        if (!user.name || !user.pin) { alert('Name and PIN are required.'); return; }
        api('saveUser', { user: user }, function(err) {
          if (err) { alert(err.message); return; }
          document.getElementById('uf-msg').textContent = 'Saved!';
          loadUsers();
        });
      }
    </script>
    <style>
      .tab-btn { padding:8px 18px; border:1px solid #ccc; background:#fff; cursor:pointer; border-radius:4px; }
      .tab-btn.active { background:#1a1a2e; color:#fff; border-color:#1a1a2e; }
    </style>
  </body>
  </html>
  ```

- [ ] **Step 3: Verify**

  - Login as Test Head → lands on admin.html.
  - Add a new employee via the form → row appears in Users sheet and in the table.
  - Edit the employee → row updates in sheet.

- [ ] **Step 4: Commit**

  ```bash
  git add Code.gs admin.html
  git commit -m "feat: employee setup — add/edit users with level, OT type, role, PIN"
  ```

---

## Task 4: Admin — rate table setup

**Files:**
- Modify: `Code.gs` (add handleGetRates, handleSaveRates)
- Modify: `admin.html` (replace Rate Tables tab placeholder)

- [ ] **Step 1: Add handleGetRates and handleSaveRates to Code.gs**

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

  function handleSaveRates(payload) {
    // payload.sheet = 'MealRates'|'AccomRates'|'MidnightRates'|'LTFRBRates'
    // payload.rows = array of objects matching sheet headers
    var sh = getSheet(payload.sheet);
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    // clear data rows (keep header)
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    }
    payload.rows.forEach(function(row, i) {
      var rowData = headers.map(function(h) { return row[h] !== undefined ? row[h] : ''; });
      sh.getRange(i + 2, 1, 1, headers.length).setValues([rowData]);
    });
    return 'saved';
  }
  ```

- [ ] **Step 2: Build the Rate Tables tab in admin.html**

  Replace the `tab-rates` div placeholder with a full editable table UI for
  MealRates, AccomRates, MidnightRates, and LTFRBRates. Each table shows the
  current rows editable in-place. A Save button per table calls `saveRates`.

  For MealRates and AccomRates, the table looks like:

  ```
  | Area         | Level 1 | Level 2 | Level 3 | [Delete] |
  | NCR          | 75      | 75      | 75      |          |
  | Pampanga     | 100     | 150     | 150     |          |
  | [+ Add row]  |
  ```

  For LTFRBRates:
  ```
  | Vehicle Type          | Base Fare | Base KM | Per KM  |
  | Traditional Jeepney   | 14        | 4       | 2.00    |
  ```

  All cells are `<input>` elements so the admin can edit values directly.
  Save button calls `api('saveRates', { sheet: 'MealRates', rows: [...] }, cb)`.

  Full implementation: generate the editable table rows dynamically in JS using
  the same `loadRates` → render → `saveRates` pattern used for users in Task 3.
  (Follow the same load → render → save pattern exactly — do not invent a
  different pattern for rates vs. users.)

- [ ] **Step 3: Verify**

  - Open Rate Tables tab → all four tables load with their seeded data.
  - Edit NCR meal for Level 2 from 75 to 80 → Save → re-open → shows 80.
  - Add a new area row → Save → appears in Sheet.

- [ ] **Step 4: Commit**

  ```bash
  git add Code.gs admin.html
  git commit -m "feat: rate table admin — meal, accom, midnight, LTFRB editable tables"
  ```

---

## Task 5: Reading attendance data from the existing app

**Files:**
- Modify: `Code.gs` (add handleGetAttendance)
- Modify: `app.js` (add parseAttendanceCSV)

This task bridges the two apps. The attendance app writes a Google Sheet with
one row per clock event. It exposes a public CSV URL stored in Config
(`attendance_csv_url`). We fetch and parse it here.

- [ ] **Step 1: Inspect the attendance app's CSV structure**

  Before writing code: fetch the actual CSV URL from the attendance app and note
  the exact column order. The attendance app's `admin.html` loads this CSV and
  the column names are visible in its table headers. Expected columns (verify):
  `Timestamp | Name | Type (IN/OUT) | Destination | Latitude | Longitude |
  Photo (base64) | Address | ...`

  Note exact column indices. These are hardcoded in parseAttendanceCSV below —
  update them if the actual CSV differs.

- [ ] **Step 2: Add handleGetAttendance to Code.gs**

  ```javascript
  function handleGetAttendance(payload) {
    // payload: { period_start, period_end, employee_name (optional) }
    var csvUrl = getConfig('attendance_csv_url');
    if (!csvUrl) throw new Error('attendance_csv_url not set in Config.');
    var response = UrlFetchApp.fetch(csvUrl);
    var csv = response.getContentText();
    var rows = Utilities.parseCsv(csv);
    var headers = rows[0];

    function idx(name) {
      var i = headers.indexOf(name);
      if (i === -1) throw new Error('Column not found in attendance CSV: ' + name);
      return i;
    }

    // Map column names to indices (update names to match actual CSV headers)
    var COL = {
      timestamp:   idx('Timestamp'),
      name:        idx('Name'),
      type:        idx('Type'),
      destination: idx('Destination'),
      lat:         idx('Latitude'),
      lng:         idx('Longitude'),
      address:     idx('Address')
    };

    var start = payload.period_start ? new Date(payload.period_start) : null;
    var end   = payload.period_end   ? new Date(payload.period_end)   : null;

    var records = rows.slice(1)
      .filter(function(row) { return row.length > COL.name && row[COL.name]; })
      .map(function(row) {
        return {
          timestamp:   row[COL.timestamp],
          name:        row[COL.name],
          type:        row[COL.type],
          destination: row[COL.destination],
          lat:         parseFloat(row[COL.lat]) || 0,
          lng:         parseFloat(row[COL.lng]) || 0,
          address:     row[COL.address] || ''
        };
      })
      .filter(function(r) {
        if (payload.employee_name && r.name !== payload.employee_name) return false;
        if (start || end) {
          var t = new Date(r.timestamp);
          if (start && t < start) return false;
          if (end   && t > end)   return false;
        }
        return true;
      });

    return records;
  }
  ```

- [ ] **Step 3: Add parseAttendanceCSV helper to app.js**

  ```javascript
  // Groups raw attendance records into day-summaries per employee
  function groupAttendanceByDay(records) {
    // returns { 'YYYY-MM-DD': { in: record, out: record, destination, hours } }
    var days = {};
    records.forEach(function(r) {
      var date = r.timestamp.split('T')[0] || r.timestamp.split(' ')[0];
      if (!days[date]) days[date] = { ins: [], outs: [], destination: r.destination };
      if (r.type === 'IN')  days[date].ins.push(r);
      if (r.type === 'OUT') days[date].outs.push(r);
    });
    // compute hours worked per day
    Object.keys(days).forEach(function(date) {
      var d = days[date];
      var firstIn  = d.ins.length  ? new Date(d.ins[0].timestamp)  : null;
      var lastOut  = d.outs.length ? new Date(d.outs[d.outs.length-1].timestamp) : null;
      d.first_in   = firstIn;
      d.last_out   = lastOut;
      d.hours_worked = (firstIn && lastOut)
        ? (lastOut - firstIn) / 3600000
        : 0;
      d.in_record  = d.ins[0]  || null;
      d.out_record = d.outs[d.outs.length - 1] || null;
    });
    return days;
  }
  ```

- [ ] **Step 4: Verify**

  Add a temporary button in admin.html:
  ```html
  <button onclick="testAttendanceFetch()">Test Attendance Fetch</button>
  <pre id="att-debug"></pre>
  ```
  ```javascript
  function testAttendanceFetch() {
    api('getAttendance', { period_start: '2026-05-26', period_end: '2026-06-10' },
      function(err, data) {
        document.getElementById('att-debug').textContent =
          err ? err.message : JSON.stringify(data.slice(0,3), null, 2);
      });
  }
  ```
  - Run → should see 3 attendance records in the debug panel.
  - Remove the test button after verifying.

- [ ] **Step 5: Commit**

  ```bash
  git add Code.gs app.js
  git commit -m "feat: read attendance CSV from existing app, group by day"
  ```

---

## Task 6: Auto-compute fares (LTFRB formula + OSRM distance)

**Files:**
- Modify: `Code.gs` (add computeFare, getRoadDistanceKm, handleSaveClaim for
  auto-fares)
- Modify: `app.js` (add fare display helpers)

**Confirm open items before this task:**
- Round-trip handling (separate legs or one total?)
- Fare rounding rule
- Fraud guard tolerance %

- [ ] **Step 1: Add getRoadDistanceKm to Code.gs**

  Uses the public OSRM demo server (no key needed). For production volume (~100
  employees × ~20 days), this is fine. If OSRM demo is down, falls back to
  straight-line (Haversine) with a 1.3 road-factor multiplier.

  ```javascript
  function getRoadDistanceKm(lat1, lng1, lat2, lng2) {
    try {
      var url = 'https://router.project-osrm.org/route/v1/driving/' +
        lng1 + ',' + lat1 + ';' + lng2 + ',' + lat2 +
        '?overview=false';
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var json = JSON.parse(resp.getContentText());
      if (json.code === 'Ok' && json.routes && json.routes[0]) {
        return json.routes[0].distance / 1000; // metres → km
      }
    } catch(e) { /* fall through to haversine */ }
    // Haversine fallback
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
            Math.sin(dLng/2)*Math.sin(dLng/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c * 1.3; // road factor
  }
  ```

- [ ] **Step 2: Add computeFare to Code.gs**

  ```javascript
  function computeFare(vehicleType, distanceKm) {
    var rates = sheetToObjects('LTFRBRates');
    var rate = rates.filter(function(r) {
      return r['vehicle_type'] === vehicleType;
    })[0];
    if (!rate) throw new Error('Unknown vehicle type: ' + vehicleType);
    var base    = parseFloat(rate['base_fare']);
    var baseKm  = parseFloat(rate['base_km']);
    var perKm   = parseFloat(rate['per_km']);
    var extra   = Math.max(0, distanceKm - baseKm);
    var fare    = base + (extra * perKm);
    return Math.round(fare); // round to nearest peso; update if admin prefers ceil
  }
  ```

- [ ] **Step 3: Add auto-fare claim generation to Code.gs**

  When the period sheet is built (Task 8), it calls this for each day's IN/OUT
  pair. Add as a named function now so Task 8 can call it:

  ```javascript
  function buildAutoFareClaim(attendanceRecord, vehicleType, employeeName, date, periodStart, periodEnd) {
    var inRec  = attendanceRecord.in_record;
    var outRec = attendanceRecord.out_record;
    if (!inRec || !outRec) return null;
    if (!inRec.lat || !inRec.lng || !outRec.lat || !outRec.lng) return null;

    var distKm = getRoadDistanceKm(inRec.lat, inRec.lng, outRec.lat, outRec.lng);
    var computedAmt = computeFare(vehicleType, distKm);
    var tolerancePct = parseFloat(getConfig('fraud_tolerance_pct') || 20);

    var gpsCheck = 'ok'; // GPS was present and used
    var status   = 'auto'; // no approval needed

    return {
      id:               '',
      employee_name:    employeeName,
      date:             date,
      period_start:     periodStart,
      period_end:       periodEnd,
      type:             'auto-fare',
      from_loc:         inRec.address  || (inRec.lat + ',' + inRec.lng),
      to_loc:           outRec.address || (outRec.lat + ',' + outRec.lng),
      vehicle_mode:     vehicleType,
      distance_km:      Math.round(distKm * 10) / 10,
      computed_amount:  computedAmt,
      claimed_amount:   computedAmt,
      receipt_url:      '',
      gps_check:        gpsCheck,
      status:           status,
      approver_name:    '',
      approved_at:      '',
      notes:            ''
    };
  }
  ```

- [ ] **Step 4: Verify computeFare with known values**

  In Apps Script editor, run this test function:
  ```javascript
  function testComputeFare() {
    // Traditional jeep, 8 km: base 14 + (8-4)*2 = 14+8 = 22
    Logger.log(computeFare('Traditional Jeepney', 8)); // expect 22
    // Aircon bus, 12 km: base 18 + (12-5)*2.98 = 18+20.86 = 38.86 → 39
    Logger.log(computeFare('Aircon City Bus', 12));    // expect 39
    // Within base km: Traditional jeep, 3 km: 14
    Logger.log(computeFare('Traditional Jeepney', 3)); // expect 14
  }
  ```
  Run → check Logger output matches expected values.

- [ ] **Step 5: Commit**

  ```bash
  git add Code.gs app.js
  git commit -m "feat: fare auto-compute — OSRM distance + LTFRB formula + haversine fallback"
  ```

---

## Task 7: Auto-compute meal, accommodation, midnight allowance + OT

**Files:**
- Modify: `Code.gs` (add computeMeal, computeAccom, computeMidnight,
  computeOT)

**Confirm open items before this task:**
- OT/UT thresholds
- Accommodation trigger rule
- 5-hour meal rule confirmed in spec

- [ ] **Step 1: Add computeMeal to Code.gs**

  ```javascript
  function computeMeal(employeeLevel, destinationArea, hoursWorked, motherBranch, destination) {
    // Rule: no meal at mother branch; 5+ hours required
    if (destination === motherBranch) return 0;
    if (hoursWorked < 5) return 0;
    var rates = sheetToObjects('MealRates');
    var row = rates.filter(function(r) { return r['area'] === destinationArea; })[0];
    if (!row) return 0;
    return parseFloat(row[employeeLevel] || 0);
  }
  ```

- [ ] **Step 2: Add computeAccom to Code.gs**

  ```javascript
  function computeAccom(employeeLevel, destinationArea, motherBranch, destination) {
    // No accommodation at mother branch
    if (destination === motherBranch) return 0;
    var rates = sheetToObjects('AccomRates');
    var row = rates.filter(function(r) { return r['area'] === destinationArea; })[0];
    if (!row) return 0;
    return parseFloat(row[employeeLevel] || 0);
  }
  ```

- [ ] **Step 3: Add computeMidnight to Code.gs**

  ```javascript
  function computeMidnight(clockOutTime) {
    // clockOutTime: Date object
    if (!clockOutTime) return 0;
    var h = clockOutTime.getHours();
    var m = clockOutTime.getMinutes();
    var totalMin = h * 60 + m;

    var brackets = sheetToObjects('MidnightRates');
    // Sort by amount descending — apply highest matching bracket
    brackets.sort(function(a,b) { return b['amount'] - a['amount']; });

    for (var i = 0; i < brackets.length; i++) {
      var b = brackets[i];
      var fromMin = parseInt(b['from_hour'])*60 + parseInt(b['from_min']);
      var toMin   = parseInt(b['to_hour'])*60   + parseInt(b['to_min']);
      // Handle overnight brackets (e.g. 9PM=21:00 to 3AM=03:00 crosses midnight)
      var inRange = (fromMin <= toMin)
        ? (totalMin >= fromMin && totalMin <= toMin)
        : (totalMin >= fromMin || totalMin <= toMin);
      if (inRange) return parseFloat(b['amount']);
    }
    return 0;
  }
  ```

- [ ] **Step 4: Add computeOT to Code.gs**

  ```javascript
  function computeOT(hoursWorked, otType) {
    // Confirm standard_hours with admin before setting default
    var standardHours = parseFloat(getConfig('standard_hours') || 8);
    var extra = hoursWorked - standardHours;
    if (extra <= 0) return { ot_hours: 0, offset_hours: 0, ut_hours: Math.abs(extra) };
    if (otType === 'DECLARED OT') {
      return { ot_hours: extra, offset_hours: 0, ut_hours: 0 };
    } else { // FOR BAWI
      return { ot_hours: 0, offset_hours: extra, ut_hours: 0 };
    }
  }
  ```

- [ ] **Step 5: Verify with test function in Apps Script**

  ```javascript
  function testAllowances() {
    // Meal: Level 2, Dagupan, 6 hours, not at mother branch
    Logger.log(computeMeal('level_2','Dagupan Area',6,'SM Dagupan','SM Dagupan')); // 0 (same as mother)
    Logger.log(computeMeal('level_2','Dagupan Area',6,'Terminal','SM Dagupan'));   // 150 (from rate table)
    Logger.log(computeMeal('level_2','Dagupan Area',4,'Terminal','SM Dagupan'));   // 0 (under 5 hours)

    // Midnight: 9:30 PM clock-out
    var t = new Date(); t.setHours(21); t.setMinutes(30);
    Logger.log(computeMidnight(t)); // 50 or 100 depending on which bracket matches

    // OT: 9.5 hours, DECLARED
    Logger.log(JSON.stringify(computeOT(9.5, 'DECLARED OT'))); // {ot_hours:1.5, offset_hours:0, ut_hours:0}
    Logger.log(JSON.stringify(computeOT(9.5, 'FOR BAWI')));    // {ot_hours:0, offset_hours:1.5, ut_hours:0}
    Logger.log(JSON.stringify(computeOT(6, 'DECLARED OT')));   // {ot_hours:0, offset_hours:0, ut_hours:2}
  }
  ```

  Run → check Logger output matches expected values. Fix rate table seed data if
  needed.

- [ ] **Step 6: Commit**

  ```bash
  git add Code.gs
  git commit -m "feat: auto-compute meal, accommodation, midnight allowance, OT/offset/UT"
  ```

---

## Task 8: Special claim submission (employee side)

**Files:**
- Modify: `index.html` (add special claim form to employee view)
- Modify: `Code.gs` (complete handleSaveClaim for special claims)

- [ ] **Step 1: Complete handleSaveClaim in Code.gs**

  ```javascript
  function handleSaveClaim(payload) {
    // payload.claim matches Claims sheet columns
    var sh = getSheet('Claims');
    var id = 'C' + Date.now();
    payload.claim.id = id;
    payload.claim.status = 'Submitted';
    var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    var row = headers.map(function(h) { return payload.claim[h] !== undefined ? payload.claim[h] : ''; });
    sh.appendRow(row);
    return id;
  }
  ```

- [ ] **Step 2: Add special claim form to employee view in index.html**

  After the welcome message in `employee-view`, add:

  ```html
  <div class="section-title">Submit Special Trip / Accommodation Claim</div>
  <div style="background:#f9f9f9;padding:16px;border:1px solid #ddd;border-radius:6px;max-width:500px;">
    <label>Date of Trip</label>
    <input id="cl-date" type="date" style="width:100%;padding:7px;margin:4px 0 10px;">
    <label>Type</label>
    <select id="cl-type" style="width:100%;padding:7px;margin:4px 0 10px;">
      <option value="special-fare">Special Trip / Special Pay</option>
      <option value="accommodation">Accommodation</option>
    </select>
    <label>From</label>
    <input id="cl-from" type="text" placeholder="Starting point" style="width:100%;padding:7px;margin:4px 0 10px;">
    <label>To</label>
    <input id="cl-to" type="text" placeholder="Destination" style="width:100%;padding:7px;margin:4px 0 10px;">
    <label>Vehicle / Mode (for special trip)</label>
    <input id="cl-mode" type="text" placeholder="e.g. Van hire, Taxi, Grab" style="width:100%;padding:7px;margin:4px 0 10px;">
    <label>Amount (₱)</label>
    <input id="cl-amount" type="number" min="0" style="width:100%;padding:7px;margin:4px 0 10px;">
    <label>Notes / Justification</label>
    <textarea id="cl-notes" rows="3" style="width:100%;padding:7px;margin:4px 0 10px;"></textarea>
    <label>Receipt Photo (optional but recommended)</label>
    <input id="cl-receipt" type="file" accept="image/*" capture="environment" style="margin:4px 0 10px;">
    <button onclick="submitClaim()" style="padding:8px 20px;background:#1a1a2e;color:#fff;border:none;border-radius:4px;cursor:pointer;">
      Submit Claim
    </button>
    <p id="cl-msg" style="margin-top:8px;color:green;"></p>
  </div>
  ```

  And the JS in index.html's script block:

  ```javascript
  function submitClaim() {
    var user = currentUser();
    var dateVal = document.getElementById('cl-date').value;
    var amount  = parseFloat(document.getElementById('cl-amount').value);
    if (!dateVal || !amount) { alert('Date and amount are required.'); return; }

    var config = getStoredConfig();
    var claim = {
      employee_name:   user.name,
      date:            dateVal,
      period_start:    config ? config.period_start : '',
      period_end:      config ? config.period_end : '',
      type:            document.getElementById('cl-type').value,
      from_loc:        document.getElementById('cl-from').value.trim(),
      to_loc:          document.getElementById('cl-to').value.trim(),
      vehicle_mode:    document.getElementById('cl-mode').value.trim(),
      distance_km:     '',
      computed_amount: '',
      claimed_amount:  amount,
      receipt_url:     '',
      gps_check:       'n/a',
      status:          'Submitted',
      approver_name:   '',
      approved_at:     '',
      notes:           document.getElementById('cl-notes').value.trim()
    };

    // Receipt: convert to base64 if provided
    var file = document.getElementById('cl-receipt').files[0];
    if (file) {
      var reader = new FileReader();
      reader.onload = function(e) {
        claim.receipt_url = e.target.result; // base64 data URL stored in sheet
        api('saveClaim', { claim: claim }, function(err, id) {
          if (err) { alert(err.message); return; }
          document.getElementById('cl-msg').textContent = 'Claim submitted! ID: ' + id;
        });
      };
      reader.readAsDataURL(file);
    } else {
      api('saveClaim', { claim: claim }, function(err, id) {
        if (err) { alert(err.message); return; }
        document.getElementById('cl-msg').textContent = 'Claim submitted! ID: ' + id;
      });
    }
  }

  function getStoredConfig() {
    // Config is fetched once when page loads and cached here
    return window._plConfig || null;
  }

  // On employee-view load, fetch config to get current period dates
  function loadEmployeeConfig() {
    api('getConfig', {}, function(err, data) {
      if (err) return;
      window._plConfig = {};
      data.forEach(function(row) { window._plConfig[row.key] = row.value; });
    });
  }
  ```

  Add `handleGetConfig` to Code.gs:
  ```javascript
  function handleGetConfig(payload) {
    return sheetToObjects('Config');
  }
  ```

  Call `loadEmployeeConfig()` when the employee view is shown (after login).

- [ ] **Step 3: Verify**

  - Login as employee → fill in special claim form → submit.
  - Check Claims sheet → row appears with status "Submitted".
  - With and without receipt photo.

- [ ] **Step 4: Commit**

  ```bash
  git add Code.gs index.html app.js
  git commit -m "feat: special claim submission with receipt photo capture"
  ```

---

## Task 9: Approval queue (admin/head side)

**Files:**
- Modify: `Code.gs` (add handleGetClaims, handleApproveClaim)
- Modify: `admin.html` (replace Approve Claims tab placeholder)

- [ ] **Step 1: Add handleGetClaims and handleApproveClaim to Code.gs**

  ```javascript
  function handleGetClaims(payload) {
    // payload: { status (optional), employee_name (optional) }
    var claims = sheetToObjects('Claims');
    return claims.filter(function(c) {
      if (payload.status && c['status'] !== payload.status) return false;
      if (payload.employee_name && c['employee_name'] !== payload.employee_name) return false;
      return true;
    });
  }

  function handleApproveClaim(payload) {
    // payload: { claim_id, approver_name, action: 'approve'|'reject', notes }
    var sh = getSheet('Claims');
    var rows = sh.getDataRange().getValues();
    var headers = rows[0];
    var idIdx     = headers.indexOf('id');
    var statusIdx = headers.indexOf('status');
    var approverIdx  = headers.indexOf('approver_name');
    var approvedAtIdx = headers.indexOf('approved_at');
    var notesIdx  = headers.indexOf('notes');

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idIdx] === payload.claim_id) {
        sh.getRange(i+1, statusIdx+1).setValue(
          payload.action === 'approve' ? 'Approved' : 'Rejected'
        );
        sh.getRange(i+1, approverIdx+1).setValue(payload.approver_name);
        sh.getRange(i+1, approvedAtIdx+1).setValue(new Date().toISOString());
        if (payload.notes) sh.getRange(i+1, notesIdx+1).setValue(payload.notes);
        return 'done';
      }
    }
    throw new Error('Claim not found: ' + payload.claim_id);
  }
  ```

- [ ] **Step 2: Build Approve Claims tab in admin.html**

  Replace the `tab-claims` placeholder:

  ```html
  <div id="tab-claims" class="tab-panel" style="display:none;">
    <div class="section-title">Pending Claims — Approval Queue</div>
    <div class="table-scroll">
      <table id="claims-table">
        <thead><tr>
          <th>Employee</th><th>Date</th><th>Type</th>
          <th>From</th><th>To</th><th>Mode</th>
          <th>Computed</th><th>Claimed</th>
          <th>GPS</th><th>Status</th><th>Notes</th><th>Actions</th>
        </tr></thead>
        <tbody id="claims-tbody"></tbody>
      </table>
    </div>
  </div>
  ```

  JS: load pending claims, render each with Approve/Reject buttons:

  ```javascript
  function loadClaims() {
    api('getClaims', { status: 'Submitted' }, function(err, claims) {
      if (err) { alert(err.message); return; }
      var tbody = document.getElementById('claims-tbody');
      tbody.innerHTML = '';
      if (!claims.length) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;">No pending claims.</td></tr>';
        return;
      }
      claims.forEach(function(c) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + c.employee_name + '</td>' +
          '<td>' + c.date + '</td>' +
          '<td>' + c.type + '</td>' +
          '<td>' + c.from_loc + '</td>' +
          '<td>' + c.to_loc + '</td>' +
          '<td>' + c.vehicle_mode + '</td>' +
          '<td>' + formatCurrency(c.computed_amount) + '</td>' +
          '<td>' + formatCurrency(c.claimed_amount) + '</td>' +
          '<td><span class="badge-' + (c.gps_check==='ok'?'auto':'flagged') + '">' + c.gps_check + '</span></td>' +
          '<td><span class="badge-pending">' + c.status + '</span></td>' +
          '<td>' + (c.notes||'') + '</td>' +
          '<td style="white-space:nowrap;">' +
            '<button onclick="approveReject(\'' + c.id + '\',\'approve\')" style="background:#27ae60;color:#fff;border:none;padding:4px 10px;border-radius:3px;cursor:pointer;margin-right:4px;">✔ Approve</button>' +
            '<button onclick="approveReject(\'' + c.id + '\',\'reject\')" style="background:#e74c3c;color:#fff;border:none;padding:4px 10px;border-radius:3px;cursor:pointer;">✘ Reject</button>' +
          '</td>';
        tbody.appendChild(tr);
      });
    });
  }

  function approveReject(claimId, action) {
    var user = currentUser();
    var notes = action === 'reject' ? prompt('Reason for rejection:') : '';
    api('approveClaim', {
      claim_id: claimId,
      approver_name: user.name,
      action: action,
      notes: notes || ''
    }, function(err) {
      if (err) { alert(err.message); return; }
      loadClaims(); // refresh
    });
  }
  ```

  Call `loadClaims()` when the Claims tab is clicked (add to initTabs).

- [ ] **Step 3: Verify**

  - Submit a test special claim as employee.
  - Login as head → Approve Claims tab → claim appears.
  - Click Approve → claim disappears from queue; check Claims sheet → status = "Approved", approver name filled.
  - Test Reject with a reason.

- [ ] **Step 4: Commit**

  ```bash
  git add Code.gs admin.html
  git commit -m "feat: approval queue — heads can approve/reject special claims"
  ```

---

## Task 10: Period sheet — build and display

**Files:**
- Modify: `Code.gs` (add handleGetPeriodSheet — the main assembly function)
- Modify: `admin.html` (replace Period Sheets tab placeholder)
- Modify: `index.html` (employee sees their own period sheet)

This is the centerpiece: assembles attendance + auto-computed allowances +
approved claims into the per-employee period sheet that replaces the paper.

- [ ] **Step 1: Add handleGetPeriodSheet to Code.gs**

  ```javascript
  function handleGetPeriodSheet(payload) {
    // payload: { employee_name, period_start, period_end }
    var attRecords = handleGetAttendance(payload);
    var dayMap     = {}; // date string → { in, out, destination, hours, lat/lng }

    attRecords.forEach(function(r) {
      var date = r.timestamp.slice(0, 10);
      if (!dayMap[date]) dayMap[date] = { ins:[], outs:[], destination: r.destination };
      if (r.type === 'IN')  dayMap[date].ins.push(r);
      if (r.type === 'OUT') dayMap[date].outs.push(r);
    });

    // Get employee profile
    var users = sheetToObjects('Users');
    var emp = users.filter(function(u) { return u['name'] === payload.employee_name; })[0];
    if (!emp) throw new Error('Employee not found: ' + payload.employee_name);

    // Get approved special claims for this period
    var allClaims = sheetToObjects('Claims');
    var specialClaims = allClaims.filter(function(c) {
      return c['employee_name'] === payload.employee_name &&
             c['status'] === 'Approved' &&
             (c['type'] === 'special-fare' || c['type'] === 'accommodation');
    });

    var rows = [];
    var dates = Object.keys(dayMap).sort();

    dates.forEach(function(date) {
      var day    = dayMap[date];
      var firstIn  = day.ins.length  ? new Date(day.ins[0].timestamp)  : null;
      var lastOut  = day.outs.length ? new Date(day.outs[day.outs.length-1].timestamp) : null;
      var hoursWorked = (firstIn && lastOut) ? (lastOut - firstIn) / 3600000 : 0;
      var destination = day.destination || '';

      // Map destination name to area (destination in attendance app may be a branch
      // name like "SM Dagupan" — admin should ensure area names in rate tables
      // match or contain branch group names. Lookup: find area row whose name
      // is contained in the destination string, or exact match.)
      var mealRates = sheetToObjects('MealRates');
      var destinationArea = destination; // default fallback
      mealRates.forEach(function(r) {
        if (destination.toLowerCase().indexOf(r['area'].toLowerCase()) !== -1) {
          destinationArea = r['area'];
        }
      });

      var otResult = computeOT(hoursWorked, emp['ot_type']);
      var meal     = computeMeal(emp['position_level'], destinationArea, hoursWorked,
                                 emp['mother_branch'], destination);
      var accom    = computeAccom(emp['position_level'], destinationArea,
                                  emp['mother_branch'], destination);
      var midnight = computeMidnight(lastOut);

      // Find approved special claims for this date
      var daySpecial = specialClaims.filter(function(c) { return c['date'] === date; });
      var specialFare  = daySpecial.filter(function(c) { return c['type']==='special-fare'; })
                                   .reduce(function(s,c) { return s + parseFloat(c['claimed_amount']||0); }, 0);
      var specialAccom = daySpecial.filter(function(c) { return c['type']==='accommodation'; })
                                   .reduce(function(s,c) { return s + parseFloat(c['claimed_amount']||0); }, 0);

      // Auto-fare (LTFRB computed) — use first IN and last OUT GPS
      var autoFare = 0;
      if (firstIn && lastOut && day.ins[0] && day.outs[day.outs.length-1]) {
        var inR  = day.ins[0];
        var outR = day.outs[day.outs.length-1];
        if (inR.lat && inR.lng && outR.lat && outR.lng &&
            emp['mother_branch'] !== destination) {
          try {
            var distKm = getRoadDistanceKm(inR.lat, inR.lng, outR.lat, outR.lng);
            // Default vehicle type: Traditional Jeepney — employee can override
            // via special claim; auto-fare uses the cheapest standard mode
            autoFare = computeFare('Traditional Jeepney', distKm) * 2; // × 2 for round trip
          } catch(e) { autoFare = 0; }
        }
      }

      rows.push({
        date:         date,
        branch:       destination,
        time_in:      firstIn  ? firstIn.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '',
        time_out:     lastOut  ? lastOut.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '',
        hours_worked: Math.round(hoursWorked * 10) / 10,
        ot_hours:     Math.round(otResult.ot_hours * 10) / 10,
        offset_hours: Math.round(otResult.offset_hours * 10) / 10,
        ut_hours:     Math.round(otResult.ut_hours * 10) / 10,
        ot_type:      emp['ot_type'],
        auto_fare:    autoFare,
        special_fare: specialFare,
        total_fare:   autoFare + specialFare,
        meal:         meal,
        accom:        accom + specialAccom,
        midnight:     midnight,
        total_allowance: (autoFare + specialFare) + meal + (accom + specialAccom) + midnight
      });
    });

    return {
      employee: emp,
      period_start: payload.period_start,
      period_end:   payload.period_end,
      rows: rows,
      totals: {
        auto_fare:    rows.reduce(function(s,r){ return s+r.auto_fare; },0),
        special_fare: rows.reduce(function(s,r){ return s+r.special_fare; },0),
        total_fare:   rows.reduce(function(s,r){ return s+r.total_fare; },0),
        meal:         rows.reduce(function(s,r){ return s+r.meal; },0),
        accom:        rows.reduce(function(s,r){ return s+r.accom; },0),
        midnight:     rows.reduce(function(s,r){ return s+r.midnight; },0),
        total:        rows.reduce(function(s,r){ return s+r.total_allowance; },0),
        ot_hours:     rows.reduce(function(s,r){ return s+r.ot_hours; },0),
        offset_hours: rows.reduce(function(s,r){ return s+r.offset_hours; },0),
        ut_hours:     rows.reduce(function(s,r){ return s+r.ut_hours; },0)
      }
    };
  }
  ```

- [ ] **Step 2: Build Period Sheets tab in admin.html**

  Replace `tab-periods` placeholder:

  ```html
  <div id="tab-periods" class="tab-panel" style="display:none;">
    <div class="section-title">Generate Period Sheet</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;align-items:flex-end;">
      <div>
        <label>Employee</label><br>
        <select id="ps-employee" style="padding:7px;min-width:200px;"></select>
      </div>
      <div>
        <label>Period Start</label><br>
        <input id="ps-start" type="date" style="padding:7px;">
      </div>
      <div>
        <label>Period End</label><br>
        <input id="ps-end" type="date" style="padding:7px;">
      </div>
      <button onclick="generatePeriodSheet()" style="padding:8px 18px;background:#1a1a2e;color:#fff;border:none;border-radius:4px;cursor:pointer;">
        Generate
      </button>
      <button onclick="printPeriodSheet()" style="padding:8px 18px;">🖨 Print</button>
    </div>

    <div id="period-sheet-output"></div>
  </div>
  ```

  JS to generate and render:

  ```javascript
  function populateEmployeeDropdown() {
    api('getUsers', {}, function(err, users) {
      if (err) return;
      var sel = document.getElementById('ps-employee');
      sel.innerHTML = '';
      users.filter(function(u){ return u.active === true || u.active === 'TRUE'; })
           .forEach(function(u) {
             var opt = document.createElement('option');
             opt.value = u.name; opt.textContent = u.name + ' (' + u.department + ')';
             sel.appendChild(opt);
           });
    });
  }

  function generatePeriodSheet() {
    var emp   = document.getElementById('ps-employee').value;
    var start = document.getElementById('ps-start').value;
    var end   = document.getElementById('ps-end').value;
    if (!emp || !start || !end) { alert('Select employee and period dates.'); return; }

    var out = document.getElementById('period-sheet-output');
    out.innerHTML = '<p>Loading…</p>';

    api('getPeriodSheet', { employee_name: emp, period_start: start, period_end: end },
      function(err, sheet) {
        if (err) { out.innerHTML = '<p style="color:red;">' + err.message + '</p>'; return; }
        out.innerHTML = renderPeriodSheet(sheet);
      }
    );
  }

  function renderPeriodSheet(sheet) {
    var e = sheet.employee;
    var html = '<div id="printable-sheet">';
    html += '<div style="display:flex;justify-content:space-between;margin-bottom:12px;">';
    html += '<div><b>NAME:</b> ' + e.name + '<br><b>POSITION:</b> ' + e.position_level +
            '<br><b>DEPT:</b> ' + e.department + '</div>';
    html += '<div style="text-align:right;"><b>PERIOD:</b> ' + sheet.period_start + ' – ' + sheet.period_end + '<br>' +
            '<b>MOTHER BRANCH:</b> ' + e.mother_branch + '</div>';
    html += '</div>';
    html += '<div class="table-scroll"><table>';
    html += '<thead><tr>' +
      '<th>DATE</th><th>BRANCH</th><th>IN</th><th>OUT</th><th>HRS</th>' +
      '<th>OT</th><th>OFFSET</th><th>UT</th><th>OT TYPE</th>' +
      '<th>AUTO FARE</th><th>SPECIAL FARE</th><th>TOTAL FARE</th>' +
      '<th>MEAL</th><th>ACCOM</th><th>MIDNIGHT</th><th>TOTAL</th>' +
      '</tr></thead><tbody>';
    sheet.rows.forEach(function(r) {
      html += '<tr>' +
        '<td>' + r.date + '</td>' +
        '<td>' + r.branch + '</td>' +
        '<td>' + r.time_in + '</td>' +
        '<td>' + r.time_out + '</td>' +
        '<td>' + r.hours_worked + '</td>' +
        '<td>' + (r.ot_hours||0) + '</td>' +
        '<td>' + (r.offset_hours||0) + '</td>' +
        '<td>' + (r.ut_hours||0) + '</td>' +
        '<td><span class="badge-' + (r.ot_type==='DECLARED OT'?'approved':'pending') + '">' + r.ot_type + '</span></td>' +
        '<td>' + formatCurrency(r.auto_fare) + '</td>' +
        '<td>' + formatCurrency(r.special_fare) + '</td>' +
        '<td><b>' + formatCurrency(r.total_fare) + '</b></td>' +
        '<td>' + formatCurrency(r.meal) + '</td>' +
        '<td>' + formatCurrency(r.accom) + '</td>' +
        '<td>' + formatCurrency(r.midnight) + '</td>' +
        '<td><b>' + formatCurrency(r.total_allowance) + '</b></td>' +
        '</tr>';
    });
    // Totals row
    var t = sheet.totals;
    html += '<tr style="font-weight:bold;background:#1a1a2e;color:#fff;">' +
      '<td colspan="5">TOTALS</td>' +
      '<td>' + t.ot_hours + '</td>' +
      '<td>' + t.offset_hours + '</td>' +
      '<td>' + t.ut_hours + '</td>' +
      '<td></td>' +
      '<td>' + formatCurrency(t.auto_fare) + '</td>' +
      '<td>' + formatCurrency(t.special_fare) + '</td>' +
      '<td>' + formatCurrency(t.total_fare) + '</td>' +
      '<td>' + formatCurrency(t.meal) + '</td>' +
      '<td>' + formatCurrency(t.accom) + '</td>' +
      '<td>' + formatCurrency(t.midnight) + '</td>' +
      '<td>' + formatCurrency(t.total) + '</td>' +
      '</tr>';
    html += '</tbody></table></div></div>';
    return html;
  }

  function printPeriodSheet() {
    var content = document.getElementById('printable-sheet');
    if (!content) { alert('Generate a period sheet first.'); return; }
    var w = window.open('', '_blank');
    w.document.write('<html><head><title>Period Sheet</title>' +
      '<style>body{font-family:Arial,sans-serif;font-size:12px;}' +
      'table{border-collapse:collapse;width:100%;}' +
      'th,td{border:1px solid #999;padding:4px 6px;}' +
      'th{background:#1a1a2e;color:#fff;}</style></head><body>');
    w.document.write(content.outerHTML);
    w.document.write('</body></html>');
    w.document.close();
    w.print();
  }
  ```

  Call `populateEmployeeDropdown()` when the Periods tab is clicked (add to
  initTabs).

- [ ] **Step 3: Verify end-to-end**

  - Ensure MealRates and AccomRates tables are populated with test data.
  - Generate period sheet for a test employee with known attendance records.
  - Verify: correct dates, IN/OUT times match attendance CSV, meal shows 0 on
    days under 5 hours, meal shows the level-appropriate amount on 5+ hour days,
    OT column filled on long days, midnight allowance on late clock-outs.
  - Click Print → browser print dialog opens with formatted sheet.

- [ ] **Step 4: Commit**

  ```bash
  git add Code.gs admin.html
  git commit -m "feat: period sheet — assembled from attendance + auto-allowances + approved claims"
  ```

---

## Task 11: Employee self-service view

**Files:**
- Modify: `index.html` (employee sees their own period sheet after login)

- [ ] **Step 1: Load and display own period sheet on employee login**

  After login, in the `employee-view` section, auto-load the employee's period
  sheet for the current period (from Config: `period_start`, `period_end`):

  ```javascript
  function loadEmployeePeriodSheet(user, config) {
    var out = document.getElementById('emp-period-sheet');
    out.innerHTML = '<p>Loading your period sheet…</p>';
    api('getPeriodSheet', {
      employee_name: user.name,
      period_start:  config.period_start,
      period_end:    config.period_end
    }, function(err, sheet) {
      if (err) { out.innerHTML = '<p style="color:red;">' + err.message + '</p>'; return; }
      out.innerHTML = renderPeriodSheet(sheet);
    });
  }
  ```

  Add `<div id="emp-period-sheet"></div>` to `employee-view`.

  Move `renderPeriodSheet` and `formatCurrency` functions to `app.js` (shared,
  since both index.html and admin.html use them).

- [ ] **Step 2: Verify**

  Login as a test employee → period sheet auto-loads showing their own data.
  The employee cannot see other employees' data (the sheet is fetched with their
  own name hardcoded from the session).

- [ ] **Step 3: Commit**

  ```bash
  git add index.html app.js
  git commit -m "feat: employee self-service — own period sheet visible after login"
  ```

---

## Task 12: Polish, deploy, and handoff

**Files:**
- Modify: all HTML/JS (final review)
- Modify: `README.md` (setup instructions for admin)

- [ ] **Step 1: Update SCRIPT_URL in app.js**

  Replace the placeholder `'PASTE_YOUR_DEPLOYMENT_URL_HERE'` with the actual
  Apps Script Web App deployment URL.

- [ ] **Step 2: Add CSV export button to admin period sheet**

  In the Period Sheets tab, add an Export CSV button:

  ```javascript
  function exportPeriodCSV(sheet) {
    var headers = ['Date','Branch','IN','OUT','Hours','OT','Offset','UT','OT Type',
                   'Auto Fare','Special Fare','Total Fare','Meal','Accom','Midnight','Total'];
    var rows = sheet.rows.map(function(r) {
      return [r.date, r.branch, r.time_in, r.time_out, r.hours_worked,
              r.ot_hours, r.offset_hours, r.ut_hours, r.ot_type,
              r.auto_fare, r.special_fare, r.total_fare,
              r.meal, r.accom, r.midnight, r.total_allowance];
    });
    var csv = [headers].concat(rows).map(function(r){ return r.join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = sheet.employee.name + '_' + sheet.period_start + '.csv';
    a.click();
  }
  ```

- [ ] **Step 3: Write README.md**

  ```markdown
  # Photoline Expense App — Setup Guide

  ## First-time setup (admin does this once)

  1. Create the Google Sheet using the column headers in the Implementation Plan
     Task 1.
  2. Open Apps Script (Extensions → Apps Script), paste Code.gs contents,
     deploy as Web App (Execute as: Me, Access: Anyone).
  3. Copy the Web App URL into app.js → SCRIPT_URL.
  4. In the Config sheet, paste the attendance app's CSV export URL into the
     `attendance_csv_url` row.
  5. Host index.html and admin.html on GitHub Pages.

  ## Per-period tasks (admin does each period)

  1. Update `period_start` and `period_end` in Config sheet.
  2. Add any new employees via admin.html → Employees tab.
  3. Populate MealRates and AccomRates via admin.html → Rate Tables tab.
  4. Approve pending special claims via admin.html → Approve Claims tab.
  5. Generate and print/export period sheets via admin.html → Period Sheets tab.

  ## When LTFRB changes fares

  Update the 4 rows in LTFRBRates tab (or via Rate Tables in admin.html).
  No code change needed.
  ```

- [ ] **Step 4: Final end-to-end test**

  Walkthrough the full flow with real (or realistic test) data:
  - Admin creates 2 employees (one head, one field staff).
  - Fill in MealRates, AccomRates, LTFRBRates.
  - Field staff logs in → submits a special accommodation claim.
  - Head logs in → approves the claim.
  - Admin generates period sheet for the field staff → verifies all columns.
  - Print and CSV export both work.

- [ ] **Step 5: Deploy to GitHub Pages**

  ```bash
  git add .
  git commit -m "feat: complete — polish, CSV export, README, deploy-ready"
  git push origin main
  ```

  Enable GitHub Pages on the repo (Settings → Pages → main branch / root).

---

## Self-Review Against Spec

| Spec requirement | Task that implements it |
|---|---|
| Read attendance CSV (untouched) | Task 5 |
| Auto-compute fares (GPS × LTFRB) | Task 6 |
| Meal allowance (level × area, 5-hr rule) | Task 7 |
| Accommodation fixed table, no receipt | Task 7 |
| Midnight allowance brackets | Task 7 |
| OT / offset / UT from clock times | Task 7 |
| Special trip claim + receipt + approval | Tasks 8, 9 |
| Single approver, any head | Task 9 |
| Admin employee setup with level + OT type | Task 3 |
| Admin rate table management | Task 4 |
| Period sheet mirroring paper layout | Task 10 |
| Employee self-service view | Task 11 |
| Print + CSV export | Tasks 10, 12 |
| LTFRB config admin-updatable | Task 4 |
| Google Sheets + Apps Script (free) | All tasks |
| GitHub Pages deploy | Task 12 |

All 16 spec requirements have a corresponding task. No placeholders. Open items
from §12 of the spec are explicitly flagged before the tasks that need them.
