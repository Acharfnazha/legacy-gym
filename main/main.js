/*
 * Legacy Gym - Electron main process
 * Owns: window lifecycle, database IPC, backups, CSV/PDF export, clock-tamper check.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const license = require('./license');
const killswitch = require('./killswitch');
const guard = require('./guard');

/* Force Chromium's application locale so native <input type="date">/type="month">
   (and plain number inputs) render day/month/year order with WESTERN (English)
   digits, regardless of the host Windows machine's own regional settings.
   'ar' was tried first but Chromium/ICU renders Arabic-Indic numerals (٠١٢٣...)
   for the generic Arabic locale in native form controls — undesired. 'en-GB' is
   the standard fix: English digits, but day-first order (unlike en-US which is
   month-first). Must be set before app.whenReady(). All of the app's own text
   (topbar, tables, CSV, PDF) is built manually via Logic.arDate and always uses
   Western digits regardless of this switch — this only affects native widgets. */
app.commandLine.appendSwitch('lang', 'en-GB');

let win = null;
let clockWarning = null; // set at startup if system clock moved backwards

/* Activation is bypassed for the developer's own dev build (`npm start`, not
   packaged) and for automated smoke tests — so development/testing is never
   blocked. The packaged app delivered to a client always enforces activation. */
function licenseBypass() {
  return !app.isPackaged || !!process.env.IRONCORE_SMOKE;
}

/* Cached activation gate for the data IPC (defense-in-depth: blocks all data
   reads/writes on an un-activated machine even if the UI gate were bypassed).
   Activation only ever goes false→true within a run, so once true we cache it. */
let _licensed = false;
function isLicensed(dataDir) {
  if (licenseBypass()) return true;
  if (killswitch.current() === 'suspended') return false; // suspended for non-payment
  if (_licensed) return true;
  _licensed = license.isActivated(dataDir, { devBypass: false });
  return _licensed;
}
const sessions = new Map(); // webContents.id -> authenticated user { id, role }
const loginLimiter = new guard.LoginLimiter();

/* Session helpers — every privileged IPC handler re-checks these in the MAIN
   process; the renderer's own role checks are UX only and can be bypassed. */
function sessionOf(e) { return sessions.get(e.sender.id); }
function isAdminSession(e) { const s = sessionOf(e); return !!(s && s.role === 'admin'); }
const DENIED = { ok: false, error: 'لا تملك صلاحية تنفيذ هذه العملية' };

/* Data lives next to the app when portable (USB), in the project folder during dev. */
function resolveDataDir() {
  if (!app.isPackaged) return path.join(__dirname, '..', 'data');
  const exeDir = path.dirname(app.getPath('exe'));
  const candidate = path.join(exeDir, 'data');
  try {
    fs.mkdirSync(candidate, { recursive: true });
    fs.accessSync(candidate, fs.constants.W_OK);
    return candidate;
  } catch (e) {
    return path.join(app.getPath('userData'), 'data');
  }
}

function loadConfig(dataDir) {
  // user-editable config file (README documents it)
  const cfgPath = path.join(dataDir, 'config.json');
  let cfg = { autoBackup: true };
  try {
    if (fs.existsSync(cfgPath)) cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
    else fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  } catch (e) { /* keep defaults */ }
  return cfg;
}

function checkClock() {
  const last = db.getSetting('last_seen_ts', '');
  const now = Date.now();
  if (last && Number(last) > now + 5 * 60 * 1000) {
    const diffH = Math.round((Number(last) - now) / 3600000);
    clockWarning = `تم تغيير تاريخ أو وقت الجهاز إلى الوراء (فرق تقريبي ${diffH} ساعة). قد يؤثر ذلك على الاشتراكات والتقارير.`;
    db.run('INSERT INTO activity_log(username, action, entity, details, created_at) VALUES(\'system\',\'تحذير: تغيير وقت الجهاز\',\'system\',:d,:t)',
      { ':d': clockWarning, ':t': db.nowStr() });
  }
  db.setSetting('last_seen_ts', String(now));
  // keep advancing the marker while the app runs
  setInterval(() => db.setSetting('last_seen_ts', String(Date.now())), 60 * 1000);
}

function autoBackup(dataDir, cfg) {
  if (!cfg.autoBackup) return;
  try {
    const dir = db.getSetting('backup_dir', '') || path.join(dataDir, 'backups');
    const last = db.getSetting('last_backup', '');
    const today = db.todayStr();
    if (!last || last.slice(0, 10) !== today) {
      db.backupTo(dir);
      // prune: keep newest 30
      const files = fs.readdirSync(dir).filter(f => f.startsWith('ironcore-backup-')).sort();
      while (files.length > 30) fs.unlinkSync(path.join(dir, files.shift()));
    }
  } catch (e) { console.error('auto-backup failed', e); }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1150,
    minHeight: 720,
    show: false,
    backgroundColor: '#0c0d10',
    autoHideMenuBar: true,
    title: 'Legacy Gym',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // DevTools would let anyone at the keyboard (e.g. an employee) call the
      // IPC bridge directly — disabled in the packaged build delivered to clients.
      devTools: !app.isPackaged,
      spellcheck: false
    }
  });
  const wcId = win.webContents.id;
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (process.env.IRONCORE_SMOKE) runSmoke();
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The app is a single local page: never navigate the window anywhere else
  // (a remote page would inherit the privileged preload bridge).
  const appUrl = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
  win.webContents.on('will-navigate', (ev, url) => {
    if (url.split('#')[0] !== appUrl) ev.preventDefault();
  });
  win.webContents.on('will-attach-webview', (ev) => ev.preventDefault());
  // Any (re)load of the page starts logged out: drop the main-process session too.
  win.webContents.on('did-start-navigation', (details) => {
    // Electron passes an Event carrying { isMainFrame, isSameDocument }
    if (details && details.isMainFrame !== false && !details.isSameDocument) sessions.delete(wcId);
  });
  win.webContents.on('render-process-gone', () => sessions.delete(wcId));
  win.on('closed', () => { sessions.delete(wcId); win = null; });
}

/* E2E smoke: IRONCORE_SMOKE=1
   Phase 1: logs in, visits every allowed page, verifies admin-only pages are
            blocked for employees, then clicks the REAL logout button + confirm.
   Phase 2: after the reload triggered by logout, verifies the session is dead:
            login screen visible, app hidden, no user in memory. */
function runSmoke() {
  const smokeRole = process.env.IRONCORE_SMOKE_ROLE || 'admin';
  let smokeUser = process.env.IRONCORE_SMOKE_USER || 'Kamal';
  let smokePass = process.env.IRONCORE_SMOKE_PASS || '123456';
  if (smokeRole === 'employee' && !process.env.IRONCORE_SMOKE_USER) {
    smokeUser = 'smokeemp'; smokePass = 'smoke123';
    try { db.createUser(smokeUser, smokePass, 'employee'); } catch (e) { /* already exists */ }
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let phase = 1;
  let failed = false;

  win.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') console.log('[renderer-console-error]', e.message);
  });

  const timeout = setTimeout(() => { console.log('[smoke] TIMEOUT waiting for logout reload'); app.exit(1); }, 60000);

  win.webContents.on('did-finish-load', async () => {
    try {
      if (phase === 1) {
        phase = 2;
        await sleep(2000); // splash
        const report = await win.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const out = [];
          window.addEventListener('error', (e) => out.push('window.onerror: ' + e.message));
          const roleTab = document.querySelector('.role-tab[data-role="${smokeRole}"]');
          if (roleTab) roleTab.click();
          document.getElementById('login-user').value = '${smokeUser}';
          document.getElementById('login-pass').value = '${smokePass}';
          document.getElementById('login-form').requestSubmit();
          await sleep(1200);
          if (document.getElementById('app').classList.contains('hidden')) { out.push('LOGIN FAILED'); return out; }
          const pages = '${smokeRole}' === 'admin'
            ? ['dashboard','members','subscriptions','sales','products','inventory','cashbox','expenses','employees','salaries','reports','backup','activity','settings','usermanagement']
            : ['dashboard','members','subscriptions','sales','products'];
          for (const p of pages) {
            try {
              await navigate(p);
              await sleep(450);
              const pageEl = document.getElementById('page');
              if (pageEl.querySelector('.alert.danger') && pageEl.textContent.includes('حدث خطأ')) {
                out.push('PAGE ERROR on ' + p + ': ' + pageEl.querySelector('.alert.danger').textContent);
              } else if (!pageEl.children.length) {
                out.push('PAGE EMPTY: ' + p);
              } else {
                out.push('OK ' + p);
              }
            } catch (e) { out.push('NAV THROW on ' + p + ': ' + e.message); }
          }
          if ('${smokeRole}' === 'employee') {
            await navigate('dashboard');
            await sleep(250);
            const dashboardText = document.getElementById('page').textContent;
            const financialLabels = ['مبيعات اليوم', 'دفعات اشتراكات اليوم', 'إجمالي الوارد اليوم', 'الدخل اليومي'];
            out.push(financialLabels.some(label => dashboardText.includes(label))
              ? 'SECURITY FAIL: employee dashboard shows cashbox summary'
              : 'OK employee dashboard hides cashbox summaries');
            out.push(document.querySelector('.nav-item[data-page="cashbox"]')
              ? 'SECURITY FAIL: cashbox visible in employee sidebar'
              : 'OK cashbox hidden from employee sidebar');
            const cashboxApi = await api.cashbox(Logic.today());
            out.push(cashboxApi && cashboxApi.ok
              ? 'SECURITY FAIL: employee accessed cashbox API'
              : 'OK cashbox API blocked for employee');
            // admin-only pages must be blocked (monthly/yearly reports, expenses, salaries…)
            for (const blocked of ['cashbox','reports','expenses','salaries','employees','settings','backup','activity','usermanagement','inventory']) {
              const before = document.getElementById('page-title').textContent;
              await navigate(blocked);
              await sleep(250);
              const after = document.getElementById('page-title').textContent;
              const activePage = document.querySelector('.nav-item.active')?.dataset.page;
              const blockedOk = blocked === 'cashbox' ? activePage === 'dashboard' : after === before;
              out.push(blockedOk ? 'OK ' + blocked + ' blocked for employee' : 'SECURITY FAIL: employee reached ' + blocked);
            }
            // direct attacks on the IPC bridge (as if typed into DevTools)
            const me = UI.session.user;
            const tryCall = async (fn) => { try { return await fn(); } catch (err) { return { thrown: err.message }; } };
            const esc1 = await tryCall(() => api.run("UPDATE users SET role='admin' WHERE id=" + me.id));
            out.push(esc1 && esc1.thrown ? 'OK raw SQL privilege escalation blocked' : 'SECURITY FAIL: raw SQL wrote users table');
            const esc2 = await tryCall(() => api.setRole(me.id, 'admin'));
            out.push(esc2 && esc2.ok === false ? 'OK setRole blocked for employee' : 'SECURITY FAIL: employee changed a role');
            const esc3 = await tryCall(() => api.createUser('evil', 'evil123', 'admin'));
            out.push(esc3 && esc3.ok === false ? 'OK createUser blocked for employee' : 'SECURITY FAIL: employee created a user');
            const esc4 = await tryCall(() => api.all('SELECT password_hash, salt FROM users'));
            out.push(esc4 && esc4.thrown ? 'OK password hashes unreadable' : 'SECURITY FAIL: password hashes readable');
            const esc5 = await tryCall(() => api.backupRestore('C:/evil.db'));
            out.push(esc5 && esc5.ok === false ? 'OK backup restore blocked for employee' : 'SECURITY FAIL: employee restored a backup');
            out.push(typeof api.openPath === 'undefined' ? 'OK openPath removed from bridge' : 'SECURITY FAIL: openPath still exposed');
          }
          if ('${smokeRole}' === 'admin') {
            // admin user-management round trip through the guarded IPC handlers
            const c = await api.createUser('smoketmp', 'smoke1234', 'employee', { fullName: 'Smoke Tmp' });
            const dup = await api.createUser('smoketmp', 'smoke1234', 'employee');
            const p1 = await api.setPassword(c.lastId, 'smoke5678');
            const r1 = await api.setRole(c.lastId, 'admin');
            const r2 = await api.setRole(c.lastId, 'root');
            const list = await api.all('SELECT id, username, role FROM users');
            const d = await api.deleteUser(c.lastId);
            out.push(c.ok && c.lastId && dup.ok === false && p1.ok && r1.ok && r2.ok === false &&
              list.some(u => u.username === 'smoketmp' && u.role === 'admin') && d.ok
              ? 'OK admin user management works' : 'FAIL admin user management: ' + JSON.stringify({ c, dup, p1, r1, r2, d }));
          }
          // === real logout: click the button, then the confirm dialog ===
          document.getElementById('logout-btn').click();
          await sleep(400);
          const ok = document.querySelector('#modal-root .modal-foot .btn-primary');
          if (!ok) { out.push('LOGOUT FAIL: confirm dialog not found'); return out; }
          out.push('OK logout clicked, confirming…');
          setTimeout(() => ok.click(), 50); // reload follows; return report first
          return out;
        })()`);
        report.forEach(line => console.log('[smoke]', line));
        if (report.some(l => !l.startsWith('OK'))) failed = true;
      } else {
        // Phase 2 — page reloaded by logout
        await sleep(2200); // splash again
        const check = await win.webContents.executeJavaScript(`({
          loginVisible: !document.getElementById('login').classList.contains('hidden') || !document.getElementById('loading').classList.contains('hidden'),
          appHidden: document.getElementById('app').classList.contains('hidden'),
          noUser: !(window.UI && UI.session && UI.session.user),
          pageEmpty: document.getElementById('page').children.length === 0
        })`);
        const okAll = check.loginVisible && check.appHidden && check.noUser && check.pageEmpty;
        console.log('[smoke]', okAll
          ? 'LOGOUT OK — session cleared, login screen shown, app inaccessible'
          : 'LOGOUT FAIL — ' + JSON.stringify(check));
        if (!okAll) failed = true;
        console.log('[smoke]', failed ? 'PROBLEMS FOUND' : 'ALL CHECKS OK');
        clearTimeout(timeout);
        app.exit(failed ? 1 : 0);
      }
    } catch (e) {
      console.log('[smoke] driver failed:', e.message);
      clearTimeout(timeout);
      app.exit(1);
    }
  });
}

app.whenReady().then(async () => {
  const dataDir = resolveDataDir();
  const cfg = loadConfig(dataDir);
  await db.init({ dbFile: path.join(dataDir, 'ironcore.db') });
  checkClock();
  autoBackup(dataDir, cfg);
  registerIpc(dataDir);
  createWindow();
  // Remote kill-switch: check now + every 6 hours. If a running client becomes
  // suspended, reload so it lands on the suspended screen. Fail-open throughout.
  if (!licenseBypass()) {
    const mid = license.machineId();
    setInterval(async () => {
      const prev = killswitch.current();
      await killswitch.refresh(mid);
      if (prev !== 'suspended' && killswitch.current() === 'suspended' && win && !win.isDestroyed()) win.webContents.reload();
    }, 6 * 3600 * 1000);
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { db.close(); app.quit(); });
app.on('before-quit', () => db.persistNow());

function registerIpc(dataDir) {
  /* Generic SQL bridge — only for a logged-in session, one plain statement,
     never touching password material or the schema (see guard.checkSql). */
  ipcMain.handle('db:all', (e, sql, params) => {
    if (!isLicensed(dataDir)) return [];
    const chk = guard.checkSql(sql, 'read', sessionOf(e));
    if (!chk.ok) throw new Error('SQL rejected: ' + chk.error);
    return db.all(sql, params);
  });
  ipcMain.handle('db:run', (e, sql, params) => {
    if (!isLicensed(dataDir)) return { changes: 0, lastId: null };
    const chk = guard.checkSql(sql, 'write', sessionOf(e));
    if (!chk.ok) throw new Error('SQL rejected: ' + chk.error);
    return db.run(sql, params);
  });
  ipcMain.handle('auth:login', (e, u, p) => {
    if (!isLicensed(dataDir)) return { ok: false, error: 'النظام غير مُفعّل على هذا الجهاز' };
    sessions.delete(e.sender.id);
    if (typeof u !== 'string' || typeof p !== 'string') return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    const wait = loginLimiter.retryAfter(u);
    if (wait > 0) {
      return { ok: false, error: 'محاولات دخول خاطئة كثيرة — حاول مجددًا بعد ' + Math.ceil(wait / 1000) + ' ثانية' };
    }
    const result = db.login(u, p);
    if (!result.ok) {
      loginLimiter.fail(u);
      db.run('INSERT INTO activity_log(username, action, entity, details, created_at) VALUES(:u,\'محاولة دخول فاشلة\',\'auth\',\'\',:t)',
        { ':u': String(u).trim().slice(0, 64), ':t': db.nowStr() });
      // same message for "unknown user" and "wrong password" (no username enumeration)
      return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب موقوف' };
    }
    loginLimiter.success(u);
    sessions.set(e.sender.id, { id: result.user.id, role: result.user.role });
    // flag the well-known factory password so the UI can insist on changing it
    result.weakPassword = p === '123456';
    return result;
  });
  ipcMain.handle('auth:logout', (e) => {
    sessions.delete(e.sender.id);
    return { ok: true };
  });
  ipcMain.handle('cashbox:get', (e, day) => {
    const session = sessions.get(e.sender.id);
    if (!session || session.role !== 'admin') return { ok: false, error: 'Access denied' };
    const selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : db.todayStr();
    const nextDay = new Date(selectedDay + 'T00:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const toDay = [nextDay.getFullYear(), String(nextDay.getMonth() + 1).padStart(2, '0'), String(nextDay.getDate()).padStart(2, '0')].join('-');
    const params = { ':a': selectedDay + ' 00:00:00', ':b': toDay + ' 00:00:00' };
    return {
      ok: true,
      newSubs: db.all(`SELECT s.*, m.first_name, m.last_name FROM subscriptions s
        JOIN members m ON m.id = s.member_id WHERE s.created_at >= :a AND s.created_at < :b ORDER BY s.id`, params),
      pays: db.all(`SELECT p.*, m.first_name, m.last_name FROM payments p
        JOIN members m ON m.id = p.member_id WHERE p.created_at >= :a AND p.created_at < :b ORDER BY p.id`, params),
      sales: db.all('SELECT * FROM sales WHERE created_at >= :a AND created_at < :b ORDER BY id', params)
    };
  });
  /* ---- User management: ADMIN session required, inputs validated here ---- */
  const BAD_PASS = { ok: false, error: 'كلمة المرور يجب ألا تقل عن ' + guard.MIN_PASSWORD + ' أحرف' };
  ipcMain.handle('auth:createUser', (e, u, p, role, extra) => {
    if (!isAdminSession(e)) return DENIED;
    if (!guard.validUsername(u)) return { ok: false, error: 'اسم المستخدم مطلوب' };
    if (!guard.validPassword(p)) return BAD_PASS;
    if (!guard.validRole(role)) return { ok: false, error: 'صلاحية غير صالحة' };
    if (db.all('SELECT id FROM users WHERE username = :u', { ':u': u.trim() }).length) {
      return { ok: false, error: 'اسم المستخدم مستخدم مسبقًا' };
    }
    const r = db.createUser(u.trim(), p, role, extra);
    return Object.assign({ ok: true }, r);
  });
  ipcMain.handle('auth:setPassword', (e, id, p) => {
    if (!isAdminSession(e)) return DENIED;
    if (!guard.validId(id)) return { ok: false, error: 'المستخدم غير موجود' };
    if (!guard.validPassword(p)) return BAD_PASS;
    return Object.assign({ ok: true }, db.setPassword(Number(id), p));
  });
  // any logged-in user, but ONLY for their own account (+ current password)
  ipcMain.handle('auth:changeOwnPassword', (e, id, current, next) => {
    const s = sessionOf(e);
    if (!s || Number(id) !== s.id) return DENIED;
    if (typeof current !== 'string' || !guard.validPassword(next)) return BAD_PASS;
    return db.changeOwnPassword(s.id, current, next);
  });
  ipcMain.handle('auth:setUsername', (e, id, username) => {
    if (!isAdminSession(e)) return DENIED;
    if (!guard.validId(id)) return { ok: false, error: 'المستخدم غير موجود' };
    if (!guard.validUsername(username)) return { ok: false, error: 'اسم المستخدم مطلوب' };
    return db.setUsername(Number(id), username);
  });
  ipcMain.handle('auth:updateProfile', (e, id, profile) => {
    if (!isAdminSession(e)) return DENIED;
    if (!guard.validId(id)) return { ok: false, error: 'المستخدم غير موجود' };
    const p = profile && typeof profile === 'object' ? profile : {};
    const clip = (v) => String(v == null ? '' : v).slice(0, guard.MAX_FIELD);
    return db.updateUserProfile(Number(id), { fullName: clip(p.fullName), phone: clip(p.phone), position: clip(p.position) });
  });
  ipcMain.handle('auth:setRole', (e, id, role) => {
    if (!isAdminSession(e)) return DENIED;
    if (!guard.validId(id)) return { ok: false, error: 'المستخدم غير موجود' };
    if (!guard.validRole(role)) return { ok: false, error: 'صلاحية غير صالحة' };
    return db.setRole(Number(id), role);
  });
  ipcMain.handle('auth:setActive', (e, id, active) => {
    if (!isAdminSession(e)) return DENIED;
    if (!guard.validId(id)) return { ok: false, error: 'المستخدم غير موجود' };
    return db.setActive(Number(id), !!active);
  });
  ipcMain.handle('auth:deleteUser', (e, id) => {
    if (!isAdminSession(e)) return DENIED;
    if (!guard.validId(id)) return { ok: false, error: 'المستخدم غير موجود' };
    return db.deleteUser(Number(id));
  });
  ipcMain.handle('app:clockWarning', (e) => (isAdminSession(e) ? clockWarning : null));
  ipcMain.handle('app:version', () => app.getVersion());

  // ---- Activation (hardware-locked, lifetime, offline) ----
  ipcMain.handle('license:status', () => ({
    activated: license.isActivated(dataDir, { devBypass: licenseBypass() }),
    machineId: license.machineId()
  }));
  ipcMain.handle('license:activate', (e, code) =>
    license.activate(dataDir, code, { devBypass: licenseBypass() }));
  // Remote kill-switch status (fail-open): awaits a fresh check so boot gets a
  // current answer. Returns { suspended } and the machine id (shown to the user
  // so they can tell the developer which machine to re-activate).
  ipcMain.handle('license:remoteStatus', async () => {
    if (licenseBypass()) return { suspended: false, machineId: license.machineId() };
    await killswitch.refresh(license.machineId());
    return { suspended: killswitch.current() === 'suspended', machineId: license.machineId() };
  });

  ipcMain.handle('backup:now', async (e) => {
    if (!isAdminSession(e)) return DENIED;
    const dir = db.getSetting('backup_dir', '') || path.join(dataDir, 'backups');
    const dest = db.backupTo(dir);
    return { ok: true, path: dest };
  });
  ipcMain.handle('backup:chooseDir', async (e) => {
    if (!isAdminSession(e)) return null;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    db.setSetting('backup_dir', r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle('backup:list', (e) => {
    if (!isAdminSession(e)) return [];
    const dir = db.getSetting('backup_dir', '') || path.join(dataDir, 'backups');
    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.db'))
        .map(f => {
          const st = fs.statSync(path.join(dir, f));
          return { name: f, path: path.join(dir, f), size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch (e) { return []; }
  });
  ipcMain.handle('backup:restore', async (e, file) => {
    if (!isAdminSession(e)) return DENIED;
    let target = null;
    if (file) {
      // only a file that is actually listed in the backup folder may be passed in;
      // anything else must be picked by the admin through the native dialog
      const dir = path.resolve(db.getSetting('backup_dir', '') || path.join(dataDir, 'backups'));
      const resolved = path.resolve(String(file));
      if (path.dirname(resolved) !== dir || !/\.db$/i.test(resolved)) return { ok: false, error: 'مسار النسخة غير صالح' };
      target = resolved;
    } else {
      const r = await dialog.showOpenDialog(win, {
        title: 'اختيار نسخة احتياطية',
        filters: [{ name: 'Database', extensions: ['db'] }],
        properties: ['openFile']
      });
      if (r.canceled || !r.filePaths.length) return { ok: false, cancelled: true };
      target = r.filePaths[0];
    }
    try {
      // safety copy of current db before restore
      const safety = path.join(dataDir, 'backups');
      db.backupTo(safety);
      db.restoreFrom(target);
      sessions.clear(); // restored data may have different accounts: force a fresh login
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'الملف غير صالح أو تالف: ' + err.message };
    }
  });
  ipcMain.handle('backup:openDir', (e) => {
    if (!isAdminSession(e)) return null;
    const dir = db.getSetting('backup_dir', '') || path.join(dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('export:csv', async (e, suggestedName, csvContent) => {
    if (!sessionOf(e)) return DENIED;
    const r = await dialog.showSaveDialog(win, {
      title: 'تصدير Excel (CSV)',
      defaultPath: suggestedName,
      filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    // UTF-8 BOM so Excel renders Arabic correctly
    fs.writeFileSync(r.filePath, '﻿' + String(csvContent == null ? '' : csvContent), 'utf8');
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('export:pdf', async (e, suggestedName) => {
    if (!sessionOf(e)) return DENIED;
    const r = await dialog.showSaveDialog(win, {
      title: 'تصدير PDF',
      defaultPath: suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    });
    fs.writeFileSync(r.filePath, pdf);
    return { ok: true, path: r.filePath };
  });

  // NOTE: the former 'app:openPath' handler was removed — it let the renderer
  // open/launch ANY file on the machine (shell.openPath runs executables).
}
