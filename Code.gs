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

// Same Sheets Date-cell-coercion problem as claimDateKey above, but for a
// FULL "YYYY-MM-DD HH:MM:SS"-shaped value where the time-of-day must be
// preserved (claimDateKey deliberately truncates to just the date, which
// would collapse every ShiftTags timestamp on a given day to the
// same key). Must ALWAYS parse through Date and reformat — even for a
// plain string input — not just when the value already arrives as a Date
// object. The real attendance app doesn't zero-pad single-digit hours
// (e.g. "2026-07-01 4:20:11"), so a raw CSV timestamp string compared
// directly against a Sheets-auto-converted-then-reformatted Date (which
// DOES come out zero-padded, "2026-07-01 04:20:11") would silently never
// match — this was a real bug: an End tag on an unpadded-hour timestamp
// (e.g. 4:20 AM) never resolved into a Day, while a two-digit-hour Start
// tag (e.g. 6:55 PM) worked fine. Parsing every input through `new Date()`
// first guarantees both sides of every ShiftTags comparison always produce
// the identical zero-padded key, regardless of which form the value
// happened to arrive in.
function normalizeTimestampCell(v) {
  if (!v) return '';
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v); // defensive fallback — shouldn't happen for real timestamps
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

// Single source of truth for action dispatch, shared by doGet and doPost.
// `get: true` marks actions safe to expose over GET: read-only, and their
// request payload is always a few short strings (never a base64 photo or a
// full rate-table replace) so it fits in a URL query string. Apps Script's
// /exec responses inconsistently carry the Access-Control-Allow-Origin
// header on POST (cross-origin fetch() from GitHub Pages can get silently
// CORS-blocked even though the request succeeded server-side), but GET
// responses carry it reliably — so reads go via GET to dodge that, while
// writes stay POST since some payloads (saveClaim's receipt photos,
// saveRates' full-table replace) are too large for a query string.
var HANDLERS = {
  'ping':             { fn: handlePing,            get: true  },
  'login':            { fn: handleLogin,           get: true  },
  'getUsers':         { fn: handleGetUsers,        get: true  },
  'saveUser':         { fn: handleSaveUser,        get: false },
  'deleteUser':       { fn: handleDeleteUser,      get: false },
  'getRates':         { fn: handleGetRates,        get: true  },
  'saveRates':        { fn: handleSaveRates,       get: false },
  'getAttendance':    { fn: handleGetAttendance,   get: true  },
  'saveClaim':        { fn: handleSaveClaim,       get: false },
  'getConfig':        { fn: handleGetConfig,       get: true  },
  'getClaims':        { fn: handleGetClaims,       get: true  },
  'approveClaim':     { fn: handleApproveClaim,    get: false },
  'getPeriodSheet':   { fn: handleGetPeriodSheet,  get: true  },
  'toggleMealDenial': { fn: handleToggleMealDenial, get: false },
  'saveShiftTags':    { fn: handleSaveShiftTags,       get: false },
  'checkNameMatches': { fn: handleCheckNameMatches, get: true  }
};

function doGet(e) {
  if (!e || !e.parameter || !e.parameter.action) {
    return HtmlService.createHtmlOutput('Photoline Expense App API running.');
  }
  var payload = {};
  for (var key in e.parameter) payload[key] = e.parameter[key];
  return runAction(payload.action, payload, /* viaGet */ true);
}

function doPost(e) {
  var payload = JSON.parse(e.postData.contents);
  return runAction(payload.action, payload, /* viaGet */ false);
}

function runAction(action, payload, viaGet) {
  clearSheetCache();
  try {
    var entry = HANDLERS[action];
    if (!entry || (viaGet && !entry.get)) throw new Error('Unknown action: ' + action);
    var result = entry.fn(payload);
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
  cacheBustSheet('Users');
  return payload.user.id;
}

// Removes a Users row by id — only their login/user record. Historical
// Claims/EmployeeRates rows are untouched since those are keyed by
// employee name, not by this row, so past claims and rate history survive
// a deleted user intact.
function handleDeleteUser(payload) {
  var sh = getSheet('Users');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === payload.id) {
      sh.deleteRow(i + 1);
      cacheBustSheet('Users');
      return true;
    }
  }
  throw new Error('User not found.');
}

// Audit tool for the admin Employees tab: surfaces two previously-invisible
// mismatch classes that silently zero out an employee's data (no error,
// just 0 rows / ₱0 rates) — see Resume.md "STOP HERE FIRST" for the Jude
// Patani incident that motivated this. View-only; the admin still fixes
// mismatches through the existing Users/EmployeeRates edit forms.
function handleCheckNameMatches(payload) {
  var users = sheetToObjects('Users');

  // handleGetAttendance's name filter (used by every period-sheet lookup)
  // is exact/case-sensitive, so that's what 'exact' below checks for. The
  // lowercased set only tells us whether a case-only typo is the culprit.
  var attRecords = handleGetAttendance({});
  var exactNames = {};
  var lowerNames = {};
  attRecords.forEach(function(r) {
    exactNames[r.name] = true;
    lowerNames[r.name.toLowerCase()] = true;
  });

  var rates = sheetToObjects('EmployeeRates');

  return {
    rows: users.map(function(u) {
      var attendance_status = exactNames[u['name']] ? 'exact' :
        (lowerNames[String(u['name']).toLowerCase()] ? 'case-only' : 'none');

      var hasEmployeeRate = rates.some(function(r) {
        return (!r['department'] || r['department'] === '') &&
               namesMatch(r['employee_name'], u['name']);
      });
      var hasDeptFallback = rates.some(function(r) {
        return (!r['employee_name'] || r['employee_name'] === '') &&
               r['department'] === u['department'];
      });
      var rates_status = hasEmployeeRate ? 'employee' :
        (hasDeptFallback ? 'dept-fallback' : 'none');

      return {
        name: u['name'],
        department: u['department'],
        active: u['active'],
        attendance_status: attendance_status,
        rates_status: rates_status
      };
    })
  };
}

function handleGetRates(payload) {
  return {
    employeeRates: sheetToObjects('EmployeeRates'),
    midnight:       sheetToObjects('MidnightRates'),
    ltfrb:          sheetToObjects('LTFRBRates'),
    config:         sheetToObjects('Config'),
    // Read-only reference data for the admin Rate Tables tab's Area
    // dropdown (search-and-select Area, auto-fills Region/Province) — not
    // one of the RATE_SHEET_NAMES editable rate tables, just exposed here
    // for the frontend to read.
    areaCenters:    sheetToObjects('AreaCenters')
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
  if (payload.sheet === 'EmployeeRates') cacheBustSheet('EmployeeRates');
  return 'saved';
}

// ============================================================
// ONE-TIME IMPORT — AreaCenters full rebuild (2026-07-05)
// ============================================================
// Not wired into RATE_SHEET_NAMES/handleSaveRates on purpose — AreaCenters
// stays "admin-edited, not auto-generated" per SETUP.md. Run this manually
// once from the Apps Script editor's function picker, then delete it —
// same convention as the prior EmployeeRates bulk import (see Resume.md).
// Rebuilds AreaCenters from 3 columns (area|lat|lng) to 5
// (area|lat|lng|province|region) using the "Coordinates Employee rates.pdf"
// admin supplied 2026-07-05: 118 real store/mall branches, 6 broad-region
// representative points, and 8 legacy-area-name rows (reusing an existing
// nearby store's coordinates) that close the previously-documented
// "AreaCenters rows missing for broad area names" open issue, plus 3 more
// rows added after the first live run of
// oneTimeStandardizeEmployeeRatesAreas() surfaced real unmatched area
// names ("NCR BRANCH", "VISAYAS / MINDANAO" — aliases of existing rows;
// "RIZAL AREA" — new). PROVINCIAL is deliberately NOT included — no
// single coordinate is sensible for a literal "any province" fallback
// name; left as a documented permanent gap.
function oneTimeImportAreaCenters() {
  var sh = getSheet('AreaCenters');
  var headers = ['area', 'lat', 'lng', 'province', 'region'];
  var oldLastRow = sh.getLastRow();
  var oldLastCol = Math.max(sh.getLastColumn(), headers.length);
  if (oldLastRow > 0) {
    sh.getRange(1, 1, oldLastRow, oldLastCol).clearContent();
  }
  var rows = [
    // 118 per-store rows, verbatim from the PDF (Store Mall, lat, lng, Province, Region/Area)
    ['Abreeza Davao', 7.0911904, 125.611299, 'Davao del Sur', 'MINDANAO'],
    ['Alabang Town Center', 14.4229089, 121.0299295, 'Metro Manila (NCR)', 'NCR AREA'],
    ['Alimall', 14.6195569, 121.0567919, 'Metro Manila (NCR)', 'NCR AREA'],
    ['Arca South', 14.505245, 121.0439665, 'Metro Manila (NCR)', 'NCR AREA'],
    ['Ayala Bacolod', 10.6767825, 122.9502508, 'Negros Occidental', 'VISAYAS'],
    ['Ayala Fairview', 14.7363856, 121.0601532, 'Metro Manila (NCR)', 'NCR AREA'],
    ['C. Center', 14.4191063, 121.0347268, 'Metro Manila (NCR)', 'NCR AREA'],
    ['Cash & Carry', 14.5586644, 121.005787, 'Metro Manila (NCR)', 'NCR AREA'],
    ['CSI-1', 16.0235482, 120.3233352, 'Pangasinan', 'NORTH LUZON'],
    ['Festival Mall', 14.4173814, 121.0403204, 'Metro Manila (NCR)', 'NCR AREA'],
    ['Gaisano Tagum', 7.449246, 125.8115664, 'Davao del Norte', 'MINDANAO'],
    ['Gateway', 14.6217945, 121.0528441, 'Metro Manila (NCR)', 'NCR AREA'],
    ['Greenhills', 14.6008192, 121.0484381, 'Metro Manila (NCR)', 'NCR AREA'],
    ['Harbor Point', 14.824898, 120.280219, 'Zambales', 'NORTH LUZON'],
    ['Jenra Dau', 15.1788005, 120.5875015, 'Pampanga', 'NORTH LUZON'],
    ['JTC Vigan', 17.5893511, 120.3892454, 'Ilocos Sur', 'NORTH LUZON'],
    ['LCC Legaspi', 13.1472294, 123.7533517, 'Albay', 'SOUTH LUZON'],
    ['LCC Polangui', 13.2889761, 123.4909201, 'Albay', 'SOUTH LUZON'],
    ['LCC Tabaco', 13.3580349, 123.7297836, 'Albay', 'SOUTH LUZON'],
    ['Limketkai', 8.4815828, 124.6560603, 'Misamis Oriental', 'MINDANAO'],
    ['Magic Mall San Carlos', 15.9321453, 120.3457204, 'Pangasinan', 'NORTH LUZON'],
    ['Market! Market!', 14.5502545, 121.0561214, 'Metro Manila (NCR)', 'NCR AREA'],
    ['Marquee Mall', 15.1626197, 120.6098906, 'Pampanga', 'NORTH LUZON'],
    ['Nagaland E-Mall', 13.6251932, 123.1863596, 'Camarines Sur', 'SOUTH LUZON'],
    ['Nepo Alaminos', 16.1551235, 119.9806954, 'Pangasinan', 'NORTH LUZON'],
    ['Nepo Angeles', 15.1349646, 120.5884236, 'Pampanga', 'NORTH LUZON'],
    ['One Ayala', 14.5504493, 121.0278251, 'Metro Manila (NCR)', 'NCR AREA'],
    ['R Valencia', 7.9342625, 125.0997739, 'Bukidnon', 'MINDANAO'],
    ['R. Antipolo', 14.5951779, 121.1727884, 'Rizal', 'SOUTH LUZON'],
    ['R. Antique', 10.7363788, 121.9516577, 'Antique', 'VISAYAS'],
    ['R. Bacolod', 10.6914441, 122.9584763, 'Negros Occidental', 'VISAYAS'],
    ['R. Cebu', 10.3041971, 123.9112621, 'Cebu', 'VISAYAS'],
    ['R. Dasmariñas', 14.2999244, 120.9540761, 'Cavite', 'CAVITE AREA'],
    ['R. Ermita 1', 14.5758375, 120.9839388, 'Metro Manila (NCR)', 'NCR AREA'],
    ['R. Ermita 2', 14.5764797, 120.9827984, 'Metro Manila (NCR)', 'NCR AREA'],
    ['R. Galleria', 14.5910506, 121.0598379, 'Metro Manila (NCR)', 'NCR AREA'],
    ['R. Gapan', 15.3007114, 120.9478721, 'Nueva Ecija', 'NORTH LUZON'],
    ['R. Iligan', 8.2182056, 124.2403316, 'Lanao del Norte', 'MINDANAO'],
    ['R. Ilo-ilo 1', 10.6941504, 122.5662128, 'Iloilo', 'VISAYAS'],
    ['R. Ilo-ilo 2', 10.7194991, 122.5602461, 'Iloilo', 'VISAYAS'],
    ['R. Imus', 14.412979, 120.9417939, 'Cavite', 'CAVITE AREA'],
    ['R. Metro East', 14.6196165, 121.0999832, 'Metro Manila (NCR)', 'NCR AREA'],
    ['R. Pagadian', 7.8272998, 123.4378573, 'Zamboanga del Sur', 'MINDANAO'],
    ['R. Palawan', 9.7670357, 118.7482247, 'Palawan', 'SOUTH LUZON'],
    ['R. Tacloban', 11.2076804, 125.0082809, 'Leyte', 'VISAYAS'],
    ['Rob Galleria South', 14.3521045, 121.0622036, 'Laguna', 'SOUTH LUZON'],
    ['Rob Ilocos', 18.1798657, 120.5926892, 'Ilocos Norte', 'NORTH LUZON'],
    ['Rob. Roxas', 11.5691276, 122.7516453, 'Capiz', 'VISAYAS'],
    ['SM Aura', 14.5451358, 121.0533845, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Bacolod', 10.670787, 122.9426715, 'Negros Occidental', 'VISAYAS'],
    ['SM Bacoor 2', 14.445098, 120.9511457, 'Cavite', 'CAVITE AREA'],
    ['SM Baguio', 16.4088516, 120.5998022, 'Benguet', 'NORTH LUZON'],
    ['SM Baliwag', 14.9601687, 120.8903531, 'Bulacan', 'NORTH LUZON'],
    ['SM Bataan', 14.6824965, 120.5381408, 'Bataan', 'NORTH LUZON'],
    ['SM Batangas', 13.7552925, 121.068434, 'Batangas', 'SOUTH LUZON'],
    ['SM Bicutan', 14.4870683, 121.0440722, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Butuan', 8.9454067, 125.5334816, 'Agusan del Norte', 'MINDANAO'],
    ['SM Calamba', 14.2041849, 121.1545856, 'Laguna', 'SOUTH LUZON'],
    ['SM Caloocan', 14.751327, 121.0202188, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM CDO Premier', 8.4843206, 124.6549106, 'Misamis Oriental', 'MINDANAO'],
    ['SM CDO UP Town', 8.4558491, 124.6234008, 'Misamis Oriental', 'MINDANAO'],
    ['SM Cebu', 10.3114191, 123.9178164, 'Cebu', 'VISAYAS'],
    ['SM Clark', 15.1699129, 120.5792407, 'Pampanga', 'NORTH LUZON'],
    ['SM Daet', 14.12164, 122.9458603, 'Camarines Norte', 'SOUTH LUZON'],
    ['SM Dagupan', 16.0443393, 120.3436764, 'Pangasinan', 'NORTH LUZON'],
    ['SM Dasmariñas', 14.301747, 120.9567294, 'Cavite', 'CAVITE AREA'],
    ['SM Ecoland', 7.0506083, 125.5882523, 'Davao del Sur', 'MINDANAO'],
    ['SM Fairview', 14.7345991, 121.057901, 'Metro Manila (NCR)', 'NCR AREA'],
    ['Sm Gen San', 6.1154774, 125.1810148, 'South Cotabato', 'MINDANAO'],
    ['SM Grand Central', 14.6550839, 120.9845139, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Iloilo', 10.7143716, 122.5510023, 'Iloilo', 'VISAYAS'],
    ['SM Iloilo Terminal', 10.6929993, 122.5644997, 'Iloilo', 'VISAYAS'],
    ['Sm La Union', 16.6255511, 120.3238458, 'La Union', 'NORTH LUZON'],
    ['Sm Lanang', 7.0990116, 125.6315227, 'Davao del Sur', 'MINDANAO'],
    ['SM Laoag', 18.1879012, 120.5855843, 'Ilocos Norte', 'NORTH LUZON'],
    ['SM Las Piñas', 14.4485208, 120.9803942, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Legaspi', 13.1437617, 123.7438313, 'Albay', 'SOUTH LUZON'],
    ['SM Lipa', 13.95464, 121.1633598, 'Batangas', 'SOUTH LUZON'],
    ['SM Manila', 14.5901469, 120.9830916, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Marikina', 14.6260595, 121.0837029, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Marilao', 14.7541635, 120.9565923, 'Bulacan', 'NORTH LUZON'],
    ['SM Masinag', 14.625364, 121.1199172, 'Rizal', 'SOUTH LUZON'],
    ['SM Megamall', 14.5856693, 121.0566083, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM MOA', 14.5358397, 120.980416, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Molino', 14.3831641, 120.9775927, 'Cavite', 'CAVITE AREA'],
    ['SM Naga', 13.6211327, 123.1903499, 'Camarines Sur', 'SOUTH LUZON'],
    ['SM North Main', 14.6563879, 121.0300734, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM North The Block', 14.6558939, 121.0323097, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Novaliches', 14.7081659, 121.0381529, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Olongapo Central', 14.8370173, 120.282813, 'Zambales', 'NORTH LUZON'],
    ['SM Olongapo Downtown', 14.8264573, 120.2831319, 'Zambales', 'NORTH LUZON'],
    ['SM Palawan', 9.7439738, 118.7402726, 'Palawan', 'SOUTH LUZON'],
    ['SM Pampanga 2', 15.052138, 120.6988582, 'Pampanga', 'NORTH LUZON'],
    ['SM Rosales', 15.8781997, 120.6025975, 'Pangasinan', 'NORTH LUZON'],
    ['SM Rosario', 14.4091917, 120.8573046, 'Cavite', 'CAVITE AREA'],
    ['SM Roxas', 11.5957877, 122.7487031, 'Capiz', 'VISAYAS'],
    ['SM San Jose', 14.7864953, 121.075104, 'Bulacan', 'NORTH LUZON'],
    ['SM San Lazaro', 14.6179182, 120.9854576, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM San Mateo', 14.6801335, 121.1139431, 'Rizal', 'SOUTH LUZON'],
    ['SM San Pablo', 14.0713633, 121.3015686, 'Laguna', 'SOUTH LUZON'],
    ['SM San Pedro', 14.3330862, 121.0284876, 'Laguna', 'SOUTH LUZON'],
    ['SM Sangandaan', 14.6585595, 120.9717542, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Seaside', 10.2818856, 123.8812841, 'Cebu', 'VISAYAS'],
    ['SM Sorsogon', 12.9763652, 124.0193223, 'Sorsogon', 'SOUTH LUZON'],
    ['SM South Mall', 14.433448, 121.0106928, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Sta Rosa 1', 14.3128036, 121.0983253, 'Laguna', 'SOUTH LUZON'],
    ['SM Sta. Mesa', 14.6046632, 121.0190613, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Sto. Tomas', 14.1059623, 121.1501117, 'Batangas', 'SOUTH LUZON'],
    ['SM Sucat', 14.4688911, 121.0103989, 'Metro Manila (NCR)', 'NCR AREA'],
    ['SM Tanza', 14.3932578, 120.8498271, 'Cavite', 'CAVITE AREA'],
    ['SM Tarlac', 15.4774417, 120.5948595, 'Tarlac', 'NORTH LUZON'],
    ['SM Taytay', 14.5649089, 121.1392497, 'Rizal', 'SOUTH LUZON'],
    ['SM Telabastagan', 15.120246, 120.6018769, 'Pampanga', 'NORTH LUZON'],
    ['SM Trece Martires', 14.282036, 120.8659846, 'Cavite', 'CAVITE AREA'],
    ['SM Tuguegarao', 17.6274396, 121.7179561, 'Cagayan', 'NORTH LUZON'],
    ['SM Urdaneta', 15.9711341, 120.5718656, 'Pangasinan', 'NORTH LUZON'],
    ['Victory Antipolo', 14.5882015, 121.1759186, 'Rizal', 'SOUTH LUZON'],
    ['Vista Mall Bataan', 14.6548009, 120.5338636, 'Bataan', 'NORTH LUZON'],

    // 6 broad-region rows — one real, named representative store per PDF region
    ['NCR AREA', 14.5856693, 121.0566083, '(multiple)', 'NCR AREA'],
    ['CAVITE AREA', 14.301747, 120.9567294, '(multiple)', 'CAVITE AREA'],
    ['NORTH LUZON', 15.1699129, 120.5792407, '(multiple)', 'NORTH LUZON'],
    ['SOUTH LUZON', 14.2041849, 121.1545856, '(multiple)', 'SOUTH LUZON'],
    ['VISAYAS', 10.3114191, 123.9178164, '(multiple)', 'VISAYAS'],
    ['MINDANAO', 7.0911904, 125.611299, '(multiple)', 'MINDANAO'],

    // 8 legacy-area-name rows — reuse an existing nearby PDF store's coordinates.
    // PROVINCIAL is intentionally NOT included (see comment above the function).
    ['PAMPANGA AREA', 15.1626197, 120.6098906, 'Pampanga', 'NORTH LUZON'],
    ['OLONGAPO AREA', 14.8370173, 120.282813, 'Zambales', 'NORTH LUZON'],
    ['DAGUPAN AREA', 16.0443393, 120.3436764, 'Pangasinan', 'NORTH LUZON'],
    ['BULACAN AREA', 14.9601687, 120.8903531, 'Bulacan', 'NORTH LUZON'],
    ['LAGUNA AREA', 14.2041849, 121.1545856, 'Laguna', 'SOUTH LUZON'],
    ['BICOL AREA', 13.1437617, 123.7438313, 'Albay', 'SOUTH LUZON'],
    ['VIS/MIN AREA', 10.3114191, 123.9178164, 'Cebu', 'VISAYAS'],
    ['VISMIN / MINDANAO', 10.3114191, 123.9178164, 'Cebu', 'VISAYAS'],

    // 3 rows added 2026-07-05 after the first live run of
    // oneTimeStandardizeEmployeeRatesAreas() surfaced real unmatched
    // EmployeeRates.area values in the execution log:
    // - "NCR BRANCH" and "VISAYAS / MINDANAO" are alternate spellings of
    //   existing rows above ("NCR AREA" / "VISMIN / MINDANAO") — added as
    //   aliases (same coordinates) rather than editing EmployeeRates itself.
    // - "RIZAL AREA" had no AreaCenters row at all — added using a real
    //   Rizal-province store from the PDF (SM Masinag) as its representative point.
    ['NCR BRANCH', 14.5856693, 121.0566083, '(multiple)', 'NCR AREA'],
    ['VISAYAS / MINDANAO', 10.3114191, 123.9178164, 'Cebu', 'VISAYAS'],
    ['RIZAL AREA', 14.625364, 121.1199172, 'Rizal', 'SOUTH LUZON']
  ];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  return 'AreaCenters rebuilt: ' + rows.length + ' rows';
}

// One-time backfill (2026-07-05): standardizes EmployeeRates.area spelling
// to match AreaCenters' canonical casing (case-insensitive lookup only —
// never reassigns a row to a different area), and adds new `region`/
// `province` columns backfilled from the matched AreaCenters row. Rows
// with no case-insensitive match are left untouched (area unchanged,
// region/province blank) and reported via Logger.log so the admin can
// review them by hand — same "flag ambiguities, don't guess" convention
// as the 2026-07-03 rate-book import. Run manually once from the Apps
// Script editor, then delete — not wired into handleSaveRates/ongoing saves.
function oneTimeStandardizeEmployeeRatesAreas() {
  var centers = sheetToObjects('AreaCenters');
  var lookup = {};
  centers.forEach(function(c) {
    lookup[String(c['area']).toLowerCase()] = {
      canonicalArea: c['area'],
      region: c['region'],
      province: c['province']
    };
  });

  var sh = getSheet('EmployeeRates');
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var areaIdx = headers.indexOf('area');
  var empIdx = headers.indexOf('employee_name');
  var deptIdx = headers.indexOf('department');
  var regionIdx = headers.indexOf('region');
  if (regionIdx === -1) {
    regionIdx = headers.length;
    sh.getRange(1, regionIdx + 1).setValue('region');
    headers[regionIdx] = 'region';
  }
  var provinceIdx = headers.indexOf('province');
  if (provinceIdx === -1) {
    provinceIdx = headers.length;
    sh.getRange(1, provinceIdx + 1).setValue('province');
  }

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 'no data rows';

  var lastCol = Math.max(sh.getLastColumn(), regionIdx + 1, provinceIdx + 1);
  var dataRange = sh.getRange(2, 1, lastRow - 1, lastCol);
  var data = dataRange.getValues();
  var unmatched = [];

  data.forEach(function(row) {
    var area = String(row[areaIdx] || '');
    var match = lookup[area.toLowerCase()];
    if (match) {
      if (row[areaIdx] !== match.canonicalArea) row[areaIdx] = match.canonicalArea;
      row[regionIdx] = match.region;
      row[provinceIdx] = match.province;
    } else {
      row[regionIdx] = '';
      row[provinceIdx] = '';
      unmatched.push((row[empIdx] || row[deptIdx] || '(blank)') + ': "' + area + '"');
    }
  });

  dataRange.setValues(data);

  if (unmatched.length) {
    Logger.log('Unmatched EmployeeRates areas (%s rows), left as-is, region/province blank:\n%s',
      unmatched.length, unmatched.join('\n'));
  }
  return 'Standardized/backfilled ' + (data.length - unmatched.length) + ' rows, ' +
    unmatched.length + ' unmatched (see execution log)';
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
// `candidateRows` is the caller's already-scoped subset of EmployeeRates
// (this employee's own rows + their department's fallback rows) — passed in
// rather than re-fetched/re-filtered from the full company-wide table on
// every call (this is called up to twice per day in a period, and the full
// table only ever needs scoping-down once per request).
function resolveEmployeeRate(employeeName, department, destinationArea, candidateRows) {
  var empRow = candidateRows.filter(function(r) {
    return namesMatch(r['employee_name'], employeeName) && r['area'] === destinationArea;
  })[0];
  if (empRow) return empRow;
  var deptRow = candidateRows.filter(function(r) {
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

function computeMeal(employeeName, department, destinationArea, hoursWorked, motherBranch, destination, wasLogComplete, candidateAreaRows) {
  // Rule: no meal at mother branch. A genuinely incomplete log (missing
  // Log In or Log Out, including a day nulled by the 20-hour sanity cap —
  // see handleGetPeriodSheet's wasLogComplete computation) auto-grants
  // the meal regardless of hoursWorked. A complete log still requires
  // 5+ hours, unchanged from before.
  if (destination === motherBranch) return 0;
  if (wasLogComplete && hoursWorked < 5) return 0;
  var row = resolveEmployeeRate(employeeName, department, destinationArea, candidateAreaRows);
  if (!row) return 0;
  return parseFloat(row['meal_amount'] || 0);
}

function computeAccom(employeeName, department, destinationArea, motherBranch, destination, candidateAreaRows) {
  // No accommodation at mother branch
  if (destination === motherBranch) return 0;
  var row = resolveEmployeeRate(employeeName, department, destinationArea, candidateAreaRows);
  if (!row) return 0;
  return parseFloat(row['accom_amount'] || 0);
}

// `sortedBrackets` is MidnightRates pre-sorted by the caller (once per
// request) — this used to re-fetch and re-sort on every call, up to twice
// per day in a period, for a table that never changes within a request.
function computeMidnight(clockOutTime, sortedBrackets) {
  // clockOutTime: Date object
  if (!clockOutTime) return 0;
  var h = clockOutTime.getHours();
  var m = clockOutTime.getMinutes();
  var totalMin = h * 60 + m;

  var brackets = sortedBrackets;

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

// Shared chunked-cache helpers — CacheService.getScriptCache() caps each
// value at ~100KB, so a large string is split across numbered chunk keys
// plus one "_count" key recording how many chunks to reassemble. Used by
// both the attendance-CSV cache below and cachedSheetToObjects() further
// down, so the chunking dance only needs writing once.
var CACHE_CHUNK_SIZE = 90000; // stay under CacheService's ~100KB-per-key cap

function cacheGetChunked(cache, key) {
  var chunkCountStr = cache.get(key + '_count');
  if (!chunkCountStr) return null;
  var chunkCount = parseInt(chunkCountStr, 10);
  var keys = [];
  for (var i = 0; i < chunkCount; i++) keys.push(key + '_' + i);
  var chunks = cache.getAll(keys);
  if (!keys.every(function(k) { return chunks.hasOwnProperty(k); })) {
    return null; // one or more chunks expired/evicted independently
  }
  return keys.map(function(k) { return chunks[k]; }).join('');
}

function cachePutChunked(cache, key, str, ttlSeconds) {
  // Best-effort: caching is a speed optimization, not correctness-critical —
  // if this throws (e.g. quota), the caller already has its data and just
  // won't get the speedup on the next call.
  try {
    var chunkCount = Math.ceil(str.length / CACHE_CHUNK_SIZE) || 1;
    var toPut = {};
    for (var j = 0; j < chunkCount; j++) {
      toPut[key + '_' + j] = str.slice(j * CACHE_CHUNK_SIZE, (j + 1) * CACHE_CHUNK_SIZE);
    }
    toPut[key + '_count'] = String(chunkCount);
    cache.putAll(toPut, ttlSeconds);
  } catch (e) {
    // ignore — see comment above
  }
}

// Unlike a cache write, a failed bust is NOT swallowed — a write handler
// that silently fails to invalidate its own cache entry is the one failure
// mode that risks actually-wrong data (an approved claim looking
// unapproved), rather than just a slower-than-necessary read. Worst case on
// a genuine CacheService outage: the short TTL on cachedSheetToObjects()
// self-heals within seconds.
function cacheBustChunked(cache, key) {
  var chunkCountStr = cache.get(key + '_count');
  var chunkCount = chunkCountStr ? parseInt(chunkCountStr, 10) : 5; // fallback: clear a small fixed range
  var keys = [key + '_count'];
  for (var i = 0; i < chunkCount; i++) keys.push(key + '_' + i);
  cache.removeAll(keys);
}

// The attendance CSV is the whole company's whole log history (no
// date/employee filtering happens until AFTER download) and grows forever,
// so a bare UrlFetchApp.fetch() got slower every week and re-ran on every
// single login/period-sheet load.
var ATTENDANCE_CACHE_TTL_SEC = 180; // balances freshness vs. avoiding refetches

function fetchAttendanceCsv(csvUrl) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'attendanceCsv_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, csvUrl)
  );

  var cached = cacheGetChunked(cache, cacheKey);
  if (cached !== null) return cached;

  var csv = UrlFetchApp.fetch(csvUrl).getContentText();
  cachePutChunked(cache, cacheKey, csv, ATTENDANCE_CACHE_TTL_SEC);
  return csv;
}

// Caches sheetToObjects() results ACROSS requests (the existing _sheetCache
// only dedupes reads within one request — reset at the top of every
// runAction() call). handleGetPeriodSheet reads Users/EmployeeRates/Claims/
// MealDenials/ShiftTags on every single login/reload; each is a real Sheets-
// API round trip, so five of them stack on every load. Short TTLs (see call
// sites) plus explicit cacheBustSheet() calls in every handler that writes
// one of these sheets keep this from serving stale data after a save.
function cachedSheetToObjects(name, ttlSeconds) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'sheetObjects_' + name;
  var cached = cacheGetChunked(cache, cacheKey);
  if (cached !== null) return JSON.parse(cached);

  var rows = sheetToObjects(name); // still populates the per-request _sheetCache as before
  cachePutChunked(cache, cacheKey, JSON.stringify(rows), ttlSeconds);
  return rows;
}

function cacheBustSheet(name) {
  cacheBustChunked(CacheService.getScriptCache(), 'sheetObjects_' + name);
}

function handleGetAttendance(payload) {
  // payload: { period_start, period_end, employee_name (optional) }
  var csvUrl = getConfig('attendance_csv_url');
  if (!csvUrl) throw new Error('attendance_csv_url not set in Config.');
  var csv = fetchAttendanceCsv(csvUrl);
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
  cacheBustSheet('Claims');
  return id;
}

function handleGetConfig(payload) {
  return sheetToObjects('Config');
}

// ============================================================
// CLAIMS APPROVAL QUEUE (admin/head side)
// ============================================================

function handleGetClaims(payload) {
  // payload: { status (optional), employee_name (optional),
  //            date_start (optional), date_end (optional) }
  var claims = sheetToObjects('Claims');
  var startKey = payload.date_start ? claimDateKey(payload.date_start) : null;
  var endKey   = payload.date_end   ? claimDateKey(payload.date_end)   : null;
  return claims.filter(function(c) {
    if (payload.status && c['status'] !== payload.status) return false;
    if (payload.employee_name && c['employee_name'] !== payload.employee_name) return false;
    if (startKey || endKey) {
      var cKey = claimDateKey(c['date']);
      if (startKey && cKey < startKey) return false;
      if (endKey   && cKey > endKey)   return false;
    }
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
  var claimedAmtIdx = headers.indexOf('claimed_amount');

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][idIdx] === payload.claim_id) {
      sh.getRange(i+1, statusIdx+1).setValue(
        payload.decision === 'approve' ? 'Approved' : 'Rejected'
      );
      sh.getRange(i+1, approverIdx+1).setValue(payload.approver_name);
      sh.getRange(i+1, approvedAtIdx+1).setValue(new Date().toISOString());
      if (payload.notes) sh.getRange(i+1, notesIdx+1).setValue(payload.notes);
      // Admin may have corrected the submitted amount before approving —
      // gated on decision === 'approve' here too (not just trusting the
      // client to omit the field on reject), so a rejected claim's amount
      // is never touched even if the payload shape changes later.
      if (payload.decision === 'approve' && payload.claimed_amount !== undefined && payload.claimed_amount !== '') {
        sh.getRange(i+1, claimedAmtIdx+1).setValue(Number(payload.claimed_amount));
      }
      cacheBustSheet('Claims');
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
      cacheBustSheet('MealDenials');
      return { denied: false };
    }
  }

  sh.appendRow([payload.employee_name, payload.date, payload.denied_by, new Date().toISOString()]);
  cacheBustSheet('MealDenials');
  return { denied: true };
}

// The raw GPS-log Log-In/Log-Out pairing for a day can be ambiguous or
// wrong (stray/orphan logs — see handleGetPeriodSheet's segments[] KNOWN
// ISSUE comment below) — this lets the employee explicitly tag an
// individual raw attendance log as the 'start' or 'end' of a shift.
// resolveShiftDays() (below, inside handleGetPeriodSheet) then pairs a
// tagged 'start' with the next tagged 'end' that follows it chronologically
// into a "resolved Day", which drives HRS/MEAL/ACCOM/MIDNIGHT for that
// shift instead of the auto-derived first-in/last-out. Upsert/delete keyed
// on (employee_name, timestamp) — NOT date, since the unit tagged is one
// raw log, not a calendar day (a Day can span two calendar dates, e.g. an
// overnight shift). Case-sensitive employee_name match, same convention as
// handleToggleMealDenial — written by the app from an already-resolved
// session name, never hand-typed. Untagging (role '') DELETES the row
// entirely rather than writing a blank role, so there's no "tagged but
// blank" state to special-case on read.
//
// Batched (plural) rather than one action per tag — the frontend's "Save
// Shift Changes" button already batches multiple dropdown edits together
// in the browser (see index.html), so sending them as one request here
// avoids one Apps Script invocation + HTTP round trip per changed row.
function handleSaveShiftTags(payload) {
  // payload: { employee_name, tags: [{ timestamp, role }, ...] }  // role: 'start'|'end'|''
  var sh = getSheet('ShiftTags');
  var rows = sh.getDataRange().getValues();
  var headers = rows[0];
  var nameIdx = headers.indexOf('employee_name');
  var tsIdx   = headers.indexOf('timestamp');
  var roleIdx = headers.indexOf('role');
  var updIdx  = headers.indexOf('updated_at');
  var now     = new Date().toISOString();

  // Index this employee's existing rows by normalized timestamp once,
  // rather than re-scanning the whole sheet per tag.
  var existingRowIndex = {}; // normalizedTimestamp -> 0-based index into `rows`
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][nameIdx] === payload.employee_name) {
      existingRowIndex[normalizeTimestampCell(rows[i][tsIdx])] = i;
    }
  }

  var sheetRowsToDelete = []; // 1-based sheet row numbers
  var toAppend = [];

  payload.tags.forEach(function(tag) {
    var ts = normalizeTimestampCell(tag.timestamp);
    var existingIdx = existingRowIndex[ts];
    if (!tag.role) {
      if (existingIdx !== undefined) sheetRowsToDelete.push(existingIdx + 1);
      return;
    }
    if (existingIdx !== undefined) {
      sh.getRange(existingIdx + 1, roleIdx + 1).setValue(tag.role);
      sh.getRange(existingIdx + 1, updIdx  + 1).setValue(now);
    } else {
      toAppend.push([payload.employee_name, ts, tag.role, now]);
    }
  });

  // Delete in descending row-number order so an earlier deletion never
  // shifts a still-pending later row number out from under it.
  sheetRowsToDelete.sort(function(a, b) { return b - a; });
  sheetRowsToDelete.forEach(function(rowNum) { sh.deleteRow(rowNum); });

  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }

  cacheBustSheet('ShiftTags');
  return { saved: true, count: payload.tags.length };
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
  // Only records sharing the EXACT same timestamp collapse into one entry —
  // a duplicate log a few seconds apart (or any other difference) stays
  // distinct. Used to build per-day itemized segments (see day.segments below).
  function dedupeExactTimestamps(records) {
    var seen = {};
    return records.filter(function(r) {
      if (seen[r.timestamp]) return false;
      seen[r.timestamp] = true;
      return true;
    });
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
  var users = cachedSheetToObjects('Users', 30);
  var emp = users.filter(function(u) { return u['name'] === payload.employee_name; })[0];
  if (!emp) throw new Error('Employee not found: ' + payload.employee_name);

  // Candidate area rows for THIS employee: their own employee-specific rows
  // plus their department's fallback rows. Scoped per-employee (not the
  // whole EmployeeRates table) because different employees/departments can
  // use differently-named areas — a global lookup would risk matching
  // against some other employee's area name.
  var allEmployeeRates = cachedSheetToObjects('EmployeeRates', 30);
  var candidateAreaRows = allEmployeeRates.filter(function(r) {
    // Case-insensitive: see namesMatch comment near resolveEmployeeRate for why.
    return namesMatch(r['employee_name'], payload.employee_name) ||
           ((!r['employee_name'] || r['employee_name'] === '') && r['department'] === emp['department']);
  });

  var candidateAreaNames = candidateAreaRows
    .map(function(r) { return r['area']; })
    .filter(function(a, i, arr) { return a && arr.indexOf(a) === i; }); // distinct, non-blank

  // Sorted once per request and threaded into every computeMidnight() call
  // below — MidnightRates never changes within a request, so re-sorting it
  // on every one of the up-to-30 calls in a 15-day period was pure waste.
  var sortedMidnightBrackets = sheetToObjects('MidnightRates').slice();
  sortedMidnightBrackets.sort(function(a, b) { return b['amount'] - a['amount']; });

  // Get approved special claims for this period
  var allClaims = cachedSheetToObjects('Claims', 20);
  var specialClaims = allClaims.filter(function(c) {
    return c['employee_name'] === payload.employee_name &&
           c['status'] === 'Approved' &&
           (c['type'] === 'special-fare' || c['type'] === 'accommodation');
  });
  // Approved + Submitted — for display metadata only (claim_details per row).
  // Amount calculations below still use specialClaims (Approved-only).
  var specialClaimsAll = allClaims.filter(function(c) {
    return c['employee_name'] === payload.employee_name &&
           (c['status'] === 'Approved' || c['status'] === 'Submitted') &&
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
  var mealDenials = cachedSheetToObjects('MealDenials', 30);
  var deniedDates = {};
  mealDenials.forEach(function(d) {
    if (d['employee_name'] === payload.employee_name) {
      deniedDates[claimDateKey(d['date'])] = true;
    }
  });

  // Employee Start/End Shift tags — lets the employee tag an individual raw
  // log as 'start' or 'end' of a shift (see handleSaveShiftTag above).
  // Indexed by exact timestamp (not date — a tagged shift can span two
  // calendar dates, e.g. an overnight shift).
  var shiftTags = cachedSheetToObjects('ShiftTags', 30);
  var tagByTimestamp = {};
  shiftTags.forEach(function(t) {
    if (t['employee_name'] === payload.employee_name) {
      tagByTimestamp[normalizeTimestampCell(t['timestamp'])] = t['role'];
    }
  });

  // Resolves employee-tagged 'start'/'end' logs into "resolved Days" — a
  // tagged 'start' is paired with the NEXT tagged 'end' that follows it
  // chronologically. Mirrors the exact same state-machine shape as the
  // real Log-In/Log-Out pairing loop above: a new 'start' tag encountered
  // while one is already pending (no 'end' yet) silently ABANDONS the
  // pending start — no Day is produced for it, exactly like a second real
  // Log In closing out an unclosed one today. A trailing pending start with
  // no following 'end', or an orphan 'end' tag with no pending start,
  // likewise produce no Day. dayNumber increments once per resolved
  // (closed) pair, in the order pairs CLOSE — there is no calendar date to
  // key numbering off since a Day can span two dates.
  function resolveShiftDays(records, tagMap) {
    var days = [];
    var pendingStart = null;
    var counter = 0;
    records.forEach(function(r) {
      var role = tagMap[normalizeTimestampCell(r.timestamp)];
      if (role === 'start') {
        pendingStart = r;
      } else if (role === 'end' && pendingStart) {
        counter++;
        days.push({
          dayNumber:      counter,
          startTimestamp: pendingStart.timestamp,
          endTimestamp:   r.timestamp,
          ownDate:        dayKey(pendingStart.timestamp)
        });
        pendingStart = null;
      }
    });
    return days;
  }

  var resolvedDays = resolveShiftDays(attRecords, tagByTimestamp);

  // Per-resolved-Day HRS/MEAL/ACCOM/MIDNIGHT — computed independently of,
  // and does NOT replace, the per-calendar-date `rows`/`segments` built
  // below (those keep driving the admin view and the per-location fare-
  // claim feature exactly as before). Reuses the same compute* functions
  // and area-resolution logic, just fed a tagged Start/End pair's
  // timestamps instead of a calendar date's auto first-in/last-out.
  resolvedDays.forEach(function(day) {
    var firstIn = new Date(day.startTimestamp);
    var lastOut = new Date(day.endTimestamp);
    // Same 20-hour sanity cap as the per-date loop below — a tagged pair is
    // still just two raw logs and can in principle be mistagged across an
    // implausible span.
    if ((lastOut - firstIn) / 3600000 > 20) lastOut = null;

    var hoursWorked = lastOut ? (lastOut - firstIn) / 3600000 : 0;
    var wasComplete = !!lastOut;
    var startRecord = attRecords.filter(function(r) { return r.timestamp === day.startTimestamp; })[0];
    var destination = startRecord ? startRecord.destination : '';

    var destinationArea = destination;
    candidateAreaRows.forEach(function(r) {
      if (destination.toLowerCase().indexOf(r['area'].toLowerCase()) !== -1) {
        destinationArea = r['area'];
      }
    });
    if (destinationArea === destination && startRecord &&
        (startRecord.lat || startRecord.lng)) {
      var gpsArea = resolveAreaByGPS(startRecord.lat, startRecord.lng, candidateAreaNames);
      if (gpsArea) destinationArea = gpsArea;
    }

    day.hours_worked = Math.round(hoursWorked * 10) / 10;
    day.meal = computeMeal(payload.employee_name, emp['department'], destinationArea,
                            hoursWorked, emp['mother_branch'], destination, wasComplete, candidateAreaRows);
    day.meal_denied = !!deniedDates[day.ownDate];
    if (day.meal_denied) day.meal = 0;
    day.accom = computeAccom(payload.employee_name, emp['department'], destinationArea,
                              emp['mother_branch'], destination, candidateAreaRows);
    var daySpecialAccom = specialClaims.filter(function(c) {
      return c['type'] === 'accommodation' && claimDateKey(c['date']) === day.ownDate;
    }).reduce(function(s, c) { return s + parseFloat(c['claimed_amount'] || 0); }, 0);
    day.accom += daySpecialAccom;
    day.midnight = lastOut ? computeMidnight(lastOut, sortedMidnightBrackets) : 0;
    day.total = day.meal + day.accom + day.midnight; // fare stays segment-level, not summed here
  });

  var daysByNumber = {};
  resolvedDays.forEach(function(d) { daysByNumber[d.dayNumber] = d; });

  // Flat, whole-period, chronological list of every raw attendance log —
  // the primary display unit for the employee "My Sheet" tab (one <tr> per
  // log, not per calendar date). day_number/is_day_start_row let the
  // frontend rowspan-merge DAY/HRS/MEAL/ACCOM/MIDNIGHT/TOTAL across a
  // resolved Day's row range without re-deriving the pairing client-side.
  var startIndexOf = {}, endIndexOf = {};
  resolvedDays.forEach(function(d) {
    startIndexOf[d.startTimestamp] = d.dayNumber;
  });
  var openDayNumber = null;
  var logs = attRecords.map(function(r) {
    if (startIndexOf[r.timestamp] !== undefined) openDayNumber = startIndexOf[r.timestamp];
    var dayNumber = openDayNumber;
    var isDayStartRow = (openDayNumber !== null && r.timestamp === daysByNumber[openDayNumber].startTimestamp);
    if (dayNumber !== null && r.timestamp === daysByNumber[dayNumber].endTimestamp) {
      openDayNumber = null; // this row closes the range; the NEXT row (if any) belongs to no day unless it opens a new one
    }
    return {
      timestamp:   r.timestamp,
      date:        dayKey(r.timestamp),
      time_label:  new Date(r.timestamp).toLocaleTimeString('en-PH', {hour:'2-digit', minute:'2-digit'}),
      type:        r.type,
      destination: r.destination,
      tag:         tagByTimestamp[normalizeTimestampCell(r.timestamp)] || '',
      day_number:      dayNumber,
      is_day_start_row: isDayStartRow
    };
  });

  var rows = [];
  var dates = Object.keys(dayMap).sort();

  dates.forEach(function(date) {
    var day    = dayMap[date];
    day.in_record  = day.ins.length  ? day.ins[0] : null;
    day.out_record = day.outs.length ? day.outs[day.outs.length-1] : null;
    var firstIn  = day.in_record  ? new Date(day.in_record.timestamp)  : null;
    var lastOut  = day.out_record ? new Date(day.out_record.timestamp) : null;

    // KNOWN ISSUE: the segments[] block below zips day.ins/day.outs purely
    // by array position after independently deduping each array, which can
    // pair an unrelated orphan log into the wrong "segment" (e.g. end time
    // earlier than start time) when a day has stray logs. This is a
    // separate, pre-existing bug in the per-segment fare-claim feature
    // (FROM/TO/MODE/FARE AMT below) — intentionally NOT fixed here. The
    // employee-tagged Start/End Shift feature (resolveShiftDays above)
    // solves this same class of ambiguity for HRS/MEAL/ACCOM/MIDNIGHT via
    // an entirely separate, additive `days`/`logs` pass — it does not touch
    // this per-calendar-date segments[] construction at all.
    //
    // Itemized per-location segments — additive, does NOT replace the
    // first-in/last-out day-level fields above (those still drive meal/
    // accom/midnight/area resolution exactly as before). Lets an employee
    // who visited multiple distinct locations in one day file a separate
    // fare claim per segment instead of one claim for the whole day. Only
    // exact-same-timestamp records merge (dedupeExactTimestamps) — any
    // other difference stays a separate segment. Sequential index-zip
    // pairing is safe here because both arrays are already chronologically
    // ordered (attRecords sorted above, state machine appends in order).
    var segIns  = dedupeExactTimestamps(day.ins);
    var segOuts = dedupeExactTimestamps(day.outs);
    var segCount = Math.max(segIns.length, segOuts.length);
    var segments = [];
    for (var si = 0; si < segCount; si++) {
      var segIn  = segIns[si]  || null;
      var segOut = segOuts[si] || null;
      var segFirstIn = segIn  ? new Date(segIn.timestamp)  : null;
      var segLastOut = segOut ? new Date(segOut.timestamp) : null;
      segments.push({
        seg_key:      segIn ? segIn.timestamp : ('out-' + segOut.timestamp),
        time_in:      segFirstIn ? segFirstIn.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '',
        time_out:     segLastOut ? segLastOut.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '',
        // Exact raw timestamps (not display strings) — the join key the
        // frontend uses to match this segment back to its two rows in the
        // flat `logs[]` list.
        time_in_raw:  segIn  ? segIn.timestamp  : '',
        time_out_raw: segOut ? segOut.timestamp : '',
        hours_worked: (segFirstIn && segLastOut) ? Math.round(((segLastOut-segFirstIn)/3600000) * 10) / 10 : 0,
        destination:  segIn ? segIn.destination : segOut.destination,
        complete:     !!(segIn && segOut)
      });
    }

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
                               hoursWorked, emp['mother_branch'], destination, wasLogComplete, candidateAreaRows);
    var mealDenied = !!deniedDates[date];
    if (mealDenied) meal = 0;
    var accom    = computeAccom(payload.employee_name, emp['department'], destinationArea,
                                emp['mother_branch'], destination, candidateAreaRows);
    var midnight = computeMidnight(lastOut, sortedMidnightBrackets);

    // Find approved special claims for this date
    var daySpecial = specialClaims.filter(function(c) { return claimDateKey(c['date']) === date; });
    var specialFare  = daySpecial.filter(function(c) { return c['type']==='special-fare'; })
                                 .reduce(function(s,c) { return s + parseFloat(c['claimed_amount']||0); }, 0);
    var specialAccom = daySpecial.filter(function(c) { return c['type']==='accommodation'; })
                                 .reduce(function(s,c) { return s + parseFloat(c['claimed_amount']||0); }, 0);

    var hasCompanyService = companyServiceClaims.some(function(c) {
      return claimDateKey(c['date']) === date;
    });
    // Auto-fare (GPS distance + LTFRB formula) retired 2026-07-05 — fare is
    // now always a manual employee claim (special-fare, vehicle_mode
    // Jeepney/Tricycle/Company Service). computeFare()/buildAutoFareClaim()
    // are left defined but unused; see
    // docs/superpowers/specs/2026-07-05-manual-fare-claims-design.md.
    var autoFare = 0;

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
      total_allowance: (autoFare + specialFare) + meal + (accom + specialAccom) + midnight,
      segments: segments,
      claim_details: specialClaimsAll
        .filter(function(c) { return claimDateKey(c['date']) === date; })
        .map(function(c) {
          return {
            id:             c['id'],
            type:           c['type'],
            from_loc:       c['from_loc']     || '',
            to_loc:         c['to_loc']       || '',
            vehicle_mode:   c['vehicle_mode'] || '',
            claimed_amount: parseFloat(c['claimed_amount'] || 0),
            status:         c['status'],
            segment_key:    c['segment_key'] || ''
          };
        })
    });
  });

  return {
    employee: emp,
    period_start: payload.period_start,
    period_end:   payload.period_end,
    rows: rows,
    // Additive fields for the employee "My Sheet" tab's flat per-log
    // timeline + Start/End Shift tagging feature — `rows`/`totals` above
    // are completely unchanged so the admin view (which only ever reads
    // those) is unaffected.
    logs: logs,
    days: resolvedDays,
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
