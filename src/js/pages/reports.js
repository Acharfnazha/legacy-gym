/* التقارير الشهرية والسنوية — Reports */
(function () {
  window.PAGES = window.PAGES || {};
  let mode = 'month';
  let selMonth = null, selYear = null;
  let reportCurrency = 'USD';
  const reportValue = (usd) => Logic.convert(usd, 'USD', reportCurrency, UI.lbpRate());
  const reportMoney = (usd) => UI.money(reportValue(usd), reportCurrency);
  const csvValue = (usd) => reportValue(usd).toFixed(reportCurrency === 'LBP' ? 0 : 2);

  async function monthData(month) {
    const rate = UI.lbpRate();
    const from = month + '-01 00:00:00';
    const nextMonth = (() => {
      const [y, m] = month.split('-').map(Number);
      return (m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0'));
    })();
    const to = nextMonth + '-01 00:00:00';

    const newMembersRows = await api.all('SELECT COUNT(*) c FROM members WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
    const pays = await api.all('SELECT * FROM payments WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
    const sales = await api.all('SELECT * FROM sales WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
    const products = await api.all('SELECT * FROM products');
    const exps = await api.all('SELECT * FROM expenses WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
    const salaries = await api.all('SELECT * FROM salaries WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
    const invPurchases = await api.all('SELECT * FROM inventory_purchases WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
    const subsAll = await api.all(`SELECT s.*, m.first_name, m.last_name, m.phone FROM subscriptions s JOIN members m ON m.id = s.member_id
      WHERE s.id IN (SELECT MAX(id) FROM subscriptions GROUP BY member_id)`);
    const outstandingSubs = await api.all("SELECT * FROM subscriptions WHERE manual_status != 'cancelled'");
    // "renewed" = a subscription created this month that is NOT that member's first-ever subscription row
    const renewedRows = await api.all(`SELECT COUNT(*) c FROM subscriptions s
      WHERE s.created_at >= :a AND s.created_at < :b AND s.id != (SELECT MIN(id) FROM subscriptions WHERE member_id = s.member_id)`, { ':a': from, ':b': to });

    const today = Logic.today();
    let active = 0, expired = 0, late = 0;
    let totalOutstandingUSD = 0;
    subsAll.forEach(s => {
      const st = Logic.subStatus(s, today);
      if (st.key === 'active' || st.key === 'active_owed') active++;
      if (st.key === 'expired' || st.key === 'expires_today') expired++;
      if (st.key === 'expired') late++;
    });
    outstandingSubs.forEach(s => {
      const st = Logic.subStatus(s, today);
      if (st.owed > 0) totalOutstandingUSD += Logic.toUSD(st.owed, s.currency, s.exchange_rate || rate);
    });

    const salesF = Logic.computeSalesFinancials(sales, products, rate);
    const paysUSD = Logic.sumUSD(pays, rate);
    const membersF = Logic.computeMembersFinancials(newMembersRows[0].c, renewedRows[0].c, paysUSD, totalOutstandingUSD);
    const expF = Logic.computeExpenseBreakdown(exps, salaries, invPurchases, rate);

    const totalRevenue = paysUSD + salesF.revenue;
    const totalExpenses = salesF.cogs + expF.operatingUSD;
    const netProfit = totalRevenue - totalExpenses;

    // top products by revenue (for the existing chart)
    const byProduct = {};
    sales.forEach(s => { byProduct[s.product_name] = (byProduct[s.product_name] || 0) + Logic.historicalUSD(s, 'total', 'total_revenue_usd', 'exchange_rate_at_sale', rate); });
    const topProducts = Object.entries(byProduct).map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value).slice(0, 7);

    // daily trend
    const byDay = {};
    sales.forEach(s => { const d = s.created_at.slice(0, 10); byDay[d] = (byDay[d] || 0) + Logic.historicalUSD(s, 'total', 'total_revenue_usd', 'exchange_rate_at_sale', rate); });
    pays.forEach(p => { const d = p.created_at.slice(0, 10); byDay[d] = (byDay[d] || 0) + Logic.historicalUSD(p, 'amount', 'converted_amount_usd', 'exchange_rate_at_payment', rate); });
    const dayTrend = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ label: d.slice(8), value: Math.round(v) }));

    return { active, expired, late, paysUSD, salesF, membersF, expF, totalRevenue, totalExpenses, netProfit, topProducts, dayTrend };
  }

  async function yearData(year) {
    const rate = UI.lbpRate();
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const mm = year + '-' + String(m).padStart(2, '0');
      const from = mm + '-01 00:00:00';
      const to = (m === 12 ? (Number(year) + 1) + '-01' : year + '-' + String(m + 1).padStart(2, '0')) + '-01 00:00:00';
      const pays = await api.all('SELECT * FROM payments WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
      const sales = await api.all('SELECT * FROM sales WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
      const products = await api.all('SELECT * FROM products');
      const exps = await api.all('SELECT amount, currency FROM expenses WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
      const salaries = await api.all('SELECT amount, currency FROM salaries WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
      const invPurchases = await api.all('SELECT * FROM inventory_purchases WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });
      const nm = await api.all('SELECT COUNT(*) c FROM members WHERE created_at >= :a AND created_at < :b', { ':a': from, ':b': to });

      const salesF = Logic.computeSalesFinancials(sales, products, rate);
      const paysUSD = Logic.sumUSD(pays, rate);
      const expF = Logic.computeExpenseBreakdown(exps, salaries, invPurchases, rate);
      const revenue = paysUSD + salesF.revenue;
      const expense = salesF.cogs + expF.operatingUSD;
      months.push({
        m, revenue: Math.round(revenue * 100) / 100, expense: Math.round(expense * 100) / 100,
        net: revenue - expense, newMembers: nm[0].c, salesCount: salesF.count, productsSold: salesF.productsSold,
        subscriptionRevenue: paysUSD, salesRevenue: salesF.revenue, cogs: salesF.cogs,
        operatingExpense: expF.operatingUSD, inventoryPurchases: expF.inventoryUSD, grossProfit: salesF.grossProfit
      });
    }
    const totalRevenue = months.reduce((s, x) => s + x.revenue, 0);
    const totalExpense = months.reduce((s, x) => s + x.expense, 0);
    const totalSalesCount = months.reduce((s, x) => s + x.salesCount, 0);
    const totalGrossProfit = months.reduce((s, x) => s + x.grossProfit, 0);
    const totalCOGS = months.reduce((s, x) => s + x.cogs, 0);
    const totalOperatingExpense = months.reduce((s, x) => s + x.operatingExpense, 0);
    const totalSalesRevenue = months.reduce((s, x) => s + x.salesRevenue, 0);
    const totalProductsSold = months.reduce((s, x) => s + x.productsSold, 0);
    const withData = months.filter(x => x.revenue > 0 || x.expense > 0);
    const best = withData.length ? withData.reduce((a, b) => b.net > a.net ? b : a) : null;
    const worst = withData.length ? withData.reduce((a, b) => b.net < a.net ? b : a) : null;

    // subscription revenue for the year + a CURRENT (not year-scoped) outstanding-balance snapshot
    const yearPays = await api.all('SELECT * FROM payments WHERE created_at >= :a AND created_at < :b',
      { ':a': year + '-01-01 00:00:00', ':b': (Number(year) + 1) + '-01-01 00:00:00' });
    const subscriptionRevenueUSD = Logic.sumUSD(yearPays, rate);
    const today = Logic.today();
    const subsAll = await api.all("SELECT * FROM subscriptions WHERE manual_status != 'cancelled'");
    let totalOutstandingUSD = 0;
    subsAll.forEach(s => {
      const st = Logic.subStatus(s, today);
      if (st.owed > 0 && st.key !== 'cancelled') totalOutstandingUSD += Logic.toUSD(st.owed, s.currency, s.exchange_rate || rate);
    });

    return {
      months, totalRevenue, totalExpense, net: totalRevenue - totalExpense, best, worst,
      totalSalesCount, totalProductsSold, totalSalesRevenue, totalCOGS, totalOperatingExpense,
      totalGrossProfit, subscriptionRevenueUSD, totalOutstandingUSD
    };
  }

  function statRow(items) {
    const g = UI.el('div', { class: 'grid grid-4' });
    g.innerHTML = items.map(([icon, tone, val, lbl]) =>
      `<div class="stat"><div class="stat-icon ${tone}">${UI.icons[icon]}</div><div class="stat-body"><div class="stat-value">${val}</div><div class="stat-label">${lbl}</div></div></div>`).join('');
    return g;
  }

  function sectionTitle(text) {
    return UI.el('div', { class: 'card-title', text, style: 'margin-top:18px;font-size:15px' });
  }

  function kvList(rows) {
    const kv = UI.el('div', { class: 'kv-list' });
    kv.innerHTML = rows.map(([label, val, cls]) => `<div class="kv${cls ? ' ' + cls : ''}"><span class="muted">${label}</span><b>${val}</b></div>`).join('');
    return kv;
  }

  window.PAGES.reports = {
    render: async (page) => {
      if (!selMonth) selMonth = Logic.thisMonth();
      if (!selYear) selYear = Logic.thisYear();

      const toolbar = UI.el('div', { class: 'toolbar no-print' });
      const chips = UI.el('div', { class: 'chip-row' });
      [['month', 'تقرير شهري'], ['year', 'تقرير سنوي']].forEach(([k, lbl]) => {
        chips.appendChild(UI.el('button', { class: 'chip' + (mode === k ? ' active' : ''), text: lbl, onclick: () => { mode = k; refreshPage(); } }));
      });
      toolbar.appendChild(chips);
      const reportCur = UI.currencySelect(reportCurrency);
      reportCur.onchange = () => { reportCurrency = reportCur.value; refreshPage(); };
      toolbar.appendChild(UI.field('عملة التقرير', reportCur));
      if (mode === 'month') {
        const fM = UI.input({ type: 'month', value: selMonth, style: 'width:170px' });
        fM.onchange = () => { selMonth = fM.value || Logic.thisMonth(); refreshPage(); };
        toolbar.appendChild(fM);
      } else {
        const fY = UI.input({ type: 'number', value: selYear, min: 2020, max: 2100, style: 'width:110px' });
        fY.onchange = () => { selYear = fY.value; refreshPage(); };
        toolbar.appendChild(fY);
      }
      toolbar.appendChild(UI.el('div', { class: 'spacer' }));
      toolbar.appendChild(UI.el('button', {
        class: 'btn btn-sm', html: UI.icons.printer + ' تصدير PDF',
        onclick: async () => {
          const res = await api.exportPdf('تقرير-' + (mode === 'month' ? selMonth : selYear) + '.pdf');
          if (res.ok) UI.toast('تم حفظ PDF: ' + res.path);
        }
      }));
      const csvBtn = UI.el('button', { class: 'btn btn-sm', html: UI.icons.file + ' تصدير Excel' });
      toolbar.appendChild(csvBtn);
      page.appendChild(toolbar);

      const ph = UI.el('div', { class: 'report-head' });
      ph.innerHTML = '<img src="../assets/logo.png" alt="Legacy Gym"><div><h2>' + (mode === 'month' ? 'التقرير الشهري — ' + Logic.fmtMonthYear(selMonth) : 'التقرير السنوي — ' + selYear) + '</h2><div class="rh-meta">' + UI.esc(UI.setting('gym_name_ar', '')) + ' — طُبع في ' + Logic.arDateTime(Logic.nowStr()) + '</div></div>';
      page.appendChild(ph);

      if (mode === 'month') {
        const d = await monthData(selMonth);
        csvBtn.onclick = () => UI.exportCsv('التقرير-الشهري-' + selMonth + '.csv',
          ['البند', 'القيمة'],
          [['مشتركون جدد', d.membersF.newMembersCount], ['تجديدات', d.membersF.renewedCount],
          ['إيرادات الاشتراكات ' + reportCurrency, csvValue(d.paysUSD)], ['إيرادات المبيعات ' + reportCurrency, csvValue(d.salesF.revenue)],
          ['تكلفة البضاعة المباعة ' + reportCurrency, csvValue(d.salesF.cogs)], ['الربح الإجمالي (مبيعات) ' + reportCurrency, csvValue(d.salesF.grossProfit)],
          ['رواتب الموظفين ' + reportCurrency, csvValue(d.expF.salariesUSD)], ['إجمالي مصاريف التشغيل ' + reportCurrency, csvValue(d.expF.operatingUSD)], ['شراء مخزون (معلومة إدارية) ' + reportCurrency, csvValue(d.expF.inventoryUSD)],
          ['إجمالي الإيرادات ' + reportCurrency, csvValue(d.totalRevenue)], ['إجمالي المصاريف ' + reportCurrency, csvValue(d.totalExpenses)],
          ['صافي الربح الشهري ' + reportCurrency, csvValue(d.netProfit)], ['إجمالي الرصيد المتبقي على المشتركين ' + reportCurrency, csvValue(d.membersF.totalOutstandingUSD)]]);

        page.appendChild(statRow([
          ['members', 'ember', d.active, 'ناشط حاليًا'],
          ['clock', 'warn', d.expired, 'اشتراك منتهٍ'],
          ['alert', 'danger', d.late, 'متأخر عن الدفع'],
          ['cashbox', d.netProfit >= 0 ? 'ok' : 'danger', reportMoney(d.netProfit), 'صافي الربح الشهري']
        ]));

        // 1. Sales Table
        page.appendChild(sectionTitle('جدول المبيعات'));
        page.appendChild(statRow([
          ['sales', 'ember', d.salesF.count, 'عدد عمليات البيع'],
          ['sales', 'ok', reportMoney(d.salesF.revenue), 'إجمالي الإيرادات'],
          ['expenses', 'danger', reportMoney(d.salesF.cogs), 'تكلفة البضاعة المباعة'],
          ['reports', d.salesF.grossProfit >= 0 ? 'ok' : 'danger', reportMoney(d.salesF.grossProfit), 'الربح الإجمالي']
        ]));
        page.appendChild(UI.el('div', { class: 'muted', style: 'margin-top:8px;font-size:13px', text: 'عدد القطع المباعة: ' + d.salesF.productsSold }));

        const trendCard = UI.el('div', { class: 'card', style: 'margin-top:14px' });
        trendCard.innerHTML = '<div class="card-title">الدخل اليومي خلال الشهر (بالدولار)</div>';
        trendCard.appendChild(Charts.bars(d.dayTrend, { format: v => '$' + v }));
        page.appendChild(trendCard);

        const topCard = UI.el('div', { class: 'card', style: 'margin-top:14px' });
        topCard.innerHTML = '<div class="card-title">أفضل المنتجات مبيعًا (بالدولار)</div>';
        topCard.appendChild(Charts.hbars(d.topProducts, { format: v => '$' + v }));
        page.appendChild(topCard);

        // 2. Members Table
        page.appendChild(sectionTitle('جدول المشتركين'));
        page.appendChild(statRow([
          ['members', 'ember', d.membersF.newMembersCount, 'مشترك جديد'],
          ['refresh', 'info', d.membersF.renewedCount, 'تجديد اشتراك'],
          ['subs', 'ok', reportMoney(d.membersF.subscriptionRevenueUSD), 'إيرادات الاشتراكات'],
          ['alert', d.membersF.totalOutstandingUSD > 0 ? 'danger' : 'ok', reportMoney(d.membersF.totalOutstandingUSD), 'إجمالي الرصيد المتبقي']
        ]));

        // 3. Operating Expenses
        page.appendChild(sectionTitle('مصاريف التشغيل'));
        const expCard = UI.el('div', { class: 'card', style: 'margin-top:8px' });
        expCard.appendChild(kvList([
          ['رواتب الموظفين', reportMoney(d.expF.salariesUSD)],
          ['مصاريف أخرى', reportMoney(d.expF.otherUSD)],
          ['إجمالي مصاريف التشغيل', reportMoney(d.expF.operatingUSD), 'total']
        ]));
        expCard.appendChild(UI.table({
          columns: [
            { label: 'التاريخ', num: true, render: r => Logic.arDate(r.created_at) },
            { label: 'الوقت', num: true, render: r => String(r.created_at).slice(11, 16) },
            { label: 'التصنيف', html: true, render: r => UI.badge(r.category, r.category === 'رواتب' ? 'ember' : r.category === 'شراء مخزون' ? 'info' : 'neutral') },
            { label: 'الوصف', key: 'note' },
            { label: 'المبلغ', num: true, html: true, render: r => '<b style="color:var(--danger)">' + UI.money(r.amount, r.currency) + '</b>' },
            { label: 'أدخل بواسطة', key: 'created_by' }
          ],
          rows: d.expF.operatingRows, empty: 'لا مصاريف تشغيل هذا الشهر'
        }));
        page.appendChild(expCard);

        // 4. Inventory purchases (cash-spending information; not deducted with COGS)
        page.appendChild(sectionTitle('مشتريات المخزون'));
        const invCard = UI.el('div', { class: 'card', style: 'margin-top:8px' });
        invCard.appendChild(kvList([['إجمالي مشتريات المخزون', reportMoney(d.expF.inventoryUSD), 'total']]));
        invCard.appendChild(UI.table({
          columns: [
            { label: 'التاريخ', num: true, render: r => Logic.arDate(r.created_at) },
            { label: 'الوقت', num: true, render: r => String(r.created_at).slice(11, 16) },
            { label: 'المنتج / المورّد', key: 'note' },
            { label: 'الكمية', key: 'qty', num: true },
            { label: 'التكلفة', num: true, render: r => UI.money(r.amount, r.currency) },
            { label: 'أدخل بواسطة', key: 'created_by' }
          ], rows: d.expF.inventoryRows, empty: 'لا مشتريات مخزون هذا الشهر'
        }));
        page.appendChild(invCard);

        // 5. Final Summary
        page.appendChild(sectionTitle('الملخص النهائي'));
        const sumCard = UI.el('div', { class: 'card', style: 'margin-top:8px' });
        sumCard.appendChild(kvList([
          ['إيرادات الاشتراكات', reportMoney(d.paysUSD)],
          ['إيرادات المبيعات', reportMoney(d.salesF.revenue)],
          ['إجمالي الإيرادات', reportMoney(d.totalRevenue), 'total']
        ]));
        sumCard.appendChild(kvList([
          ['تكلفة البضاعة المباعة', reportMoney(d.salesF.cogs)],
          ['رواتب الموظفين', reportMoney(d.expF.salariesUSD)],
          ['مصاريف أخرى', reportMoney(d.expF.otherUSD)],
          ['إجمالي مصاريف التشغيل', reportMoney(d.expF.operatingUSD)],
          ['إجمالي التكلفة المحاسبية', reportMoney(d.totalExpenses), 'total']
        ]));
        sumCard.appendChild(kvList([
          ['صافي الربح الشهري', '<span style="color:' + (d.netProfit >= 0 ? 'var(--ok)' : 'var(--danger)') + '">' + reportMoney(d.netProfit) + '</span>', 'total']
        ]));
        page.appendChild(sumCard);

      } else {
        const d = await yearData(selYear);
        csvBtn.onclick = () => UI.exportCsv('التقرير-السنوي-' + selYear + '.csv',
          ['الشهر', 'الإيرادات ' + reportCurrency, 'المصاريف ' + reportCurrency, 'الصافي ' + reportCurrency, 'مشتركون جدد'],
          d.months.map(m => [Logic.monthName(m.m), csvValue(m.revenue), csvValue(m.expense), csvValue(m.net), m.newMembers]));

        page.appendChild(statRow([
          ['reports', 'ember', reportMoney(d.totalRevenue), 'إيرادات السنة'],
          ['expenses', 'danger', reportMoney(d.totalExpense), 'مصاريف السنة'],
          ['cashbox', d.net >= 0 ? 'ok' : 'danger', reportMoney(d.net), 'صافي الربح السنوي'],
          ['members', 'info', d.months.reduce((s, m) => s + m.newMembers, 0), 'مشترك جديد خلال السنة']
        ]));

        const chartCard = UI.el('div', { class: 'card', style: 'margin-top:14px' });
        chartCard.innerHTML = '<div class="card-title">مقارنة الأشهر — الإيرادات مقابل المصاريف (بالدولار)</div>';
        chartCard.appendChild(Charts.bars(d.months.map(m => ({ label: Logic.monthName(m.m).split(' ')[0], value: m.revenue, value2: m.expense })), { format: v => '$' + v }));
        chartCard.appendChild(UI.el('div', {
          class: 'chart-legend',
          html: '<span><span class="dot" style="background:#1E9BFF"></span>الإيرادات</span><span><span class="dot" style="background:#9AA7B8"></span>المصاريف</span>'
        }));
        page.appendChild(chartCard);

        // Sales (yearly)
        page.appendChild(sectionTitle('المبيعات'));
        page.appendChild(statRow([
          ['sales', 'ember', d.totalProductsSold, 'إجمالي القطع المباعة'],
          ['sales', 'ok', reportMoney(d.totalSalesRevenue), 'إيرادات مبيعات المنتجات'],
          ['expenses', 'danger', reportMoney(d.totalCOGS), 'تكلفة البضاعة المباعة'],
          ['reports', d.totalGrossProfit >= 0 ? 'ok' : 'danger', reportMoney(d.totalGrossProfit), 'الربح الإجمالي'],
        ]));

        // Members (yearly) — no names, totals only
        page.appendChild(sectionTitle('المشتركون'));
        const membersYearRow = UI.el('div', { class: 'grid grid-3' });
        membersYearRow.innerHTML = [
          ['subs', 'ok', reportMoney(d.subscriptionRevenueUSD), 'إجمالي إيرادات الاشتراكات'],
          ['alert', d.totalOutstandingUSD > 0 ? 'danger' : 'ok', reportMoney(d.totalOutstandingUSD), 'الرصيد المتبقي الحالي'],
          ['members', 'ember', d.months.reduce((s, m) => s + m.newMembers, 0), 'مشترك جديد']
        ].map(([icon, tone, val, lbl]) => `<div class="stat"><div class="stat-icon ${tone}">${UI.icons[icon]}</div><div class="stat-body"><div class="stat-value">${val}</div><div class="stat-label">${lbl}</div></div></div>`).join('');
        page.appendChild(membersYearRow);

        const cols = UI.el('div', { class: 'grid grid-2', style: 'margin-top:14px;align-items:start' });
        const growthCard = UI.el('div', { class: 'card' });
        growthCard.innerHTML = '<div class="card-title">نمو المشتركين الجدد شهريًا</div>';
        growthCard.appendChild(Charts.line(d.months.map(m => ({ label: Logic.monthName(m.m).split(' ')[0], value: m.newMembers })), { color: '#7C9BE0' }));
        cols.appendChild(growthCard);

        const bwCard = UI.el('div', { class: 'card' });
        bwCard.innerHTML = '<div class="card-title">أفضل وأضعف شهر</div>';
        const kv = UI.el('div', { class: 'kv-list' });
        kv.innerHTML =
          (d.best ? `<div class="kv"><span class="muted">أفضل شهر</span><b style="color:var(--ok)">${Logic.monthName(d.best.m)} — ${reportMoney(d.best.net)}</b></div>` : '') +
          (d.worst ? `<div class="kv"><span class="muted">أضعف شهر</span><b style="color:var(--danger)">${Logic.monthName(d.worst.m)} — ${reportMoney(d.worst.net)}</b></div>` : '') +
          `<div class="kv"><span class="muted">متوسط صافي الشهر</span><b>${reportMoney(d.net / 12)}</b></div>`;
        bwCard.appendChild(kv);
        cols.appendChild(bwCard);
        page.appendChild(cols);

        // Expenses (yearly)
        page.appendChild(sectionTitle('المصاريف'));
        page.appendChild(UI.table({
          columns: [
            { label: 'الشهر', render: r => Logic.monthName(r.m) },
            { label: 'الإيرادات', num: true, render: r => reportMoney(r.revenue) },
            { label: 'المصاريف', num: true, render: r => reportMoney(r.expense) },
            { label: 'الصافي', num: true, html: true, render: r => '<b style="color:' + (r.net >= 0 ? 'var(--ok)' : 'var(--danger)') + '">' + reportMoney(r.net) + '</b>' }
          ],
          rows: d.months.filter(m => m.revenue || m.expense)
        }));

        // Final Summary (yearly)
        page.appendChild(sectionTitle('الملخص النهائي'));
        const sumCard = UI.el('div', { class: 'card', style: 'margin-top:8px' });
        sumCard.appendChild(kvList([
          ['إجمالي الإيرادات', reportMoney(d.totalRevenue), 'total']
        ]));
        sumCard.appendChild(kvList([
          ['تكلفة البضاعة المباعة', reportMoney(d.totalCOGS)],
          ['إجمالي مصاريف التشغيل', reportMoney(d.totalOperatingExpense)],
          ['إجمالي التكلفة المحاسبية', reportMoney(d.totalExpense), 'total']
        ]));
        sumCard.appendChild(kvList([
          ['صافي الربح السنوي', '<span style="color:' + (d.net >= 0 ? 'var(--ok)' : 'var(--danger)') + '">' + reportMoney(d.net) + '</span>', 'total']
        ]));
        page.appendChild(sumCard);
      }
    }
  };
})();
