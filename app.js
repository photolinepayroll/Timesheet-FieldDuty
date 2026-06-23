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
