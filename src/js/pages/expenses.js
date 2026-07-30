/* المصاريف — Expenses */
(function () {
  window.PAGES = window.PAGES || {};
  let filter = { range: 'month', cat: 'all' };

  function rangeDates(range) {
    const today = Logic.today();
    if (range === 'today') return [today, Logic.addDays(today, 1)];
    if (range === 'week') return [Logic.addDays(today, -7), Logic.addDays(today, 1)];
    if (range === 'month') return [today.slice(0, 7) + '-01', Logic.addDays(today, 1)];
    if (range === 'year') return [today.slice(0, 4) + '-01-01', Logic.addDays(today, 1)];
    return ['2000-01-01', Logic.addDays(today, 1)];
  }
  window.rangeDates = rangeDates;

  function expenseForm(existing, onSaved) {
    const e = existing || {};
    const fCat = UI.select(Logic.EXPENSE_CATS, e.category || 'كهرباء');
    const fAmount = UI.input({ type: 'number', value: e.amount != null ? e.amount : '', min: 0, step: '0.01', placeholder: '0.00' });
    const fCur = UI.currencySelect(e.currency || 'USD');
    UI.wireCurrencyConvert(fAmount, fCur);
    const fNote = UI.el('textarea', { placeholder: 'تفاصيل المصروف (اختياري)' }); fNote.value = e.note || '';

    const body = UI.el('div');
    const r1 = UI.el('div', { class: 'form-row-3' });
    r1.appendChild(UI.field('نوع المصروف', fCat));
    r1.appendChild(UI.field('المبلغ *', fAmount));
    r1.appendChild(UI.field('العملة', fCur));
    body.appendChild(r1);
    body.appendChild(UI.field('ملاحظة', fNote));

    const save = UI.el('button', { class: 'btn btn-primary', text: existing ? 'حفظ' : 'تسجيل المصروف' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: existing ? 'تعديل مصروف #' + e.id : 'تسجيل مصروف جديد', body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      const a = Number(fAmount.value);
      const rate = UI.lbpRate();
      const amountUSD = Logic.toUSD(a, fCur.value, rate);
      if (isNaN(a) || a <= 0) { UI.toast('أدخل مبلغًا صحيحًا (لا يمكن أن يكون سلبيًا)', 'error'); return; }
      if (existing) {
        if (!UI.canEditRow(e.created_at, e.created_by)) { UI.toast(UI.editLockMsg, 'error'); return; }
        await api.run('UPDATE expenses SET category=:c, amount=:a, currency=:cur, exchange_rate_at_expense=:r, converted_amount_usd=:u, note=:n WHERE id=:id',
          { ':c': fCat.value, ':a': a, ':cur': fCur.value, ':r': rate, ':u': amountUSD, ':n': fNote.value.trim(), ':id': e.id });
        UI.log('تعديل مصروف', 'expenses', e.id,
          'قبل: ' + e.category + ' ' + UI.money(e.amount, e.currency) + ' ← بعد: ' + fCat.value + ' ' + UI.money(a, fCur.value));
      } else {
        const r = await api.run('INSERT INTO expenses(category, amount, currency, exchange_rate_at_expense, converted_amount_usd, note, created_at, created_by) VALUES(:c,:a,:cur,:r,:u,:n,:t,:by)',
          { ':c': fCat.value, ':a': a, ':cur': fCur.value, ':r': rate, ':u': amountUSD, ':n': fNote.value.trim(), ':t': Logic.nowStr(), ':by': UI.username() });
        UI.log('تسجيل مصروف', 'expenses', r.lastId, fCat.value + ' ' + UI.money(a, fCur.value));
      }
      UI.toast('تم الحفظ');
      md.close();
      onSaved();
    };
  }

  window.PAGES.expenses = {
    render: async (page) => {
      const [from, to] = rangeDates(filter.range);
      let rows = await api.all('SELECT * FROM expenses WHERE created_at >= :a AND created_at < :b ORDER BY id DESC',
        { ':a': from + ' 00:00:00', ':b': to + ' 00:00:00' });
      if (filter.cat !== 'all') rows = rows.filter(r => r.category === filter.cat);
      const totalUSD = Logic.sumUSD(rows, UI.lbpRate());

      const toolbar = UI.el('div', { class: 'toolbar' });
      const chips = UI.el('div', { class: 'chip-row' });
      [['today', 'اليوم'], ['week', 'هذا الأسبوع'], ['month', 'هذا الشهر'], ['year', 'هذه السنة'], ['all', 'الكل']].forEach(([k, lbl]) => {
        chips.appendChild(UI.el('button', { class: 'chip' + (filter.range === k ? ' active' : ''), text: lbl, onclick: () => { filter.range = k; refreshPage(); } }));
      });
      toolbar.appendChild(chips);
      const catSel = UI.select([{ value: 'all', label: 'كل الأنواع' }, ...Logic.EXPENSE_CATS], filter.cat, { style: 'width:170px' });
      catSel.onchange = () => { filter.cat = catSel.value; refreshPage(); };
      toolbar.appendChild(catSel);
      toolbar.appendChild(UI.el('div', { class: 'spacer' }));
      toolbar.appendChild(UI.el('button', {
        class: 'btn btn-sm', html: UI.icons.file + ' تصدير Excel',
        onclick: () => UI.exportCsv('المصاريف.csv', ['التاريخ', 'النوع', 'المبلغ', 'العملة', 'ملاحظة', 'الموظف'],
          rows.map(r => [Logic.arDateTime(r.created_at), r.category, r.amount, r.currency, r.note, r.created_by]))
      }));
      const addBtn = UI.el('button', { class: 'btn btn-primary', html: UI.icons.plus + ' مصروف جديد' });
      addBtn.onclick = () => expenseForm(null, refreshPage);
      toolbar.appendChild(addBtn);
      page.appendChild(toolbar);

      page.appendChild(UI.el('div', {
        class: 'alert info', html: 'إجمالي مصاريف الفترة: <b>' + UI.money(totalUSD, 'USD') + '</b> (' + rows.length + ' عملية)'
      }));

      page.appendChild(UI.table({
        columns: [
          { label: 'التاريخ', num: true, render: r => Logic.arDateTime(r.created_at) },
          { label: 'النوع', html: true, render: r => UI.badge(r.category, 'neutral') },
          { label: 'المبلغ', num: true, html: true, render: r => '<b style="color:var(--danger)">' + UI.money(r.amount, r.currency) + '</b>' },
          { label: 'ملاحظة', key: 'note' },
          { label: 'الموظف', key: 'created_by' },
          {
            label: '', cls: 'actions', render: r => UI.actionBtns([
              { icon: UI.icons.edit, title: 'تعديل', onClick: () => expenseForm(r, refreshPage) },
              UI.isAdmin() ? {
                icon: UI.icons.trash, title: 'حذف', danger: true, onClick: async () => {
                  const yes = await UI.confirm('حذف مصروف', 'حذف "' + r.category + ' — ' + UI.money(r.amount, r.currency) + '"؟', { danger: true });
                  if (!yes) return;
                  await api.run('DELETE FROM expenses WHERE id=:id', { ':id': r.id });
                  UI.log('حذف مصروف', 'expenses', r.id, r.category);
                  refreshPage();
                }
              } : null
            ])
          }
        ],
        rows,
        empty: 'لا مصاريف في هذه الفترة'
      }));
    }
  };
})();
