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
