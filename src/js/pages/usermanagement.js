/* الإعدادات ← إدارة المستخدمين — enterprise auth/account management (admin only) */
(function () {
  window.PAGES = window.PAGES || {};
  let filter = { q: '', status: 'all' };

  async function fetchUsers() {
    return api.all('SELECT * FROM users ORDER BY created_at DESC, id DESC');
  }

  function applyFilter(rows) {
    let out = rows;
    if (filter.q) {
      const q = filter.q.trim();
      out = out.filter(r => (r.full_name || '').includes(q) || (r.username || '').includes(q) || (r.phone || '').includes(q));
    }
    if (filter.status === 'admin') out = out.filter(r => r.role === 'admin');
    else if (filter.status === 'employee') out = out.filter(r => r.role === 'employee');
    else if (filter.status === 'active') out = out.filter(r => r.active);
    else if (filter.status === 'disabled') out = out.filter(r => !r.active);
    return out;
  }

  /* ---- "حسابي" — the logged-in admin's own username + password ---- */
  function renderMyAccount(container) {
    const me = UI.session.user;
    const grid = UI.el('div', { class: 'grid grid-2', style: 'margin-bottom:18px' });

    const unameCard = UI.el('div', { class: 'card' });
    unameCard.innerHTML = '<div class="card-title">حسابي — تغيير اسم المستخدم</div>';
    const fUsername = UI.input({ value: me.username, dir: 'ltr' });
    unameCard.appendChild(UI.field('اسم المستخدم الجديد', fUsername));
    const saveUname = UI.el('button', { class: 'btn btn-primary btn-sm', text: 'حفظ اسم المستخدم' });
    unameCard.appendChild(saveUname);
    saveUname.onclick = async () => {
      const nu = fUsername.value.trim();
      if (!nu) { UI.toast('اسم المستخدم مطلوب', 'error'); return; }
      if (nu === me.username) { UI.toast('لم يتغيّر شيء', 'error'); return; }
      const res = await api.setUsername(me.id, nu);
      if (!res.ok) { UI.toast(res.error, 'error'); return; }
      UI.log('تغيير اسم المستخدم', 'users', me.id, 'من "' + me.username + '" إلى "' + nu + '"');
      me.username = nu;
      document.getElementById('user-name').textContent = nu;
      document.getElementById('user-avatar').textContent = nu.charAt(0).toUpperCase();
      UI.toast('تم تغيير اسم المستخدم بنجاح');
      refreshPage();
    };
    grid.appendChild(unameCard);

    const passCard = UI.el('div', { class: 'card' });
    passCard.innerHTML = '<div class="card-title">حسابي — تغيير كلمة المرور</div>';
    const fCurrent = UI.input({ type: 'password', placeholder: 'كلمة المرور الحالية' });
    const fNew = UI.input({ type: 'password', placeholder: '6 أحرف على الأقل' });
    const fConfirm = UI.input({ type: 'password', placeholder: 'أعد كتابة كلمة المرور الجديدة' });
    passCard.appendChild(UI.field('كلمة المرور الحالية', fCurrent));
    passCard.appendChild(UI.field('كلمة المرور الجديدة', fNew));
    passCard.appendChild(UI.field('تأكيد كلمة المرور الجديدة', fConfirm));
    const savePass = UI.el('button', { class: 'btn btn-primary btn-sm', text: 'حفظ وتسجيل الخروج' });
    passCard.appendChild(savePass);
    savePass.onclick = async () => {
      if (!fCurrent.value) { UI.toast('أدخل كلمة المرور الحالية', 'error'); return; }
      if (fNew.value.length < 6) { UI.toast('كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف', 'error'); return; }
      if (fNew.value !== fConfirm.value) { UI.toast('كلمة المرور الجديدة وتأكيدها غير متطابقين', 'error'); return; }
      const res = await api.changeOwnPassword(me.id, fCurrent.value, fNew.value);
      if (!res.ok) { UI.toast(res.error, 'error'); return; }
      // never store/display the password itself in the log — target account only
      UI.log('تغيير كلمة المرور', 'users', me.id, 'تغيير كلمة مرور الحساب الشخصي');
      UI.toast('تم تغيير كلمة المرور — سيتم تسجيل خروجك الآن لإعادة الدخول بها');
      setTimeout(() => window.forceLogout('تسجيل خروج تلقائي بعد تغيير كلمة المرور'), 1400);
    };
    grid.appendChild(passCard);

    container.appendChild(grid);
  }

  /* ---- Add / edit user ---- */
  function userForm(existing, onSaved) {
    const u = existing || {};
    const fFullName = UI.input({ value: u.full_name || '', placeholder: 'الاسم الكامل' });
    const fUsername = UI.input({ value: u.username || '', dir: 'ltr', placeholder: 'اسم المستخدم' });
    const fPhone = UI.input({ value: u.phone || '', dir: 'ltr', placeholder: '03 123456 (اختياري)' });
    const fPosition = UI.select([{ value: '', label: '—' }, ...Logic.JOBS], u.position || '');
    const fRole = UI.select([{ value: 'employee', label: 'موظف' }, { value: 'admin', label: 'مدير' }], u.role || 'employee');

    const body = UI.el('div');
    const r1 = UI.el('div', { class: 'form-row' });
    r1.appendChild(UI.field('الاسم الكامل *', fFullName));
    r1.appendChild(UI.field('اسم المستخدم *', fUsername));
    body.appendChild(r1);
    const r2 = UI.el('div', { class: 'form-row-3' });
    r2.appendChild(UI.field('رقم الهاتف', fPhone));
    r2.appendChild(UI.field('الوظيفة / المنصب', fPosition));
    r2.appendChild(UI.field('الصلاحية', fRole));
    body.appendChild(r2);

    let fPass = null, fConfirm = null;
    if (!existing) {
      body.appendChild(UI.el('div', { class: 'nav-sep', text: 'كلمة المرور', style: 'margin:10px 0 8px' }));
      fPass = UI.input({ type: 'password', placeholder: '6 أحرف على الأقل' });
      fConfirm = UI.input({ type: 'password', placeholder: 'أعد كتابة كلمة المرور' });
      const r3 = UI.el('div', { class: 'form-row' });
      r3.appendChild(UI.field('كلمة المرور *', fPass));
      r3.appendChild(UI.field('تأكيد كلمة المرور *', fConfirm));
      body.appendChild(r3);
    }

    const save = UI.el('button', { class: 'btn btn-primary', text: existing ? 'حفظ التعديلات' : 'إنشاء المستخدم' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: existing ? 'تعديل مستخدم — ' + (u.full_name || u.username) : 'مستخدم جديد', body, footer: [cancel, save], wide: true });
    cancel.onclick = () => md.close();

    save.onclick = async () => {
      const fullName = fFullName.value.trim();
      const username = fUsername.value.trim();
      if (!fullName) { UI.toast('الاسم الكامل مطلوب', 'error'); return; }
      if (!username) { UI.toast('اسم المستخدم مطلوب', 'error'); return; }

      try {
        if (existing) {
          if (username !== u.username) {
            const r = await api.setUsername(u.id, username);
            if (!r.ok) { UI.toast(r.error, 'error'); return; }
            UI.log('تغيير اسم المستخدم', 'users', u.id, 'من "' + u.username + '" إلى "' + username + '"');
          }
          if (fRole.value !== u.role) {
            const r = await api.setRole(u.id, fRole.value);
            if (!r.ok) { UI.toast(r.error, 'error'); return; }
            UI.log('تغيير صلاحية مستخدم', 'users', u.id, username + ' ← ' + (fRole.value === 'admin' ? 'مدير' : 'موظف'));
          }
          await api.updateProfile(u.id, { fullName, phone: fPhone.value.trim(), position: fPosition.value });
          UI.log('تعديل مستخدم', 'users', u.id, username);
          UI.toast('تم حفظ التعديلات');
        } else {
          if (!fPass.value || fPass.value.length < 6) { UI.toast('كلمة المرور يجب ألا تقل عن 6 أحرف', 'error'); return; }
          if (fPass.value !== fConfirm.value) { UI.toast('كلمة المرور وتأكيدها غير متطابقين', 'error'); return; }
          const r = await api.createUser(username, fPass.value, fRole.value, { fullName, phone: fPhone.value.trim(), position: fPosition.value });
          UI.log('إنشاء مستخدم', 'users', r.lastId, fullName + ' (' + username + ')');
          UI.toast('تم إنشاء المستخدم بنجاح');
        }
      } catch (err) {
        UI.toast('اسم المستخدم مستخدم مسبقًا', 'error');
        return;
      }
      md.close();
      onSaved();
    };
  }

  /* ---- Reset another user's password (no old password needed) ---- */
  function resetPasswordDialog(user, onSaved) {
    const fPass = UI.input({ type: 'password', placeholder: '6 أحرف على الأقل' });
    const fConfirm = UI.input({ type: 'password', placeholder: 'أعد كتابة كلمة المرور' });
    const body = UI.el('div');
    body.appendChild(UI.el('div', {
      class: 'alert info',
      html: 'إعادة تعيين كلمة مرور: <b>' + UI.esc(user.full_name || user.username) + '</b> (<span dir="ltr">' + UI.esc(user.username) + '</span>)'
    }));
    body.appendChild(UI.field('كلمة المرور الجديدة', fPass));
    body.appendChild(UI.field('تأكيد كلمة المرور الجديدة', fConfirm));
    const save = UI.el('button', { class: 'btn btn-primary', text: 'حفظ' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: 'إعادة تعيين كلمة المرور', body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      if (fPass.value.length < 6) { UI.toast('كلمة المرور يجب ألا تقل عن 6 أحرف', 'error'); return; }
      if (fPass.value !== fConfirm.value) { UI.toast('كلمة المرور وتأكيدها غير متطابقين', 'error'); return; }
      await api.setPassword(user.id, fPass.value);
      // logged WITHOUT the password value — target account + who did it only
      UI.log('إعادة تعيين كلمة المرور', 'users', user.id, user.username);
      UI.toast('تمت إعادة تعيين كلمة المرور بنجاح');
      md.close();
      onSaved();
    };
  }

  async function toggleActive(user, onSaved) {
    const action = user.active ? 'إيقاف' : 'تفعيل';
    const yes = await UI.confirm(action + ' حساب', 'هل تريد ' + action + ' حساب "' + (user.full_name || user.username) + '" (' + user.username + ')؟');
    if (!yes) return;
    const res = await api.setActive(user.id, user.active ? 0 : 1);
    if (!res.ok) { UI.toast(res.error, 'error'); return; }
    UI.log(user.active ? 'إيقاف مستخدم' : 'تفعيل مستخدم', 'users', user.id, user.username);
    UI.toast(user.active ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب');
    onSaved();
  }

  async function deleteUserFlow(user, onSaved) {
    const yes = await UI.confirm('حذف مستخدم',
      'هل أنت متأكد من حذف "' + (user.full_name || user.username) + '" (' + user.username + ')؟ إذا كان له سجل عمليات سابق (مبيعات، اشتراكات، مصاريف…) سيتم إيقاف حسابه بدلًا من حذفه للحفاظ على البيانات المالية.',
      { danger: true, okText: 'حذف' });
    if (!yes) return;
    const res = await api.deleteUser(user.id);
    if (!res.ok) { UI.toast(res.error, 'error'); return; }
    if (res.action === 'disabled') {
      UI.log('محاولة حذف مستخدم له سجل عمليات — تم إيقافه بدلًا من الحذف', 'users', user.id, user.username);
      UI.toast('لهذا المستخدم سجل عمليات سابق — تم إيقاف الحساب بدلًا من حذفه للحفاظ على البيانات المالية');
    } else {
      UI.log('حذف مستخدم', 'users', user.id, user.username);
      UI.toast('تم حذف المستخدم نهائيًا');
    }
    onSaved();
  }

  window.PAGES.usermanagement = {
    render: async (page) => {
      const back = UI.el('button', { class: 'btn btn-ghost btn-sm', html: '&larr; رجوع إلى الإعدادات' });
      back.onclick = () => navigate('settings');
      page.appendChild(back);
      page.appendChild(UI.el('h3', { text: 'إدارة المستخدمين', style: 'margin:14px 0 4px;font-size:19px' }));
      page.appendChild(UI.el('div', {
        class: 'muted', style: 'margin-bottom:16px;font-size:13px',
        text: 'إدارة حسابات الدخول: المدراء والموظفون، الصلاحيات، الحالة، وكلمات المرور.'
      }));

      renderMyAccount(page);

      let rows = await fetchUsers();
      rows = rows.filter(r => r.username !== UI.username()); // self is managed above, not in the table

      const toolbar = UI.el('div', { class: 'toolbar' });
      const search = UI.el('div', { class: 'search-box' });
      const sInput = UI.input({ placeholder: 'بحث بالاسم أو اسم المستخدم أو رقم الهاتف…', value: filter.q });
      search.innerHTML = UI.icons.search;
      search.appendChild(sInput);
      sInput.oninput = UI.debounce(() => { filter.q = sInput.value; refreshPage(); }, 250);
      toolbar.appendChild(search);

      const chips = UI.el('div', { class: 'chip-row' });
      [['all', 'الكل'], ['admin', 'مدراء'], ['employee', 'موظفون'], ['active', 'ناشط'], ['disabled', 'موقوف']].forEach(([k, lbl]) => {
        chips.appendChild(UI.el('button', {
          class: 'chip' + (filter.status === k ? ' active' : ''), text: lbl,
          onclick: () => { filter.status = k; refreshPage(); }
        }));
      });
      toolbar.appendChild(chips);
      toolbar.appendChild(UI.el('div', { class: 'spacer' }));
      const addBtn = UI.el('button', { class: 'btn btn-primary', html: UI.icons.plus + ' مستخدم جديد' });
      addBtn.onclick = () => userForm(null, refreshPage);
      toolbar.appendChild(addBtn);
      page.appendChild(toolbar);

      const shown = applyFilter(rows);
      page.appendChild(UI.el('div', { class: 'muted', style: 'margin-bottom:10px;font-size:13px', text: shown.length + ' مستخدم' }));

      page.appendChild(UI.table({
        columns: [
          { label: 'الاسم', render: r => r.full_name || r.username },
          { label: 'اسم المستخدم', key: 'username' },
          { label: 'الصلاحية', html: true, render: r => r.role === 'admin' ? UI.badge('مدير', 'ember') : UI.badge('موظف', 'info') },
          { label: 'الحالة', html: true, render: r => r.active ? UI.badge('ناشط', 'ok') : UI.badge('موقوف', 'danger') },
          { label: 'آخر تسجيل دخول', num: true, render: r => r.last_login ? Logic.arDateTime(r.last_login) : 'لم يسجّل الدخول بعد' },
          { label: 'تاريخ الإنشاء', num: true, render: r => Logic.arDate(r.created_at) },
          {
            label: '', cls: 'actions', render: r => UI.actionBtns([
              { icon: UI.icons.edit, title: 'تعديل', onClick: () => userForm(r, refreshPage) },
              { icon: UI.icons.key, title: 'إعادة تعيين كلمة المرور', onClick: () => resetPasswordDialog(r, refreshPage) },
              { icon: r.active ? UI.icons.pause : UI.icons.check, title: r.active ? 'إيقاف الحساب' : 'تفعيل الحساب', onClick: () => toggleActive(r, refreshPage) },
              { icon: UI.icons.trash, title: 'حذف', danger: true, onClick: () => deleteUserFlow(r, refreshPage) }
            ])
          }
        ],
        rows: shown,
        empty: 'لا يوجد مستخدمون مطابقون'
      }));
    }
  };
})();
