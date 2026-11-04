/*
 * Legacy Gym - Database engine (main process)
 * sql.js (WASM SQLite) — no native modules, fully portable (USB-friendly).
 * The DB lives as a single file on disk; writes are debounced + flushed on quit.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let SQL = null;        // sql.js module
let db = null;         // database instance
let dbFile = null;     // absolute path of the db file
let saveTimer = null;
let dirty = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  employee_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  age INTEGER,
  gender TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'month',
  duration_days INTEGER NOT NULL DEFAULT 30,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate REAL NOT NULL DEFAULT 0,
  price_usd REAL NOT NULL DEFAULT 0,
  price_lbp REAL NOT NULL DEFAULT 0,
  paid_usd REAL NOT NULL DEFAULT 0,
  manual_status TEXT DEFAULT '',
  pause_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER,
  member_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  entered_amount REAL NOT NULL DEFAULT 0,
  entered_currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate_at_payment REAL NOT NULL DEFAULT 0,
  converted_amount_usd REAL NOT NULL DEFAULT 0,
  converted_amount_lbp REAL NOT NULL DEFAULT 0,
  payment_date TEXT DEFAULT '',
  payment_time TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS pauses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT DEFAULT '',
  days INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'أخرى',
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  stock INTEGER NOT NULL DEFAULT 0,
  low_stock INTEGER NOT NULL DEFAULT 5,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  unit_purchase_price_at_sale REAL NOT NULL DEFAULT 0,
  unit_selling_price_at_sale REAL NOT NULL DEFAULT 0,
  total_revenue REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  gross_profit REAL NOT NULL DEFAULT 0,
  exchange_rate_at_sale REAL NOT NULL DEFAULT 0,
  total_revenue_usd REAL NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  member_id INTEGER,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate_at_expense REAL NOT NULL DEFAULT 0,
  converted_amount_usd REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  job TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  salary REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  start_date TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'يعمل',
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS salaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate_at_payment REAL NOT NULL DEFAULT 0,
  converted_amount_usd REAL NOT NULL DEFAULT 0,
  month TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS inventory_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate_at_purchase REAL NOT NULL DEFAULT 0,
  converted_total_usd REAL NOT NULL DEFAULT 0,
  supplier TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS member_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT DEFAULT '',
  entity_id INTEGER,
  details TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_member ON subscriptions(member_id);
CREATE INDEX IF NOT EXISTS idx_pay_member ON payments(member_id);
CREATE INDEX IF NOT EXISTS idx_pause_sub ON pauses(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(created_at);
CREATE INDEX IF NOT EXISTS idx_log_date ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_invp_date ON inventory_purchases(created_at);
CREATE INDEX IF NOT EXISTS idx_notes_member ON member_notes(member_id);
`;

function pad(n) { return String(n).padStart(2, '0'); }
function nowStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function todayStr(d) { return nowStr(d).slice(0, 10); }
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { salt, hash };
}

/* Constant-time comparison of two hex hashes (avoids timing side channels). */
function sameHash(a, b) {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
// used to burn the same scrypt time for unknown usernames (no user enumeration by timing)
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');

function persistSoon() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persistNow(); }, 400);
}

function persistNow() {
  if (!db || !dirty) return;
  try {
    const data = Buffer.from(db.export());
    const tmp = dbFile + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dbFile);
    dirty = false;
  } catch (e) {
    console.error('DB persist failed:', e);
  }
}

function all(sql, params) {
  const stmt = db.prepare(sql);
  try {
    if (params) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally { stmt.free(); }
}

function run(sql, params) {
  const stmt = db.prepare(sql);
  try {
    if (params) stmt.bind(params);
    stmt.step();
  } finally { stmt.free(); }
  const changes = db.getRowsModified();
  let lastId = null;
  if (/^\s*insert/i.test(sql)) {
    const r = all('SELECT last_insert_rowid() AS id');
    lastId = r.length ? r[0].id : null;
  }
  persistSoon();
  return { changes, lastId };
}

function getSetting(key, fallback) {
  const r = all('SELECT value FROM settings WHERE key = :k', { ':k': key });
  return r.length ? r[0].value : (fallback === undefined ? null : fallback);
}

function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES(:k, :v) ON CONFLICT(key) DO UPDATE SET value = :v',
    { ':k': key, ':v': String(value) });
}

/* Column migrations for databases created by older versions. */
function ensureColumn(table, col, def) {
  const cols = all(`PRAGMA table_info(${table})`).map(c => c.name);
  if (!cols.includes(col)) run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
function migrate() {
  ensureColumn('members', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('products', 'created_at', "TEXT DEFAULT ''");
  ensureColumn('products', 'created_by', "TEXT DEFAULT ''");
  ensureColumn('products', 'purchase_price', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('users', 'full_name', "TEXT DEFAULT ''");
  ensureColumn('users', 'phone', "TEXT DEFAULT ''");
  ensureColumn('users', 'position', "TEXT DEFAULT ''");
  ensureColumn('users', 'last_login', "TEXT DEFAULT ''");
  ensureColumn('subscriptions', 'exchange_rate', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('subscriptions', 'price_usd', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('subscriptions', 'price_lbp', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('subscriptions', 'paid_usd', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('payments', 'entered_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('payments', 'entered_currency', "TEXT NOT NULL DEFAULT 'USD'");
  ensureColumn('payments', 'exchange_rate_at_payment', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('payments', 'converted_amount_usd', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('payments', 'converted_amount_lbp', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('payments', 'payment_date', "TEXT DEFAULT ''");
  ensureColumn('payments', 'payment_time', "TEXT DEFAULT ''");
  ensureColumn('sales', 'unit_purchase_price_at_sale', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('sales', 'unit_selling_price_at_sale', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('sales', 'total_revenue', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('sales', 'total_cost', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('sales', 'gross_profit', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('sales', 'exchange_rate_at_sale', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('sales', 'total_revenue_usd', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('sales', 'total_cost_usd', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('expenses', 'exchange_rate_at_expense', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('expenses', 'converted_amount_usd', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('salaries', 'exchange_rate_at_payment', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('salaries', 'converted_amount_usd', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('inventory_purchases', 'exchange_rate_at_purchase', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('inventory_purchases', 'converted_total_usd', 'REAL NOT NULL DEFAULT 0');
  const legacyRate = Number(getSetting('lbp_rate', '89000')) || 89000;
  run(`UPDATE subscriptions SET exchange_rate=:r,
    price_usd=CASE WHEN currency='LBP' THEN price/:r ELSE price END,
    price_lbp=CASE WHEN currency='LBP' THEN price ELSE price*:r END,
    paid_usd=CASE WHEN currency='LBP' THEN paid/:r ELSE paid END
    WHERE exchange_rate=0 OR price_usd=0`, { ':r': legacyRate });
  run(`UPDATE payments SET entered_amount=amount, entered_currency=currency,
    exchange_rate_at_payment=:r,
    converted_amount_usd=CASE WHEN currency='LBP' THEN amount/:r ELSE amount END,
    converted_amount_lbp=CASE WHEN currency='LBP' THEN amount ELSE amount*:r END,
    payment_date=substr(created_at,1,10), payment_time=substr(created_at,12,8)
    WHERE exchange_rate_at_payment=0`, { ':r': legacyRate });
  run(`UPDATE sales SET unit_selling_price_at_sale=unit_price, total_revenue=total,
    unit_purchase_price_at_sale=COALESCE((SELECT purchase_price FROM products WHERE products.id=sales.product_id),0),
    total_cost=qty*COALESCE((SELECT purchase_price FROM products WHERE products.id=sales.product_id),0),
    gross_profit=total-(qty*COALESCE((SELECT purchase_price FROM products WHERE products.id=sales.product_id),0)),
    exchange_rate_at_sale=:r,
    total_revenue_usd=CASE WHEN currency='LBP' THEN total/:r ELSE total END,
    total_cost_usd=CASE WHEN currency='LBP' THEN (qty*COALESCE((SELECT purchase_price FROM products WHERE products.id=sales.product_id),0))/:r ELSE qty*COALESCE((SELECT purchase_price FROM products WHERE products.id=sales.product_id),0) END
    WHERE exchange_rate_at_sale=0`, { ':r': legacyRate });
  run("UPDATE expenses SET exchange_rate_at_expense=:r, converted_amount_usd=CASE WHEN currency='LBP' THEN amount/:r ELSE amount END WHERE exchange_rate_at_expense=0", { ':r': legacyRate });
  run("UPDATE salaries SET exchange_rate_at_payment=:r, converted_amount_usd=CASE WHEN currency='LBP' THEN amount/:r ELSE amount END WHERE exchange_rate_at_payment=0", { ':r': legacyRate });
  run("UPDATE inventory_purchases SET exchange_rate_at_purchase=:r, converted_total_usd=CASE WHEN currency='LBP' THEN total_cost/:r ELSE total_cost END WHERE exchange_rate_at_purchase=0", { ':r': legacyRate });
  // backfill accounts created before full_name existed (e.g. the very first seeded admin)
  run("UPDATE users SET full_name = username WHERE full_name = '' OR full_name IS NULL");
  // one-time: migrate the old single-blob members.notes into the new member_notes table
  if (getSetting('member_notes_migrated') === null) {
    const withNotes = all("SELECT id, notes, created_at FROM members WHERE notes IS NOT NULL AND notes != ''");
    withNotes.forEach(m => {
      run('INSERT INTO member_notes(member_id, text, created_at, created_by) VALUES(:m,:t,:c,:by)',
        { ':m': m.id, ':t': m.notes, ':c': m.created_at || nowStr(), ':by': 'migration' });
    });
    setSetting('member_notes_migrated', '1');
  }
}

const DEFAULT_SETTINGS = {
  gym_name: 'Legacy Gym',
  gym_name_ar: 'ليجاسي جيم',
  monthly_price: '30',
  day_price: '3',
  base_currency: 'USD',
  lbp_rate: '89000',
  gym_phone: '',
  gym_address: '',
  backup_dir: '',
  last_backup: '',
  last_seen_ts: '',
  accent: 'gold'
};

function seedDefaults() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (getSetting(k) === null) setSetting(k, v);
  }
  // First run: single default admin account only — no demo data, no sample products.
  const users = all('SELECT COUNT(*) AS c FROM users');
  if (users[0].c === 0) {
    const admin = hashPassword('123456');
    run(`INSERT INTO users(username, password_hash, salt, role, active, created_at, full_name, position)
      VALUES(:u,:h,:s,:r,1,:t,:f,:pos)`,
      { ':u': 'Kamal', ':h': admin.hash, ':s': admin.salt, ':r': 'admin', ':t': nowStr(), ':f': 'Kamal', ':pos': 'مدير النظام' });
  }
}

async function init(options) {
  const opts = options || {};
  dbFile = opts.dbFile;
  const sqlJsPath = opts.sqlJsDir || path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
  const initSqlJs = require(path.join(sqlJsPath, 'sql-wasm.js'));
  SQL = await initSqlJs({ locateFile: (f) => path.join(sqlJsPath, f) });
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  if (fs.existsSync(dbFile)) {
    db = new SQL.Database(fs.readFileSync(dbFile));
  } else {
    db = new SQL.Database();
  }
  db.exec(SCHEMA);
  migrate();
  seedDefaults();
  dirty = true;
  persistNow();
  return module.exports;
}

/* -------- Auth -------- */
function login(username, password) {
  const rows = all('SELECT * FROM users WHERE username = :u AND active = 1', { ':u': String(username == null ? '' : username).trim() });
  if (!rows.length) {
    hashPassword(String(password == null ? '' : password), DUMMY_SALT);
    return { ok: false, error: 'اسم المستخدم غير موجود أو الحساب موقوف' };
  }
  const u = rows[0];
  const { hash } = hashPassword(String(password == null ? '' : password), u.salt);
  if (!sameHash(hash, u.password_hash)) return { ok: false, error: 'كلمة المرور غير صحيحة' };
  run('UPDATE users SET last_login = :t WHERE id = :id', { ':t': nowStr(), ':id': u.id });
  run('INSERT INTO activity_log(username, action, entity, details, created_at) VALUES(:u,\'تسجيل دخول\',\'auth\',\'\',:t)', { ':u': u.username, ':t': nowStr() });
  return { ok: true, user: { id: u.id, username: u.username, role: u.role } };
}

function createUser(username, password, role, extra) {
  const { salt, hash } = hashPassword(password);
  const ex = extra || {};
  return run(`INSERT INTO users(username, password_hash, salt, role, active, created_at, full_name, phone, position)
    VALUES(:u,:h,:s,:r,1,:t,:f,:p,:pos)`,
    { ':u': username, ':h': hash, ':s': salt, ':r': role, ':t': nowStr(),
      ':f': (ex.fullName || username), ':p': (ex.phone || ''), ':pos': (ex.position || '') });
}

function setPassword(userId, password) {
  const { salt, hash } = hashPassword(password);
  return run('UPDATE users SET password_hash = :h, salt = :s WHERE id = :id', { ':h': hash, ':s': salt, ':id': userId });
}

function verifyPassword(userId, password) {
  const rows = all('SELECT * FROM users WHERE id = :id', { ':id': userId });
  if (!rows.length) return false;
  const { hash } = hashPassword(String(password == null ? '' : password), rows[0].salt);
  return sameHash(hash, rows[0].password_hash);
}

/* Admin (or any user) changing their OWN password — requires the current password. */
function changeOwnPassword(userId, currentPassword, newPassword) {
  if (!verifyPassword(userId, currentPassword)) return { ok: false, error: 'كلمة المرور الحالية غير صحيحة' };
  if (String(newPassword || '').length < 6) return { ok: false, error: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف' };
  setPassword(userId, newPassword);
  return { ok: true };
}

function setUsername(userId, newUsername) {
  newUsername = String(newUsername || '').trim();
  if (!newUsername) return { ok: false, error: 'اسم المستخدم مطلوب' };
  const dup = all('SELECT id FROM users WHERE username = :u AND id != :id', { ':u': newUsername, ':id': userId });
  if (dup.length) return { ok: false, error: 'اسم المستخدم مستخدم مسبقًا' };
  run('UPDATE users SET username = :u WHERE id = :id', { ':u': newUsername, ':id': userId });
  return { ok: true, username: newUsername };
}

function updateUserProfile(userId, profile) {
  const p = profile || {};
  run('UPDATE users SET full_name = :f, phone = :p, position = :pos WHERE id = :id',
    { ':f': (p.fullName || '').trim(), ':p': (p.phone || '').trim(), ':pos': (p.position || '').trim(), ':id': userId });
  return { ok: true };
}

/* How many OTHER active admins exist besides `excludeId` — used to stop the
   last active admin account from being demoted, disabled, or deleted (lockout). */
function countActiveAdmins(excludeId) {
  const params = {};
  let sql = "SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1";
  if (excludeId) { sql += ' AND id != :id'; params[':id'] = excludeId; }
  return all(sql, params)[0].c;
}

function setRole(userId, role) {
  const rows = all('SELECT * FROM users WHERE id = :id', { ':id': userId });
  if (!rows.length) return { ok: false, error: 'المستخدم غير موجود' };
  const u = rows[0];
  if (u.role === 'admin' && role !== 'admin' && u.active && countActiveAdmins(userId) === 0) {
    return { ok: false, error: 'لا يمكن تغيير صلاحية آخر حساب مدير فعّال في النظام' };
  }
  run('UPDATE users SET role = :r WHERE id = :id', { ':r': role, ':id': userId });
  return { ok: true };
}

function setActive(userId, active) {
  const rows = all('SELECT * FROM users WHERE id = :id', { ':id': userId });
  if (!rows.length) return { ok: false, error: 'المستخدم غير موجود' };
  const u = rows[0];
  if (!active && u.role === 'admin' && u.active && countActiveAdmins(userId) === 0) {
    return { ok: false, error: 'لا يمكن إيقاف آخر حساب مدير فعّال في النظام' };
  }
  run('UPDATE users SET active = :a WHERE id = :id', { ':a': active ? 1 : 0, ':id': userId });
  return { ok: true };
}

/* Real business records tied to this username — NOT activity_log (a fresh
   account that only ever logged in must still be permanently deletable). */
function userHasHistory(username) {
  const checks = [
    ['sales', 'created_by'], ['payments', 'created_by'], ['expenses', 'created_by'],
    ['subscriptions', 'created_by'], ['members', 'created_by'], ['salaries', 'created_by']
  ];
  for (const [table, col] of checks) {
    const r = all(`SELECT COUNT(*) c FROM ${table} WHERE ${col} = :u`, { ':u': username });
    if (r[0].c > 0) return true;
  }
  return false;
}

/* Delete when the account has no linked records; otherwise disable it so all
   sales/subscriptions/expenses/salaries it created stay intact. */
function deleteUser(userId) {
  const rows = all('SELECT * FROM users WHERE id = :id', { ':id': userId });
  if (!rows.length) return { ok: false, error: 'المستخدم غير موجود' };
  const u = rows[0];
  if (u.role === 'admin' && u.active && countActiveAdmins(userId) === 0) {
    return { ok: false, error: 'لا يمكن حذف آخر حساب مدير فعّال في النظام' };
  }
  if (userHasHistory(u.username)) {
    run('UPDATE users SET active = 0 WHERE id = :id', { ':id': userId });
    return { ok: true, action: 'disabled', username: u.username };
  }
  run('DELETE FROM users WHERE id = :id', { ':id': userId });
  return { ok: true, action: 'deleted', username: u.username };
}

/* -------- Backup -------- */
function backupTo(dir) {
  persistNow();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = nowStr().replace(/[: ]/g, '-');
  const dest = path.join(dir, `ironcore-backup-${stamp}.db`);
  fs.copyFileSync(dbFile, dest);
  setSetting('last_backup', nowStr());
  return dest;
}

function restoreFrom(file) {
  const bytes = fs.readFileSync(file);
  const testDb = new SQL.Database(bytes); // validate it opens
  testDb.exec('SELECT COUNT(*) FROM users'); // validate schema
  testDb.close();
  if (db) db.close();
  db = new SQL.Database(bytes);
  db.exec(SCHEMA);
  migrate();
  dirty = true;
  persistNow();
  return true;
}

function close() {
  persistNow();
  if (db) { db.close(); db = null; }
}

module.exports = {
  init, all, run, close, persistNow,
  getSetting, setSetting,
  login, createUser, setPassword, hashPassword, verifyPassword, changeOwnPassword,
  setUsername, updateUserProfile, setRole, setActive, deleteUser, userHasHistory, countActiveAdmins,
  backupTo, restoreFrom,
  nowStr, todayStr, addDays,
  get file() { return dbFile; }
};
