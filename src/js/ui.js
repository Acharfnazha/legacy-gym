/*
 * Legacy Gym — UI toolkit: DOM helpers, icons, toasts, modals, tables, CSV.
 */
(function () {
  const UI = {};
  window.UI = UI;

  /* ---- session (current user) ---- */
  UI.session = { user: null, settings: {} };
  UI.isAdmin = () => UI.session.user && UI.session.user.role === 'admin';
  UI.username = () => (UI.session.user ? UI.session.user.username : '');
  UI.setting = (k, fb) => (UI.session.settings[k] !== undefined ? UI.session.settings[k] : fb);
  UI.lbpRate = () => Number(UI.setting('lbp_rate', 89000)) || 89000;

  UI.loadSettings = async () => {
    const rows = await api.all('SELECT key, value FROM settings');
    UI.session.settings = {};
    rows.forEach(r => { UI.session.settings[r.key] = r.value; });
  };

  UI.log = (action, entity, entityId, details) => {
    api.run('INSERT INTO activity_log(username, action, entity, entity_id, details, created_at) VALUES(:u,:a,:e,:id,:d,:t)', {
      ':u': UI.username(), ':a': action, ':e': entity || '', ':id': entityId || null,
      ':d': details || '', ':t': Logic.nowStr()
    });
  };

  /* ---- DOM ---- */
  UI.el = (tag, attrs, children) => {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    }
    (children || []).forEach(c => { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  };
  UI.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---- Icons (Phosphor-style light strokes, one consistent set) ---- */
  const P = (paths, vb) => `<svg width="19" height="19" viewBox="${vb || '0 0 24 24'}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  UI.icons = {
    dashboard: P('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    members: P('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    subs: P('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/>'),
    sales: P('<circle cx="9" cy="21" r="1.6"/><circle cx="20" cy="21" r="1.6"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>'),
    products: P('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
    expenses: P('<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
    employees: P('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6"/>'),
    salaries: P('<rect x="2" y="7" width="20" height="12" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>'),
    cashbox: P('<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 11h20"/><circle cx="12" cy="15" r="2"/>'),
    reports: P('<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="0.8"/><rect x="12" y="8" width="3" height="10" rx="0.8"/><rect x="17" y="5" width="3" height="13" rx="0.8"/>'),
    backup: P('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    activity: P('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
    settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    plus: P('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    edit: P('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>'),
    trash: P('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    money: P('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
    refresh: P('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
    pause: P('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'),
    x: P('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    check: P('<polyline points="20 6 9 17 4 12"/>'),
    alert: P('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    file: P('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
    printer: P('<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
    water: P('<path d="M12 2.7s6.5 7.1 6.5 11.8a6.5 6.5 0 0 1-13 0C5.5 9.8 12 2.7 12 2.7z"/>'),
    user: P('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    calendar: P('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    clock: P('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    key: P('<circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/>')
  };

  /* ---- Toast ---- */
  UI.toast = (msg, type) => {
    const root = document.getElementById('toast-root');
    const t = UI.el('div', { class: 'toast ' + (type || 'ok') });
    t.innerHTML = (type === 'error' ? UI.icons.alert : UI.icons.check) + '<span>' + UI.esc(msg) + '</span>';
    root.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 3200);
  };

  /* ---- Modal ---- */
  UI.modal = ({ title, body, footer, wide, onClose }) => {
    const root = document.getElementById('modal-root');
    const backdrop = UI.el('div', { class: 'modal-backdrop' });
    const m = UI.el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title });
    const head = UI.el('div', { class: 'modal-head' });
    head.appendChild(UI.el('h3', { text: title }));
    const closeBtn = UI.el('button', { class: 'icon-btn', 'aria-label': 'إغلاق', html: UI.icons.x, onclick: close });
    head.appendChild(closeBtn);
    const bodyEl = UI.el('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    m.appendChild(head); m.appendChild(bodyEl);
    if (footer) { const f = UI.el('div', { class: 'modal-foot' }); footer.forEach(b => f.appendChild(b)); m.appendChild(f); }
    backdrop.appendChild(m);
    root.appendChild(backdrop);
    function close() { backdrop.remove(); if (onClose) onClose(); }
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
    const escH = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escH); } };
    document.addEventListener('keydown', escH);
    const first = bodyEl.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 60);
    return { close, el: m, body: bodyEl };
  };

  UI.confirm = (title, message, opts) => new Promise(resolve => {
    const o = opts || {};
    const ok = UI.el('button', { class: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), text: o.okText || 'تأكيد' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    // resolve BEFORE close(): close() fires onClose→resolve(false), and a promise
    // keeps only its FIRST value — resolving after close() made every confirm
    // return "cancel" (this was the root cause of the broken logout/delete).
    const md = UI.modal({ title, body: '<p style="color:var(--muted)">' + UI.esc(message) + '</p>', footer: [cancel, ok], onClose: () => resolve(false) });
    ok.onclick = () => { resolve(true); md.close(); };
    cancel.onclick = () => { resolve(false); md.close(); };
  });

  /* Admin password gate for sensitive actions */
  UI.adminGate = () => new Promise(resolve => {
    if (!UI.isAdmin()) { UI.toast('هذه العملية تتطلب حساب المدير', 'error'); resolve(false); return; }
    resolve(true);
  });

  /* ---- Table ---- */
  UI.table = ({ columns, rows, empty, rowAttrs }) => {
    const wrap = UI.el('div', { class: 'table-wrap' });
    if (!rows.length) {
      wrap.appendChild(UI.el('div', { class: 'empty-state', html: UI.icons.file.replace('width="19" height="19"', 'width="42" height="42"') + '<div class="empty-title">' + UI.esc(empty || 'لا توجد بيانات') + '</div><div>ابدأ بإضافة سجل جديد</div>' }));
      return wrap;
    }
    const table = UI.el('table');
    const thead = UI.el('thead');
    const tr = UI.el('tr');
    columns.forEach(c => tr.appendChild(UI.el('th', { text: c.label })));
    thead.appendChild(tr); table.appendChild(thead);
    const tbody = UI.el('tbody');
    rows.forEach(r => {
      const trr = UI.el('tr', rowAttrs ? rowAttrs(r) : null);
      columns.forEach(c => {
        const td = UI.el('td', c.num ? { class: 'num' } : null);
        const v = c.render ? c.render(r) : r[c.key];
        if (v instanceof Node) td.appendChild(v);
        else if (c.html) td.innerHTML = v == null ? '' : v;
        else td.textContent = v == null ? '' : v;
        if (c.cls) td.className += ' ' + c.cls;
        trr.appendChild(td);
      });
      tbody.appendChild(trr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  };

  UI.badge = (label, tone) => `<span class="badge ${tone || 'neutral'}">${UI.esc(label)}</span>`;

  UI.actionBtns = (btns) => {
    const td = UI.el('span');
    btns.forEach(b => {
      if (!b) return;
      td.appendChild(UI.el('button', {
        class: 'icon-btn' + (b.danger ? ' danger' : ''), title: b.title, 'aria-label': b.title,
        html: b.icon, onclick: (e) => { e.stopPropagation(); b.onClick(); }
      }));
    });
    return td;
  };

  /* ---- Field builders ---- */
  UI.field = (label, input) => {
    const f = UI.el('label', { class: 'field' });
    f.appendChild(UI.el('span', { text: label }));
    f.appendChild(input);
    return f;
  };
  UI.input = (attrs) => {
    const el = UI.el('input', attrs);
    if (attrs && (attrs.type === 'date' || attrs.type === 'month')) return UI.wrapNativeDateInput(el, attrs.type);
    return el;
  };

  /* Native <input type="date">/type="month"> on Windows displays its persistent
     value using the HOST MACHINE'S OWN regional "short date" setting (Control
     Panel), NOT Electron's app locale — confirmed empirically: forcing the app
     locale only fixed the digit glyphs (Arabic-Indic -> Western), the day/month
     ORDER still followed this dev machine's en-US Windows setting (M/d/yyyy),
     which we cannot control on a customer's laptop. `color: transparent` alone
     also proved unreliable — some native segments (observed: trailing year
     digits) still painted through on the enabled (non-disabled) field. So the
     persistent displayed text can never be guaranteed DD/MM/YYYY via CSS/locale
     tricks alone on the native control.
     Fix: keep the real native input fully working underneath (.value stays ISO,
     fires input/change normally, still keyboard-focusable) but fully HIDE it
     behind an opaque cover (same background/border as a normal field) and draw
     our own DD/MM/YYYY text + a locale-independent calendar icon on top. Clicking
     the cover calls input.showPicker() to open the native calendar popup.
     Wrapping happens once in UI.input() so every existing call site (.value
     get/set, .onchange =, UI.field(...), appendChild(...)) keeps working
     completely unchanged — the returned wrapper forwards those to the real
     input underneath. */
  UI.wrapNativeDateInput = (input, type) => {
    const style = input.getAttribute('style');
    if (style) input.removeAttribute('style');
    const wrap = UI.el('span', { class: 'date-field-wrap', style: style || '' });
    const cover = UI.el('span', { class: 'date-cover' });
    const overlay = UI.el('span', { class: 'date-overlay' });
    const textEl = UI.el('span', { class: 'date-overlay-text' });
    const iconEl = UI.el('span', { class: 'date-overlay-icon', html: UI.icons.calendar });
    overlay.appendChild(textEl);
    overlay.appendChild(iconEl);
    const render = () => {
      const v = input.value;
      wrap.classList.toggle('is-disabled', !!input.disabled);
      if (!v) { textEl.textContent = ''; overlay.classList.add('placeholder'); return; }
      overlay.classList.remove('placeholder');
      textEl.textContent = type === 'month' ? Logic.fmtMonthYear(v) : Logic.arDate(v);
    };
    input.addEventListener('input', render);
    input.addEventListener('change', render);
    // the native 'value' setter isn't observable via events — intercept it too,
    // so programmatic assignment (e.g. fEnd.value = Logic.subEnd(...)) also
    // refreshes the overlay immediately.
    const nativeDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return nativeDesc.get.call(input); },
      set(v) { nativeDesc.set.call(input, v); render(); }
    });
    cover.addEventListener('click', () => {
      if (input.disabled) return;
      input.focus();
      try { input.showPicker(); } catch (e) { /* unsupported context — focus() already happened */ }
    });
    render();
    wrap.appendChild(input);
    wrap.appendChild(cover);
    wrap.appendChild(overlay);
    ['value', 'disabled', 'onchange', 'oninput'].forEach(prop => {
      Object.defineProperty(wrap, prop, {
        configurable: true, get: () => input[prop],
        set: (v) => { input[prop] = v; if (prop === 'disabled') render(); }
      });
    });
    wrap.addEventListener = (...args) => input.addEventListener(...args);
    wrap.focus = () => input.focus();
    return wrap;
  };
  UI.select = (options, value, attrs) => {
    const s = UI.el('select', attrs);
    options.forEach(o => {
      const opt = UI.el('option', { value: o.value !== undefined ? o.value : o, text: o.label !== undefined ? o.label : o });
      if (String(opt.value) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  };
  UI.currencySelect = (value) => UI.select([
    { value: 'USD', label: 'دولار $' }, { value: 'LBP', label: 'ليرة لبنانية' }
  ], value || 'USD');

  /* Centralized currency service (data-entry side): when a currency selector
     changes, convert the paired amount field's value via Logic.convert instead
     of leaving the typed number as-is — prevents e.g. "3" (meant as USD) from
     being silently saved as "3 LBP" after switching the dropdown to LBP. */
  UI.wireCurrencyConvert = (amountInput, currencySelect) => {
    currencySelect.dataset.prevCurrency = currencySelect.value;
    currencySelect.addEventListener('change', () => {
      const from = currencySelect.dataset.prevCurrency || 'USD';
      const to = currencySelect.value;
      const converted = Logic.convert(amountInput.value, from, to, UI.lbpRate());
      amountInput.value = to === 'LBP' ? Math.round(converted) : Math.round(converted * 100) / 100;
      currencySelect.dataset.prevCurrency = to;
      amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  /* Independent subscription-payment currency editor. The subscription price
     and the entered payment keep their own currencies; comparisons are made in
     USD and the entered amount is never overwritten in storage. */
  UI.paymentEditor = (priceInput, priceCurrency, initialAmount, initialCurrency, rate) => {
    const amount = UI.input({ value: initialAmount == null ? '' : initialAmount, inputmode: 'decimal', placeholder: '0' });
    const currency = UI.currencySelect(initialCurrency || 'USD');
    const saveWithoutPayment = UI.input({ type: 'checkbox' });
    const summary = UI.el('div', { class: 'alert info', style: 'margin-top:10px' });
    let previousCurrency = currency.value;
    const render = () => {
      // "Free membership" mode: no money is paid and nothing is owed. The amount
      // fields are disabled and the summary shows it's free.
      const free = saveWithoutPayment.checked;
      amount.disabled = free;
      currency.disabled = free;
      if (free) {
        summary.innerHTML = '<b>اشتراك مجاني (دخول مجاني)</b> — لا يُدفع أي مبلغ، ولا يترتّب على المشترك أي رصيد متبقٍ، ولا يظهر شيء في الصندوق اليومي.';
        return;
      }
      const sub = Logic.subscriptionSnapshot(Logic.parseAmount(priceInput.value), priceCurrency.value, rate);
      const pay = Logic.currencySnapshot(amount.value, currency.value, rate);
      if (!sub || !pay) { summary.textContent = 'أدخل مبلغًا وسعر صرف صالحين'; return; }
      const remainingUSD = Math.max(0, Logic.roundUSD(sub.usd - pay.usd));
      summary.innerHTML = '<div class="kv-list">' +
        '<div class="kv"><span class="muted">سعر الصرف</span><b>1 USD = ' + UI.money(rate, 'LBP') + '</b></div>' +
        '<div class="kv"><span class="muted">قيمة الاشتراك</span><b>' + UI.money(sub.usd, 'USD') + ' = ' + UI.money(sub.lbp, 'LBP') + '</b></div>' +
        '<div class="kv"><span class="muted">المدفوع</span><b>' + UI.money(pay.enteredAmount, pay.enteredCurrency) + ' = ' + UI.money(pay.usd, 'USD') + '</b></div>' +
        '<div class="kv total"><span>المتبقي</span><b>' + UI.money(remainingUSD, 'USD') + ' = ' + UI.money(Math.round(remainingUSD * rate), 'LBP') + '</b></div>' +
        '</div>';
    };
    saveWithoutPayment.addEventListener('change', render);
    currency.addEventListener('change', () => {
      const oldAmount = Logic.parseAmount(amount.value);
      if (Number.isFinite(oldAmount)) {
        const converted = Logic.convert(oldAmount, previousCurrency, currency.value, rate);
        amount.value = currency.value === 'LBP' ? Math.round(converted) : Math.round(converted * 100) / 100;
        UI.toast('تم تحويل مبلغ الدفعة تلقائيًا حسب سعر الصرف');
      }
      previousCurrency = currency.value;
      render();
    });
    amount.addEventListener('input', render);
    priceInput.addEventListener('input', render);
    priceCurrency.addEventListener('change', render);
    render();
    return {
      amount, currency, saveWithoutPayment, summary, render,
      get: () => ({ subscription: Logic.subscriptionSnapshot(Logic.parseAmount(priceInput.value), priceCurrency.value, rate), payment: Logic.currencySnapshot(amount.value, currency.value, rate) })
    };
  };

  /* ---- CSV export ---- */
  UI.exportCsv = async (filename, headers, rows) => {
    // CSV/formula injection guard: a text cell starting with = + - @ (or tab/CR)
    // would be executed by Excel as a formula (e.g. a member named "=HYPERLINK(...)").
    // Prefix such cells with an apostrophe; real numbers (e.g. -5) are left as-is.
    const q = (v) => {
      let s = String(v == null ? '' : v);
      if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lines = [headers.map(q).join(',')];
    rows.forEach(r => lines.push(r.map(q).join(',')));
    const res = await api.exportCsv(filename, lines.join('\r\n'));
    if (res.ok) UI.toast('تم التصدير: ' + res.path);
    else if (!res.cancelled) UI.toast('فشل التصدير', 'error');
  };

  /* ---- misc ---- */
  UI.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms || 250); }; };
  UI.money = Logic.fmtMoney;
  /* Employee: only own rows, within 2 hours. Admin: always (logged). */
  UI.canEditRow = (createdAt, createdBy) => Logic.canModify(
    createdAt, createdBy,
    UI.session.user ? UI.session.user.role : 'employee',
    UI.username());
  UI.editLockMsg = 'انتهت مهلة تعديل هذه العملية. يرجى مراجعة المدير.';

  /* ---- Member picker (searchable autocomplete for sales) ----
     Matches name / surname / full name / phone / member ID.
     Empty input OR the explicit list item = external (non-member) customer.
     A sale can never be linked to a name that doesn't exist in the system. */
  UI.memberPicker = () => {
    const wrap = UI.el('div', { class: 'member-picker' });
    const input = UI.input({ placeholder: 'اكتب اسم / هاتف / ID المشترك — أو اتركه فارغًا لزبون خارجي' });
    const list = UI.el('div', { class: 'mp-list hidden' });
    let selected = null;   // {memberId, label} when a real member is chosen
    let confirmedExternal = false;

    const choose = (sel) => {
      if (sel) { selected = sel; confirmedExternal = false; input.value = '#' + sel.memberId + ' ' + sel.label; }
      else { selected = null; confirmedExternal = true; input.value = ''; input.placeholder = 'زبون خارجي / بدون مشترك'; }
      list.classList.add('hidden');
    };

    const render = async () => {
      selected = null; confirmedExternal = false;
      const q = input.value.trim();
      list.innerHTML = '';
      const ext = UI.el('div', { class: 'mp-item mp-ext', html: UI.icons.user + '<span>زبون خارجي / بدون مشترك</span>' });
      ext.onmousedown = (e) => { e.preventDefault(); choose(null); };
      list.appendChild(ext);
      if (q.length >= 1) {
        const rows = await api.all(`SELECT id, first_name, last_name, phone FROM members
          WHERE archived = 0 AND (first_name LIKE :q OR last_name LIKE :q
            OR (first_name || ' ' || last_name) LIKE :q OR phone LIKE :q OR id = :idq)
          ORDER BY id DESC LIMIT 8`, { ':q': '%' + q + '%', ':idq': Number(q) || -1 });
        rows.forEach(m => {
          const item = UI.el('div', {
            class: 'mp-item',
            html: '<b>#' + m.id + '</b> <span>' + UI.esc(m.first_name + ' ' + m.last_name) + '</span> <span class="muted" dir="ltr">' + UI.esc(m.phone || '') + '</span>'
          });
          item.onmousedown = (e) => { e.preventDefault(); choose({ memberId: m.id, label: m.first_name + ' ' + m.last_name }); };
          list.appendChild(item);
        });
        if (!rows.length) list.appendChild(UI.el('div', { class: 'mp-empty', text: 'لا يوجد مشترك مطابق — اختر "زبون خارجي" أو صحّح البحث' }));
      }
      list.classList.remove('hidden');
    };
    input.oninput = UI.debounce(render, 180);
    input.onfocus = render;
    input.onblur = () => setTimeout(() => list.classList.add('hidden'), 160);
    wrap.appendChild(input);
    wrap.appendChild(list);

    return {
      el: wrap,
      /* {ok, memberId, label} — ok=false when typed text doesn't resolve to a member */
      get: () => {
        const q = input.value.trim();
        if (selected) return { ok: true, memberId: selected.memberId, label: selected.label };
        if (!q || confirmedExternal) return { ok: true, memberId: null, label: '' };
        return { ok: false };
      }
    };
  };
})();
