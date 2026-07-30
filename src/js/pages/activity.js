/* سجل العمليات — Activity Log (admin) */
(function () {
  window.PAGES = window.PAGES || {};
  let filter = { q: '', user: 'all', range: 'today' };

  window.PAGES.activity = {
    render: async (page) => {
      const [from, to] = window.rangeDates(filter.range);
      let rows = await api.all('SELECT * FROM activity_log WHERE created_at >= :a AND created_at < :b ORDER BY id DESC LIMIT 800',
        { ':a': from + ' 00:00:00', ':b': to + ' 00:00:00' });
      const users = [...new Set(rows.map(r => r.username))];
      if (filter.user !== 'all') rows = rows.filter(r => r.username === filter.user);
      if (filter.q) rows = rows.filter(r => (r.action + ' ' + r.details).includes(filter.q));

      // per-employee summary for the period
      const summary = {};
      rows.forEach(r => {
        summary[r.username] = summary[r.username] || { ops: 0, sales: 0, edits: 0 };
        summary[r.username].ops++;
        if (r.action.includes('بيع')) summary[r.username].sales++;
        if (r.action.includes('تعديل')) summary[r.username].edits++;
      });

      const toolbar = UI.el('div', { class: 'toolbar' });
      const search = UI.el('div', { class: 'search-box' });
      const sInput = UI.input({ placeholder: 'بحث في العمليات…', value: filter.q });
      search.innerHTML = UI.icons.search;
      search.appendChild(sInput);
      sInput.oninput = UI.debounce(() => { filter.q = sInput.value; refreshPage(); }, 300);
      toolbar.appendChild(search);
      const chips = UI.el('div', { class: 'chip-row' });
      [['today', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['all', 'الكل']].forEach(([k, lbl]) => {
        chips.appendChild(UI.el('button', { class: 'chip' + (filter.range === k ? ' active' : ''), text: lbl, onclick: () => { filter.range = k; refreshPage(); } }));
      });
      toolbar.appendChild(chips);
      const userSel = UI.select([{ value: 'all', label: 'كل المستخدمين' }, ...users], filter.user, { style: 'width:160px' });
      userSel.onchange = () => { filter.user = userSel.value; refreshPage(); };
      toolbar.appendChild(userSel);
      toolbar.appendChild(UI.el('div', { class: 'spacer' }));
      toolbar.appendChild(UI.el('button', {
        class: 'btn btn-sm', html: UI.icons.file + ' تصدير Excel',
        onclick: () => UI.exportCsv('سجل-العمليات.csv', ['التاريخ', 'المستخدم', 'العملية', 'القسم', 'التفاصيل'],
          rows.map(r => [Logic.arDateTime(r.created_at), r.username, r.action, r.entity, r.details]))
      }));
      page.appendChild(toolbar);

      // summary cards
      const sum = UI.el('div', { class: 'grid grid-4', style: 'margin-bottom:14px' });
      Object.entries(summary).slice(0, 4).forEach(([user, s]) => {
        sum.innerHTML += `<div class="stat"><div class="stat-icon info">${UI.icons.user}</div>
          <div class="stat-body"><div class="stat-value">${s.ops}</div>
          <div class="stat-label">${UI.esc(user)} — عملية</div>
          <div class="stat-sub">${s.sales} بيع · ${s.edits} تعديل</div></div></div>`;
      });
      if (Object.keys(summary).length) page.appendChild(sum);

      page.appendChild(UI.table({
        columns: [
          { label: 'التاريخ والوقت', num: true, render: r => Logic.arDateTime(r.created_at) },
          { label: 'المستخدم', html: true, render: r => UI.badge(r.username, r.username === 'admin' ? 'ember' : 'info') },
          {
            label: 'العملية', html: true, render: r => {
              const tone = r.action.includes('حذف') || r.action.includes('إلغاء') || r.action.includes('تحذير') || r.action.includes('إيقاف') ? 'danger'
                : r.action.includes('تعديل') || r.action.includes('مراجعة') || r.action.includes('تغيير') ? 'warn'
                  : r.action.includes('بيع') || r.action.includes('دفع') ? 'ok' : 'neutral';
              return UI.badge(r.action, tone);
            }
          },
          { label: 'التفاصيل', key: 'details' }
        ],
        rows,
        empty: 'لا عمليات في هذه الفترة'
      }));
    }
  };
})();
