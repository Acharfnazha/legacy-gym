/* المخزون — Inventory (value, profit, low/out-of-stock, most sold) */
(function () {
  window.PAGES = window.PAGES || {};

  window.PAGES.inventory = {
    render: async (page) => {
      const rate = UI.lbpRate();
      const products = await api.all('SELECT * FROM products ORDER BY category, name');
      const sales = await api.all('SELECT * FROM sales');

      const rows = products.map(p => {
        const stockValueUSD = Logic.toUSD(p.stock * (p.purchase_price || 0), p.currency, rate);
        const profitPerUnit = (p.price || 0) - (p.purchase_price || 0);
        return { ...p, stockValueUSD, profitPerUnit };
      });
      const totalValueUSD = rows.reduce((s, r) => s + r.stockValueUSD, 0);

      /* Realized profit: current purchase_price applied retroactively to all
         historical sales of that product — an approximation (no lot/FIFO
         costing exists in this system), acceptable for a small shop. */
      const byProduct = {};
      products.forEach(p => { byProduct[p.id] = p; });
      let realizedProfitUSD = 0;
      const qtyByProduct = {};
      sales.forEach(s => {
        qtyByProduct[s.product_id] = (qtyByProduct[s.product_id] || 0) + s.qty;
        const saleUSD = Logic.historicalUSD(s, 'total', 'total_revenue_usd', 'exchange_rate_at_sale', rate);
        const p = byProduct[s.product_id];
        const costUSD = Number(s.exchange_rate_at_sale)
          ? Number(s.total_cost_usd || 0)
          : (p ? Logic.toUSD(s.qty * (p.purchase_price || 0), p.currency, rate) : 0);
        realizedProfitUSD += saleUSD - costUSD;
      });
      const mostSold = Object.entries(qtyByProduct)
        .map(([id, qty]) => ({ label: (byProduct[id] ? byProduct[id].name : '#' + id), value: qty }))
        .sort((a, b) => b.value - a.value).slice(0, 8);

      const lowStock = rows.filter(r => r.active && r.stock > 0 && r.stock <= r.low_stock);
      const outStock = rows.filter(r => r.active && r.stock <= 0);

      const stats = UI.el('div', { class: 'grid grid-4' });
      stats.innerHTML =
        `<div class="stat"><div class="stat-icon ember">${UI.icons.products}</div><div class="stat-body"><div class="stat-value">${UI.money(totalValueUSD, 'USD')}</div><div class="stat-label">قيمة المخزون الإجمالية</div></div></div>` +
        `<div class="stat"><div class="stat-icon ${realizedProfitUSD >= 0 ? 'ok' : 'danger'}">${UI.icons.money}</div><div class="stat-body"><div class="stat-value">${UI.money(realizedProfitUSD, 'USD')}</div><div class="stat-label">الربح المحقق (تقديري)</div></div></div>` +
        `<div class="stat"><div class="stat-icon warn">${UI.icons.alert}</div><div class="stat-body"><div class="stat-value">${lowStock.length}</div><div class="stat-label">مخزون منخفض</div></div></div>` +
        `<div class="stat"><div class="stat-icon danger">${UI.icons.x}</div><div class="stat-body"><div class="stat-value">${outStock.length}</div><div class="stat-label">نفد من المخزون</div></div></div>`;
      page.appendChild(stats);

      if (lowStock.length || outStock.length) {
        const alertsWrap = UI.el('div', { style: 'margin-top:14px;display:flex;flex-direction:column;gap:10px' });
        if (outStock.length) alertsWrap.appendChild(UI.el('div', {
          class: 'alert danger', html: UI.icons.alert + '<div><b>نفد من المخزون:</b> ' + outStock.map(r => UI.esc(r.name)).join('، ') + '</div>'
        }));
        if (lowStock.length) alertsWrap.appendChild(UI.el('div', {
          class: 'alert warn', html: UI.icons.alert + '<div><b>مخزون منخفض:</b> ' + lowStock.map(r => UI.esc(r.name) + ' (' + r.stock + ')').join('، ') + '</div>'
        }));
        page.appendChild(alertsWrap);
      }

      const cols = UI.el('div', { class: 'grid grid-2', style: 'margin-top:14px;align-items:start' });
      const mostSoldCard = UI.el('div', { class: 'card' });
      mostSoldCard.innerHTML = '<div class="card-title">الأكثر مبيعًا (بالكمية)</div>';
      mostSoldCard.appendChild(mostSold.length ? Charts.hbars(mostSold, { format: v => String(v) }) : UI.el('div', { class: 'muted', text: 'لا مبيعات بعد' }));
      cols.appendChild(mostSoldCard);

      const valueCard = UI.el('div', { class: 'card' });
      valueCard.innerHTML = '<div class="card-title">أعلى المنتجات قيمة في المخزون</div>';
      const topValue = rows.filter(r => r.stockValueUSD > 0).sort((a, b) => b.stockValueUSD - a.stockValueUSD).slice(0, 8)
        .map(r => ({ label: r.name, value: Math.round(r.stockValueUSD * 100) / 100 }));
      valueCard.appendChild(topValue.length ? Charts.hbars(topValue, { format: v => '$' + v }) : UI.el('div', { class: 'muted', text: 'لا يوجد مخزون بعد' }));
      cols.appendChild(valueCard);
      page.appendChild(cols);

      const tableCard = UI.el('div', { class: 'card', style: 'margin-top:14px' });
      tableCard.innerHTML = '<div class="card-title">كل المنتجات</div>';
      tableCard.appendChild(UI.table({
        columns: [
          { label: 'المنتج', key: 'name' },
          { label: 'التصنيف', html: true, render: r => UI.badge(r.category, r.category === 'مياه' ? 'info' : 'neutral') },
          {
            label: 'المخزون', num: true, html: true, render: r =>
              r.stock <= 0 ? '<b style="color:var(--danger)">نفد (0)</b>' :
                r.stock <= r.low_stock ? '<b style="color:var(--warn)">' + r.stock + '</b>' : String(r.stock)
          },
          { label: 'سعر الشراء', num: true, render: r => UI.money(r.purchase_price || 0, r.currency) },
          { label: 'سعر البيع', num: true, render: r => UI.money(r.price, r.currency) },
          { label: 'الربح/قطعة', num: true, html: true, render: r => '<b style="color:' + (r.profitPerUnit >= 0 ? 'var(--ok)' : 'var(--danger)') + '">' + UI.money(r.profitPerUnit, r.currency) + '</b>' },
          { label: 'قيمة المخزون', num: true, render: r => UI.money(r.stockValueUSD, 'USD') }
        ],
        rows,
        empty: 'لا توجد منتجات بعد'
      }));
      page.appendChild(tableCard);
    }
  };
})();
