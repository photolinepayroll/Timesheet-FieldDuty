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
    // 'getPeriodSheet', 'getAttendance')
    // as their handler functions are implemented.
    var handlers = {
      'ping': handlePing,
      'login': handleLogin,
      'getUsers': handleGetUsers,
      'saveUser': handleSaveUser,
      'getRates': handleGetRates,
      'saveRates': handleSaveRates
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
