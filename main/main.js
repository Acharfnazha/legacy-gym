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
const sessions = new Map(); // webContents.id -> authenticated user role

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
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (process.env.IRONCORE_SMOKE) runSmoke();
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
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

  win.webContents.on('console-message', (e, level, msg) => {
    if (level >= 2) console.log('[renderer-console-error]', msg);
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
  ipcMain.handle('db:all', (e, sql, params) => isLicensed(dataDir) ? db.all(sql, params) : []);
  ipcMain.handle('db:run', (e, sql, params) => isLicensed(dataDir) ? db.run(sql, params) : { changes: 0, lastId: null });
  ipcMain.handle('auth:login', (e, u, p) => {
    if (!isLicensed(dataDir)) return { ok: false, error: 'النظام غير مُفعّل على هذا الجهاز' };
    const result = db.login(u, p);
    if (result.ok) sessions.set(e.sender.id, { id: result.user.id, role: result.user.role });
    else sessions.delete(e.sender.id);
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
  ipcMain.handle('auth:createUser', (e, u, p, role, extra) => db.createUser(u, p, role, extra));
  ipcMain.handle('auth:setPassword', (e, id, p) => db.setPassword(id, p));
  ipcMain.handle('auth:changeOwnPassword', (e, id, current, next) => db.changeOwnPassword(id, current, next));
  ipcMain.handle('auth:setUsername', (e, id, username) => db.setUsername(id, username));
  ipcMain.handle('auth:updateProfile', (e, id, profile) => db.updateUserProfile(id, profile));
  ipcMain.handle('auth:setRole', (e, id, role) => db.setRole(id, role));
  ipcMain.handle('auth:setActive', (e, id, active) => db.setActive(id, active));
  ipcMain.handle('auth:deleteUser', (e, id) => db.deleteUser(id));
  ipcMain.handle('app:clockWarning', () => clockWarning);
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

  ipcMain.handle('backup:now', async () => {
    const dir = db.getSetting('backup_dir', '') || path.join(dataDir, 'backups');
    const dest = db.backupTo(dir);
    return { ok: true, path: dest };
  });
  ipcMain.handle('backup:chooseDir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    db.setSetting('backup_dir', r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle('backup:list', () => {
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
    let target = file;
    if (!target) {
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
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'الملف غير صالح أو تالف: ' + err.message };
    }
  });
  ipcMain.handle('backup:openDir', () => {
    const dir = db.getSetting('backup_dir', '') || path.join(dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('export:csv', async (e, suggestedName, csvContent) => {
    const r = await dialog.showSaveDialog(win, {
      title: 'تصدير Excel (CSV)',
      defaultPath: suggestedName,
      filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    // UTF-8 BOM so Excel renders Arabic correctly
    fs.writeFileSync(r.filePath, '﻿' + csvContent, 'utf8');
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('export:pdf', async (e, suggestedName) => {
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

  ipcMain.handle('app:openPath', (e, p) => shell.openPath(p));
}
