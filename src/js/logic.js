/*
 * Legacy Gym — domain logic shared by UI pages and tests.
 * Pure functions only (no DOM, no IPC) so test/db.test.js can require() this file.
 */
(function (root) {
  const L = {};

  L.pad = (n) => String(n).padStart(2, '0');
  L.nowStr = (d) => {
    d = d || new Date();
    return d.getFullYear() + '-' + L.pad(d.getMonth() + 1) + '-' + L.pad(d.getDate()) + ' ' +
      L.pad(d.getHours()) + ':' + L.pad(d.getMinutes()) + ':' + L.pad(d.getSeconds());
  };
  L.today = (d) => L.nowStr(d).slice(0, 10);
  L.thisMonth = (d) => L.today(d).slice(0, 7);
  L.thisYear = (d) => L.today(d).slice(0, 4);
  L.addDays = (dateStr, days) => {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + Number(days));
    return L.today(d);
  };
  L.daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

  /* Calendar-month arithmetic: same day next month; clamps to the last
     day of the target month when needed (e.g. Jan 31 + 1mo = Feb 28/29). */
  L.addMonths = (dateStr, n) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const months = m - 1 + Number(n);
    const ty = y + Math.floor(months / 12);
    const tm = ((months % 12) + 12) % 12;
    const lastDay = new Date(ty, tm + 1, 0).getDate();
    return L.today(new Date(ty, tm, Math.min(d, lastDay)));
  };

  /* Subscription end date by type — months are CALENDAR months (03/07 → 03/08). */
  L.subEnd = (type, count, startDate) => {
    if (type === 'day') return L.addDays(startDate, 1);
    if (type === 'month') return L.addMonths(startDate, 1);
    if (type === 'months') return L.addMonths(startDate, Math.max(1, Number(count) || 1));
    return L.addDays(startDate, Math.max(1, Number(count) || 1)); // custom days
  };

  /*
   * Effective subscription status.
   * manual_status ('paused' | 'cancelled') always wins.
   * Otherwise derived from dates + payment:
   *   active | expires_today | expired (with lateDays) — plus owed flag.
   */
  L.subStatus = (sub, todayStr) => {
    const t = todayStr || L.today();
    if (sub.manual_status === 'paused') return { key: 'paused', label: 'متوقف', tone: 'info', lateDays: 0 };
    if (sub.manual_status === 'cancelled') return { key: 'cancelled', label: 'ملغى', tone: 'neutral', lateDays: 0 };
    const hasSnapshot = Number(sub.exchange_rate) > 0;
    const priceUSD = hasSnapshot ? Number(sub.price_usd) || 0 : L.toUSD(sub.price, sub.currency, sub.exchange_rate);
    const paidUSD = hasSnapshot ? Number(sub.paid_usd) || 0 : L.toUSD(sub.paid, sub.currency, sub.exchange_rate);
    const owedUSD = Math.max(0, priceUSD - paidUSD);
    const owed = owedUSD <= 0.00001 ? 0 : L.convert(owedUSD, 'USD', sub.currency || 'USD', sub.exchange_rate);
    if (sub.end_date > t) {
      if (owed > 0) return { key: 'active_owed', label: 'ناشط - عليه مبلغ', tone: 'warn', lateDays: 0, owed };
      return { key: 'active', label: 'ناشط', tone: 'ok', lateDays: 0, owed: 0 };
    }
    if (sub.end_date === t) return { key: 'expires_today', label: 'ينتهي اليوم', tone: 'warn', lateDays: 0, owed };
    const late = L.daysBetween(sub.end_date, t);
    return { key: 'expired', label: late === 1 ? 'متأخر يوم واحد' : late === 2 ? 'متأخر يومين' : 'متأخر ' + late + ' أيام', tone: 'danger', lateDays: late, owed };
  };

  L.payStatus = (sub) => {
    const hasSnapshot = Number(sub.exchange_rate) > 0;
    const price = hasSnapshot ? Number(sub.price_usd) || 0 : L.toUSD(sub.price, sub.currency, sub.exchange_rate);
    const paid = hasSnapshot ? Number(sub.paid_usd) || 0 : L.toUSD(sub.paid, sub.currency, sub.exchange_rate);
    if (paid + 0.00001 >= price && price > 0) return { key: 'paid', label: 'مدفوع بالكامل', tone: 'ok' };
    if (paid > 0) return { key: 'partial', label: 'مدفوع جزئيًا', tone: 'warn' };
    return { key: 'unpaid', label: 'غير مدفوع', tone: 'danger' };
  };

  /* ---- Currency ---- */
  L.toUSD = (amount, currency, lbpRate) => {
    const a = Number(amount) || 0;
    if (currency === 'LBP') return a / (Number(lbpRate) || 89000);
    return a;
  };
  L.fmtMoney = (amount, currency) => {
    const a = Number(amount) || 0;
    if (currency === 'LBP') return a.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' ل.ل';
    return '$' + a.toLocaleString('en-US', { minimumFractionDigits: a % 1 ? 2 : 0, maximumFractionDigits: 2 });
  };
  L.fmtUSD = (a) => L.fmtMoney(a, 'USD');

  /* Centralized currency service: convert an amount between USD/LBP at the
     given rate. Used whenever a form's currency selector changes, so the
     typed number always follows the exchange rate instead of being silently
     relabeled (e.g. "3" typed as USD-equivalent must become "270000" when
     the currency is switched to LBP, not stay "3"). */
  L.convert = (amount, fromCurrency, toCurrency, lbpRate) => {
    const a = Number(amount) || 0;
    if (fromCurrency === toCurrency) return a;
    const rate = Number(lbpRate) || 89000;
    return fromCurrency === 'USD' ? a * rate : a / rate;
  };
  L.parseAmount = (value) => Number(String(value == null ? '' : value).replace(/[,\s]/g, ''));
  L.roundUSD = (value) => Math.round((Number(value) || 0) * 1000000) / 1000000;
  L.currencySnapshot = (amount, currency, rate) => {
    const entered = L.parseAmount(amount);
    const validRate = Number(rate);
    if (!Number.isFinite(entered) || entered < 0 || !Number.isFinite(validRate) || validRate <= 0) return null;
    const usd = L.roundUSD(currency === 'LBP' ? entered / validRate : entered);
    return { enteredAmount: entered, enteredCurrency: currency, rate: validRate, usd, lbp: Math.round(usd * validRate) };
  };
  L.subscriptionSnapshot = (price, currency, rate) => {
    const snap = L.currencySnapshot(price, currency, rate);
    return snap && { price: snap.enteredAmount, currency, rate: snap.rate, usd: snap.usd, lbp: snap.lbp };
  };
  L.historicalUSD = (row, amountKey, convertedKey, rateKey, fallbackRate) => {
    const converted = Number(row && row[convertedKey]);
    if (Number.isFinite(converted) && (converted !== 0 || Number(row && row[amountKey]) === 0)) return converted;
    return L.toUSD(row && row[amountKey], row && row.currency, Number(row && row[rateKey]) || fallbackRate);
  };

  /* ---- Edit-permission rules ----
     Employee: may modify/delete ONLY rows they created themselves,
               and only within EDIT_WINDOW_HOURS (2h) of creation.
     Admin:    always allowed (every admin edit is written to the activity log). */
  L.EDIT_WINDOW_HOURS = 2;
  L.canModify = (createdAt, createdBy, role, username, nowMs) => {
    if (role === 'admin') return true;
    if (createdBy && username && createdBy !== username) return false;
    const created = new Date(String(createdAt).replace(' ', 'T')).getTime();
    if (isNaN(created)) return false;
    return ((nowMs || Date.now()) - created) < L.EDIT_WINDOW_HOURS * 3600 * 1000;
  };

  /* 24-hour window (kept for: member hard-delete window, flagging payments
     recorded against old subscriptions for admin review). */
  L.canEdit = (createdAt, role, nowMs) => {
    if (role === 'admin') return true;
    const created = new Date(String(createdAt).replace(' ', 'T')).getTime();
    if (isNaN(created)) return false;
    return ((nowMs || Date.now()) - created) < 24 * 3600 * 1000;
  };

  /* ---- Duplicate-member matching ----
     "Identical information" = same full name AND same phone (or both have no phone).
     Same name alone with a different/missing phone is only a soft match (two real
     people can share a common name) — the caller decides whether to warn or block. */
  L.normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  L.memberMatch = (a, b) => {
    const nameMatch = L.normName(a.first_name) === L.normName(b.first_name) &&
      L.normName(a.last_name) === L.normName(b.last_name);
    if (!nameMatch) return { nameMatch: false, hardMatch: false };
    const ap = String(a.phone || '').trim(), bp = String(b.phone || '').trim();
    const hardMatch = ap ? ap === bp : !bp;
    return { nameMatch: true, hardMatch };
  };

  /* ---- Aggregation helpers (used by cashbox/reports + tests) ---- */
  L.sumUSD = (rows, lbpRate, amountKey) => {
    const k = amountKey || 'amount';
    return rows.reduce((s, r) => {
      if (k === 'amount' && r.converted_amount_usd != null && Number(r.exchange_rate_at_payment || r.exchange_rate_at_expense)) return s + Number(r.converted_amount_usd || 0);
      if (k === 'total' && r.total_revenue_usd != null && Number(r.exchange_rate_at_sale)) return s + Number(r.total_revenue_usd || 0);
      if (k === 'total_cost' && r.converted_total_usd != null && Number(r.exchange_rate_at_purchase)) return s + Number(r.converted_total_usd || 0);
      return s + L.toUSD(r[k], r.currency, lbpRate);
    }, 0);
  };

  /* ---- Report calculations (pure — used by reports.js AND tests) ----
     COGS/realized-profit use each product's CURRENT purchase_price applied
     retroactively to historical sales — an approximation (no lot/FIFO costing
     exists in this system), acceptable for a small shop. */
  L.computeSalesFinancials = (sales, products, lbpRate) => {
    const byId = {};
    products.forEach(p => { byId[p.id] = p; });
    const revenue = sales.reduce((sum, s) => sum + L.historicalUSD(s, 'total', 'total_revenue_usd', 'exchange_rate_at_sale', lbpRate), 0);
    let cogs = 0, productsSold = 0;
    sales.forEach(s => {
      productsSold += Number(s.qty) || 0;
      const snapCost = Number(s.total_cost_usd);
      if (Number.isFinite(snapCost) && (snapCost !== 0 || Number(s.total_cost) === 0)) cogs += snapCost;
      else {
        const p = byId[s.product_id];
        if (p) cogs += L.toUSD((Number(s.qty) || 0) * (Number(p.purchase_price) || 0), p.currency, lbpRate);
      }
    });
    return { count: sales.length, revenue, cogs, grossProfit: revenue - cogs, productsSold };
  };

  L.computeMembersFinancials = (newMembersCount, renewedCount, subscriptionRevenueUSD, totalOutstandingUSD) => ({
    newMembersCount, renewedCount, subscriptionRevenueUSD, totalOutstandingUSD
  });

  /* Merges salaries + inventory purchases + other expenses into one dated,
     categorized list (for the per-row Expenses Table) plus category totals. */
  L.computeExpenseBreakdown = (otherExpenses, salaries, invPurchases, lbpRate) => {
    const salariesUSD = salaries.reduce((s, r) => s + L.historicalUSD(r, 'amount', 'converted_amount_usd', 'exchange_rate_at_payment', lbpRate), 0);
    const inventoryUSD = invPurchases.reduce((s, r) => s + L.historicalUSD(r, 'total_cost', 'converted_total_usd', 'exchange_rate_at_purchase', lbpRate), 0);
    const otherUSD = otherExpenses.reduce((s, r) => s + L.historicalUSD(r, 'amount', 'converted_amount_usd', 'exchange_rate_at_expense', lbpRate), 0);
    const operatingRows = [
      ...salaries.map(s => ({ created_at: s.created_at, amount: s.amount, currency: s.currency, category: 'رواتب', note: s.note || '', created_by: s.created_by || '' })),
      ...otherExpenses.map(e => ({ created_at: e.created_at, amount: e.amount, currency: e.currency, category: e.category, note: e.note || '', created_by: e.created_by || '' }))
    ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const inventoryRows = invPurchases.map(p => ({ created_at: p.created_at, amount: p.total_cost, currency: p.currency, category: 'شراء مخزون', note: p.product_name + (p.supplier ? ' — ' + p.supplier : ''), created_by: p.created_by || '', qty: p.qty }))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const rows = [...operatingRows, ...inventoryRows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return { salariesUSD, inventoryUSD, otherUSD, operatingUSD: salariesUSD + otherUSD, totalUSD: salariesUSD + inventoryUSD + otherUSD, operatingRows, inventoryRows, rows };
  };

  /* ---- Display formatting: DD/MM/YYYY everywhere, never MM/DD/YYYY ----
     Internal storage/arithmetic stays ISO (YYYY-MM-DD[ HH:MM:SS]) — Logic.today(),
     addDays(), addMonths(), subEnd() etc. are UNCHANGED and must stay ISO since SQL
     date-range queries and <input type="date"> values depend on lexicographic order.
     These functions are the single place that converts ISO -> the user-facing format. */
  L.arDate = (iso) => {
    if (!iso) return '';
    const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  };
  L.arDateTime = (iso) => {
    if (!iso) return '';
    const date = L.arDate(iso);
    if (!date) return '';
    const time = String(iso).slice(11, 16);
    return time ? date + ' ' + time : date;
  };

  const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  L.DAYS_AR = DAYS_AR;
  L.dayName = (dateStr) => DAYS_AR[new Date((dateStr || L.today()) + 'T00:00:00').getDay()];
  /* "الاثنين 06/07/2026" — day name + DD/MM/YYYY, for headers/topbar/print. */
  L.fmtDayDate = (dateStr) => {
    const ds = dateStr || L.today();
    return L.dayName(ds) + ' ' + L.arDate(ds);
  };

  const MONTHS_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  L.monthName = (m) => MONTHS_AR[(Number(m) - 1 + 12) % 12];
  L.MONTHS_AR = MONTHS_AR;
  /* "تموز 2026" — for month-only values (YYYY-MM), e.g. salaries.month. */
  L.fmtMonthYear = (ym) => {
    if (!ym) return '';
    const [y, m] = String(ym).split('-');
    return (y && m) ? L.monthName(Number(m)) + ' ' + y : '';
  };

  L.SUB_TYPES = [
    { key: 'day', label: 'يوم واحد' },
    { key: 'month', label: 'شهر واحد' },
    { key: 'months', label: 'عدة أشهر' },
    { key: 'custom', label: 'أيام مخصصة' }
  ];
  L.EXPENSE_CATS = ['إيجار', 'كهرباء', 'إنترنت', 'اشتراك Wi-Fi', 'ماء', 'مواد تنظيف', 'تصليح مكيفات', 'صيانة معدات', 'إصلاحات', 'عطور', 'رواتب', 'مصاريف إدارية', 'مصاريف أخرى'];
  L.PRODUCT_CATS = ['مياه', 'مشروبات غازية', 'Protein Bar', 'مشروبات طاقة', 'فيتامينات', 'مكملات غذائية', 'منتجات أخرى'];
  L.JOBS = ['مسؤول استقبال', 'مدرب', 'مدربة', 'تنظيف', 'محاسبة', 'غير ذلك'];

  if (typeof module !== 'undefined' && module.exports) module.exports = L;
  else root.Logic = L;
})(typeof window !== 'undefined' ? window : globalThis);
