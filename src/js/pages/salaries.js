/* الرواتب — Salaries (يدخل ضمن مصاريف النادي) */
(function () {
  window.PAGES = window.PAGES || {};

  function payDialog(employees, onSaved) {
    const now = new Date();
    const monthDefault = Logic.thisMonth();
    const fEmp = UI.select(employees.map(e => ({ value: e.id, label: e.name + ' — ' + e.job })), employees[0] && employees[0].id);
    const fAmount = UI.input({ type: 'number', min: 0, step: '0.01', value: employees[0] ? employees[0].salary : '' });
    const fCur = UI.currencySelect(employees[0] ? employees[0].currency : 'USD');
    UI.wireCurrencyConvert(fAmount, fCur);
    const fMonth = UI.input({ type: 'month', value: monthDefault });
    const fNote = UI.input({ placeholder: 'ملاحظة (اختياري)' });
    fEmp.onchange = () => {
      const e = employees.find(x => String(x.id) === fEmp.value);
      if (e) { fAmount.value = e.salary || ''; fCur.value = e.currency || 'USD'; fCur.dataset.prevCurrency = fCur.value; }
    };

    const body = UI.el('div');
    body.appendChild(UI.field('الموظف', fEmp));
    const r1 = UI.el('div', { class: 'form-row-3' });
    r1.appendChild(UI.field('المبلغ *', fAmount));
    r1.appendChild(UI.field('العملة', fCur));
    r1.appendChild(UI.field('عن شهر', fMonth));
    body.appendChild(r1);
    body.appendChild(UI.field('ملاحظة', fNote));

    const save = UI.el('button', { class: 'btn btn-primary', text: 'تسجيل دفع الراتب' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: 'دفع راتب', body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      const a = Number(fAmount.value);
      if (isNaN(a) || a <= 0) { UI.toast('أدخل مبلغًا صحيحًا', 'error'); return; }
      if (!fMonth.value) { UI.toast('حدد الشهر', 'error'); return; }
      const emp = employees.find(x => String(x.id) === fEmp.value);
      const rate = UI.lbpRate();
      const r = await api.run('INSERT INTO salaries(employee_id, amount, currency, exchange_rate_at_payment, converted_amount_usd, month, note, created_at, created_by) VALUES(:e,:a,:c,:r,:u,:m,:n,:t,:by)',
        { ':e': emp.id, ':a': a, ':c': fCur.value, ':r': rate, ':u': Logic.toUSD(a, fCur.value, rate), ':m': fMonth.value, ':n': fNote.value.trim(), ':t': Logic.nowStr(), ':by': UI.username() });
      // Salaries live only in the `salaries` table (never auto-inserted into
      // `expenses`) — this keeps them out of the Daily Cashbox by construction;
      // Monthly/Yearly reports read the `salaries` table directly (see reports.js).
      UI.log('دفع راتب', 'salaries', r.lastId, emp.name + ' — ' + UI.money(a, fCur.value) + ' عن ' + Logic.fmtMonthYear(fMonth.value));
      UI.toast('تم تسجيل الراتب');
      md.close();
      onSaved();
    };
  }

  window.PAGES.salaries = {
    render: async (page) => {
      const employees = await api.all('SELECT * FROM employees WHERE status = \'يعمل\' ORDER BY name');
      const rows = await api.all(`SELECT s.*, e.name, e.job FROM salaries s
        LEFT JOIN employees e ON e.id = s.employee_id ORDER BY s.id DESC LIMIT 200`);
      const monthTotal = Logic.sumUSD(rows.filter(r => r.month === Logic.thisMonth()), UI.lbpRate());

      const toolbar = UI.el('div', { class: 'toolbar' });
      toolbar.appendChild(UI.el('div', {
        class: 'alert info', style: 'margin:0',
        html: 'رواتب الشهر الحالي: <b>' + UI.money(monthTotal, 'USD') + '</b> — تُحتسب تلقائيًا ضمن المصاريف'
      }));
      toolbar.appendChild(UI.el('div', { class: 'spacer' }));
      const payBtn = UI.el('button', { class: 'btn btn-primary', html: UI.icons.money + ' دفع راتب' });
      payBtn.onclick = () => {
        if (!employees.length) { UI.toast('أضف موظفين أولًا من صفحة الموظفين', 'error'); return; }
        payDialog(employees, refreshPage);
      };
      toolbar.appendChild(payBtn);
      page.appendChild(toolbar);

      page.appendChild(UI.table({
        columns: [
          { label: 'التاريخ', num: true, render: r => Logic.arDateTime(r.created_at) },
          { label: 'الموظف', render: r => r.name || 'موظف محذوف' },
          { label: 'الوظيفة', key: 'job' },
          { label: 'عن شهر', num: true, render: r => Logic.fmtMonthYear(r.month) },
          { label: 'المبلغ', num: true, html: true, render: r => '<b>' + UI.money(r.amount, r.currency) + '</b>' },
          { label: 'ملاحظة', key: 'note' },
          { label: 'سجّله', key: 'created_by' }
        ],
        rows,
        empty: 'لا رواتب مسجلة بعد'
      }));
    }
  };
})();
