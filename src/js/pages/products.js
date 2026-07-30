/* المنتجات والمخزون — Products & inventory */
(function () {
  window.PAGES = window.PAGES || {};

  function productForm(existing, onSaved) {
    const p = existing || {};
    const fName = UI.input({ value: p.name || '', placeholder: 'اسم المنتج' });
    const fCat = UI.select(Logic.PRODUCT_CATS, p.category || 'مياه');
    const fPrice = UI.input({ type: 'number', value: p.price != null ? p.price : '', min: 0, step: '0.01' });
    const fPurchase = UI.input({ type: 'number', value: p.purchase_price != null ? p.purchase_price : '', min: 0, step: '0.01' });
    const fCur = UI.currencySelect(p.currency || 'USD');
    UI.wireCurrencyConvert(fPrice, fCur);
    UI.wireCurrencyConvert(fPurchase, fCur);
    const fStock = UI.input({ type: 'number', value: p.stock != null ? p.stock : 0, min: 0 });
    const fLow = UI.input({ type: 'number', value: p.low_stock != null ? p.low_stock : 5, min: 0 });

    const body = UI.el('div');
    body.appendChild(UI.field('اسم المنتج *', fName));
    const r1 = UI.el('div', { class: 'form-row-3' });
    r1.appendChild(UI.field('التصنيف', fCat));
    r1.appendChild(UI.field('سعر البيع', fPrice));
    r1.appendChild(UI.field('العملة', fCur));
    body.appendChild(r1);
    const r2 = UI.el('div', { class: 'form-row' });
    r2.appendChild(UI.field('سعر الشراء (التكلفة)', fPurchase));
    body.appendChild(r2);
    const profitEl = UI.el('div', { class: 'kv total', style: 'border-top:0;padding-top:4px' });
    const updateProfit = () => {
      const profit = (Number(fPrice.value) || 0) - (Number(fPurchase.value) || 0);
      profitEl.innerHTML = '<span>الربح لكل قطعة</span><b style="color:' + (profit >= 0 ? 'var(--ok)' : 'var(--danger)') + '">' + UI.money(profit, fCur.value) + '</b>';
    };
    fPrice.addEventListener('input', updateProfit);
    fPurchase.addEventListener('input', updateProfit);
    fCur.addEventListener('change', updateProfit);
    updateProfit();
    body.appendChild(profitEl);
    const r3 = UI.el('div', { class: 'form-row' });
    r3.appendChild(UI.field('الكمية في المخزون', fStock));
    r3.appendChild(UI.field('حد التنبيه (مخزون منخفض)', fLow));
    body.appendChild(r3);

    const save = UI.el('button', { class: 'btn btn-primary', text: existing ? 'حفظ' : 'إضافة المنتج' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: existing ? 'تعديل منتج — ' + p.name : 'إضافة منتج جديد', body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      if (!fName.value.trim()) { UI.toast('اسم المنتج مطلوب', 'error'); return; }
      const price = Number(fPrice.value), purchase = Number(fPurchase.value) || 0, stock = Number(fStock.value), low = Number(fLow.value);
      if (isNaN(price) || price < 0 || purchase < 0 || stock < 0 || low < 0) { UI.toast('لا يمكن إدخال قيم سلبية', 'error'); return; }
      if (existing) {
        if (!UI.canEditRow(p.created_at, p.created_by)) { UI.toast(UI.editLockMsg, 'error'); return; }
        await api.run('UPDATE products SET name=:n, category=:c, price=:p, purchase_price=:pp, currency=:cur, stock=:s, low_stock=:l WHERE id=:id',
          { ':n': fName.value.trim(), ':c': fCat.value, ':p': price, ':pp': purchase, ':cur': fCur.value, ':s': stock, ':l': low, ':id': p.id });
        UI.log('تعديل منتج', 'products', p.id,
          'قبل: ' + p.name + ' ' + UI.money(p.price, p.currency) + ' مخزون ' + p.stock +
          ' ← بعد: ' + fName.value.trim() + ' ' + UI.money(price, fCur.value) + ' مخزون ' + stock);
      } else {
        const r = await api.run('INSERT INTO products(name, category, price, purchase_price, currency, stock, low_stock, active, created_at, created_by) VALUES(:n,:c,:p,:pp,:cur,:s,:l,1,:t,:by)',
          { ':n': fName.value.trim(), ':c': fCat.value, ':p': price, ':pp': purchase, ':cur': fCur.value, ':s': stock, ':l': low, ':t': Logic.nowStr(), ':by': UI.username() });
        UI.log('إضافة منتج', 'products', r.lastId, fName.value);
      }
      UI.toast('تم الحفظ');
      md.close();
      onSaved();
    };
  }

  /* Recording an inventory purchase (buying stock) never touches `expenses`
     or the Daily Cashbox — it's saved to `inventory_purchases` only, and
     Monthly/Yearly reports read that table directly (see reports.js). */
  function inventoryPurchaseDialog(p, onSaved) {
    const fQty = UI.input({ type: 'number', value: 10, min: 1 });
    const fCost = UI.input({ type: 'number', value: p.purchase_price || '', min: 0, step: '0.01' });
    const fCur = UI.currencySelect(p.currency || 'USD');
    UI.wireCurrencyConvert(fCost, fCur);
    const fSupplier = UI.input({ placeholder: 'المورّد (اختياري)' });
    const body = UI.el('div');
    body.appendChild(UI.el('div', { class: 'alert info', html: 'المخزون الحالي: <b>' + p.stock + '</b>' }));
    const r1 = UI.el('div', { class: 'form-row-3' });
    r1.appendChild(UI.field('الكمية المشتراة', fQty));
    r1.appendChild(UI.field('سعر الشراء للقطعة', fCost));
    r1.appendChild(UI.field('العملة', fCur));
    body.appendChild(r1);
    body.appendChild(UI.field('المورّد', fSupplier));
    const totalEl = UI.el('div', { class: 'kv total', style: 'border-top:0;padding-top:4px' });
    const updateTotal = () => {
      const t = (Number(fQty.value) || 0) * (Number(fCost.value) || 0);
      totalEl.innerHTML = '<span>إجمالي التكلفة</span><b>' + UI.money(t, fCur.value) + '</b>';
    };
    fQty.addEventListener('input', updateTotal);
    fCost.addEventListener('input', updateTotal);
    fCur.addEventListener('change', updateTotal);
    updateTotal();
    body.appendChild(totalEl);

    const save = UI.el('button', { class: 'btn btn-primary', text: 'تسجيل شراء المخزون' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: 'شراء مخزون — ' + p.name, body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      const q = Number(fQty.value), cost = Number(fCost.value);
      if (!q || q < 1) { UI.toast('أدخل كمية صحيحة', 'error'); return; }
      if (isNaN(cost) || cost < 0) { UI.toast('لا يمكن إدخال سعر سلبي', 'error'); return; }
      const rate = UI.lbpRate();
      await api.run(`INSERT INTO inventory_purchases(product_id, product_name, qty, unit_cost, total_cost, currency, exchange_rate_at_purchase, converted_total_usd, supplier, created_at, created_by)
        VALUES(:p,:n,:q,:c,:t,:cur,:r,:u,:s,:d,:by)`, {
        ':p': p.id, ':n': p.name, ':q': q, ':c': cost, ':t': q * cost, ':cur': fCur.value,
        ':r': rate, ':u': Logic.toUSD(q * cost, fCur.value, rate),
        ':s': fSupplier.value.trim(), ':d': Logic.nowStr(), ':by': UI.username()
      });
      await api.run('UPDATE products SET stock = stock + :q, purchase_price = :c WHERE id = :id', { ':q': q, ':c': cost, ':id': p.id });
      UI.log('شراء مخزون', 'products', p.id, p.name + ' +' + q + ' — ' + UI.money(q * cost, fCur.value));
      UI.toast('تمت إضافة ' + q + ' إلى مخزون ' + p.name);
      md.close();
      onSaved();
    };
  }

  window.PAGES.products = {
    render: async (page) => {
      const products = await api.all('SELECT * FROM products ORDER BY active DESC, category, name');
      const low = products.filter(p => p.active && p.stock <= p.low_stock);

      if (low.length) {
        page.appendChild(UI.el('div', {
          class: 'alert warn',
          html: UI.icons.alert + '<div><b>مخزون منخفض:</b> ' + low.map(p => UI.esc(p.name) + ' (' + p.stock + ')').join('، ') + '</div>'
        }));
      }

      const toolbar = UI.el('div', { class: 'toolbar' });
      toolbar.appendChild(UI.el('div', { class: 'spacer' }));
      const addBtn = UI.el('button', { class: 'btn btn-primary', html: UI.icons.plus + ' منتج جديد' });
      addBtn.onclick = () => productForm(null, refreshPage);
      toolbar.appendChild(addBtn);
      page.appendChild(toolbar);

      page.appendChild(UI.table({
        columns: [
          { label: 'المنتج', key: 'name' },
          { label: 'التصنيف', html: true, render: r => UI.badge(r.category, r.category === 'مياه' ? 'info' : 'neutral') },
          { label: 'سعر الشراء', num: true, render: r => UI.money(r.purchase_price || 0, r.currency) },
          { label: 'سعر البيع', num: true, render: r => UI.money(r.price, r.currency) },
          { label: 'الربح/قطعة', num: true, html: true, render: r => '<b style="color:var(--ok)">' + UI.money((r.price || 0) - (r.purchase_price || 0), r.currency) + '</b>' },
          {
            label: 'المخزون', num: true, html: true, render: r =>
              r.stock <= 0 ? '<b style="color:var(--danger)">نفد (0)</b>' :
                r.stock <= r.low_stock ? '<b style="color:var(--warn)">' + r.stock + '</b>' : String(r.stock)
          },
          { label: 'حد التنبيه', key: 'low_stock', num: true },
          { label: 'الحالة', html: true, render: r => r.active ? UI.badge('مفعّل', 'ok') : UI.badge('معطّل', 'neutral') },
          {
            label: '', cls: 'actions', render: r => UI.actionBtns([
              { icon: UI.icons.plus, title: 'شراء مخزون', onClick: () => inventoryPurchaseDialog(r, refreshPage) },
              { icon: UI.icons.edit, title: 'تعديل', onClick: () => productForm(r, refreshPage) },
              {
                icon: r.active ? UI.icons.pause : UI.icons.check, title: r.active ? 'تعطيل المنتج' : 'تفعيل المنتج', onClick: async () => {
                  if (!UI.canEditRow(r.created_at, r.created_by)) { UI.toast(UI.editLockMsg, 'error'); return; }
                  await api.run('UPDATE products SET active = :a WHERE id = :id', { ':a': r.active ? 0 : 1, ':id': r.id });
                  UI.log(r.active ? 'تعطيل منتج' : 'تفعيل منتج', 'products', r.id, r.name);
                  refreshPage();
                }
              }
            ])
          }
        ],
        rows: products,
        empty: 'لا توجد منتجات — أضف أول منتج'
      }));
    }
  };
})();
