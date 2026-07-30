/* المبيعات اليومية — Sales (quick tiles + list) */
(function () {
  window.PAGES = window.PAGES || {};

  function saleDialog(product, onSaved) {
    const fQty = UI.input({ type: 'number', value: 1, min: 1, max: product.stock });
    const fPrice = UI.input({ type: 'number', value: product.price, min: 0, step: '0.01' });
    const fCur = UI.currencySelect(product.currency || 'USD');
    UI.wireCurrencyConvert(fPrice, fCur);
    const picker = UI.memberPicker();
    const fNote = UI.input({ placeholder: 'ملاحظة (اختياري)' });

    const body = UI.el('div');
    body.appendChild(UI.el('div', { class: 'alert info', html: 'المخزون المتوفر: <b>' + product.stock + '</b>' }));
    const r1 = UI.el('div', { class: 'form-row-3' });
    r1.appendChild(UI.field('الكمية', fQty));
    r1.appendChild(UI.field('سعر القطعة (قابل للتعديل)', fPrice));
    r1.appendChild(UI.field('العملة', fCur));
    body.appendChild(r1);
    const r2 = UI.el('div', { class: 'form-row' });
    r2.appendChild(UI.field('المشتري (مشترك أو زبون خارجي)', picker.el));
    r2.appendChild(UI.field('ملاحظة', fNote));
    body.appendChild(r2);
    const totalEl = UI.el('div', { class: 'kv total', style: 'border-top:0;padding-top:4px' });
    const updateTotal = () => {
      const t = (Number(fQty.value) || 0) * (Number(fPrice.value) || 0);
      totalEl.innerHTML = '<span>الإجمالي</span><b>' + UI.money(t, fCur.value) + '</b>';
    };
    fQty.oninput = updateTotal; fPrice.oninput = updateTotal; fCur.onchange = updateTotal;
    updateTotal();
    body.appendChild(totalEl);

    const save = UI.el('button', { class: 'btn btn-primary', text: 'تسجيل البيع' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: 'بيع — ' + product.name, body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      const qty = Number(fQty.value), price = Number(fPrice.value);
      const rate = UI.lbpRate();
      if (!qty || qty < 1) { UI.toast('أدخل كمية صحيحة', 'error'); return; }
      if (qty > product.stock) { UI.toast('الكمية أكبر من المخزون المتوفر (' + product.stock + ')', 'error'); return; }
      if (isNaN(price) || price < 0) { UI.toast('لا يمكن إدخال سعر سلبي', 'error'); return; }
      const buyer = picker.get();
      if (!buyer.ok) { UI.toast('اختر مشتركًا من القائمة أو حدد "زبون خارجي" — لا يمكن ربط البيع باسم غير موجود', 'error'); return; }
      const unitCost = Logic.convert(Number(product.purchase_price) || 0, product.currency || 'USD', fCur.value, rate);
      const revenue = qty * price, totalCost = qty * unitCost;
      await api.run(`INSERT INTO sales(product_id, product_name, category, qty, unit_price, total, currency, unit_purchase_price_at_sale, unit_selling_price_at_sale, total_revenue, total_cost, gross_profit, exchange_rate_at_sale, total_revenue_usd, total_cost_usd, member_id, note, created_at, created_by)
        VALUES(:p,:n,:c,:q,:u,:t,:cur,:uc,:us,:t,:tc,:gp,:r,:ru,:cu,:mid,:note,:d,:by)`, {
        ':p': product.id, ':n': product.name, ':c': product.category, ':q': qty, ':u': price,
        ':t': revenue, ':cur': fCur.value, ':uc': unitCost, ':us': price, ':tc': totalCost, ':gp': revenue - totalCost,
        ':r': rate, ':ru': Logic.toUSD(revenue, fCur.value, rate), ':cu': Logic.toUSD(totalCost, fCur.value, rate),
        ':mid': buyer.memberId,
        ':note': (buyer.memberId ? 'للمشترك #' + buyer.memberId + ' ' + buyer.label + '. ' : '') + fNote.value.trim(),
        ':d': Logic.nowStr(), ':by': UI.username()
      });
      await api.run('UPDATE products SET stock = stock - :q WHERE id = :id', { ':q': qty, ':id': product.id });
      UI.log('عملية بيع', 'sales', product.id, product.name + ' ×' + qty + ' = ' + UI.money(qty * price, fCur.value));
      UI.toast('تم تسجيل البيع — ' + UI.money(qty * price, fCur.value));
      md.close();
      onSaved();
    };
  }

  window.PAGES.sales = {
    render: async (page) => {
      const today = Logic.today();
      const isAdmin = UI.isAdmin();

      // quick tiles — water pinned first (fastest sale)
      const products = await api.all(`SELECT * FROM products WHERE active = 1
        ORDER BY CASE WHEN category = 'مياه' THEN 0 ELSE 1 END, category, name`);

      const tilesCard = UI.el('div', { class: 'card', style: 'margin-bottom:14px' });
      tilesCard.innerHTML = '<div class="card-title">بيع سريع — اضغط على المنتج</div>';
      const grid = UI.el('div', { class: 'quick-grid' });
      products.forEach(p => {
        const tile = UI.el('button', {
          class: 'quick-tile' + (p.category === 'مياه' ? ' water' : '') + (p.stock <= 0 ? ' oos' : ''),
          onclick: () => saleDialog(p, refreshPage)
        });
        tile.innerHTML =
          (p.category === 'مياه' ? '<div style="color:var(--info)">' + UI.icons.water + '</div>' : '') +
          '<div class="qt-name">' + UI.esc(p.name) + '</div>' +
          '<div class="qt-price">' + UI.money(p.price, p.currency) + '</div>' +
          '<div class="qt-stock">' + (p.stock <= 0 ? 'نفد المخزون' : 'متوفر: ' + p.stock) + '</div>';
        grid.appendChild(tile);
      });
      if (!products.length) grid.innerHTML = '<div class="muted">لا توجد منتجات — أضفها من صفحة المنتجات</div>';
      tilesCard.appendChild(grid);
      page.appendChild(tilesCard);

      // today's sales — employees see their own sales only
      const where = isAdmin ? '' : ' AND created_by = :by';
      const params = { ':d': today + ' 00:00:00' };
      if (!isAdmin) params[':by'] = UI.username();
      const sales = await api.all('SELECT * FROM sales WHERE created_at >= :d' + where + ' ORDER BY id DESC', params);
      const totalUSD = Logic.sumUSD(sales, UI.lbpRate(), 'total');

      const listCard = UI.el('div', { class: 'card' });
      const head = UI.el('div', { class: 'card-title' });
      head.innerHTML = (isAdmin ? 'مبيعات اليوم (كل الموظفين)' : 'مبيعاتي اليوم') +
        '<span class="badge ember">الإجمالي: ' + UI.money(totalUSD, 'USD') + '</span>';
      listCard.appendChild(head);
      listCard.appendChild(UI.table({
        columns: [
          { label: 'الوقت', num: true, render: r => r.created_at.slice(11, 16) },
          { label: 'المنتج', key: 'product_name' },
          { label: 'التصنيف', html: true, render: r => UI.badge(r.category, r.category === 'مياه' ? 'info' : 'neutral') },
          { label: 'الكمية', key: 'qty', num: true },
          { label: 'السعر', num: true, render: r => UI.money(r.unit_price, r.currency) },
          { label: 'الإجمالي', num: true, html: true, render: r => '<b>' + UI.money(r.total, r.currency) + '</b>' },
          { label: 'ملاحظة', key: 'note' },
          { label: 'الموظف', key: 'created_by' },
          {
            label: '', cls: 'actions', render: r => UI.actionBtns([
              UI.canEditRow(r.created_at, r.created_by) ? {
                icon: UI.icons.trash, title: 'إلغاء البيع (يعيد الكمية للمخزون)', danger: true, onClick: async () => {
                  const yes = await UI.confirm('إلغاء عملية بيع', 'سيتم حذف البيع وإرجاع الكمية إلى المخزون.', { danger: true });
                  if (!yes) return;
                  await api.run('UPDATE products SET stock = stock + :q WHERE id = :p', { ':q': r.qty, ':p': r.product_id });
                  await api.run('DELETE FROM sales WHERE id = :id', { ':id': r.id });
                  UI.log('إلغاء بيع', 'sales', r.id, r.product_name + ' ×' + r.qty);
                  UI.toast('تم إلغاء البيع');
                  refreshPage();
                }
              } : null
            ])
          }
        ],
        rows: sales,
        empty: 'لا مبيعات اليوم بعد'
      }));
      page.appendChild(listCard);
    }
  };
})();
