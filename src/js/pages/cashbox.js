/* الصندوق اليومي — Daily cash report */
(function () {
  window.PAGES = window.PAGES || {};
  let day = null;

  window.PAGES.cashbox = {
    render: async (page) => {
      if (!UI.isAdmin()) { await navigate('dashboard'); return; }
      const isAdmin = true;
      if (!day) day = Logic.today();
      const rate = UI.lbpRate();
      const cashbox = await api.cashbox(day);
      if (!cashbox || !cashbox.ok) { await navigate('dashboard'); return; }
      const { newSubs, pays, sales } = cashbox;

      // Daily Cashbox = income only (subscriptions + sales received today).
      // Salaries, inventory purchases, and other expenses never appear here —
      // they belong exclusively to Monthly/Yearly reports (see reports.js).
      const paysUSD = Logic.sumUSD(pays, rate);
      const salesUSD = Logic.sumUSD(sales, rate, 'total');
      const todayIncome = paysUSD + salesUSD;
      const owedToday = newSubs.reduce((s, r) => s + Logic.toUSD(Math.max(0, r.price - r.paid), r.currency, rate), 0);

      // per-currency raw totals
      const usdIn = pays.filter(p => p.currency === 'USD').reduce((s, p) => s + p.amount, 0) +
        sales.filter(p => p.currency === 'USD').reduce((s, p) => s + p.total, 0);
      const lbpIn = pays.filter(p => p.currency === 'LBP').reduce((s, p) => s + p.amount, 0) +
        sales.filter(p => p.currency === 'LBP').reduce((s, p) => s + p.total, 0);

      // sales by category
      const byCat = {};
      sales.forEach(s => { byCat[s.category] = (byCat[s.category] || 0) + Logic.toUSD(s.total, s.currency, rate); });

      /* toolbar — the entire page is admin-only */
      const toolbar = UI.el('div', { class: 'toolbar no-print' });
      if (isAdmin) {
        const fDay = UI.input({ type: 'date', value: day, style: 'width:170px' });
        fDay.onchange = () => { day = fDay.value || Logic.today(); refreshPage(); };
        toolbar.appendChild(UI.field('اليوم', fDay));
        toolbar.appendChild(UI.el('div', { class: 'spacer' }));
        toolbar.appendChild(UI.el('button', {
          class: 'btn btn-sm', html: UI.icons.printer + ' تصدير PDF',
          onclick: async () => {
            const res = await api.exportPdf('الصندوق-اليومي-' + day + '.pdf');
            if (res.ok) UI.toast('تم حفظ PDF: ' + res.path);
          }
        }));
        toolbar.appendChild(UI.el('button', {
          class: 'btn btn-sm', html: UI.icons.file + ' تصدير Excel',
          onclick: () => {
            const rows = [];
            pays.forEach(p => rows.push([p.created_at.slice(11, 16), 'دفعة اشتراك', p.first_name + ' ' + p.last_name, p.amount, p.currency, p.created_by]));
            sales.forEach(s => rows.push([s.created_at.slice(11, 16), 'بيع — ' + s.product_name, s.note, s.total, s.currency, s.created_by]));
            UI.exportCsv('الصندوق-' + day + '.csv', ['الوقت', 'النوع', 'التفاصيل', 'المبلغ', 'العملة', 'الموظف'], rows);
          }
        }));
      }
      page.appendChild(toolbar);

      /* print header (only shows on paper/PDF) */
      const ph = UI.el('div', { class: 'report-head' });
      ph.innerHTML = '<img src="../assets/logo.png" alt="Legacy Gym"><div><h2>كشف الصندوق اليومي — ' + Logic.arDate(day) + '</h2><div class="rh-meta">' + UI.esc(UI.setting('gym_name_ar', '')) + ' — طُبع في ' + Logic.arDateTime(Logic.nowStr()) + '</div></div>';
      page.appendChild(ph);

      /* summary cards */
      const stats = UI.el('div', { class: 'grid grid-3' });
      stats.innerHTML =
        `<div class="stat"><div class="stat-icon ember">${UI.icons.subs}</div><div class="stat-body"><div class="stat-value">${UI.money(paysUSD, 'USD')}</div><div class="stat-label">دفعات اشتراكات (${pays.length})</div></div></div>` +
        `<div class="stat"><div class="stat-icon ok">${UI.icons.sales}</div><div class="stat-body"><div class="stat-value">${UI.money(salesUSD, 'USD')}</div><div class="stat-label">مبيعات (${sales.length})</div></div></div>` +
        `<div class="stat"><div class="stat-icon ok">${UI.icons.cashbox}</div><div class="stat-body"><div class="stat-value">${UI.money(todayIncome, 'USD')}</div><div class="stat-label">إجمالي الوارد اليوم</div></div></div>`;
      page.appendChild(stats);

      const cols = UI.el('div', { class: 'grid grid-2', style: 'margin-top:14px;align-items:start' });

      /* left: totals breakdown */
      const sumCard = UI.el('div', { class: 'card' });
      sumCard.innerHTML = '<div class="card-title">ملخص الصندوق</div>';
      const kv = UI.el('div', { class: 'kv-list' });
      let catRows = '';
      Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([cat, v]) => {
        catRows += `<div class="kv"><span class="muted">مبيعات ${UI.esc(cat)}</span><b>${UI.money(v, 'USD')}</b></div>`;
      });
      kv.innerHTML =
        `<div class="kv"><span class="muted">اشتراكات جديدة/تجديد اليوم</span><b>${newSubs.length}</b></div>` +
        `<div class="kv"><span class="muted">مجموع دفعات الاشتراكات</span><b>${UI.money(paysUSD, 'USD')}</b></div>` +
        catRows +
        `<div class="kv"><span class="muted">مجموع المبيعات</span><b>${UI.money(salesUSD, 'USD')}</b></div>` +
        `<div class="kv"><span class="muted">مبالغ متبقية على اشتراكات اليوم</span><b style="color:var(--warn)">${UI.money(owedToday, 'USD')}</b></div>` +
        `<div class="kv"><span class="muted">وارد نقدي دولار</span><b>${UI.money(usdIn, 'USD')}</b></div>` +
        `<div class="kv"><span class="muted">وارد نقدي ليرة</span><b>${UI.money(lbpIn, 'LBP')}</b></div>` +
        `<div class="kv total"><span>إجمالي الوارد اليوم (معادل بالدولار)</span><b>${UI.money(todayIncome, 'USD')}</b></div>`;
      sumCard.appendChild(kv);
      cols.appendChild(sumCard);

      /* right: subscriptions today */
      const subCard = UI.el('div', { class: 'card' });
      subCard.innerHTML = '<div class="card-title">اشتراكات وتجديدات اليوم</div>';
      subCard.appendChild(UI.table({
        columns: [
          { label: 'المشترك', render: r => r.first_name + ' ' + r.last_name },
          { label: 'القيمة', num: true, render: r => UI.money(r.price, r.currency) },
          { label: 'المدفوع', num: true, render: r => UI.money(r.paid, r.currency) },
          { label: 'المتبقي', num: true, html: true, render: r => r.price - r.paid > 0 ? '<b style="color:var(--danger)">' + UI.money(r.price - r.paid, r.currency) + '</b>' : '—' },
          { label: 'أدخل بواسطة', key: 'created_by' }
        ],
        rows: newSubs, empty: 'لا اشتراكات اليوم'
      }));
      cols.appendChild(subCard);
      page.appendChild(cols);

      /* movements table */
      const movCard = UI.el('div', { class: 'card', style: 'margin-top:14px' });
      movCard.innerHTML = '<div class="card-title">كل حركات اليوم</div>';
      const movements = [
        ...pays.map(p => ({ t: p.created_at, type: 'دفعة اشتراك', tone: 'ember', det: p.first_name + ' ' + p.last_name + (p.note ? ' — ' + p.note : ''), amt: p.amount, cur: p.currency, by: p.created_by })),
        ...sales.map(s => ({ t: s.created_at, type: 'بيع', tone: 'ok', det: s.product_name + ' ×' + s.qty + (s.note ? ' — ' + s.note : ''), amt: s.total, cur: s.currency, by: s.created_by }))
      ].sort((a, b) => a.t.localeCompare(b.t));
      movCard.appendChild(UI.table({
        columns: [
          { label: 'الوقت', num: true, render: r => r.t.slice(11, 16) },
          { label: 'النوع', html: true, render: r => UI.badge(r.type, r.tone) },
          { label: 'التفاصيل', key: 'det' },
          { label: 'المبلغ', num: true, html: true, render: r => '<b style="color:' + (r.amt < 0 ? 'var(--danger)' : 'var(--ok)') + '">' + (r.amt < 0 ? '- ' : '+ ') + UI.money(Math.abs(r.amt), r.cur) + '</b>' },
          { label: 'أدخل بواسطة (Created By)', key: 'by' }
        ],
        rows: movements, empty: 'لا حركات في هذا اليوم'
      }));
      page.appendChild(movCard);
    }
  };
})();
