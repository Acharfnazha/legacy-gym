/*
 * Legacy Gym — test suite (npm test)
 * Runs the real DB engine (main/db.js) against a temp file + the shared
 * domain logic (src/js/logic.js). No test framework needed.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const db = require('../main/db');
const L = require('../src/js/logic.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.error('  FAIL  ' + name); }
}
function eq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.error('  FAIL  ' + name + '\n        expected: ' + JSON.stringify(b) + '\n        got:      ' + JSON.stringify(a)); }
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironcore-test-'));
  const dbFile = path.join(tmpDir, 'test.db');
  await db.init({ dbFile, sqlJsDir: path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist') });

  console.log('\n== First run is completely empty (no demo data) ==');
  eq(db.all('SELECT COUNT(*) c FROM members')[0].c, 0, 'no members on first run');
  eq(db.all('SELECT COUNT(*) c FROM products')[0].c, 0, 'no products on first run');
  eq(db.all('SELECT COUNT(*) c FROM sales')[0].c, 0, 'no sales on first run');
  eq(db.all('SELECT COUNT(*) c FROM subscriptions')[0].c, 0, 'no subscriptions on first run');
  eq(db.all('SELECT COUNT(*) c FROM expenses')[0].c, 0, 'no expenses on first run');
  eq(db.all('SELECT COUNT(*) c FROM employees')[0].c, 0, 'no employees on first run');
  eq(db.all('SELECT COUNT(*) c FROM users')[0].c, 1, 'exactly one user (the default admin)');

  console.log('\n== Calendar-month subscription dates ==');
  eq(L.addMonths('2026-07-03', 1), '2026-08-03', '03/07 + 1 month = 03/08');
  eq(L.addMonths('2026-07-15', 1), '2026-08-15', '15/07 + 1 month = 15/08');
  eq(L.addMonths('2026-01-31', 1), '2026-02-28', 'Jan 31 clamps to Feb 28');
  eq(L.addMonths('2026-08-31', 1), '2026-09-30', 'Aug 31 clamps to Sep 30');
  eq(L.addMonths('2026-11-15', 2), '2027-01-15', 'crosses year boundary');
  eq(L.subEnd('month', 1, '2026-07-03'), '2026-08-03', 'month sub = same day next month');
  eq(L.subEnd('months', 3, '2026-07-03'), '2026-10-03', '3 months = same day +3 months');
  eq(L.subEnd('day', 1, '2026-07-03'), '2026-07-04', 'day sub = next day');
  eq(L.subEnd('custom', 12, '2026-07-03'), '2026-07-15', 'custom 12 days');

  console.log('\n== Subscription status ==');
  const sub = { end_date: '2026-07-10', price: 30, paid: 30, manual_status: '' };
  eq(L.subStatus(sub, '2026-07-03').key, 'active', 'active before end date');
  eq(L.subStatus(sub, '2026-07-10').key, 'expires_today', 'expires on end date');
  eq(L.subStatus(sub, '2026-07-11').lateDays, 1, 'late 1 day after end');
  eq(L.subStatus(sub, '2026-07-14').lateDays, 4, 'late 4 days');
  eq(L.subStatus({ ...sub, manual_status: 'paused' }, '2026-08-01').key, 'paused', 'paused wins over expiry — no late days');
  eq(L.subStatus({ ...sub, manual_status: 'paused' }, '2026-08-01').lateDays, 0, 'paused accrues zero late days');
  eq(L.subStatus({ ...sub, paid: 10 }, '2026-07-03').owed, 20, 'owed = price - paid');

  eq(L.toUSD(89000, 'LBP', 89000), 1, 'LBP→USD conversion');

  console.log('\n== Edit-permission rules (employee 2h own rows / admin always) ==');
  const now = Date.now();
  const h = 3600 * 1000;
  const at = (msAgo) => L.nowStr(new Date(now - msAgo));
  ok(L.canModify(at(1 * h), 'sara', 'employee', 'sara', now), 'employee edits own row within 2h');
  ok(!L.canModify(at(3 * h), 'sara', 'employee', 'sara', now), 'employee blocked on own row after 2h');
  ok(!L.canModify(at(0.5 * h), 'omar', 'employee', 'sara', now), "employee blocked on someone else's row even if fresh");
  ok(L.canModify(at(100 * h), 'omar', 'admin', 'Kamal', now), 'admin can modify anything at any time');
  ok(!L.canModify('', 'sara', 'employee', 'sara', now), 'missing timestamp blocks employee');
  ok(L.canEdit('2020-01-01 10:00:00', 'admin'), '24h helper: admin always allowed');
  ok(!L.canEdit('2020-01-01 10:00:00', 'employee'), '24h helper: old row blocked (member hard-delete window)');

  console.log('\n== Fixed product categories ==');
  eq(L.PRODUCT_CATS, ['مياه', 'مشروبات غازية', 'Protein Bar', 'مشروبات طاقة', 'فيتامينات', 'مكملات غذائية', 'منتجات أخرى'],
    'category list is the exact fixed set (Arabic + Protein Bar)');

  console.log('\n== Unified date display: DD/MM/YYYY everywhere, never MM/DD/YYYY ==');
  eq(L.arDate('2026-07-03'), '03/07/2026', 'plain ISO date -> DD/MM/YYYY');
  eq(L.arDate('2026-08-15 14:30:00'), '15/08/2026', 'ISO datetime -> date part is DD/MM/YYYY');
  eq(L.arDate('2026-12-31'), '31/12/2026', 'end-of-year date formats correctly');
  ok(L.arDate('2026-07-03') !== '07/03/2026', 'never renders as MM/DD/YYYY (month-first)');
  eq(L.arDate(''), '', 'empty input returns empty string, not "NaN/NaN/NaN"');
  eq(L.arDate(null), '', 'null input returns empty string');
  eq(L.arDateTime('2026-07-03 09:05:00'), '03/07/2026 09:05', 'datetime -> "DD/MM/YYYY HH:MM"');
  eq(L.arDateTime(''), '', 'empty datetime input returns empty string');
  eq(L.dayName('2026-07-06'), 'الاثنين', 'day name is computed correctly (2026-07-06 is a Monday)');
  eq(L.fmtDayDate('2026-07-06'), 'الاثنين 06/07/2026', 'topbar-style "day-name DD/MM/YYYY" format');
  eq(L.fmtMonthYear('2026-07'), 'تموز 2026', 'month-only value (YYYY-MM) -> Arabic month name + year');
  eq(L.fmtMonthYear(''), '', 'empty month-year input returns empty string');
  // internal ISO storage/arithmetic must be completely unaffected by the display-layer change
  eq(L.today(new Date(2026, 6, 3)), '2026-07-03', 'Logic.today() stays ISO YYYY-MM-DD (unchanged, feeds <input type="date"> + SQL)');
  eq(L.addMonths('2026-07-03', 1), '2026-08-03', 'Logic.addMonths() arithmetic still ISO, unaffected by display formatting');

  console.log('\n== Duplicate-member detection (Logic.memberMatch) ==');
  const karim1 = { first_name: 'كريم', last_name: 'حيدر', phone: '03123456' };
  eq(L.memberMatch(karim1, { first_name: 'كريم', last_name: 'حيدر', phone: '03123456' }),
    { nameMatch: true, hardMatch: true }, 'identical name + identical phone = hard match');
  eq(L.memberMatch(karim1, { first_name: '  كريم ', last_name: 'حيدر  ', phone: '03123456' }),
    { nameMatch: true, hardMatch: true }, 'extra whitespace still matches (normalized)');
  eq(L.memberMatch({ first_name: 'كريم', last_name: 'حيدر', phone: '' }, { first_name: 'كريم', last_name: 'حيدر', phone: '' }),
    { nameMatch: true, hardMatch: true }, 'same name + both phones empty = hard match');
  eq(L.memberMatch(karim1, { first_name: 'كريم', last_name: 'حيدر', phone: '70999888' }),
    { nameMatch: true, hardMatch: false }, 'same name + different phone = soft match only');
  eq(L.memberMatch(karim1, { first_name: 'كريم', last_name: 'حيدر', phone: '' }),
    { nameMatch: true, hardMatch: false }, 'same name + one has no phone = soft match only');
  eq(L.memberMatch(karim1, { first_name: 'كريم', last_name: 'فارس', phone: '03123456' }),
    { nameMatch: false, hardMatch: false }, 'different surname = no match at all, even with same phone');

  console.log('\n== Auth (default admin: Kamal / 123456) ==');
  const good = db.login('Kamal', '123456');
  ok(good.ok && good.user.role === 'admin', 'Kamal login with default password');
  ok(!db.login('Kamal', 'wrong').ok, 'wrong password rejected');
  ok(!db.login('admin', 'admin123').ok, 'old default account no longer exists');
  db.createUser('cashier', 'pass1234', 'employee');
  ok(db.login('cashier', 'pass1234').ok, 'created employee can log in');
  const uid = db.all("SELECT id FROM users WHERE username='cashier'")[0].id;
  db.setPassword(uid, 'newpass99');
  ok(!db.login('cashier', 'pass1234').ok, 'old password invalid after change');
  ok(db.login('cashier', 'newpass99').ok, 'new password works');

  console.log('\n== User management: profile, username, role, reset, disable/enable ==');
  const created = db.createUser('reception1', 'startpw1', 'employee', { fullName: 'ريما خليل', phone: '03111222', position: 'مسؤول استقبال' });
  let recRow = db.all("SELECT * FROM users WHERE username='reception1'")[0];
  eq(recRow.full_name, 'ريما خليل', 'createUser stores full name');
  eq(recRow.phone, '03111222', 'createUser stores phone');
  eq(recRow.position, 'مسؤول استقبال', 'createUser stores position');
  ok(db.login('reception1', 'startpw1').ok, 'new employee can log in');

  db.setPassword(recRow.id, 'resetpw2'); // admin reset — no old password required
  ok(!db.login('reception1', 'startpw1').ok, 'old password rejected after reset');
  ok(db.login('reception1', 'resetpw2').ok, 'employee logs in with reset password');

  let unameRes = db.setUsername(recRow.id, 'reception2');
  ok(unameRes.ok, 'username changed successfully');
  ok(db.login('reception2', 'resetpw2').ok, 'login works with new username');
  ok(!db.login('reception1', 'resetpw2').ok, 'old username no longer works');
  let dupRes = db.setUsername(recRow.id, 'Kamal');
  ok(!dupRes.ok, 'renaming to an existing username is rejected');

  db.setActive(recRow.id, 0);
  ok(!db.login('reception2', 'resetpw2').ok, 'disabled employee cannot log in');
  db.setActive(recRow.id, 1);
  ok(db.login('reception2', 'resetpw2').ok, 'enabled employee can log in again');

  let roleRes = db.setRole(recRow.id, 'admin');
  ok(roleRes.ok, 'employee promoted to admin');
  recRow = db.all('SELECT * FROM users WHERE id=:id', { ':id': recRow.id })[0];
  eq(recRow.role, 'admin', 'role persisted as admin');
  db.setRole(recRow.id, 'employee'); // revert — back to single-admin state

  console.log('\n== Last-admin protection (cannot lock the system out) ==');
  const kamal = db.all("SELECT * FROM users WHERE username='Kamal'")[0];
  ok(!db.setActive(kamal.id, 0).ok, 'cannot disable the last active admin');
  ok(!db.setRole(kamal.id, 'employee').ok, 'cannot demote the last active admin');
  ok(!db.deleteUser(kamal.id).ok, 'cannot delete the last active admin');
  db.setRole(recRow.id, 'admin'); // now two active admins exist
  ok(db.setActive(kamal.id, 0).ok, 'admin CAN be disabled once another active admin exists');
  db.setActive(kamal.id, 1); // restore
  db.setRole(recRow.id, 'employee'); // revert

  console.log('\n== Admin changes own password (current-password verification) ==');
  ok(!db.changeOwnPassword(kamal.id, 'totally-wrong', 'newvalidpw1').ok, 'rejects wrong current password');
  ok(!db.changeOwnPassword(kamal.id, '123456', 'ab').ok, 'rejects new password under 6 chars');
  ok(db.changeOwnPassword(kamal.id, '123456', 'newkamalpw').ok, 'succeeds with correct current password');
  ok(!db.login('Kamal', '123456').ok, 'old admin password no longer works');
  ok(db.login('Kamal', 'newkamalpw').ok, 'new admin password works');
  db.setPassword(kamal.id, '123456'); // restore default for the rest of the suite

  console.log('\n== Delete user: with history (archive) vs without (permanent) ==');
  const noHistoryUser = db.createUser('temp_nohist', 'temp12345', 'employee', { fullName: 'موظف تجريبي' });
  let delNoHist = db.deleteUser(noHistoryUser.lastId);
  eq(delNoHist.action, 'deleted', 'user with zero transactions is permanently deleted');
  eq(db.all("SELECT COUNT(*) c FROM users WHERE username='temp_nohist'")[0].c, 0, 'row is actually gone');

  const histUser = db.createUser('temp_hasexp', 'temp12345', 'employee', { fullName: 'موظف له سجل' });
  // dated in the past so it doesn't leak into the "today" cashbox aggregation test below
  db.run("INSERT INTO expenses(category, amount, currency, created_at, created_by) VALUES('مصاريف أخرى', 12, 'USD', :t, 'temp_hasexp')",
    { ':t': L.nowStr(new Date(Date.now() - 5 * 86400000)) });
  let delWithHist = db.deleteUser(histUser.lastId);
  eq(delWithHist.action, 'disabled', 'user with a linked expense is disabled, not deleted');
  const survivorRow = db.all('SELECT * FROM users WHERE id=:id', { ':id': histUser.lastId })[0];
  ok(survivorRow && survivorRow.active === 0, 'row still exists and is inactive after archive-delete');
  ok(!db.login('temp_hasexp', 'temp12345').ok, 'disabled-by-delete user cannot log in');
  eq(db.all("SELECT COUNT(*) c FROM expenses WHERE created_by='temp_hasexp'")[0].c, 1, 'the linked expense record is preserved');

  console.log('\n== Passwords never leak into Activity Logs ==');
  db.run('INSERT INTO activity_log(username, action, entity, details, created_at) VALUES(\'Kamal\',\'تغيير كلمة المرور\',\'users\',:d,:t)',
    { ':d': 'تغيير كلمة مرور الحساب الشخصي', ':t': L.nowStr() });
  const pwLogs = db.all("SELECT * FROM activity_log WHERE action LIKE '%كلمة%'");
  ok(pwLogs.every(r => !r.details.includes('newkamalpw') && !r.details.includes('resetpw2') && !r.details.includes('temp12345')),
    'no raw password value ever appears in activity_log.details');

  console.log('\n== Members + subscriptions flow ==');
  const m = db.run("INSERT INTO members(first_name, last_name, phone, created_at, created_by) VALUES('كريم','حيدر','03123456',:t,'Kamal')", { ':t': L.nowStr() });
  ok(m.lastId >= 1, 'member inserted with auto id');
  const start = L.today();
  const end = L.subEnd('month', 1, start);
  const s1 = db.run(`INSERT INTO subscriptions(member_id, type, duration_days, start_date, end_date, price, paid, currency, created_at, created_by)
    VALUES(:m,'month',:dd,:s,:e,30,20,'USD',:t,'Kamal')`, { ':m': m.lastId, ':dd': L.daysBetween(start, end), ':s': start, ':e': end, ':t': L.nowStr() });
  db.run("INSERT INTO payments(subscription_id, member_id, amount, currency, created_at, created_by) VALUES(:s,:m,20,'USD',:t,'Kamal')", { ':s': s1.lastId, ':m': m.lastId, ':t': L.nowStr() });
  let row = db.all('SELECT * FROM subscriptions WHERE id=:id', { ':id': s1.lastId })[0];
  eq(L.subStatus(row).key, 'active_owed', 'new sub is active with 10 owed');
  eq(row.end_date, L.addMonths(start, 1), 'end date is a calendar month later');
  db.run('UPDATE subscriptions SET paid = paid + 10 WHERE id=:id', { ':id': s1.lastId });
  row = db.all('SELECT * FROM subscriptions WHERE id=:id', { ':id': s1.lastId })[0];
  eq(L.subStatus(row).key, 'active', 'fully paid after second payment');

  console.log('\n== Pause / resume with history ==');
  const today = L.today();
  db.run("UPDATE subscriptions SET manual_status='paused', pause_date=:d WHERE id=:id", { ':d': L.addDays(today, -5), ':id': s1.lastId });
  db.run(`INSERT INTO pauses(subscription_id, member_id, start_date, end_date, days, note, created_at, created_by)
    VALUES(:s,:m,:d,'',0,'سفر',:t,'Kamal')`, { ':s': s1.lastId, ':m': m.lastId, ':d': L.addDays(today, -5), ':t': L.nowStr() });
  row = db.all('SELECT * FROM subscriptions WHERE id=:id', { ':id': s1.lastId })[0];
  eq(L.subStatus(row, L.addDays(row.end_date, 10)).key, 'paused', 'paused even long after end date');
  // resume with extension
  const pausedDays = L.daysBetween(row.pause_date, today);
  eq(pausedDays, 5, 'paused-days computed from pause_date');
  const extendedEnd = L.addDays(row.end_date, pausedDays);
  db.run("UPDATE subscriptions SET manual_status='', pause_date='', end_date=:e WHERE id=:id", { ':e': extendedEnd, ':id': s1.lastId });
  db.run("UPDATE pauses SET end_date=:e, days=:d WHERE id=(SELECT MAX(id) FROM pauses WHERE subscription_id=:s AND end_date='')",
    { ':e': today, ':d': pausedDays, ':s': s1.lastId });
  row = db.all('SELECT * FROM subscriptions WHERE id=:id', { ':id': s1.lastId })[0];
  eq(row.end_date, extendedEnd, 'end date extended by paused days on resume');
  const ph = db.all('SELECT * FROM pauses WHERE subscription_id=:s', { ':s': s1.lastId })[0];
  eq(ph.days, 5, 'pause history stores day count');
  ok(ph.end_date === today && ph.note === 'سفر', 'pause history stores return date + note');

  console.log('\n== Sales + inventory (product created by user, not seeded) ==');
  const p = db.run("INSERT INTO products(name, category, price, currency, stock, low_stock, active, created_at, created_by) VALUES('مياه صغيرة','مياه',0.5,'USD',24,6,1,:t,'cashier')", { ':t': L.nowStr() });
  db.run(`INSERT INTO sales(product_id, product_name, category, qty, unit_price, total, currency, member_id, created_at, created_by)
    VALUES(:p,'مياه صغيرة','مياه',3,0.5,1.5,'USD',:mid,:d,'cashier')`, { ':p': p.lastId, ':mid': m.lastId, ':d': L.nowStr() });
  db.run('UPDATE products SET stock = stock - 3 WHERE id=:id', { ':id': p.lastId });
  eq(db.all('SELECT stock FROM products WHERE id=:id', { ':id': p.lastId })[0].stock, 21, 'stock decremented on sale');
  eq(db.all('SELECT member_id FROM sales ORDER BY id DESC LIMIT 1')[0].member_id, m.lastId, 'sale stores member_id (not just a name)');
  // member search query used by the sales autocomplete
  const found = db.all(`SELECT id FROM members WHERE archived = 0 AND (first_name LIKE :q OR last_name LIKE :q
    OR (first_name || ' ' || last_name) LIKE :q OR phone LIKE :q OR id = :idq)`, { ':q': '%كري%', ':idq': -1 });
  ok(found.length === 1 && found[0].id === m.lastId, 'autocomplete matches member from first letters of name');
  const foundByPhone = db.all(`SELECT id FROM members WHERE archived = 0 AND (first_name LIKE :q OR last_name LIKE :q
    OR (first_name || ' ' || last_name) LIKE :q OR phone LIKE :q OR id = :idq)`, { ':q': '%03123%', ':idq': -1 });
  ok(foundByPhone.length === 1, 'autocomplete matches member by phone');

  console.log('\n== Member archive (cancel after 24h instead of hard delete) ==');
  db.run('UPDATE members SET archived = 1 WHERE id=:id', { ':id': m.lastId });
  eq(db.all('SELECT COUNT(*) c FROM members WHERE archived = 0')[0].c, 0, 'archived member excluded from active lists');
  eq(db.all('SELECT COUNT(*) c FROM members')[0].c, 1, 'archived member still exists (financial history preserved)');
  db.run('UPDATE members SET archived = 0 WHERE id=:id', { ':id': m.lastId });
  eq(db.all('SELECT COUNT(*) c FROM members WHERE archived = 0')[0].c, 1, 'member restored from archive');

  console.log('\n== Daily cash aggregation ==');
  db.run("INSERT INTO expenses(category, amount, currency, created_at, created_by) VALUES('كهرباء', 25, 'USD', :t, 'Kamal')", { ':t': L.nowStr() });
  const from = L.today() + ' 00:00:00';
  const pays = db.all('SELECT amount, currency FROM payments WHERE created_at >= :d', { ':d': from });
  const sales = db.all('SELECT total AS amount, currency FROM sales WHERE created_at >= :d', { ':d': from });
  const exps = db.all('SELECT amount, currency FROM expenses WHERE created_at >= :d', { ':d': from });
  const net = L.sumUSD(pays, 89000) + L.sumUSD(sales, 89000) - L.sumUSD(exps, 89000);
  eq(Math.round(net * 100) / 100, Math.round((20 + 1.5 - 25) * 100) / 100, 'net cash = payments + sales - expenses');

  console.log('\n== Cashbox is unified: admin + employee see the SAME total for today ==');
  db.run(`INSERT INTO sales(product_id, product_name, category, qty, unit_price, total, currency, created_at, created_by)
    VALUES(:p,'مياه صغيرة','مياه',1,5,5,'USD',:t,'Kamal')`, { ':p': p.lastId, ':t': L.nowStr() });
  db.run(`INSERT INTO sales(product_id, product_name, category, qty, unit_price, total, currency, created_at, created_by)
    VALUES(:p,'مياه صغيرة','مياه',1,2,2,'USD',:t,'cashier')`, { ':p': p.lastId, ':t': L.nowStr() });
  // this is the EXACT query cashbox.js runs — no created_by filter, so admin and employee
  // views are the same query and therefore always produce the same total.
  const cashboxSalesToday = db.all('SELECT total AS amount, currency, created_by FROM sales WHERE created_at >= :d', { ':d': L.today() + ' 00:00:00' });
  const kamalSale = cashboxSalesToday.find(r => r.amount === 5 && r.created_by === 'Kamal');
  const empSale = cashboxSalesToday.find(r => r.amount === 2 && r.created_by === 'cashier');
  ok(kamalSale && empSale, 'both the admin-entered and employee-entered sale are in the "today" result set');
  eq(L.sumUSD(cashboxSalesToday, 89000, 'amount'), 1.5 + 5 + 2, 'today\'s sales total includes every user\'s sales combined ($1.5 + $5 + $2 = $8.5)');

  console.log('\n== Backup / restore ==');
  const bdir = path.join(tmpDir, 'backups');
  const bfile = db.backupTo(bdir);
  ok(fs.existsSync(bfile), 'backup file created');
  db.run("INSERT INTO expenses(category, amount, currency, created_at, created_by) VALUES('مصاريف أخرى', 999, 'USD', :t, 'Kamal')", { ':t': L.nowStr() });
  const before = db.all('SELECT COUNT(*) c FROM expenses')[0].c;
  db.restoreFrom(bfile);
  eq(db.all('SELECT COUNT(*) c FROM expenses')[0].c, before - 1, 'restore rolled back the extra expense');
  let threw = false;
  try { db.restoreFrom(__filename); } catch (err) { threw = true; }
  ok(threw, 'restoring an invalid file is rejected');

  console.log('\n== Member ID stability (auto-increment, never changes) ==');
  const idBefore = m.lastId;
  db.run('UPDATE members SET first_name=:f WHERE id=:id', { ':f': 'كريم٢', ':id': idBefore });
  eq(db.all('SELECT id FROM members WHERE id=:id', { ':id': idBefore })[0].id, idBefore, 'editing a member never changes its id');
  const memberCountBeforeRenew = db.all('SELECT COUNT(*) c FROM members')[0].c;
  const renewSub = db.run(`INSERT INTO subscriptions(member_id, type, duration_days, start_date, end_date, price, paid, currency, created_at, created_by)
    VALUES(:m,'month',30,:s,:e,30,30,'USD',:t,'Kamal')`, { ':m': idBefore, ':s': L.today(), ':e': L.subEnd('month', 1, L.today()), ':t': L.nowStr() });
  eq(db.all('SELECT COUNT(*) c FROM members')[0].c, memberCountBeforeRenew, 'renewal never creates a new member row');
  eq(db.all('SELECT member_id FROM subscriptions WHERE id=:id', { ':id': renewSub.lastId })[0].member_id, idBefore, 'renewed subscription keeps the same member_id');

  console.log('\n== Centralized currency service (Logic.convert) ==');
  eq(L.convert(3, 'USD', 'LBP', 90000), 270000, '3 USD -> LBP at rate 90000 = 270000');
  eq(L.convert(270000, 'LBP', 'USD', 90000), 3, '270000 LBP -> USD at rate 90000 = 3');
  eq(L.convert(50, 'USD', 'USD', 90000), 50, 'same-currency conversion is a no-op');
  const roundTrip = L.convert(L.convert(42, 'USD', 'LBP', 89500), 'LBP', 'USD', 89500);
  ok(Math.abs(roundTrip - 42) < 0.001, 'USD -> LBP -> USD round-trips back to the original amount');

  console.log('\n== Independent subscription payment currency snapshots ==');
  const sub30 = L.subscriptionSnapshot(30, 'USD', 90000);
  const pay30usd = L.currencySnapshot(30, 'USD', 90000);
  const payFullLbp = L.currencySnapshot('2,700,000', 'LBP', 90000);
  const pay20usd = L.currencySnapshot(20, 'USD', 90000);
  const payPartialLbp = L.currencySnapshot('1,800,000', 'LBP', 90000);
  eq(sub30.usd - pay30usd.usd, 0, '30 USD subscription + 30 USD payment = fully paid');
  eq(sub30.usd - payFullLbp.usd, 0, '30 USD subscription + 2,700,000 LBP payment = fully paid');
  eq(sub30.usd - pay20usd.usd, 10, '30 USD subscription + 20 USD payment = 10 USD remaining');
  eq(sub30.usd - payPartialLbp.usd, 10, '30 USD subscription + 1,800,000 LBP payment = 10 USD remaining');
  eq(L.convert(30, 'USD', 'LBP', 90000), 2700000, 'switching payment currency converts 30 USD to 2,700,000 LBP');
  eq(L.historicalUSD({ amount: 2700000, currency: 'LBP', converted_amount_usd: 30, exchange_rate_at_payment: 90000 }, 'amount', 'converted_amount_usd', 'exchange_rate_at_payment', 120000), 30,
    'later exchange-rate changes do not modify a historical payment');
  const fullLbpStatus = L.subStatus({ price: 30, paid: 30, currency: 'USD', exchange_rate: 90000, price_usd: 30, price_lbp: 2700000, paid_usd: 30, end_date: L.addDays(L.today(), 10) });
  eq(fullLbpStatus.key, 'active', 'new member saved with full LBP payment has zero balance');

  console.log('\n== Remaining balance: current vs previous vs total (member profile) ==');
  const bm = db.run("INSERT INTO members(first_name, last_name, created_at, created_by) VALUES('سامر','فارس',:t,'Kamal')", { ':t': L.nowStr() });
  const oldSub = db.run(`INSERT INTO subscriptions(member_id, type, duration_days, start_date, end_date, price, paid, currency, created_at, created_by)
    VALUES(:m,'month',30,:s,:e,30,10,'USD',:t,'Kamal')`, { ':m': bm.lastId, ':s': L.addDays(L.today(), -60), ':e': L.addDays(L.today(), -30), ':t': L.nowStr() });
  const curSub = db.run(`INSERT INTO subscriptions(member_id, type, duration_days, start_date, end_date, price, paid, currency, created_at, created_by)
    VALUES(:m,'month',30,:s,:e,30,20,'USD',:t,'Kamal')`, { ':m': bm.lastId, ':s': L.today(), ':e': L.subEnd('month', 1, L.today()), ':t': L.nowStr() });
  const memberSubs = db.all('SELECT * FROM subscriptions WHERE member_id=:id ORDER BY id DESC', { ':id': bm.lastId });
  const todayB = L.today();
  const owedRowsB = memberSubs.filter(s => s.manual_status !== 'cancelled' && L.subStatus(s, todayB).owed > 0);
  const totalOwedB = owedRowsB.reduce((s, r) => s + L.toUSD(L.subStatus(r, todayB).owed, r.currency, 89000), 0);
  const currentOwedB = L.subStatus(memberSubs[0], todayB).owed;
  const previousOwedB = Math.max(0, totalOwedB - currentOwedB);
  eq(currentOwedB, 10, 'current subscription owed = 30 - 20 = 10');
  eq(previousOwedB, 20, 'previous subscription owed = 30 - 10 = 20, kept separate from current');
  eq(totalOwedB, 30, 'total outstanding = current (10) + previous (20) = 30');

  console.log('\n== Daily Cashbox exclusion: salaries and inventory purchases never touch `expenses` ==');
  const expCountBefore = db.all('SELECT COUNT(*) c FROM expenses')[0].c;
  const cashboxIncome = () => L.sumUSD(
    db.all('SELECT amount, currency FROM payments WHERE created_at >= :d', { ':d': L.today() + ' 00:00:00' })
      .concat(db.all('SELECT total AS amount, currency FROM sales WHERE created_at >= :d', { ':d': L.today() + ' 00:00:00' })),
    89000);
  const todayIncomeBefore = cashboxIncome();
  const emp = db.run("INSERT INTO employees(name, job, salary, currency) VALUES('نور','مدربة',400,'USD')");
  db.run('INSERT INTO salaries(employee_id, amount, currency, month, created_at, created_by) VALUES(:e,400,\'USD\',:m,:t,\'Kamal\')',
    { ':e': emp.lastId, ':m': L.thisMonth(), ':t': L.nowStr() });
  db.run(`INSERT INTO inventory_purchases(product_id, product_name, qty, unit_cost, total_cost, currency, created_at, created_by)
    VALUES(:p,'مياه صغيرة',24,0.3,7.2,'USD',:t,'Kamal')`, { ':p': p.lastId, ':t': L.nowStr() });
  eq(db.all('SELECT COUNT(*) c FROM expenses')[0].c, expCountBefore, 'paying a salary AND recording an inventory purchase inserted zero rows into `expenses`');
  eq(cashboxIncome(), todayIncomeBefore, "today's cashbox income total is unchanged after the salary payment + inventory purchase");

  console.log('\n== Report calculation helpers (Logic.computeSalesFinancials / computeExpenseBreakdown) ==');
  const fixtureProducts = [{ id: 1, purchase_price: 2, currency: 'USD' }, { id: 2, purchase_price: 5, currency: 'USD' }];
  const fixtureSales = [
    { product_id: 1, qty: 3, total: 15, currency: 'USD' },  // revenue 15, cost 6
    { product_id: 2, qty: 2, total: 20, currency: 'USD' }   // revenue 20, cost 10
  ];
  const salesF = L.computeSalesFinancials(fixtureSales, fixtureProducts, 89000);
  eq(salesF.count, 2, 'computeSalesFinancials: count = 2 sales');
  eq(salesF.revenue, 35, 'computeSalesFinancials: revenue = 15 + 20 = 35');
  eq(salesF.cogs, 16, 'computeSalesFinancials: COGS = (3*2) + (2*5) = 16');
  eq(salesF.grossProfit, 19, 'computeSalesFinancials: gross profit = 35 - 16 = 19');
  eq(salesF.productsSold, 5, 'computeSalesFinancials: 3 + 2 = 5 units sold');

  const snapSale = [{ product_id: 1, qty: 10, total: 20, currency: 'USD', total_revenue_usd: 20, total_cost_usd: 10, total_cost: 10, exchange_rate_at_sale: 90000 }];
  const snapF = L.computeSalesFinancials(snapSale, [{ id: 1, purchase_price: 99, currency: 'USD' }], 120000);
  eq(snapF.revenue, 20, 'snapshot sale revenue = 20 USD');
  eq(snapF.cogs, 10, 'all stock sold still reports 10 USD COGS');
  eq(snapF.grossProfit, 10, 'snapshot gross product profit = 10 USD');
  eq(snapF.cogs, 10, 'later product purchase-price edit does not change historical COGS');

  const expBreakdown = L.computeExpenseBreakdown(
    [{ created_at: '2026-01-05 10:00:00', amount: 50, currency: 'USD', category: 'كهرباء' }],
    [{ created_at: '2026-01-01 09:00:00', amount: 400, currency: 'USD' }],
    [{ created_at: '2026-01-02 11:00:00', total_cost: 30, currency: 'USD' }],
    89000
  );
  eq(expBreakdown.salariesUSD, 400, 'computeExpenseBreakdown: salaries total = 400');
  eq(expBreakdown.inventoryUSD, 30, 'computeExpenseBreakdown: inventory purchases total = 30');
  eq(expBreakdown.otherUSD, 50, 'computeExpenseBreakdown: other expenses total = 50');
  eq(expBreakdown.totalUSD, 480, 'computeExpenseBreakdown: grand total = 400 + 30 + 50 = 480');
  eq(expBreakdown.operatingUSD, 450, 'operating expenses exclude inventory purchases');
  eq(20 + 30 - 10 - expBreakdown.operatingUSD, -410, 'net profit subtracts COGS and operating expenses, not inventory purchases');
  eq(expBreakdown.rows.length, 3, 'computeExpenseBreakdown: merges all three sources into one row list');
  ok(expBreakdown.rows[0].created_at < expBreakdown.rows[1].created_at, 'computeExpenseBreakdown: rows are sorted by date');

  console.log('\n== Member notes: card system + one-time migration ==');
  const legacyNoteMember = db.run("INSERT INTO members(first_name, last_name, notes, created_at, created_by) VALUES('ليلى','خوري','ملاحظة قديمة',:t,'Kamal')", { ':t': L.nowStr() });
  eq(db.all('SELECT COUNT(*) c FROM member_notes WHERE member_id=:id', { ':id': legacyNoteMember.lastId })[0].c, 0,
    'a member inserted directly (bypassing the app form) has no member_notes rows yet — migration only runs at db.init()');
  db.run('INSERT INTO member_notes(member_id, text, created_at, created_by) VALUES(:m,:t,:d,:by)',
    { ':m': bm.lastId, ':t': 'ملاحظة أولى', ':d': L.nowStr(), ':by': 'Kamal' });
  db.run('INSERT INTO member_notes(member_id, text, created_at, created_by) VALUES(:m,:t,:d,:by)',
    { ':m': bm.lastId, ':t': 'ملاحظة ثانية', ':d': L.nowStr(), ':by': 'Kamal' });
  const memberNotes = db.all('SELECT * FROM member_notes WHERE member_id=:id ORDER BY id DESC', { ':id': bm.lastId });
  eq(memberNotes.length, 2, 'two notes were saved for the member');
  eq(memberNotes[0].text, 'ملاحظة ثانية', 'notes are ordered newest-first');

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // ---- Separate DB instance: verify the member_notes migration itself, and that it only runs once ----
  console.log('\n== member_notes one-time migration from the legacy members.notes column ==');
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ironcore-test-migrate-'));
  const dbFile2 = path.join(tmpDir2, 'test2.db');
  await db.init({ dbFile: dbFile2, sqlJsDir: path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist') });
  const legacyM = db.run("INSERT INTO members(first_name, last_name, notes, created_at, created_by) VALUES('هادي','سعد','ملاحظة من قبل الترقية',:t,'Kamal')", { ':t': L.nowStr() });
  // The migration flag was already set on the FIRST init() above (nothing to
  // migrate yet at that point) — reset it here to simulate a real upgrade
  // scenario: an existing pre-upgrade database that already has legacy
  // members.notes data and has never run this migration before.
  db.run("DELETE FROM settings WHERE key = 'member_notes_migrated'");
  db.close();
  // reopening triggers migrate() again — should migrate the legacy note exactly once
  await db.init({ dbFile: dbFile2, sqlJsDir: path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist') });
  eq(db.all('SELECT COUNT(*) c FROM member_notes WHERE member_id=:id', { ':id': legacyM.lastId })[0].c, 1,
    'legacy members.notes text was migrated into exactly one member_notes row');
  db.close();
  await db.init({ dbFile: dbFile2, sqlJsDir: path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist') }); // re-init a 3rd time
  eq(db.all('SELECT COUNT(*) c FROM member_notes WHERE member_id=:id', { ':id': legacyM.lastId })[0].c, 1,
    'migration does not duplicate the note on subsequent app restarts');
  db.close();
  fs.rmSync(tmpDir2, { recursive: true, force: true });

  console.log('\n== Hardware-lock activation (public-key, anti-copy, lifetime) ==');
  const license = require('../main/license.js');
  // 1) Machine ID format is stable and correctly shaped
  const mid = license.machineId();
  ok(/^IRON(-[0-9A-F]{4}){4}$/.test(mid), 'machineId() returns IRON-XXXX-XXXX-XXXX-XXXX format');
  eq(license.machineId(), mid, 'machineId() is stable across calls on the same machine');
  // 2) Garbage / empty codes are rejected
  ok(!license.verifyCode('', mid), 'empty activation code rejected');
  ok(!license.verifyCode('not-a-real-code', mid), 'garbage activation code rejected');
  // 3) The anti-copy security property, proven at the crypto layer with an
  //    ephemeral key pair (mirrors exactly how license.js signs+verifies):
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const midA = 'IRON-1111-2222-3333-4444';
  const midB = 'IRON-9999-8888-7777-6666';
  const codeA = crypto.sign(null, Buffer.from(midA, 'utf8'), crypto.createPrivateKey(privateKey)).toString('base64');
  const pub = crypto.createPublicKey(publicKey);
  const verify = (code, id) => { try { return crypto.verify(null, Buffer.from(id, 'utf8'), pub, Buffer.from(code, 'base64')); } catch (e) { return false; } };
  ok(verify(codeA, midA), 'a code signed for machine A activates machine A');
  ok(!verify(codeA, midB), 'a code for machine A is REJECTED on machine B (copying to another laptop fails)');
  ok(!verify('AAAA' + codeA.slice(4), midA), 'a tampered activation code is rejected');

  console.log('\n== Activation keygen round-trip (real private key ↔ real public key) ==');
  // Uses the actual shipped key pair if setup has been run with the known dev
  // passphrase; skips gracefully if the developer has since set their own.
  const privPath = path.join(__dirname, '..', 'tools', 'license-private-key.pem');
  if (fs.existsSync(privPath)) {
    try {
      const realPriv = crypto.createPrivateKey({ key: fs.readFileSync(privPath, 'utf8'), format: 'pem', passphrase: 'CHANGE-ME-IRON-CORE' });
      const realCode = crypto.sign(null, Buffer.from(mid, 'utf8'), realPriv).toString('base64');
      ok(license.verifyCode(realCode, mid), 'a code from the real keygen activates THIS machine');
      ok(!license.verifyCode(realCode, 'IRON-0000-0000-0000-0000'), 'that same real code is rejected on any other machine');
    } catch (e) {
      console.log('  SKIP  (dev has set a custom passphrase — keygen round-trip not tested here)');
    }
  } else {
    console.log('  SKIP  (no private key present — run tools/license-setup.js first)');
  }

  console.log('\n== Remote kill-switch (fail-open, signed suspensions) ==');
  const killswitch = require('../main/killswitch.js');
  // Fail-open: with the default empty statusUrl, the system is never suspended.
  const ksState = await killswitch.refresh(mid);
  eq(ksState, 'ok', 'empty statusUrl => fail-open, state is "ok" (system keeps working)');
  eq(killswitch.current(), 'ok', 'current() reflects the ok state');
  // Garbage / empty suspension signatures are rejected.
  ok(!killswitch.verifySuspension('', mid), 'empty suspension signature rejected');
  ok(!killswitch.verifySuspension('garbage', mid), 'garbage suspension signature rejected');
  // The suspension-signature scheme proven with an ephemeral key pair: a signature
  // over "<machineId>|suspended" verifies ONLY for that machine.
  const suspSigA = crypto.sign(null, Buffer.from(midA + '|suspended', 'utf8'), crypto.createPrivateKey(privateKey)).toString('base64');
  const verifySusp = (sig, id) => { try { return crypto.verify(null, Buffer.from(id + '|suspended', 'utf8'), pub, Buffer.from(sig, 'base64')); } catch (e) { return false; } };
  ok(verifySusp(suspSigA, midA), 'a suspension signed for machine A suspends machine A');
  ok(!verifySusp(suspSigA, midB), 'a suspension for machine A does NOT affect machine B');
  ok(!verifySusp('AA' + suspSigA.slice(2), midA), 'a tampered suspension signature is rejected');

  // Fetch + fail-open behaviour against a local server (proves offline/error = keeps working).
  const http = require('http');
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/notlisted')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ 'IRON-OTHER-0000-0000-0000': 'x' })); }
    else if (req.url.startsWith('/error')) { res.writeHead(500); res.end('nope'); }
    else { res.writeHead(200); res.end('{}'); }
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  eq(await killswitch.refresh(mid, `http://127.0.0.1:${port}/notlisted`), 'ok', 'machine not listed in status file => "ok" (keeps working)');
  eq(await killswitch.refresh(mid, `http://127.0.0.1:${port}/error`), 'ok', 'server error (500) => fail-open "ok"');
  eq(await killswitch.refresh(mid, 'http://127.0.0.1:1/blocked'), 'ok', 'unreachable/blocked url => fail-open "ok" (offline keeps working)');
  await new Promise(r => server.close(r));

  // Full pipeline: a fetched file that lists THIS machine with a VALID signature => suspended.
  const suspSigThis = crypto.sign(null, Buffer.from(mid + '|suspended', 'utf8'), crypto.createPrivateKey(privateKey)).toString('base64');
  const server2 = http.createServer((req, res) => {
    if (req.url.startsWith('/suspend')) { res.writeHead(200); res.end(JSON.stringify({ [mid]: suspSigThis })); }
    else { res.writeHead(200); res.end(JSON.stringify({ [mid]: 'AA' + suspSigThis.slice(2) })); } // tampered
  });
  await new Promise(r => server2.listen(0, r));
  const port2 = server2.address().port;
  eq(await killswitch.refresh(mid, `http://127.0.0.1:${port2}/suspend`, pub), 'suspended', 'valid signed suspension for THIS machine => "suspended" (locks)');
  eq(await killswitch.refresh(mid, `http://127.0.0.1:${port2}/tampered`, pub), 'ok', 'tampered signature in file => stays "ok" (fail-open, not lockable by forgery)');
  await new Promise(r => server2.close(r));

  console.log('\n========================================');
  console.log('  ' + passed + ' passed, ' + failed + ' failed');
  console.log('========================================\n');
  // Let the event loop drain (fetch sockets close) so we exit cleanly without a
  // libuv teardown assertion; force-exit only as a fallback if something lingers.
  process.exitCode = failed ? 1 : 0;
  const t = setTimeout(() => process.exit(process.exitCode), 3000);
  t.unref();
})().catch(e => { console.error(e); process.exit(1); });
