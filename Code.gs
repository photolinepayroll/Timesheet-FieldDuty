// ============================================================
// PHOTOLINE EXPENSE APP — Google Apps Script
// ============================================================

var SS = SpreadsheetApp.getActiveSpreadsheet();

function getSheet(name) {
  var sh = SS.getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

// Per-request cache: handleGetPeriodSheet calls sheetToObjects() for the same
// rate sheets (EmployeeRates/MidnightRates/LTFRBRates/Config) once per
// day in its loop. Without caching, a 15-day period re-reads each of those
// sheets ~15 times in a single request. clearSheetCache() resets this at the
// start of every doPost call, so nothing here can leak stale data across
// requests or hide a write made earlier in the same request.
var _sheetCache = {};

function clearSheetCache() {
  _sheetCache = {};
}

function sheetToObjects(name) {
  if (_sheetCache.hasOwnProperty(name)) return _sheetCache[name];
  var sh = getSheet(name);
  var rows = sh.getDataRange().getValues();
  var headers = rows[0];
  var result = rows.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
  _sheetCache[name] = result;
  return result;
}

function getConfig(key) {
  var rows = sheetToObjects('Config');
  var row = rows.filter(function(r) { return r['key'] === key; })[0];
  return row ? row['value'] : null;
}

// Google Sheets auto-converts a date-shaped string (e.g. "2026-06-13")
// written into a cell into a real Date value -- this happens even when the
// app itself writes the value via appendRow/setValues, not just when a
// human types it in. sheetToObjects() then returns that cell as a JS Date
// object instead of the original string, which breaks any `c['date'] ===
// someDateString` comparison silently (this exact bug made approved
// special-fare/accommodation/company-service claims never match their
// period-sheet date, since 'YYYY-MM-DD' !== a Date object, ever).
// Normalize whatever comes back to a plain 'YYYY-MM-DD' key. Critically,
// for a Date object this must use the script's own timezone, NOT
// toISOString()/UTC -- Sheets stores the date as local midnight, and
// converting that to UTC can shift it onto the PREVIOUS calendar day
// (e.g. 2026-06-13 00:00 in UTC+8 is 2026-06-12 16:00 UTC).
function claimDateKey(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v).slice(0, 10);
}

function doGet(e) {
  return HtmlService.createHtmlOutput('Photoline Expense App API running.');
}

function doPost(e) {
  clearSheetCache();
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var handlers = {
      'ping': handlePing,
      'login': handleLogin,
      'getUsers': handleGetUsers,
      'saveUser': handleSaveUser,
      'getRates': handleGetRates,
      'saveRates': handleSaveRates,
      'getAttendance': handleGetAttendance,
      'saveClaim': handleSaveClaim,
      'getConfig': handleGetConfig,
      'getClaims': handleGetClaims,
      'approveClaim': handleApproveClaim,
      'getPeriodSheet': handleGetPeriodSheet,
      'toggleMealDenial': handleToggleMealDenial
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
    position_level: user['position_level']
  };
}

function handleGetUsers(payload) {
  return sheetToObjects('Users');
}

function handleSaveUser(payload) {
  // payload.user = { id, name, department, mother_branch, position_level,
  //                  role, pin, active }
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

function handleGetRates(payload) {
  return {
    employeeRates: sheetToObjects('EmployeeRates'),
    midnight:       sheetToObjects('MidnightRates'),
    ltfrb:          sheetToObjects('LTFRBRates'),
    config:         sheetToObjects('Config')
  };
}

var RATE_SHEET_NAMES = ['EmployeeRates', 'MidnightRates', 'LTFRBRates'];

function handleSaveRates(payload) {
  // payload.sheet = 'EmployeeRates'|'MidnightRates'|'LTFRBRates'
  // payload.rows = array of objects matching sheet headers
  if (RATE_SHEET_NAMES.indexOf(payload.sheet) === -1) {
    throw new Error('Invalid rate sheet: ' + payload.sheet);
  }
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

// ============================================================
// FARE AUTO-COMPUTE — OSRM distance + LTFRB formula
// ============================================================

// Straight-line (great-circle) distance in km — NOT road distance.
// Used for area classification (nearest AreaCenters point) where we
// want as-the-crow-flies distance, not a road-factor estimate.
function haversineKm(lat1, lng1, lat2, lng2) {
  var R = 6371; // Earth radius in km
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
          Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
          Math.sin(dLng/2)*Math.sin(dLng/2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

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
  // Haversine fallback (straight-line distance x road factor)
  return haversineKm(lat1, lng1, lat2, lng2) * 1.3; // road factor
}

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

// Builds an auto-fare Claims row from a single day's IN/OUT attendance pair.
// The measured GPS distance (inRec -> outRec) is the ONE-WAY outbound leg;
// the fare is doubled here to cover the return trip. distance_km stays the
// one-way measured value (a factual GPS measurement) — only the fare amount
// is doubled.
function buildAutoFareClaim(attendanceRecord, vehicleType, employeeName, date, periodStart, periodEnd) {
  var inRec  = attendanceRecord.in_record;
  var outRec = attendanceRecord.out_record;
  if (!inRec || !outRec) return null;
  if (!inRec.lat || !inRec.lng || !outRec.lat || !outRec.lng) return null;

  var distKm = getRoadDistanceKm(inRec.lat, inRec.lng, outRec.lat, outRec.lng);
  var oneWayFare = computeFare(vehicleType, distKm);
  var computedAmt = oneWayFare * 2; // round trip: double the fare, not the distance
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

// ============================================================
// ALLOWANCE / OT AUTO-COMPUTE — meal, accommodation, midnight, OT
// ============================================================

// Case-insensitive name comparison: EmployeeRates.employee_name is typed in by
// hand (often copied from all-caps PDFs) while Users.name is typed separately,
// so the same employee can end up as "LOUWIN CELIS" in one sheet and "Louwin
// celis" in the other. A strict === comparison silently fails to match in that
// case — no error, just a quiet fallthrough to the generic department rate —
// so employee_name matching against EmployeeRates is intentionally
// case-insensitive (same reasoning as the existing .toLowerCase() area-name
// matching elsewhere in this file).
function namesMatch(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

// Resolves the EmployeeRates row for this employee+area: an employee-specific
// row (employee_name matches, department blank) always wins over a
// department-wide fallback row (employee_name blank, department matches) for
// the same area. Returns null if neither exists.
function resolveEmployeeRate(employeeName, department, destinationArea) {
  var rates = sheetToObjects('EmployeeRates');
  var empRow = rates.filter(function(r) {
    return namesMatch(r['employee_name'], employeeName) && r['area'] === destinationArea;
  })[0];
  if (empRow) return empRow;
  var deptRow = rates.filter(function(r) {
    return (!r['employee_name'] || r['employee_name'] === '') &&
           r['department'] === department && r['area'] === destinationArea;
  })[0];
  return deptRow || null;
}

// GPS fallback for area classification: used only when substring
// matching (handleGetPeriodSheet's main area-resolution loop) finds
// no match. Finds the nearest AreaCenters row, among ONLY the area
// names relevant to this employee (candidateAreaNames — never the
// whole AreaCenters table, to avoid matching some other employee's
// unrelated area), to the given lat/lng. Nearest-wins, no maximum-
// distance cutoff (see plan's Self-Review for the risk this implies).
// Returns the matched area name, or null if lat/lng are both 0 (no
// GPS) or no AreaCenters row exists for any candidate area name.
function resolveAreaByGPS(lat, lng, candidateAreaNames) {
  if (!lat && !lng) return null; // no GPS — same convention as buildAutoFareClaim's lat/lng checks
  var centers = sheetToObjects('AreaCenters');
  var candidateLower = candidateAreaNames.map(function(a) { return a.toLowerCase(); });
  var relevant = centers.filter(function(c) {
    return candidateLower.indexOf(String(c['area']).toLowerCase()) !== -1;
  });
  if (!relevant.length) return null;
  var best = null;
  var bestDist = Infinity;
  relevant.forEach(function(c) {
    var d = haversineKm(lat, lng, parseFloat(c['lat']), parseFloat(c['lng']));
    if (d < bestDist) {
      bestDist = d;
      best = c['area'];
    }
  });
  return best;
}

function computeMeal(employeeName, department, destinationArea, hoursWorked, motherBranch, destination, wasLogComplete) {
  // Rule: no meal at mother branch. A genuinely incomplete log (missing
  // Log In or Log Out, including a day nulled by the 20-hour sanity cap —
  // see handleGetPeriodSheet's wasLogComplete computation) auto-grants
  // the meal regardless of hoursWorked. A complete log still requires
  // 5+ hours, unchanged from before.
  if (destination === motherBranch) return 0;
  if (wasLogComplete && hoursWorked < 5) return 0;
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

  // Map column names to indices (matches real attendance app CSV headers)
  var COL = {
    timestamp:   idx('Timestamp'),
    name:        idx('Name'),
    type:        idx('Type'),
    destination: idx('Destination'),
    lat:         idx('Latitude'),
    lng:         idx('Longitude'),
    address:     idx('Address')
  };

  // Compare plain 'YYYY-MM-DD' date strings rather than Date objects: the
  // attendance timestamp ("YYYY-MM-DD HH:MM:SS") parses as local time while a
  // date-only string ("YYYY-MM-DD") parses as UTC midnight, which would
  // silently misfile records near period boundaries depending on the script's
  // timezone setting. ISO-formatted date strings compare correctly with
  // plain string operators, so this sidesteps Date-parsing ambiguity.
  function dateKey(ts) {
    return ts.indexOf('T') !== -1 ? ts.split('T')[0] : ts.split(' ')[0];
  }

  var startKey = payload.period_start ? dateKey(payload.period_start) : null;
  var endKey   = payload.period_end   ? dateKey(payload.period_end)   : null;

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
      if (startKey || endKey) {
        var tKey = dateKey(r.timestamp);
        if (startKey && tKey < startKey) return false;
        if (endKey   && tKey > endKey)   return false;
      }
      return true;
    });

  return records;
}

// ============================================================
// SPECIAL CLAIM SUBMISSION (employee side)
// ============================================================

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

function handleGetConfig(payload) {
  return sheetToObjects('Config');
}

// ============================================================
// CLAIMS APPROVAL QUEUE (admin/head side)
// ============================================================

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
  // payload: { claim_id, approver_name, decision: 'approve'|'reject', notes }
  // NOTE: this must NOT be named "action" — doPost's own dispatch key is
  // also called "action", and api()'s Object.assign({action: dispatchAction},
  // params) lets params override the dispatch key, so a same-named "action"
  // field here would silently replace "approveClaim" with "approve"/"reject"
  // before doPost ever sees it, breaking the dispatch entirely (this is
  // exactly the bug that existed here before this fix).
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
        payload.decision === 'approve' ? 'Approved' : 'Rejected'
      );
      sh.getRange(i+1, approverIdx+1).setValue(payload.approver_name);
      sh.getRange(i+1, approvedAtIdx+1).setValue(new Date().toISOString());
      if (payload.notes) sh.getRange(i+1, notesIdx+1).setValue(payload.notes);
      return 'done';
    }
  }
  throw new Error('Claim not found: ' + payload.claim_id);
}

function handleToggleMealDenial(payload) {
  // payload: { employee_name, date, denied_by }
  // Idempotent toggle: if a denial row already exists for this
  // (employee_name, date), remove it (un-deny). Otherwise add one
  // (deny). employee_name comes from the period sheet's own resolved
  // employee, not hand-typed, so exact === matching is correct here
  // (see SETUP.md's MealDenials section for why this differs from
  // EmployeeRates' case-insensitive matching).
  var sh = getSheet('MealDenials');
  var rows = sh.getDataRange().getValues();
  var headers = rows[0];
  var nameIdx = headers.indexOf('employee_name');
  var dateIdx = headers.indexOf('date');
  var dateKey = claimDateKey(payload.date);

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][nameIdx] === payload.employee_name &&
        claimDateKey(rows[i][dateIdx]) === dateKey) {
      sh.deleteRow(i + 1);
      return { denied: false };
    }
  }

  sh.appendRow([payload.employee_name, payload.date, payload.denied_by, new Date().toISOString()]);
  return { denied: true };
}

// ============================================================
// PERIOD SHEET — assembled from attendance + auto-allowances + approved claims
// ============================================================

function handleGetPeriodSheet(payload) {
  // payload: { employee_name, period_start, period_end }
  var attRecords = handleGetAttendance(payload);
  var dayMap     = {}; // date string → { ins, outs, destination, in_record, out_record }

  function dayKey(ts) { return ts.slice(0, 10); }
  function ensureDay(date, destination) {
    if (!dayMap[date]) dayMap[date] = { ins: [], outs: [], destination: destination };
    return dayMap[date];
  }

  // Sort chronologically before pairing — handleGetAttendance doesn't
  // guarantee CSV row order is chronological. NOTE: the real attendance app
  // does NOT always zero-pad single-digit hours (e.g. "2026-06-19 3:19:44"
  // instead of "...03:19:44"), so plain string comparison is unsafe here —
  // "3:19:44" sorts AFTER "18:48:53" as a string even though 3 AM is earlier
  // in the day. Parse via Date instead. This is safe (unlike comparing a
  // date-only string against a full timestamp elsewhere in this file): both
  // sides here are the same "YYYY-MM-DD HH:MM:SS"-ish format, parsed the
  // same way, so whatever timezone the runtime assumes is applied uniformly
  // to both and their RELATIVE order comes out correct regardless.
  attRecords.sort(function(a, b) {
    return new Date(a.timestamp) - new Date(b.timestamp);
  });

  // Pair each 'Log In' with the NEXT 'Log Out' that follows it chronologically,
  // regardless of whether they fall on the same calendar date. A shift that
  // starts before midnight and ends after it (e.g. clock in 10PM, clock out
  // 3AM the next day) is attributed entirely to the date it STARTED on — not
  // split into two days that each look like a no-show. A naive
  // "bucket every record by its own date" approach (the previous
  // implementation) would put the Log In in one day's bucket and the Log Out
  // in the next day's bucket, leaving both days looking like 0 hours worked.
  //
  // Real attendance data is messy (duplicate Log Ins a few seconds apart,
  // orphan Log Outs with no preceding Log In, an open Log In with no Log Out
  // yet for an in-progress day) — this handles all of those:
  // - A second 'Log In' while one is already open closes the first one out
  //   as an incomplete (no Log Out) entry on its own date, then opens the new one.
  // - A 'Log Out' with no open 'Log In' is an orphan, attributed to its own
  //   date as a no-Log-In entry.
  // - A 'Log In' left open at the end of the period (still clocked in) is
  //   recorded as an incomplete entry on its own date.
  var openIn = null;
  attRecords.forEach(function(r) {
    if (r.type === 'Log In') {
      if (openIn) ensureDay(dayKey(openIn.timestamp), openIn.destination).ins.push(openIn);
      openIn = r;
    } else if (r.type === 'Log Out') {
      if (openIn) {
        var d = ensureDay(dayKey(openIn.timestamp), openIn.destination);
        d.ins.push(openIn);
        d.outs.push(r);
        openIn = null;
      } else {
        ensureDay(dayKey(r.timestamp), r.destination).outs.push(r);
      }
    }
  });
  if (openIn) ensureDay(dayKey(openIn.timestamp), openIn.destination).ins.push(openIn);

  // Get employee profile
  var users = sheetToObjects('Users');
  var emp = users.filter(function(u) { return u['name'] === payload.employee_name; })[0];
  if (!emp) throw new Error('Employee not found: ' + payload.employee_name);

  // Candidate area rows for THIS employee: their own employee-specific rows
  // plus their department's fallback rows. Scoped per-employee (not the
  // whole EmployeeRates table) because different employees/departments can
  // use differently-named areas — a global lookup would risk matching
  // against some other employee's area name.
  var allEmployeeRates = sheetToObjects('EmployeeRates');
  var candidateAreaRows = allEmployeeRates.filter(function(r) {
    // Case-insensitive: see namesMatch comment near resolveEmployeeRate for why.
    return namesMatch(r['employee_name'], payload.employee_name) ||
           ((!r['employee_name'] || r['employee_name'] === '') && r['department'] === emp['department']);
  });

  var candidateAreaNames = candidateAreaRows
    .map(function(r) { return r['area']; })
    .filter(function(a, i, arr) { return a && arr.indexOf(a) === i; }); // distinct, non-blank

  // Get approved special claims for this period
  var allClaims = sheetToObjects('Claims');
  var specialClaims = allClaims.filter(function(c) {
    return c['employee_name'] === payload.employee_name &&
           c['status'] === 'Approved' &&
           (c['type'] === 'special-fare' || c['type'] === 'accommodation');
  });

  // Approved Company Service claims suppress that date's auto-computed
  // fare only — meal/accom/midnight/OT are unaffected (see
  // docs/superpowers/specs/2026-06-23-company-service-no-fare-design.md).
  // A claim that exists but isn't yet 'Approved' has no effect here.
  var companyServiceClaims = allClaims.filter(function(c) {
    return c['employee_name'] === payload.employee_name &&
           c['status'] === 'Approved' &&
           c['type'] === 'company-service';
  });

  // Admin meal-deny override (see docs/superpowers/specs/2026-06-25-
  // meal-incomplete-log-auto-grant-design.md). Indexed by date key so
  // the per-day loop below can do an O(1) lookup instead of re-filtering
  // the whole sheet for every day in the period.
  var mealDenials = sheetToObjects('MealDenials');
  var deniedDates = {};
  mealDenials.forEach(function(d) {
    if (d['employee_name'] === payload.employee_name) {
      deniedDates[claimDateKey(d['date'])] = true;
    }
  });

  var rows = [];
  var dates = Object.keys(dayMap).sort();

  dates.forEach(function(date) {
    var day    = dayMap[date];
    day.in_record  = day.ins.length  ? day.ins[0] : null;
    day.out_record = day.outs.length ? day.outs[day.outs.length-1] : null;
    var firstIn  = day.in_record  ? new Date(day.in_record.timestamp)  : null;
    var lastOut  = day.out_record ? new Date(day.out_record.timestamp) : null;

    // Sanity cap: a Log Out paired with a stale, never-closed Log In from an
    // earlier day (the employee forgot to log out, and no further Log In
    // happened before the next real Log Out arrived) can span multiple days.
    // 20 hours is well beyond any legitimate single shift, so treat such a
    // day as incomplete — same as a Log In with no Log Out at all. The late
    // Log Out's own data is simply dropped from this day's bucket; it is
    // NOT re-attributed to its own day (that would require restructuring
    // the pairing pass itself — accepted limitation, out of scope here).
    if (firstIn && lastOut && (lastOut - firstIn) / 3600000 > 20) {
      lastOut = null;
    }

    var hoursWorked = (firstIn && lastOut) ? (lastOut - firstIn) / 3600000 : 0;
    // Computed from the already-capped firstIn/lastOut, not the raw
    // day.in_record/day.out_record — this makes a 20-hour-cap-nulled day
    // (lastOut forced null above) count as incomplete for meal purposes,
    // exactly like a day with no Log Out at all.
    var wasLogComplete = !!(firstIn && lastOut);
    var destination = day.destination || '';

    // Map destination name to area (destination in attendance app may be a branch
    // name like "SM Dagupan" — admin should ensure area names in rate tables
    // match or contain branch group names. Lookup: find area row whose name
    // is contained in the destination string, or exact match.)
    var destinationArea = destination; // default fallback
    candidateAreaRows.forEach(function(r) {
      if (destination.toLowerCase().indexOf(r['area'].toLowerCase()) !== -1) {
        destinationArea = r['area'];
      }
    });

    // GPS fallback: only when substring matching found nothing (area-
    // resolution rows like "NCR AREA"/"CAVITE AREA" almost never appear
    // literally inside a real destination string like "Qc cityhall") AND
    // this day's first Log In has real GPS. Substring match always wins
    // when it matches — this never touches destinationArea once the loop
    // above has already set it to something other than the raw destination.
    if (destinationArea === destination && day.in_record &&
        (day.in_record.lat || day.in_record.lng)) {
      var gpsArea = resolveAreaByGPS(day.in_record.lat, day.in_record.lng, candidateAreaNames);
      if (gpsArea) destinationArea = gpsArea;
    }

    var meal     = computeMeal(payload.employee_name, emp['department'], destinationArea,
                               hoursWorked, emp['mother_branch'], destination, wasLogComplete);
    var mealDenied = !!deniedDates[date];
    if (mealDenied) meal = 0;
    var accom    = computeAccom(payload.employee_name, emp['department'], destinationArea,
                                emp['mother_branch'], destination);
    var midnight = computeMidnight(lastOut);

    // Find approved special claims for this date
    var daySpecial = specialClaims.filter(function(c) { return claimDateKey(c['date']) === date; });
    var specialFare  = daySpecial.filter(function(c) { return c['type']==='special-fare'; })
                                 .reduce(function(s,c) { return s + parseFloat(c['claimed_amount']||0); }, 0);
    var specialAccom = daySpecial.filter(function(c) { return c['type']==='accommodation'; })
                                 .reduce(function(s,c) { return s + parseFloat(c['claimed_amount']||0); }, 0);

    // Auto-fare (LTFRB computed) — reuse buildAutoFareClaim (Task 6) rather than
    // re-deriving the round-trip-doubled fare logic inline. buildAutoFareClaim
    // itself does not know about mother-branch — that gate is enforced here,
    // matching the original inline draft's behavior (no auto-fare at mother branch).
    var hasCompanyService = companyServiceClaims.some(function(c) {
      return claimDateKey(c['date']) === date;
    });
    var autoFare = 0;
    if (!hasCompanyService && emp['mother_branch'] !== destination) {
      // Default vehicle type: Traditional Jeepney — employee can override
      // via special claim; auto-fare uses the cheapest standard mode.
      var claimResult = buildAutoFareClaim(day, 'Traditional Jeepney',
        payload.employee_name, date, payload.period_start, payload.period_end);
      autoFare = claimResult ? claimResult.computed_amount : 0;
    }

    rows.push({
      date:         date,
      branch:       destination,
      time_in:      firstIn  ? firstIn.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '',
      time_out:     lastOut  ? lastOut.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '',
      hours_worked: Math.round(hoursWorked * 10) / 10,
      auto_fare:    autoFare,
      special_fare: specialFare,
      total_fare:   autoFare + specialFare,
      meal:         meal,
      meal_denied:  mealDenied,
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
      total:        rows.reduce(function(s,r){ return s+r.total_allowance; },0)
    }
  };
}
