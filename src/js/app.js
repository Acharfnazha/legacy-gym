/*
 * Legacy Gym — app boot: loading, login, shell, routing, permissions.
 */
(function () {
  const PAGES = window.PAGES = window.PAGES || {};

  const NAV = [
    { sep: 'الرئيسية' },
    { id: 'dashboard', label: 'لوحة التحكم', icon: 'dashboard' },
    { sep: 'الأعضاء' },
    { id: 'members', label: 'المشتركين', icon: 'members' },
    { id: 'subscriptions', label: 'الاشتراكات', icon: 'subs' },
    { sep: 'المبيعات' },
    { id: 'sales', label: 'المبيعات', icon: 'sales' },
    { id: 'products', label: 'المنتجات', icon: 'products' },
    { id: 'inventory', label: 'المخزون', icon: 'products', admin: true },
    { sep: 'المالية' },
    { id: 'cashbox', label: 'الصندوق اليومي', icon: 'cashbox', admin: true },
    { id: 'expenses', label: 'المصاريف', icon: 'expenses', admin: true },
    { id: 'employees', label: 'الموظفون', icon: 'employees', admin: true },
    { id: 'salaries', label: 'الرواتب', icon: 'salaries', admin: true },
    { id: 'reports', label: 'التقارير', icon: 'reports', admin: true },
    { sep: 'النظام', admin: true },
    { id: 'backup', label: 'النسخ الاحتياطي', icon: 'backup', admin: true },
    { id: 'activity', label: 'سجل العمليات', icon: 'activity', admin: true },
    { id: 'settings', label: 'الإعدادات', icon: 'settings', admin: true },
    // reached via a button inside Settings, not a top-level sidebar link
    { id: 'usermanagement', label: 'إدارة المستخدمين', icon: 'employees', admin: true, hidden: true }
  ];

  let current = null;

  function allowed(item) {
    return !item.admin || UI.isAdmin();
  }

  window.navigate = async function (id) {
    // protected pages require an authenticated session
    if (!UI.session.user) { location.reload(); return; }
    const item = NAV.find(n => n.id === id);
    if (!item || !allowed(item)) {
      UI.toast('لا تملك صلاحية الوصول لهذه الصفحة', 'error');
      if (id === 'cashbox' && current !== 'dashboard') await navigate('dashboard');
      return;
    }
    current = id;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === id));
    document.getElementById('page-title').textContent = item.label;
    const page = document.getElementById('page');
    page.innerHTML = '';
    try {
      await PAGES[id].render(page);
    } catch (e) {
      console.error(e);
      page.innerHTML = '<div class="alert danger">حدث خطأ أثناء تحميل الصفحة: ' + UI.esc(e.message) + '</div>';
    }
  };

  window.refreshPage = () => { if (current) navigate(current); };

  function buildSidebar() {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = '';
    NAV.forEach(item => {
      if (!allowed(item)) return;
      if (item.hidden) return;
      if (item.sep) {
        // hide a section header if all its items are admin-only and user is employee
        nav.appendChild(UI.el('div', { class: 'nav-sep', text: item.sep }));
        return;
      }
      const b = UI.el('button', { class: 'nav-item', 'data-page': item.id, onclick: () => navigate(item.id) });
      b.innerHTML = UI.icons[item.icon] + '<span>' + item.label + '</span>';
      nav.appendChild(b);
    });
  }

  function startClock() {
    const dateEl = document.getElementById('topbar-date');
    const clockEl = document.getElementById('topbar-clock');
    const tick = () => {
      const d = new Date();
      dateEl.textContent = Logic.fmtDayDate(Logic.today(d));
      clockEl.textContent = Logic.nowStr(d).slice(11, 16);
    };
    tick();
    setInterval(tick, 15000);
  }

  async function enterApp(user) {
    UI.session.user = user;
    await UI.loadSettings();
    document.getElementById('login').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-name').textContent = user.username;
    document.getElementById('user-role').textContent = user.role === 'admin' ? 'مدير' : 'موظف';
    document.getElementById('user-avatar').textContent = user.username.charAt(0).toUpperCase();
    document.getElementById('sidebar-gymname').textContent = UI.setting('gym_name_ar', 'ليجاسي جيم');
    buildSidebar();
    startClock();
    navigate('dashboard');

    if (UI.isAdmin()) {
      const warn = await api.clockWarning();
      if (warn) {
        UI.modal({
          title: 'تحذير: تغيير وقت الجهاز',
          body: '<div class="alert danger" style="margin:0">' + UI.esc(warn) + '</div>'
        });
      }
    }
  }

  /* Full session teardown reused by: the logout button, and forced re-login
     after an admin changes their own password. Nothing survives, there is no
     history to go "Back" to, and every page requires a fresh login. */
  window.forceLogout = async (logAction) => {
    try {
      await api.run('INSERT INTO activity_log(username, action, entity, details, created_at) VALUES(:u,:a,\'auth\',\'\',:t)',
        { ':u': UI.username(), ':a': logAction || 'تسجيل خروج', ':t': Logic.nowStr() });
    } catch (e) { /* logging must never block logout */ }
    try { await api.logout(); } catch (e) { /* local teardown still proceeds */ }
    UI.session.user = null;
    UI.session.settings = {};
    try { sessionStorage.clear(); localStorage.clear(); } catch (e) { /* no-op */ }
    document.getElementById('app').classList.add('hidden');
    document.getElementById('page').innerHTML = '';
    location.reload();
  };

  function setupLogin() {
    let selectedRole = 'admin';
    document.querySelectorAll('.role-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        selectedRole = tab.dataset.role;
      });
    });
    const form = document.getElementById('login-form');
    const errEl = document.getElementById('login-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.classList.add('hidden');
      const btn = document.getElementById('login-btn');
      btn.disabled = true; btn.textContent = 'جارٍ التحقق…';
      const u = document.getElementById('login-user').value.trim();
      const p = document.getElementById('login-pass').value;
      const res = await api.login(u, p);
      btn.disabled = false; btn.textContent = 'دخول';
      if (!res.ok) { errEl.textContent = res.error; errEl.classList.remove('hidden'); return; }
      if (res.user.role !== selectedRole) {
        errEl.textContent = res.user.role === 'admin'
          ? 'هذا الحساب حساب مدير — اختر "مدير" في الأعلى'
          : 'هذا الحساب حساب موظف — اختر "موظف" في الأعلى';
        errEl.classList.remove('hidden');
        return;
      }
      document.getElementById('login-pass').value = '';
      enterApp(res.user);
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      const yes = await UI.confirm('تسجيل الخروج', 'هل تريد تسجيل الخروج من النظام؟');
      if (!yes) return;
      await window.forceLogout('تسجيل خروج');
    });
  }

  function setupActivation(machineId, onActivated) {
    document.getElementById('activation-machine-id').value = machineId;
    document.getElementById('activation-copy').onclick = () => {
      try { navigator.clipboard.writeText(machineId); UI.toast('تم نسخ رقم الجهاز'); } catch (e) { /* no-op */ }
    };
    const form = document.getElementById('activation-form');
    const errEl = document.getElementById('activation-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.classList.add('hidden');
      const btn = document.getElementById('activation-btn');
      const code = document.getElementById('activation-code').value.trim();
      btn.disabled = true; btn.textContent = 'جارٍ التحقق…';
      const res = await api.licenseActivate(code);
      btn.disabled = false; btn.textContent = 'تفعيل';
      if (!res.ok) { errEl.textContent = res.error || 'كود التفعيل غير صحيح'; errEl.classList.remove('hidden'); return; }
      UI.toast('تم تفعيل النظام على هذا الجهاز');
      onActivated();
    });
  }

  function showSuspended(machineId) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('activation').classList.add('hidden');
    document.getElementById('login').classList.add('hidden');
    document.getElementById('suspended-machine-id').value = machineId || '';
    document.getElementById('suspended').classList.remove('hidden');
    document.getElementById('suspended-retry').onclick = () => location.reload();
  }

  async function boot() {
    // minimum splash time so the brand moment reads
    const t0 = Date.now();
    try { await api.all('SELECT 1'); } catch (e) { /* db warms up via IPC */ }
    let lic = { activated: true, machineId: '' };
    try { lic = await api.licenseStatus(); } catch (e) { /* if unavailable, don't hard-block */ }
    const wait = Math.max(0, 1400 - (Date.now() - t0));

    const showLogin = () => {
      setupLogin();
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('activation').classList.add('hidden');
      document.getElementById('suspended').classList.add('hidden');
      document.getElementById('login').classList.remove('hidden');
      document.getElementById('login-user').focus();
    };

    // After activation, check the remote kill-switch (fail-open: any error = OK).
    const proceedActivated = async () => {
      let rs = { suspended: false, machineId: lic.machineId };
      try { rs = await api.licenseRemoteStatus(); } catch (e) { /* fail-open */ }
      if (rs.suspended) { showSuspended(rs.machineId); return; }
      showLogin();
    };

    setTimeout(() => {
      if (lic.activated) { proceedActivated(); return; }
      // un-activated client machine: gate everything behind activation first
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('activation').classList.remove('hidden');
      setupActivation(lic.machineId, proceedActivated);
    }, wait);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
