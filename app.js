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

// Shared centered loading placeholder (spinner + text) for content areas
// that get replaced while a fetch is in flight — used by both pages instead
// of each repeating the same markup for the period sheet / claims list /
// attendance list / etc.
function loadingSpinnerHtml(text) {
  return '<div style="text-align:center;padding:24px 0;color:#666;">' +
    '<div class="pl-spinner-lg"></div>' + escapeHtml(text) + '</div>';
}

// ---- Period Sheet rendering ----
// Per-row SHIFT tag <select> (employeeControls only) — the employee tags an
// individual raw log as the Start or End of a shift; resolveShiftDays()
// (Code.gs, server-side) pairs a tagged Start with the next tagged End that
// follows it chronologically into a "resolved Day."
function renderShiftTagSelect(row) {
  var opts = ['', 'start', 'end'].map(function(v) {
    var label = v === '' ? '-' : (v === 'start' ? 'Start' : 'End');
    var sel = (row.tag === v) ? ' selected' : '';
    return '<option value="' + v + '"' + sel + '>' + label + '</option>';
  }).join('');
  // data-original lets the change handler tell "genuinely changed from what
  // the server last returned" apart from "toggled back to where it
  // started" — the latter should NOT count as a pending change (same
  // reasoning as admin.html's meal-deny batching).
  return '<select class="shift-tag-select" data-timestamp="' + escapeHtml(row.timestamp) + '" data-original="' + escapeHtml(row.tag) + '">' + opts + '</select>';
}

// Pre-pass over the flat per-log timeline (employeeControls only): computes,
// per row index, whether it starts/continues a resolved-Day range (drives
// DAY/HRS/MEAL/ACCOM/MIDNIGHT/TOTAL/ACCOM CLAIM rowspans) and whether it
// starts/continues a per-location segment range (drives FROM/TO/MODE/FARE
// AMT/FARE CLAIM rowspans, matched back from each date's existing
// segments[] by exact timestamp). These are two INDEPENDENT rowspan systems
// layered over the same row list — a segment's 2 rows can straddle a
// Day-range boundary, or exist with no Day-range at all; neither system
// needs to know the other's span.
function buildLogRowSpans(logs, daysByNumber, rowsByDate) {
  var n = logs.length;
  var spans = [];
  for (var i = 0; i < n; i++) {
    spans.push({
      dayGroupStart: false, daySpanLength: 0, day: null, dayContinuation: false,
      segGroupStart: false, segSpanLength: 0, seg: null, segDate: null, segContinuation: false
    });
  }

  // Day-range runs: contiguous rows sharing the same non-null day_number —
  // safe to detect by equality alone since resolveShiftDays (Code.gs) never
  // produces overlapping Days (a new Start always closes or abandons the
  // previous pending one first).
  var i = 0;
  while (i < n) {
    var dn = logs[i].day_number;
    if (!dn) { i++; continue; }
    var j = i;
    while (j < n && logs[j].day_number === dn) j++;
    spans[i].dayGroupStart = true;
    spans[i].daySpanLength = j - i;
    spans[i].day = daysByNumber[dn];
    for (var k = i + 1; k < j; k++) spans[k].dayContinuation = true;
    i = j;
  }

  var indexByTimestamp = {};
  logs.forEach(function(row, idx) { indexByTimestamp[row.timestamp] = idx; });

  Object.keys(rowsByDate).forEach(function(date) {
    var segments = rowsByDate[date].segments || [];
    segments.forEach(function(seg) {
      var inIdx  = seg.time_in_raw  ? indexByTimestamp[seg.time_in_raw]  : undefined;
      var outIdx = seg.time_out_raw ? indexByTimestamp[seg.time_out_raw] : undefined;
      if (inIdx === undefined && outIdx === undefined) return;
      var lo = (inIdx !== undefined && outIdx !== undefined) ? Math.min(inIdx, outIdx) : (inIdx !== undefined ? inIdx : outIdx);
      var hi = (inIdx !== undefined && outIdx !== undefined) ? Math.max(inIdx, outIdx) : lo;
      spans[lo].segGroupStart = true;
      spans[lo].segSpanLength = hi - lo + 1;
      spans[lo].seg = seg;
      spans[lo].segDate = date;
      for (var k = lo + 1; k <= hi; k++) spans[k].segContinuation = true;
    });
  });

  return spans;
}

// Pure sheet -> HTML string function, shared by index.html (employee
// self-service view) and admin.html (Period Sheets tab). Relies only on
// escapeHtml() and formatCurrency() above.
function renderPeriodSheet(sheet, opts) {
  opts = opts || {};
  var adminControls    = !!opts.adminControls;
  var employeeControls = !!opts.employeeControls;
  // Default true so index.html's existing call (which never sets this) is
  // unaffected — admin.html's per-log view passes false since claims there
  // are managed via the separate Approve Claims tab, not filed from here.
  var claimsInteractive = opts.claimsInteractive !== false;
  var e = sheet.employee;
  // Days-worked/total-hours summary — employee view only, derived from
  // sheet.days (one entry per RESOLVED Start/End tag pair — see
  // resolveShiftDays in Code.gs). Every entry in sheet.days already
  // represents a complete, resolved shift, so daysWorked is simply its
  // length — no filtering needed (unlike the old date-bucketed scheme,
  // there's no "date with 0 hours" case to exclude here).
  var daysWorked = 0, totalHours = 0;
  if (employeeControls) {
    daysWorked = (sheet.days || []).length;
    (sheet.days || []).forEach(function(d) { totalHours += (d.hours_worked || 0); });
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
      '<th>DATE</th><th>DAY</th><th>SHIFT</th><th>TIME</th><th>BRANCH</th><th>HRS</th>' +
      '<th>FARE AMT</th><th>FARE CLAIM</th>' +
      '<th>MEAL</th><th>ACCOM</th><th>MIDNIGHT</th><th>TOTAL</th><th>ACCOM CLAIM</th>' +
      (adminControls ? '<th>MEAL CTRL</th>' : '') +
      '</tr></thead><tbody>';
  } else {
    html += '<thead><tr>' +
      '<th>DATE</th><th>BRANCH</th><th>IN</th><th>OUT</th><th>HRS</th>' +
      '<th>AUTO FARE</th><th>SPECIAL FARE</th><th>TOTAL FARE</th>' +
      '<th>MEAL</th><th>ACCOM</th><th>MIDNIGHT</th><th>TOTAL</th>' +
      (adminControls ? '<th>MEAL CTRL</th>' : '') +
      '</tr></thead><tbody>';
  }
  if (employeeControls) {
    // Flat, whole-period, chronological per-log timeline — one <tr> per raw
    // attendance log (sheet.logs), not per calendar date. DAY/HRS/FARE AMT/
    // FARE CLAIM/MEAL/ACCOM/MIDNIGHT/TOTAL/ACCOM CLAIM all rowspan across a
    // resolved Day's row range (sheet.days — see resolveShiftDays in
    // Code.gs), or a single standalone row when a log isn't part of any
    // resolved Day. Fare used to get its own segment-level rowspan group
    // (independent of the Day range, with its own FROM/TO/MODE columns) —
    // stacking one "+ Fare" button per segment made a multi-segment day look
    // cluttered/confusing, so all of a range's segments now collapse into
    // one merged FARE AMT/FARE CLAIM cell, with a picker dropdown (see
    // toggleFarePicker below) when a range has more than one segment.
    var daysByNumber = {};
    (sheet.days || []).forEach(function(d) { daysByNumber[d.dayNumber] = d; });
    var rowsByDate = {};
    sheet.rows.forEach(function(r) { rowsByDate[r.date] = r; });
    var logs = sheet.logs || [];
    var spans = buildLogRowSpans(logs, daysByNumber, rowsByDate);

    // Collects every distinct segment (see buildLogRowSpans) whose rows fall
    // within [startIdx, startIdx+length) — a Day range can span segments
    // from two calendar dates (an overnight shift), so this looks at row
    // position, not date.
    function collectRangeSegments(startIdx, length) {
      var out = [];
      for (var k = startIdx; k < startIdx + length; k++) {
        if (spans[k] && spans[k].segGroupStart) {
          out.push({ seg: spans[k].seg, segDate: spans[k].segDate });
        }
      }
      return out;
    }

    // Builds the merged FARE AMT + FARE CLAIM <td> pair for a row range.
    // A range with exactly one segment renders identically to the old
    // per-segment cell (a single button/status, no picker) — only a
    // genuinely multi-segment range shows the "Fare (x/y)" picker button.
    function buildFareCells(startIdx, length, rowspanLen) {
      var rangeSegs = collectRangeSegments(startIdx, length);
      var totalAmt = 0;
      var pickerItems = rangeSegs.map(function(item) {
        var dateRow = rowsByDate[item.segDate];
        var claimDetails = (dateRow && dateRow.claim_details) || [];
        // Per-segment fare claim: match by segment_key. A legacy (pre-
        // feature) claim with a blank segment_key has no segment to
        // attach to — same fallback as before this rewrite.
        var segClaim = claimDetails.filter(function(c) {
          return c.type === 'special-fare' && c.segment_key === item.seg.seg_key;
        })[0];
        if (!segClaim) {
          segClaim = claimDetails.filter(function(c) {
            return c.type === 'special-fare' && !c.segment_key;
          })[0] || null;
        }
        if (segClaim) { totalAmt += parseFloat(segClaim.claimed_amount || 0); }
        var label = (item.seg.time_in || '?') + '–' + (item.seg.time_out || '?') +
          (item.seg.destination ? (' @ ' + item.seg.destination) : '');
        return {
          date: item.segDate,
          segKey: item.seg.seg_key,
          label: label,
          status: segClaim ? segClaim.status : '',
          amount: segClaim ? segClaim.claimed_amount : null
        };
      });

      var amtCell = '<td rowspan="' + rowspanLen + '">' + formatCurrency(totalAmt) + '</td>';
      var claimCellInner = '';
      if (pickerItems.length === 1) {
        var only = pickerItems[0];
        if (!only.status) {
          claimCellInner = claimsInteractive
            ? '<button class="emp-claim-btn" data-date="' + escapeHtml(only.date) + '" data-seg="' + escapeHtml(only.segKey) + '" data-type="special-fare">+ Fare</button>'
            : 'Not filed';
        } else {
          var soloLabel = only.status === 'Approved' ? '✓ Approved' : '⏳ Pending';
          claimCellInner = '<span class="claim-status-badge claim-status-' + escapeHtml(only.status.toLowerCase()) + '">' + soloLabel + '</span>';
        }
      } else if (pickerItems.length > 1) {
        var unclaimed = pickerItems.filter(function(p) { return !p.status; }).length;
        // The toggle itself stays clickable either way (admin can still see
        // the per-segment breakdown) -- data-interactive tells
        // toggleFarePicker() (below) whether an unclaimed segment inside
        // the opened list gets a "+ Fare" action button or plain text.
        claimCellInner =
          '<div class="fare-picker">' +
            '<button type="button" class="fare-picker-btn" data-interactive="' + claimsInteractive + '" data-segs=\'' + escapeHtml(JSON.stringify(pickerItems)) + '\'>' +
              'Fare (' + (pickerItems.length - unclaimed) + '/' + pickerItems.length + ')' +
            '</button>' +
          '</div>';
      }
      var claimCell = '<td rowspan="' + rowspanLen + '">' + claimCellInner + '</td>';
      return amtCell + claimCell;
    }

    // Admin-only (adminControls) MEAL CTRL cell, shared by the resolved-Day
    // path and the standalone-row calendar-date fallback below. Markup is
    // byte-identical to the old adminControls-only branch's meal-ctrl cell
    // (same .meal-deny-btn class/data-date/data-denied attributes, same
    // data-status-for span) so admin.html's existing saveMealChanges() --
    // which reads these generically by class/data-attribute -- needs no
    // changes. `row` can be undefined (no sheet.rows entry at all for this
    // date, shouldn't normally happen) -- renders an empty cell rather than
    // throwing.
    function buildMealCtrlCell(row, rowspanLen) {
      var rsAttr = rowspanLen ? (' rowspan="' + rowspanLen + '"') : '';
      if (!row || !(row.meal > 0 || row.meal_denied)) return '<td' + rsAttr + '></td>';
      return '<td' + rsAttr + '>' +
        '<span data-status-for="' + escapeHtml(row.date) + '" style="font-weight:bold;color:' + (row.meal_denied ? '#b00020' : '#0a7d2c') + ';margin-right:6px;">' +
          (row.meal_denied ? 'DENIED' : 'ALLOWED') +
        '</span>' +
        '<button class="meal-deny-btn" data-date="' + escapeHtml(row.date) + '" data-denied="' + !!row.meal_denied + '" ' +
          'style="background:' + (row.meal_denied ? '#b00020' : '#1a1a2e') + ';">' +
          (row.meal_denied ? 'Allow Meal' : 'Deny Meal') +
        '</button></td>';
    }

    logs.forEach(function(row, i) {
      var sp = spans[i];
      html += '<tr>';
      html += '<td>' + escapeHtml(row.date) + '</td>';

      if (sp.dayGroupStart) {
        html += '<td rowspan="' + sp.daySpanLength + '">' + sp.day.dayNumber + '</td>';
      } else if (!sp.dayContinuation) {
        html += '<td></td>';
      }

      html += '<td>' + renderShiftTagSelect(row) + '</td>';
      html += '<td>' + escapeHtml(row.time_label) + '</td>';
      html += '<td>' + escapeHtml(row.destination || '') + '</td>';

      if (sp.dayGroupStart) {
        html += '<td rowspan="' + sp.daySpanLength + '">' + sp.day.hours_worked + '</td>';
      } else if (!sp.dayContinuation) {
        html += '<td></td>';
      }

      // FARE AMT/FARE CLAIM/MEAL/ACCOM/MIDNIGHT/TOTAL/ACCOM CLAIM — day-range level
      if (sp.dayGroupStart) {
        html += buildFareCells(i, sp.daySpanLength, sp.daySpanLength);
        html +=
          '<td rowspan="' + sp.daySpanLength + '">' + formatCurrency(sp.day.meal) + '</td>' +
          '<td rowspan="' + sp.daySpanLength + '">' + formatCurrency(sp.day.accom) + '</td>' +
          '<td rowspan="' + sp.daySpanLength + '">' + formatCurrency(sp.day.midnight) + '</td>' +
          '<td rowspan="' + sp.daySpanLength + '"><b>' + formatCurrency(sp.day.total) + '</b></td>';
        var ownDateRow = rowsByDate[sp.day.ownDate];
        var ownClaimDetails = (ownDateRow && ownDateRow.claim_details) || [];
        var accumClaim = ownClaimDetails.filter(function(c) { return c.type === 'accommodation'; })[0] || null;
        if (!accumClaim) {
          html += '<td rowspan="' + sp.daySpanLength + '">' + (claimsInteractive
            ? '<button class="emp-claim-btn" data-date="' + escapeHtml(sp.day.ownDate) + '" data-type="accommodation">+ Accom</button>'
            : 'Not filed') + '</td>';
        } else {
          var accumLabel = accumClaim.status === 'Approved' ? '✓ Approved' : '⏳ Pending';
          html += '<td rowspan="' + sp.daySpanLength + '"><span class="claim-status-badge claim-status-' + escapeHtml(accumClaim.status.toLowerCase()) + '">' + accumLabel + '</span></td>';
        }
        if (adminControls) html += buildMealCtrlCell(rowsByDate[sp.day.ownDate], sp.daySpanLength);
      } else if (!sp.dayContinuation) {
        html += buildFareCells(i, 1, 1);
        // A standalone row (no resolved Start/End Day) used to leave MEAL/
        // ACCOM/MIDNIGHT/TOTAL blank -- fine for the employee's own view
        // (encourages tagging), but admin's payroll view needs to see the
        // calendar-date auto-computed values regardless of whether the
        // employee has tagged anything. Falls back to that date's
        // already-computed sheet.rows entry. Kept simple (rowspan=1, no new
        // date-grouping): a date with several untagged stray logs just
        // repeats the same day-level value on each of its rows.
        var fallbackRow = rowsByDate[row.date];
        if (fallbackRow) {
          html +=
            '<td>' + formatCurrency(fallbackRow.meal) + '</td>' +
            '<td>' + formatCurrency(fallbackRow.accom) + '</td>' +
            '<td>' + formatCurrency(fallbackRow.midnight) + '</td>' +
            '<td><b>' + formatCurrency(fallbackRow.total_allowance) + '</b></td>' +
            '<td></td>'; // ACCOM CLAIM -- no resolved Day to anchor a claim to here
        } else {
          html += '<td></td><td></td><td></td><td></td><td></td>';
        }
        if (adminControls) html += buildMealCtrlCell(fallbackRow);
      }

      html += '</tr>';
    });
  } else {
    sheet.rows.forEach(function(r) {
      // Itemized log-in/out segments — one <tr> per segment. A day with a
      // single complete in/out pair has exactly one segment, so this
      // reproduces today's one-row-per-day output unchanged (rowspan=1 is a
      // no-op); only genuinely multi-segment ("roving") days visibly differ.
      var segments = (r.segments && r.segments.length) ? r.segments : [null];

      segments.forEach(function(seg, si) {
        html += '<tr>';
        if (si === 0) {
          html += '<td rowspan="' + segments.length + '">' + escapeHtml(r.date) + '</td>';
          html += '<td rowspan="' + segments.length + '">' + escapeHtml(r.branch) + '</td>';
        }
        html += '<td>' + escapeHtml(seg ? seg.time_in  : r.time_in)  + '</td>';
        html += '<td>' + escapeHtml(seg ? seg.time_out : r.time_out) + '</td>';
        if (si === 0) {
          html += '<td rowspan="' + segments.length + '">' + r.hours_worked + '</td>';
        }

        if (si === 0) {
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
  }
  // Totals row
  var t = sheet.totals;
  if (employeeControls) {
    html += '<tr style="font-weight:bold;background:var(--blue2);color:#fff;">' +
      '<td colspan="6">TOTALS</td>' +
      '<td>' + formatCurrency(t.total_fare) + '</td>' +
      '<td></td>' +
      '<td>' + formatCurrency(t.meal) + '</td>' +
      '<td>' + formatCurrency(t.accom) + '</td>' +
      '<td>' + formatCurrency(t.midnight) + '</td>' +
      '<td>' + formatCurrency(t.total) + '</td>' +
      '<td></td>' +
      (adminControls ? '<td></td>' : '') +
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

// ---- Fare-claim picker (multi-segment days) ----
// Shared by index.html (employee, interactive) and admin.html (admin,
// view-only). The FARE CLAIM cell's data-segs attribute (set above in
// buildFareCells) carries each segment's date/segKey/label/status for this
// one day-range — built here on click rather than embedded as markup in
// the initial render, so the row's HTML stays lean. data-interactive
// (also set in buildFareCells, from opts.claimsInteractive) controls
// whether an unclaimed segment inside the opened list gets a "+ Fare"
// action button (employee) or plain "Not filed" text (admin) — the picker
// toggle itself always opens/closes regardless, since the segment
// breakdown is useful information either way.
function closeAllFarePickers() {
  document.querySelectorAll('.fare-picker-list.open').forEach(function(el) { el.remove(); });
}

function toggleFarePicker(btn) {
  var existing = btn.parentNode.querySelector('.fare-picker-list');
  var wasOpenHere = !!existing;
  closeAllFarePickers();
  if (wasOpenHere) return; // clicking the same button again just closes it

  var segs = JSON.parse(btn.dataset.segs);
  var interactive = btn.dataset.interactive !== 'false';
  var list = document.createElement('div');
  list.className = 'fare-picker-list open';
  list.innerHTML = segs.map(function(s) {
    // The mini "+ Fare" button carries its own date/type/seg data
    // attributes, same as any other .emp-claim-btn, so it's handled by
    // the existing delegated click handler with no extra logic needed —
    // a claimed item (badge, no button) simply has nothing to click.
    var right;
    if (s.status) {
      right = '<span class="claim-status-badge claim-status-' + s.status.toLowerCase() + '">' +
          (s.status === 'Approved' ? '✓ ' + formatCurrency(s.amount) : '⏳ Pending') +
        '</span>';
    } else if (interactive) {
      right = '<button type="button" class="emp-claim-btn" data-date="' + escapeHtml(s.date) + '" data-seg="' + escapeHtml(s.segKey) + '" data-type="special-fare">+ Fare</button>';
    } else {
      right = 'Not filed';
    }
    return '<div class="fare-picker-item">' +
      '<span>' + escapeHtml(s.label) + '</span>' + right +
      '</div>';
  }).join('');
  btn.parentNode.appendChild(list);
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

// ============================================================
// PRINT (PDF) + EXPORT (Excel) — shared by admin.html and index.html
// ============================================================
// Both depend on the CDN globals html2canvas / jspdf / XLSX, so any page
// that calls these must include those three <script> tags (see each page's
// <head>). Both read the currently-rendered #printable-sheet + the loaded
// window._lastPeriodSheet, so the same detailed timeline drives BOTH
// outputs — guaranteeing the PDF and the Excel show identical data.

// Deep-clones #printable-sheet and replaces every live form control
// (<select> shift-tag dropdown, <button> meal-deny / fare-picker /
// +Fare/+Accom, any <input>) with a plain <span> of its currently-visible
// text. html2canvas renders native form controls unreliably (garbled
// cells), and a fully-static table is also what SheetJS needs to read a
// clean value out of every cell — so this single sanitize feeds both the
// PDF and the Excel export.
function sanitizePrintableClone(content) {
  var clone = content.cloneNode(true);
  clone.removeAttribute('id'); // avoid a duplicate #printable-sheet id while attached
  var controls = clone.querySelectorAll('select, button, input');
  Array.prototype.forEach.call(controls, function(el) {
    var text;
    if (el.tagName === 'SELECT') {
      text = (el.selectedIndex >= 0 && el.options[el.selectedIndex]) ? el.options[el.selectedIndex].text : '';
    } else if (el.tagName === 'INPUT') {
      text = el.value || '';
    } else {
      text = el.textContent || '';
    }
    var span = document.createElement('span');
    span.textContent = text;
    if (el.parentNode) el.parentNode.replaceChild(span, el);
  });
  return clone;
}

// jsPDF's built-in standard fonts (Helvetica/Times/Courier) don't include a
// glyph for the Philippine Peso sign (U+20B1) -- rendering it (whether via
// html2canvas screenshotting OR jsPDF's own vector text) produces a
// corrupted/substituted character. Swaps it for a plain "P" in a clone's
// text nodes, used for the PDF path only -- Excel keeps the real ₱ symbol
// since SheetJS/Excel display Unicode text correctly, no font-glyph issue.
function stripPesoSignForPdf(root) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  var node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue.indexOf('₱') !== -1) node.nodeValue = node.nodeValue.replace(/₱/g, 'P');
  }
}

// Previews a landscape PDF in a new tab (browser's native PDF viewer, which
// provides its own download/print controls). Built with jsPDF-AutoTable
// (real vector text drawn from the sanitized table's DOM structure via its
// `html:` option, which respects rowspan/colspan) rather than html2canvas
// screenshotting -- a wide 13+ column timeline forced into one page width
// via image scaling became too small to read and showed font/rowspan
// rendering glitches; AutoTable auto-sizes columns/font and paginates
// instead of shrinking everything to fit.
function printPeriodSheet(btnEl) {
  var content = document.getElementById('printable-sheet');
  var sheet = window._lastPeriodSheet;
  if (!content || !sheet) { alert('Load/Generate a timesheet first.'); return; }
  var origLabel = btnEl ? btnEl.textContent : '';
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="pl-spinner"></span>Generating PDF…';
  }

  var clone = sanitizePrintableClone(content);
  stripPesoSignForPdf(clone);
  var hider = document.createElement('div');
  hider.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  hider.appendChild(clone);
  document.body.appendChild(hider);

  var table = clone.querySelector('table');
  if (!table) {
    document.body.removeChild(hider);
    alert('Nothing to print.');
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = origLabel; }
    return;
  }

  var doc = new jspdf.jsPDF('l', 'pt', 'a4'); // landscape — the timesheet has 12+ columns
  var pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('PHOTOLINE', pageWidth / 2, 30, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Employee Timesheet', pageWidth / 2, 46, { align: 'center' });
  doc.setFontSize(9);
  doc.text('Period: ' + sheet.period_start + ' - ' + sheet.period_end, pageWidth / 2, 60, { align: 'center' });

  doc.autoTable({
    html: table,
    startY: 72,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [26, 26, 46], textColor: 255, fontStyle: 'bold' },
    margin: { left: 20, right: 20, top: 72 }
  });

  var pageHeight = doc.internal.pageSize.getHeight();
  var finalY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 72) + 50;
  if (finalY + 20 > pageHeight - 20) { // table ended too close to the bottom — give the signatures their own page
    doc.addPage();
    finalY = 40;
  }
  var sigWidth = 140;
  var positions = [40, pageWidth / 2 - sigWidth / 2, pageWidth - 40 - sigWidth];
  var labels = ['Prepared by', 'Checked by', 'Approved by'];
  positions.forEach(function(x, i) {
    doc.line(x, finalY, x + sigWidth, finalY);
    doc.setFontSize(9);
    doc.text(labels[i], x + sigWidth / 2, finalY + 12, { align: 'center' });
  });

  document.body.removeChild(hider);
  window.open(doc.output('bloburl'), '_blank');
  if (btnEl) {
    btnEl.disabled = false;
    btnEl.textContent = origLabel || '🖨 Print (PDF)';
  }
}

// Exports the SAME detailed timeline the PDF shows as an .xlsx — the
// letterhead + employee-info rows, then the sanitized #printable-sheet
// <table> converted via SheetJS's sheet_add_dom (which honors rowspan/
// colspan as cell merges, matching the on-screen/PDF grouping), then the
// signature footer. Note: the free SheetJS build has no bold/border
// styling — text content matches the PDF; visual styling is best-effort.
function exportPeriodExcel(btnEl) {
  var content = document.getElementById('printable-sheet');
  var sheet = window._lastPeriodSheet;
  if (!content || !sheet) { alert('Load/Generate a timesheet first.'); return; }
  var clone = sanitizePrintableClone(content);
  // sheet_add_dom reads innerText, which is only populated for in-document
  // (rendered) nodes — attach the clone inside a zero-size hider first, or
  // every cell would export blank.
  var hider = document.createElement('div');
  hider.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  hider.appendChild(clone);
  document.body.appendChild(hider);
  try {
    var table = clone.querySelector('table');
    if (!table) { alert('Nothing to export.'); return; }

    var e = sheet.employee || {};
    var daysWorked = (sheet.days || []).length;
    var totalHours = 0;
    (sheet.days || []).forEach(function(d) { totalHours += (d.hours_worked || 0); });

    var head = [
      ['PHOTOLINE'],
      ['Employee Timesheet'],
      ['Period: ' + (sheet.period_start || '') + ' — ' + (sheet.period_end || '')],
      [],
      ['NAME:', e.name || '', '', 'PERIOD:', (sheet.period_start || '') + ' — ' + (sheet.period_end || '')],
      ['POSITION:', e.position_level || '', '', 'MOTHER BRANCH:', e.mother_branch || ''],
      ['DEPT:', e.department || '', '', 'DAYS WORKED:', daysWorked, 'TOTAL HOURS:', totalHours.toFixed(1)],
      []
    ];

    var ws = XLSX.utils.aoa_to_sheet(head);
    XLSX.utils.sheet_add_dom(ws, table, { origin: -1 }); // detailed timeline table, below the header
    XLSX.utils.sheet_add_aoa(ws, [
      [],
      ['Prepared by: ____________________', '', '', 'Checked by: ____________________', '', '', 'Approved by: ____________________']
    ], { origin: -1 });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Timesheet');
    XLSX.writeFile(wb, (e.name || 'timesheet') + '_' + (sheet.period_start || '') + '.xlsx');
  } finally {
    document.body.removeChild(hider);
  }
}
