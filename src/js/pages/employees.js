/* الموظفون — بيانات التوظيف والرواتب (admin only)
   حسابات الدخول (username/password/role) تُدار من: الإعدادات ← إدارة المستخدمين */
(function () {
  window.PAGES = window.PAGES || {};

  function employeeForm(existing, onSaved) {
    const e = existing || {};
    const fName = UI.input({ value: e.name || '', placeholder: 'اسم الموظف' });
    const fJob = UI.select(Logic.JOBS, e.job || 'مسؤول استقبال');
    const fPhone = UI.input({ value: e.phone || '', dir: 'ltr', placeholder: '70 123456' });
    const fSalary = UI.input({ type: 'number', value: e.salary != null ? e.salary : '', min: 0, step: '0.01', placeholder: 'اختياري' });
    const fCur = UI.currencySelect(e.currency || 'USD');
    const fStart = UI.input({ type: 'date', value: e.start_date || Logic.today() });
    const fStatus = UI.select(['يعمل', 'متوقف', 'سابق'], e.status || 'يعمل');
    const fNotes = UI.el('textarea'); fNotes.value = e.notes || '';

    const body = UI.el('div');
    const r1 = UI.el('div', { class: 'form-row' });
    r1.appendChild(UI.field('الاسم *', fName));
    r1.appendChild(UI.field('الوظيفة', fJob));
    body.appendChild(r1);
    const r2 = UI.el('div', { class: 'form-row-3' });
    r2.appendChild(UI.field('الهاتف', fPhone));
    r2.appendChild(UI.field('الراتب الشهري', fSalary));
    r2.appendChild(UI.field('العملة', fCur));
    body.appendChild(r2);
    const r3 = UI.el('div', { class: 'form-row' });
    r3.appendChild(UI.field('تاريخ بداية العمل', fStart));
    r3.appendChild(UI.field('حالة الموظف', fStatus));
    body.appendChild(r3);
    body.appendChild(UI.field('ملاحظات', fNotes));

    const save = UI.el('button', { class: 'btn btn-primary', text: existing ? 'حفظ' : 'إضافة الموظف' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: existing ? 'تعديل موظف — ' + e.name : 'إضافة موظف جديد', body, footer: [cancel, save], wide: true });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      if (!fName.value.trim()) { UI.toast('اسم الموظف مطلوب', 'error'); return; }
      if (fSalary.value && Number(fSalary.value) < 0) { UI.toast('لا يمكن إدخال راتب سلبي', 'error'); return; }
      if (existing) {
        await api.run('UPDATE employees SET name=:n, job=:j, phone=:p, salary=:s, currency=:c, start_date=:d, status=:st, notes=:no WHERE id=:id',
          { ':n': fName.value.trim(), ':j': fJob.value, ':p': fPhone.value.trim(), ':s': Number(fSalary.value) || 0, ':c': fCur.value, ':d': fStart.value, ':st': fStatus.value, ':no': fNotes.value.trim(), ':id': e.id });
        UI.log('تعديل موظف', 'employees', e.id, fName.value);
      } else {
        const r = await api.run('INSERT INTO employees(name, job, phone, salary, currency, start_date, status, notes) VALUES(:n,:j,:p,:s,:c,:d,:st,:no)',
          { ':n': fName.value.trim(), ':j': fJob.value, ':p': fPhone.value.trim(), ':s': Number(fSalary.value) || 0, ':c': fCur.value, ':d': fStart.value, ':st': fStatus.value, ':no': fNotes.value.trim() });
        UI.log('إضافة موظف', 'employees', r.lastId, fName.value);
      }
      UI.toast('تم الحفظ');
      md.close();
      onSaved();
    };
  }

  window.PAGES.employees = {
    render: async (page) => {
      const emps = await api.all('SELECT * FROM employees ORDER BY status = \'يعمل\' DESC, name');

      const noteBar = UI.el('div', { class: 'toolbar' });
      noteBar.appendChild(UI.el('div', {
        class: 'alert info', style: 'margin:0;flex:1',
        html: 'هذه الصفحة لبيانات التوظيف والرواتب فقط. لإنشاء أو تعديل <b>حسابات الدخول</b> (اسم المستخدم، كلمة المرور، الصلاحية) اذهب إلى: الإعدادات ← إدارة المستخدمين.'
      }));
      const gotoUsers = UI.el('button', { class: 'btn btn-sm', text: 'إدارة المستخدمين ←', onclick: () => navigate('usermanagement') });
      noteBar.appendChild(gotoUsers);
      page.appendChild(noteBar);

      const toolbar = UI.el('div', { class: 'toolbar' });
      toolbar.appendChild(UI.el('div', { class: 'spacer' }));
      const addBtn = UI.el('button', { class: 'btn btn-primary', html: UI.icons.plus + ' موظف جديد' });
      addBtn.onclick = () => employeeForm(null, refreshPage);
      toolbar.appendChild(addBtn);
      page.appendChild(toolbar);

      page.appendChild(UI.table({
        columns: [
          { label: 'الاسم', key: 'name' },
          { label: 'الوظيفة', key: 'job' },
          { label: 'الهاتف', key: 'phone', num: true },
          { label: 'الراتب', num: true, render: r => r.salary ? UI.money(r.salary, r.currency) : '—' },
          { label: 'بداية العمل', num: true, render: r => Logic.arDate(r.start_date) },
          { label: 'الحالة', html: true, render: r => UI.badge(r.status, r.status === 'يعمل' ? 'ok' : r.status === 'متوقف' ? 'warn' : 'neutral') },
          {
            label: '', cls: 'actions', render: r => UI.actionBtns([
              { icon: UI.icons.edit, title: 'تعديل', onClick: () => employeeForm(r, refreshPage) },
              {
                icon: UI.icons.trash, title: 'حذف', danger: true, onClick: async () => {
                  const yes = await UI.confirm('حذف موظف', 'حذف "' + r.name + '"؟ سجل الرواتب المدفوعة سيبقى محفوظًا.', { danger: true });
                  if (!yes) return;
                  await api.run('DELETE FROM employees WHERE id=:id', { ':id': r.id });
                  UI.log('حذف موظف', 'employees', r.id, r.name);
                  refreshPage();
                }
              }
            ])
          }
        ],
        rows: emps,
        empty: 'لا يوجد موظفون'
      }));
    }
  };
})();
