/* لوحة التحكم — Dashboard */
(function () {
  window.PAGES = window.PAGES || {};

  async function getData() {
    const today = Logic.today();
    const rate = UI.lbpRate();
    const isAdmin = UI.isAdmin();

    // latest subscription per member (for status counts)
    const subs = await api.all(`
      SELECT s.*, m.first_name, m.last_name, m.phone FROM subscriptions s
      JOIN members m ON m.id = s.member_id
      WHERE m.archived = 0 AND s.id IN (SELECT MAX(id) FROM subscriptions GROUP BY member_id)`);

    let active = 0, expiresToday = 0, late1 = 0, lateMore = 0, paused = 0, owedList = [], endedList = [];
    subs.forEach(s => {
      const st = Logic.subStatus(s, today);
      if (st.key === 'active' || st.key === 'active_owed') active++;
      if (st.key === 'expires_today') { expiresToday++; endedList.push({ ...s, st }); }
      if (st.key === 'expired' && st.lateDays <= 60) {
        if (st.lateDays === 1) late1++; else lateMore++;
        endedList.push({ ...s, st });
      }
      if (st.key === 'paused') paused++;
      if (st.owed > 0 && st.key !== 'cancelled' && st.key !== 'paused') owedList.push({ ...s, st });
    });
    endedList.sort((a, b) => a.st.lateDays - b.st.lateDays);

    const lowStock = await api.all("SELECT * FROM products WHERE active = 1 AND stock <= low_stock ORDER BY stock ASC");

    let salesUSD = 0, paysUSD = 0, salesCount = 0;
    const trend = [];
    if (isAdmin) {
      const salesToday = await api.all("SELECT * FROM sales WHERE created_at >= :d", { ':d': today + ' 00:00:00' });
      const paysToday = await api.all("SELECT * FROM payments WHERE created_at >= :d", { ':d': today + ' 00:00:00' });
      salesUSD = Logic.sumUSD(salesToday, rate, 'total');
      paysUSD = Logic.sumUSD(paysToday, rate);
      salesCount = salesToday.length;

      // last 14 days income trend (admin only)
      for (let i = 13; i >= 0; i--) {
        const d = Logic.addDays(today, -i);
        const s = await api.all("SELECT total, currency FROM sales WHERE created_at >= :a AND created_at < :b", { ':a': d + ' 00:00:00', ':b': Logic.addDays(d, 1) + ' 00:00:00' });
        const p = await api.all("SELECT amount, currency FROM payments WHERE created_at >= :a AND created_at < :b", { ':a': d + ' 00:00:00', ':b': Logic.addDays(d, 1) + ' 00:00:00' });
        const [, mm, dd] = d.split('-');
        trend.push({ label: dd + '/' + mm, value: Math.round((Logic.sumUSD(s, rate, 'total') + Logic.sumUSD(p, rate)) * 100) / 100 });
      }
    }

    return { active, expiresToday, late1, lateMore, paused, owedList, endedList, salesUSD, paysUSD, salesCount, lowStock, trend };
  }

  function stat(icon, tone, value, label, sub) {
    return `<div class="stat">
      <div class="stat-icon ${tone}">${UI.icons[icon]}</div>
      <div class="stat-body">
        <div class="stat-value">${value}</div>
        <div class="stat-label">${label}</div>
        ${sub ? '<div class="stat-sub">' + sub + '</div>' : ''}
      </div>
    </div>`;
  }

  window.PAGES.dashboard = {
    render: async (page) => {
      const d = await getData();
      const isAdmin = UI.isAdmin();
      const todayIncome = d.paysUSD + d.salesUSD;
      const lastBackup = UI.setting('last_backup', '');

      const wrap = UI.el('div');

      // alerts
      if (d.lowStock.length) {
        wrap.appendChild(UI.el('div', {
          class: 'alert warn',
          html: UI.icons.alert + '<div><b>تنبيه مخزون:</b> ' + d.lowStock.slice(0, 4).map(p => UI.esc(p.name) + ' (' + p.stock + ')').join('، ') + (d.lowStock.length > 4 ? ' و' + (d.lowStock.length - 4) + ' منتجات أخرى' : '') + ' — المخزون منخفض</div>'
        }));
      }
      if (d.expiresToday + d.late1 + d.lateMore > 0) {
        wrap.appendChild(UI.el('div', {
          class: 'alert danger',
          html: UI.icons.clock + '<div><b>اشتراكات تحتاج متابعة:</b> ' + d.expiresToday + ' تنتهي اليوم، ' + d.late1 + ' متأخر يوم واحد، ' + d.lateMore + ' متأخر أكثر من يوم</div>'
        }));
      }

      // subscription-status row (visible for admin AND employee)
      const stats = UI.el('div', { class: 'grid grid-4' });
      stats.innerHTML =
        stat('clock', 'warn', d.expiresToday, 'انتهى اشتراكه اليوم') +
        stat('alert', 'danger', d.late1, 'متأخر يوم واحد') +
        stat('alert', 'danger', d.lateMore, 'متأخر أكثر من يوم') +
        stat('pause', 'info', d.paused, 'متوقف مؤقتًا (Pause)');
      wrap.appendChild(stats);

      const stats2 = UI.el('div', { class: 'grid grid-4', style: 'margin-top:14px' });
      stats2.innerHTML = isAdmin
        ? stat('members', 'ember', d.active, 'مشترك ناشط') +
          stat('sales', 'ok', UI.money(d.salesUSD, 'USD'), 'مبيعات اليوم', d.salesCount + ' عملية بيع') +
          stat('subs', 'ember', UI.money(d.paysUSD, 'USD'), 'دفعات اشتراكات اليوم') +
          stat('cashbox', 'ok', UI.money(todayIncome, 'USD'), 'إجمالي الوارد اليوم', 'اشتراكات + مبيعات اليوم فقط')
        : stat('members', 'ember', d.active, 'مشترك ناشط') +
          stat('products', 'warn', d.lowStock.length, 'منتجات مخزونها منخفض');
      wrap.appendChild(stats2);

      // two-column: expiring list + trend
      const cols = UI.el('div', { class: 'grid', style: 'grid-template-columns: 1.2fr 1fr; margin-top:14px; align-items:start' });

      const listCard = UI.el('div', { class: 'card' });
      listCard.innerHTML = '<div class="card-title">اشتراكات منتهية أو متأخرة <button type="button" class="btn btn-sm btn-ghost" data-go="subscriptions">عرض الكل</button></div>';
      // inline onclick="" is blocked by the page CSP — bind the handler in JS instead
      listCard.querySelector('[data-go]').addEventListener('click', () => navigate('subscriptions'));
      listCard.appendChild(UI.table({
        columns: [
          { label: 'ID', key: 'member_id', num: true },
          { label: 'المشترك', render: r => r.first_name + ' ' + r.last_name },
          { label: 'الهاتف', key: 'phone', num: true },
          { label: 'انتهى في', num: true, render: r => Logic.arDate(r.end_date) },
          { label: 'التأخير', num: true, render: r => r.st.lateDays > 0 ? r.st.lateDays + ' يوم' : 'اليوم' },
          { label: 'الحالة', html: true, render: r => UI.badge(r.st.label, r.st.tone) },
          { label: 'المتبقي', num: true, render: r => r.st.owed > 0 ? UI.money(r.st.owed, r.currency) : '—' }
        ],
        rows: d.endedList.slice(0, 8),
        empty: 'لا توجد اشتراكات منتهية — ممتاز'
      }));
      cols.appendChild(listCard);

      if (isAdmin) {
        const trendCard = UI.el('div', { class: 'card' });
        trendCard.innerHTML = '<div class="card-title">الدخل اليومي — آخر 14 يوم (بالدولار)</div>';
        trendCard.appendChild(Charts.line(d.trend, { format: v => '$' + v }));
        trendCard.appendChild(UI.el('div', {
          class: 'muted', style: 'font-size:12px;margin-top:10px',
          text: lastBackup ? 'آخر نسخة احتياطية: ' + Logic.arDateTime(lastBackup) : 'لم يتم إنشاء نسخة احتياطية بعد'
        }));
        cols.appendChild(trendCard);
      } else {
        cols.style.gridTemplateColumns = '1fr';
      }
      wrap.appendChild(cols);

      // owed list
      if (d.owedList.length) {
        const owedCard = UI.el('div', { class: 'card', style: 'margin-top:14px' });
        owedCard.innerHTML = '<div class="card-title">مشتركون عليهم مبالغ متبقية</div>';
        owedCard.appendChild(UI.table({
          columns: [
            { label: 'المشترك', render: r => r.first_name + ' ' + r.last_name },
            { label: 'الهاتف', key: 'phone', num: true },
            { label: 'قيمة الاشتراك', num: true, render: r => UI.money(r.price, r.currency) },
            { label: 'المدفوع', num: true, render: r => UI.money(r.paid, r.currency) },
            { label: 'المتبقي', num: true, html: true, render: r => '<b style="color:var(--danger)">' + UI.money(r.st.owed, r.currency) + '</b>' }
          ],
          rows: d.owedList.slice(0, 10)
        }));
        wrap.appendChild(owedCard);
      }

      page.appendChild(wrap);
    }
  };
})();
