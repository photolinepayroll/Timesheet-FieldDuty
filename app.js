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

// Escapes HTML special characters so untrusted/free-text strings (e.g.
// employee-authored claim notes) can be safely concatenated into innerHTML
// without being interpreted as markup or executable script.
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Period Sheet rendering ----
// Pure sheet -> HTML string function, shared by index.html (employee
// self-service view) and admin.html (Period Sheets tab). Relies only on
// escapeHtml() and formatCurrency() above.
function renderPeriodSheet(sheet, opts) {
  opts = opts || {};
  var adminControls    = !!opts.adminControls;
  var employeeControls = !!opts.employeeControls;
  var e = sheet.employee;
  var html = '<div id="printable-sheet">';
  html += '<div style="display:flex;justify-content:space-between;margin-bottom:12px;">';
  html += '<div><b>NAME:</b> ' + escapeHtml(e.name) + '<br><b>POSITION:</b> ' + escapeHtml(e.position_level) +
          '<br><b>DEPT:</b> ' + escapeHtml(e.department) + '</div>';
  html += '<div style="text-align:right;"><b>PERIOD:</b> ' + escapeHtml(sheet.period_start) + ' — ' + escapeHtml(sheet.period_end) + '<br>' +
          '<b>MOTHER BRANCH:</b> ' + escapeHtml(e.mother_branch) + '</div>';
  html += '</div>';
  html += '<div class="table-scroll"><table>';
  if (employeeControls) {
    html += '<thead><tr>' +
      '<th>DATE</th><th>BRANCH</th><th>IN</th><th>OUT</th><th>HRS</th>' +
      '<th>FROM</th><th>TO</th><th>MODE</th><th>FARE AMT</th>' +
      '<th>MEAL</th><th>ACCOM</th><th>MIDNIGHT</th><th>TOTAL</th>' +
      '<th>FARE CLAIM</th><th>ACCOM CLAIM</th>' +
      '</tr></thead><tbody>';
  } else {
    html += '<thead><tr>' +
      '<th>DATE</th><th>BRANCH</th><th>IN</th><th>OUT</th><th>HRS</th>' +
      '<th>AUTO FARE</th><th>SPECIAL FARE</th><th>TOTAL FARE</th>' +
      '<th>MEAL</th><th>ACCOM</th><th>MIDNIGHT</th><th>TOTAL</th>' +
      (adminControls ? '<th>MEAL CTRL</th>' : '') +
      '</tr></thead><tbody>';
  }
  sheet.rows.forEach(function(r) {
    html += '<tr>' +
      '<td>' + escapeHtml(r.date) + '</td>' +
      '<td>' + escapeHtml(r.branch) + '</td>' +
      '<td>' + escapeHtml(r.time_in) + '</td>' +
      '<td>' + escapeHtml(r.time_out) + '</td>' +
      '<td>' + r.hours_worked + '</td>';

    if (employeeControls) {
      var claimDetails = r.claim_details || [];
      var fareClaim  = null;
      var accumClaim = null;
      claimDetails.forEach(function(c) {
        if (c.type === 'special-fare'  && !fareClaim)  fareClaim  = c;
        if (c.type === 'accommodation' && !accumClaim) accumClaim = c;
      });
      html +=
        '<td>' + escapeHtml(fareClaim ? fareClaim.from_loc    : '') + '</td>' +
        '<td>' + escapeHtml(fareClaim ? fareClaim.to_loc      : '') + '</td>' +
        '<td>' + escapeHtml(fareClaim ? fareClaim.vehicle_mode : '') + '</td>' +
        '<td>' + formatCurrency(r.total_fare) + '</td>' +
        '<td>' + formatCurrency(r.meal) + '</td>' +
        '<td>' + formatCurrency(r.accom) + '</td>' +
        '<td>' + formatCurrency(r.midnight) + '</td>' +
        '<td><b>' + formatCurrency(r.total_allowance) + '</b></td>';
      // FARE CLAIM column: + Fare button or status badge
      if (!fareClaim) {
        html += '<td><button class="emp-claim-btn" data-date="' + escapeHtml(r.date) + '" data-type="special-fare">+ Fare</button></td>';
      } else {
        var fareLabel = fareClaim.status === 'Approved' ? '✓ Approved' : '⏳ Pending';
        html += '<td><span class="claim-status-badge claim-status-' + escapeHtml(fareClaim.status.toLowerCase()) + '">' + fareLabel + '</span></td>';
      }
      // ACCOM CLAIM column: + Accom button or status badge
      if (!accumClaim) {
        html += '<td><button class="emp-claim-btn" data-date="' + escapeHtml(r.date) + '" data-type="accommodation">+ Accom</button></td>';
      } else {
        var accumLabel = accumClaim.status === 'Approved' ? '✓ Approved' : '⏳ Pending';
        html += '<td><span class="claim-status-badge claim-status-' + escapeHtml(accumClaim.status.toLowerCase()) + '">' + accumLabel + '</span></td>';
      }
    } else {
      html +=
        '<td>' + formatCurrency(r.auto_fare) + '</td>' +
        '<td>' + formatCurrency(r.special_fare) + '</td>' +
        '<td><b>' + formatCurrency(r.total_fare) + '</b></td>' +
        '<td>' + formatCurrency(r.meal) + '</td>' +
        '<td>' + formatCurrency(r.accom) + '</td>' +
        '<td>' + formatCurrency(r.midnight) + '</td>' +
        '<td><b>' + formatCurrency(r.total_allowance) + '</b></td>';
      if (adminControls) {
        // Button must remain visible on a denied row (meal forced to 0 by
        // the server) so the admin can reverse the denial — checking only
        // `r.meal > 0` would make the button disappear the moment a row
        // is denied. r.date is a plain 'YYYY-MM-DD' string (never
        // employee-authored free text), but it's escaped anyway for the
        // attribute value per this file's existing convention.
        if (r.meal > 0 || r.meal_denied) {
          html += '<td><button class="meal-deny-btn" data-date="' + escapeHtml(r.date) + '">' +
            (r.meal_denied ? 'Allow Meal' : 'Deny Meal') + '</button></td>';
        } else {
          html += '<td></td>';
        }
      }
    }
    html += '</tr>';
  });
  // Totals row
  var t = sheet.totals;
  if (employeeControls) {
    html += '<tr style="font-weight:bold;background:var(--blue2);color:#fff;">' +
      '<td colspan="5">TOTALS</td>' +
      '<td colspan="3"></td>' +
      '<td>' + formatCurrency(t.total_fare) + '</td>' +
      '<td>' + formatCurrency(t.meal) + '</td>' +
      '<td>' + formatCurrency(t.accom) + '</td>' +
      '<td>' + formatCurrency(t.midnight) + '</td>' +
      '<td>' + formatCurrency(t.total) + '</td>' +
      '<td colspan="2"></td>' +
      '</tr>';
  } else {
    html += '<tr style="font-weight:bold;background:var(--blue2);color:#fff;">' +
      '<td colspan="5">TOTALS</td>' +
      '<td>' + formatCurrency(t.auto_fare) + '</td>' +
      '<td>' + formatCurrency(t.special_fare) + '</td>' +
      '<td>' + formatCurrency(t.total_fare) + '</td>' +
      '<td>' + formatCurrency(t.meal) + '</td>' +
      '<td>' + formatCurrency(t.accom) + '</td>' +
      '<td>' + formatCurrency(t.midnight) + '</td>' +
      '<td>' + formatCurrency(t.total) + '</td>' +
      (adminControls ? '<td></td>' : '') +
      '</tr>';
  }
  html += '</tbody></table></div></div>';
  return html;
}

// ---- Attendance ----
// Groups raw attendance records into day-summaries per employee
function groupAttendanceByDay(records) {
  // returns { 'YYYY-MM-DD': { ins, outs, destination, first_in, last_out, hours_worked, in_record, out_record } }
  var days = {};
  records.forEach(function(r) {
    // Real attendance app writes Timestamp as 'YYYY-MM-DD HH:MM:SS' (space-
    // separated, not ISO). Use the space-split as the primary path; keep the
    // T-split as a defensive fallback in case a record is ever ISO-formatted.
    var date = r.timestamp.indexOf('T') !== -1
      ? r.timestamp.split('T')[0]
      : r.timestamp.split(' ')[0];
    if (!days[date]) days[date] = { ins: [], outs: [], destination: r.destination };
    if (r.type === 'Log In')  days[date].ins.push(r);
    if (r.type === 'Log Out') days[date].outs.push(r);
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
