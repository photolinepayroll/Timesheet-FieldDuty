// app.js — shared by index.html and admin.html

var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby1nwaPJuGeqYQOFu9Jwre5AzgnPMkJp8wWdSwgi-U9YTCiB_ZvAJ6juoGSv3JfwmKxKQ/exec';

// ---- API ----
// Read-only actions go via GET (query string) instead of POST: Apps Script's
// /exec responses inconsistently carry Access-Control-Allow-Origin on POST,
// so cross-origin fetch() from GitHub Pages can get silently CORS-blocked
// even when the request succeeded server-side — GET responses carry that
// header reliably. Writes stay POST since some payloads (saveClaim's
// receipt photos, saveRates' full-table replace) are too large for a URL.
// Must mirror Code.gs's HANDLERS `get: true` list.
var GET_ACTIONS = {
  ping: true, login: true, getUsers: true, getRates: true,
  getAttendance: true, getConfig: true, getClaims: true, getPeriodSheet: true,
  checkNameMatches: true
};

function api(action, params, cb) {
  var body = Object.assign({ action: action }, params || {});
  var useGet = !!GET_ACTIONS[action];
  var url = SCRIPT_URL;
  var opts = { method: 'POST', body: JSON.stringify(body) };
  if (useGet) {
    var qs = Object.keys(body).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(body[k]);
    }).join('&');
    url = SCRIPT_URL + '?' + qs;
    opts = { method: 'GET' };
  }
  fetch(url, opts)
  .then(function(r) {
    return r.text().then(function(text) {
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        throw new Error(
          'Server returned an unexpected response instead of JSON — the ' +
          'Apps Script Web App may need to be redeployed, or its access ' +
          'permission may not be set to "Anyone". (Raw response started ' +
          'with: ' + text.slice(0, 60) + ')'
        );
      }
    });
  })
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
// Builds the Start Shift / End Shift <select> for a day (employeeControls
// only) — options come from that date's actual raw Log In/Log Out
// timestamps (r.day_ins/r.day_outs), so the employee can only ever pick a
// real logged event, never type an arbitrary time. Pre-selects whichever
// timestamp is currently in effect (r.time_in_raw/r.time_out_raw — the
// employee's saved override if one exists, otherwise the day's auto-
// default first-in/last-out).
function renderShiftSelect(r, which) {
  var options = which === 'start' ? (r.day_ins || []) : (r.day_outs || []);
  var current = which === 'start' ? r.time_in_raw : r.time_out_raw;
  var cls     = which === 'start' ? 'shift-start-select' : 'shift-end-select';
  var opts = '<option value="">-</option>' + options.map(function(o) {
    var sel = (o.timestamp === current) ? ' selected' : '';
    return '<option value="' + escapeHtml(o.timestamp) + '"' + sel + '>' + escapeHtml(o.label) + '</option>';
  }).join('');
  return '<select class="' + cls + '" data-date="' + escapeHtml(r.date) + '">' + opts + '</select>';
}

// Pure sheet -> HTML string function, shared by index.html (employee
// self-service view) and admin.html (Period Sheets tab). Relies only on
// escapeHtml() and formatCurrency() above.
function renderPeriodSheet(sheet, opts) {
  opts = opts || {};
  var adminControls    = !!opts.adminControls;
  var employeeControls = !!opts.employeeControls;
  var e = sheet.employee;
  // Days-worked/total-hours summary + DAY-column numbering — employee view
  // only, purely derived from the day-level hours_worked field (already
  // zeroed by the backend whenever a day's effective first-in/last-out
  // pairing is incomplete, whether auto-derived or employee-overridden), so
  // this stays on the same day-level footing as the rest of the sheet's
  // day-level columns. dayNumbers only gets an entry for a RESOLVED date
  // (hours_worked > 0) — an unresolved date in between simply has no entry,
  // so the next resolved date continues the count rather than reserving a
  // number for it.
  var daysWorked = 0, totalHours = 0, dayNumbers = {};
  if (employeeControls) {
    var dayCounter = 0;
    sheet.rows.forEach(function(r) {
      totalHours += (r.hours_worked || 0);
      if (r.hours_worked > 0) {
        daysWorked++;
        dayCounter++;
        dayNumbers[r.date] = dayCounter;
      }
    });
  }
  var html = '<div id="printable-sheet">';
  html += '<div style="display:flex;justify-content:space-between;margin-bottom:12px;">';
  html += '<div><b>NAME:</b> ' + escapeHtml(e.name) + '<br><b>POSITION:</b> ' + escapeHtml(e.position_level) +
          '<br><b>DEPT:</b> ' + escapeHtml(e.department) + '</div>';
  html += '<div style="text-align:right;"><b>PERIOD:</b> ' + escapeHtml(sheet.period_start) + ' — ' + escapeHtml(sheet.period_end) + '<br>' +
          '<b>MOTHER BRANCH:</b> ' + escapeHtml(e.mother_branch) +
          (employeeControls ? '<br><b>DAYS WORKED:</b> ' + daysWorked + '<br><b>TOTAL HOURS:</b> ' + totalHours.toFixed(1) : '') +
          '</div>';
  html += '</div>';
  html += '<div class="table-scroll"><table>';
  if (employeeControls) {
    html += '<thead><tr>' +
      '<th>DAY</th><th>DATE</th><th>BRANCH</th><th>START SHIFT</th><th>END SHIFT</th><th>HRS</th>' +
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
    var claimDetails = r.claim_details || [];
    // Itemized log-in/out segments — one <tr> per segment. A day with a
    // single complete in/out pair has exactly one segment, so this
    // reproduces today's one-row-per-day output unchanged (rowspan=1 is a
    // no-op); only genuinely multi-segment ("roving") days visibly differ.
    var segments = (r.segments && r.segments.length) ? r.segments : [null];
    var accumClaim = null; // accommodation stays day-level — a hotel stay isn't per-segment
    claimDetails.forEach(function(c) {
      if (c.type === 'accommodation' && !accumClaim) accumClaim = c;
    });

    segments.forEach(function(seg, si) {
      html += '<tr>';
      if (si === 0) {
        if (employeeControls) {
          html += '<td rowspan="' + segments.length + '">' + (dayNumbers[r.date] || '') + '</td>';
        }
        html += '<td rowspan="' + segments.length + '">' + escapeHtml(r.date) + '</td>';
        html += '<td rowspan="' + segments.length + '">' + escapeHtml(r.branch) + '</td>';
      }
      if (employeeControls) {
        // Start/End Shift are day-level (the employee's selection applies
        // to the whole day, not per-segment) — shown once, spanning every
        // segment row of that day, same as DATE/BRANCH above.
        if (si === 0) {
          html += '<td rowspan="' + segments.length + '">' + renderShiftSelect(r, 'start') + '</td>';
          html += '<td rowspan="' + segments.length + '">' + renderShiftSelect(r, 'end')   + '</td>';
        }
      } else {
        html += '<td>' + escapeHtml(seg ? seg.time_in  : r.time_in)  + '</td>';
        html += '<td>' + escapeHtml(seg ? seg.time_out : r.time_out) + '</td>';
      }
      if (si === 0) {
        html += '<td rowspan="' + segments.length + '">' + r.hours_worked + '</td>';
      }

      if (employeeControls) {
        // Per-segment fare claim: match by segment_key. A legacy (pre-
        // feature) claim with a blank segment_key has no segment to
        // attach to — attribute it to segment index 0 as a fallback (no
        // such claim should exist for a genuinely multi-segment day, since
        // per-segment claiming didn't exist before this feature).
        var segClaim = seg ? claimDetails.filter(function(c) {
          return c.type === 'special-fare' && c.segment_key === seg.seg_key;
        })[0] : null;
        if (!segClaim && si === 0) {
          segClaim = claimDetails.filter(function(c) {
            return c.type === 'special-fare' && !c.segment_key;
          })[0] || null;
        }
        html +=
          '<td>' + escapeHtml(segClaim ? segClaim.from_loc     : '') + '</td>' +
          '<td>' + escapeHtml(segClaim ? segClaim.to_loc       : '') + '</td>' +
          '<td>' + escapeHtml(segClaim ? segClaim.vehicle_mode : '') + '</td>' +
          '<td>' + formatCurrency(segClaim ? segClaim.claimed_amount : 0) + '</td>';
        if (si === 0) {
          html +=
            '<td rowspan="' + segments.length + '">' + formatCurrency(r.meal) + '</td>' +
            '<td rowspan="' + segments.length + '">' + formatCurrency(r.accom) + '</td>' +
            '<td rowspan="' + segments.length + '">' + formatCurrency(r.midnight) + '</td>' +
            '<td rowspan="' + segments.length + '"><b>' + formatCurrency(r.total_allowance) + '</b></td>';
        }
        // FARE CLAIM column: + Fare button (one per segment) or status badge
        if (!segClaim) {
          html += '<td><button class="emp-claim-btn" data-date="' + escapeHtml(r.date) + '" data-seg="' + escapeHtml(seg ? seg.seg_key : '') + '" data-type="special-fare">+ Fare</button></td>';
        } else {
          var fareLabel = segClaim.status === 'Approved' ? '✓ Approved' : '⏳ Pending';
          html += '<td><span class="claim-status-badge claim-status-' + escapeHtml(segClaim.status.toLowerCase()) + '">' + fareLabel + '</span></td>';
        }
        // ACCOM CLAIM column: + Accom button or status badge — day-level, one per day
        if (si === 0) {
          if (!accumClaim) {
            html += '<td rowspan="' + segments.length + '"><button class="emp-claim-btn" data-date="' + escapeHtml(r.date) + '" data-type="accommodation">+ Accom</button></td>';
          } else {
            var accumLabel = accumClaim.status === 'Approved' ? '✓ Approved' : '⏳ Pending';
            html += '<td rowspan="' + segments.length + '"><span class="claim-status-badge claim-status-' + escapeHtml(accumClaim.status.toLowerCase()) + '">' + accumLabel + '</span></td>';
          }
        }
      } else if (si === 0) {
        html +=
          '<td rowspan="' + segments.length + '">' + formatCurrency(r.auto_fare) + '</td>' +
          '<td rowspan="' + segments.length + '">' + formatCurrency(r.special_fare) + '</td>' +
          '<td rowspan="' + segments.length + '"><b>' + formatCurrency(r.total_fare) + '</b></td>' +
          '<td rowspan="' + segments.length + '">' + formatCurrency(r.meal) + '</td>' +
          '<td rowspan="' + segments.length + '">' + formatCurrency(r.accom) + '</td>' +
          '<td rowspan="' + segments.length + '">' + formatCurrency(r.midnight) + '</td>' +
          '<td rowspan="' + segments.length + '"><b>' + formatCurrency(r.total_allowance) + '</b></td>';
        if (adminControls) {
          // Button must remain visible on a denied row (meal forced to 0 by
          // the server) so the admin can reverse the denial — checking only
          // `r.meal > 0` would make the button disappear the moment a row
          // is denied. r.date is a plain 'YYYY-MM-DD' string (never
          // employee-authored free text), but it's escaped anyway for the
          // attribute value per this file's existing convention. Meal
          // control stays one-per-day (rowspan) even on a multi-segment
          // day — meal is a day-level allowance, not per-segment.
          if (r.meal > 0 || r.meal_denied) {
            // Button label is the ACTION ("Allow Meal" reverses a denial), not
            // the current status — easy to misread as "meal is allowed" when
            // a row is actually denied. The colored status word in front of it
            // (and the button's own background color) is the actual state
            // indicator; the button text alone should never be relied on.
            html += '<td rowspan="' + segments.length + '">' +
              '<span data-status-for="' + escapeHtml(r.date) + '" style="font-weight:bold;color:' + (r.meal_denied ? '#b00020' : '#0a7d2c') + ';margin-right:6px;">' +
                (r.meal_denied ? 'DENIED' : 'ALLOWED') +
              '</span>' +
              '<button class="meal-deny-btn" data-date="' + escapeHtml(r.date) + '" data-denied="' + !!r.meal_denied + '" ' +
                'style="background:' + (r.meal_denied ? '#b00020' : '#1a1a2e') + ';">' +
                (r.meal_denied ? 'Allow Meal' : 'Deny Meal') +
              '</button></td>';
          } else {
            html += '<td rowspan="' + segments.length + '"></td>';
          }
        }
      }
      html += '</tr>';
    });
  });
  // Totals row
  var t = sheet.totals;
  if (employeeControls) {
    html += '<tr style="font-weight:bold;background:var(--blue2);color:#fff;">' +
      '<td colspan="6">TOTALS</td>' +
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
