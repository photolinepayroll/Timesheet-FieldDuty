// ============================================================
// PHOTOLINE EXPENSE APP — Google Apps Script
// ============================================================

var SS = SpreadsheetApp.getActiveSpreadsheet();

function getSheet(name) {
  var sh = SS.getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
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
    // NOTE: later tasks will add their own entries to this map
    // (e.g. 'getConfig', 'getClaims', 'saveClaim', 'approveClaim',
    // 'getPeriodSheet')
    // as their handler functions are implemented.
    var handlers = {
      'ping': handlePing,
      'login': handleLogin,
      'getUsers': handleGetUsers,
      'saveUser': handleSaveUser,
      'getRates': handleGetRates,
      'saveRates': handleSaveRates,
      'getAttendance': handleGetAttendance
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
    position_level: user['position_level'],
    ot_type: user['ot_type']
  };
}

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

function handleGetRates(payload) {
  return {
    meal:      sheetToObjects('MealRates'),
    accom:     sheetToObjects('AccomRates'),
    midnight:  sheetToObjects('MidnightRates'),
    ltfrb:     sheetToObjects('LTFRBRates'),
    config:    sheetToObjects('Config')
  };
}

var RATE_SHEET_NAMES = ['MealRates', 'AccomRates', 'MidnightRates', 'LTFRBRates'];

function handleSaveRates(payload) {
  // payload.sheet = 'MealRates'|'AccomRates'|'MidnightRates'|'LTFRBRates'
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
