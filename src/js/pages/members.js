/* المشتركين — Members */
(function () {
  window.PAGES = window.PAGES || {};

  let filter = { q: '', status: 'all' };

  async function fetchMembers() {
    const rows = await api.all(`
      SELECT m.*, s.id AS sub_id, s.start_date, s.end_date, s.price, s.paid, s.currency, s.exchange_rate, s.price_usd, s.price_lbp, s.paid_usd, s.manual_status
      FROM members m
      LEFT JOIN subscriptions s ON s.id = (SELECT MAX(id) FROM subscriptions WHERE member_id = m.id)
      ORDER BY m.id DESC`);
    const today = Logic.today();
    return rows.map(r => {
      const st = r.archived
        ? { key: 'archived', label: 'ملغى / مؤرشف', tone: 'neutral', owed: 0 }
        : r.sub_id ? Logic.subStatus(r, today) : { key: 'none', label: 'بدون اشتراك', tone: 'neutral', owed: 0 };
      return { ...r, st };
    });
  }

  function applyFilter(rows) {
    let out = rows;
    if (filter.q) {
      const q = filter.q.trim();
      out = out.filter(r =>
        (r.first_name + ' ' + r.last_name).includes(q) ||
        String(r.id) === q ||
        (r.phone || '').includes(q));
    }
    if (filter.status === 'archived') return out.filter(r => r.archived);
    out = out.filter(r => !r.archived); // archived members hidden from all other views
    if (filter.status !== 'all') {
      out = out.filter(r => {
        if (filter.status === 'active') return r.st.key === 'active' || r.st.key === 'active_owed';
        if (filter.status === 'expired') return r.st.key === 'expired' || r.st.key === 'expires_today';
        if (filter.status === 'owed') return r.st.owed > 0;
        if (filter.status === 'paused') return r.st.key === 'paused';
        if (filter.status === 'none') return r.st.key === 'none' || r.st.key === 'cancelled';
        return true;
      });
    }
    return out;
  }

  /* -------- Duplicate-member guard --------
     "Identical information" = same full name AND same phone (or both have no phone).
     Same name alone with a different/missing phone on either side is only a soft warning
     (two different real people can share a common name). */
  async function findDuplicateMember(firstName, lastName, phone) {
    if (!String(firstName || '').trim()) return null;
    const candidate = { first_name: firstName, last_name: lastName, phone };
    const rows = await api.all('SELECT * FROM members');
    const nameMatches = rows.filter(r => Logic.memberMatch(candidate, r).nameMatch);
    if (!nameMatches.length) return null;
    const hard = nameMatches.find(r => Logic.memberMatch(candidate, r).hardMatch);
    return { hard: hard || null, soft: nameMatches[0] };
  }

  function showDuplicateChoice(existingMember, onSaved) {
    const name = existingMember.first_name + ' ' + (existingMember.last_name || '');
    const body = UI.el('div');
    body.appendChild(UI.el('div', {
      class: 'alert danger',
      html: UI.icons.alert + '<div>يوجد مشترك بنفس الاسم ورقم الهاتف بالفعل: <b>' + UI.esc(name) + '</b> (#' + existingMember.id + '). لا يمكن إنشاء مشترك مكرر.</div>'
    }));
    const openBtn = UI.el('button', { class: 'btn btn-primary', text: 'فتح بيانات المشترك' });
    const renewBtn = UI.el('button', { class: 'btn', text: 'تجديد الاشتراك' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: 'هذا المشترك موجود بالفعل', body, footer: [cancel, renewBtn, openBtn] });
    cancel.onclick = () => md.close();
    openBtn.onclick = () => { md.close(); showProfile(existingMember.id, onSaved); };
    renewBtn.onclick = () => { md.close(); window.SubActions.renewDialog(existingMember, onSaved); };
  }

  /* -------- Add / edit member (+ optional first subscription) -------- */
  function memberForm(existing, onSaved) {
    const m = existing || {};
    const fFirst = UI.input({ value: m.first_name || '', required: '', placeholder: 'الاسم' });
    const fLast = UI.input({ value: m.last_name || '', placeholder: 'الشهرة / اسم العائلة' });
    const fPhone = UI.input({ value: m.phone || '', placeholder: '03 123456', dir: 'ltr' });
    const fAge = UI.input({ type: 'number', value: m.age || '', min: 8, max: 90, placeholder: 'اختياري' });
    const fGender = UI.select([{ value: '', label: '—' }, 'ذكر', 'أنثى'], m.gender || '');
    // Notes are managed from the profile's dedicated "الملاحظات" card (member_notes
    // table) — this quick textarea only exists at creation time for convenience.
    const fNotes = existing ? null : UI.el('textarea', { placeholder: 'اختياري' });

    const body = UI.el('div');
    const row1 = UI.el('div', { class: 'form-row' });
    row1.appendChild(UI.field('الاسم *', fFirst));
    row1.appendChild(UI.field('الشهرة', fLast));
    body.appendChild(row1);
    const row2 = UI.el('div', { class: 'form-row-3' });
    row2.appendChild(UI.field('رقم الهاتف', fPhone));
    row2.appendChild(UI.field('العمر', fAge));
    row2.appendChild(UI.field('الجنس', fGender));
    body.appendChild(row2);
    if (fNotes) body.appendChild(UI.field('أول ملاحظة', fNotes));

    // subscription section only when creating
    let subInputs = null;
    if (!existing) {
      const rate = UI.lbpRate();
      body.appendChild(UI.el('div', { class: 'nav-sep', text: 'الاشتراك الأول (اختياري)', style: 'margin:10px 0 8px' }));
      const fType = UI.select(Logic.SUB_TYPES.map(t => ({ value: t.key, label: t.label })), 'month');
      const fCount = UI.input({ type: 'number', value: 1, min: 1 });
      const fStart = UI.input({ type: 'date', value: Logic.today() });
      const fPrice = UI.input({ type: 'number', value: UI.setting('monthly_price', 30), min: 0, step: '0.01' });
      const fCur = UI.currencySelect('USD');
      UI.wireCurrencyConvert(fPrice, fCur);
      const payment = UI.paymentEditor(fPrice, fCur, UI.setting('monthly_price', 30), 'USD', rate);
      const fEnd = UI.input({ type: 'date', disabled: '' });

      const countField = UI.field('عدد الأشهر / الأيام', fCount);
      countField.style.display = 'none';
      const updateEnd = () => {
        if (fStart.value) fEnd.value = Logic.subEnd(fType.value, fCount.value, fStart.value);
        countField.style.display = (fType.value === 'months' || fType.value === 'custom') ? '' : 'none';
        let baseUSD = Number(UI.setting('monthly_price', 30));
        if (fType.value === 'day') baseUSD = Number(UI.setting('day_price', 3));
        else if (fType.value === 'months') baseUSD *= Math.max(1, Number(fCount.value) || 1);
        fPrice.value = Logic.convert(baseUSD, 'USD', fCur.value, rate);
        payment.amount.value = Logic.convert(baseUSD, 'USD', payment.currency.value, rate);
        payment.render();
      };
      fType.onchange = updateEnd; fCount.oninput = updateEnd; fStart.onchange = updateEnd;
      updateEnd();

      const r3 = UI.el('div', { class: 'form-row-3' });
      r3.appendChild(UI.field('نوع الاشتراك', fType));
      r3.appendChild(countField);
      r3.appendChild(UI.field('تاريخ البداية', fStart));
      body.appendChild(r3);
      const r4 = UI.el('div', { class: 'form-row-3' });
      r4.appendChild(UI.field('تاريخ النهاية (تلقائي)', fEnd));
      r4.appendChild(UI.field('قيمة الاشتراك', fPrice));
      r4.appendChild(UI.field('العملة', fCur));
      body.appendChild(r4);
      const r5 = UI.el('div', { class: 'form-row' });
      r5.appendChild(UI.field('المبلغ المدفوع الآن', payment.amount));
      r5.appendChild(UI.field('عملة الدفع', payment.currency));
      body.appendChild(r5);
      body.appendChild(UI.field('اشتراك مجاني (دخول مجاني — لا يُدفع شيء)', payment.saveWithoutPayment));
      body.appendChild(payment.summary);
      subInputs = { fType, fCount, fStart, fEnd, fPrice, fCur, payment, rate };
    }

    const save = UI.el('button', { class: 'btn btn-primary', text: existing ? 'حفظ التعديلات' : 'إضافة المشترك' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: existing ? 'تعديل مشترك #' + m.id : 'إضافة مشترك جديد', body, footer: [cancel, save], wide: !existing });
    cancel.onclick = () => md.close();

    save.onclick = async () => {
      if (!fFirst.value.trim()) { UI.toast('الاسم مطلوب', 'error'); fFirst.focus(); return; }
      if (fAge.value && (Number(fAge.value) < 8 || Number(fAge.value) > 90)) { UI.toast('العمر غير منطقي', 'error'); return; }
      if (existing) {
        if (!UI.canEditRow(m.created_at, m.created_by)) { UI.toast(UI.editLockMsg, 'error'); return; }
        await api.run('UPDATE members SET first_name=:f, last_name=:l, phone=:p, age=:a, gender=:g WHERE id=:id',
          { ':f': fFirst.value.trim(), ':l': fLast.value.trim(), ':p': fPhone.value.trim(), ':a': fAge.value || null, ':g': fGender.value, ':id': m.id });
        UI.log('تعديل مشترك', 'members', m.id,
          'قبل: ' + m.first_name + ' ' + m.last_name + ' / ' + (m.phone || '—') +
          ' ← بعد: ' + fFirst.value.trim() + ' ' + fLast.value.trim() + ' / ' + (fPhone.value.trim() || '—'));
        UI.toast('تم حفظ التعديلات');
      } else {
        const dup = await findDuplicateMember(fFirst.value, fLast.value, fPhone.value);
        if (dup && dup.hard) {
          md.close();
          showDuplicateChoice(dup.hard, onSaved);
          return;
        }
        if (dup && dup.soft) {
          const proceed = await UI.confirm('يوجد مشترك بنفس الاسم',
            'يوجد مشترك بنفس الاسم بالفعل. هل تريد المتابعة وإضافة مشترك جديد بنفس الاسم؟');
          if (!proceed) return;
        }
        const r = await api.run('INSERT INTO members(first_name, last_name, phone, age, gender, created_at, created_by) VALUES(:f,:l,:p,:a,:g,:t,:by)',
          { ':f': fFirst.value.trim(), ':l': fLast.value.trim(), ':p': fPhone.value.trim(), ':a': fAge.value || null, ':g': fGender.value, ':t': Logic.nowStr(), ':by': UI.username() });
        const memberId = r.lastId;
        UI.log('إضافة مشترك', 'members', memberId, fFirst.value + ' ' + fLast.value);
        if (fNotes && fNotes.value.trim()) {
          await api.run('INSERT INTO member_notes(member_id, text, created_at, created_by) VALUES(:m,:t,:d,:by)',
            { ':m': memberId, ':t': fNotes.value.trim(), ':d': Logic.nowStr(), ':by': UI.username() });
        }
        if (subInputs && Number(subInputs.fPrice.value) >= 0 && subInputs.fStart.value) {
          const si = subInputs;
          const free = si.payment.saveWithoutPayment.checked;
          const snapshots = si.payment.get();
          const subSnap = snapshots.subscription, paySnap = snapshots.payment;
          if (!subSnap) { UI.toast('أدخل سعر اشتراك وسعر صرف صالحين', 'error'); return; }
          // Free membership: price 0, paid 0, no payment record, nothing in cashbox.
          if (!free) {
            if (!paySnap || subSnap.price < 0 || paySnap.enteredAmount < 0) { UI.toast('أدخل مبالغ وسعر صرف صالحين', 'error'); return; }
            if (paySnap.enteredAmount === 0) { UI.toast('أدخل دفعة أو فعّل "اشتراك مجاني"', 'error'); return; }
            if (paySnap.usd > subSnap.usd + 0.00001) { UI.toast('المبلغ المدفوع أكبر من قيمة الاشتراك', 'error'); return; }
          }
          const priceCur = free ? 0 : subSnap.price;
          const priceUSD = free ? 0 : subSnap.usd;
          const priceLBP = free ? 0 : subSnap.lbp;
          const paidUSD = free ? 0 : paySnap.usd;
          const paidInSubCurrency = free ? 0 : Logic.convert(paySnap.usd, 'USD', si.fCur.value, si.rate);
          const endDate = Logic.subEnd(si.fType.value, si.fCount.value, si.fStart.value);
          const sub = await api.run(`INSERT INTO subscriptions(member_id, type, duration_days, start_date, end_date, price, paid, currency, exchange_rate, price_usd, price_lbp, paid_usd, created_at, created_by)
            VALUES(:m,:ty,:d,:s,:e,:p,:pd,:c,:r,:pu,:pl,:pdu,:t,:by)`, {
            ':m': memberId, ':ty': si.fType.value, ':d': Logic.daysBetween(si.fStart.value, endDate), ':s': si.fStart.value,
            ':e': endDate, ':p': priceCur, ':pd': paidInSubCurrency, ':c': si.fCur.value,
            ':r': si.rate, ':pu': priceUSD, ':pl': priceLBP, ':pdu': paidUSD,
            ':t': Logic.nowStr(), ':by': UI.username()
          });
          if (!free && paySnap.enteredAmount > 0) {
            const now = Logic.nowStr();
            await api.run(`INSERT INTO payments(subscription_id, member_id, amount, currency, entered_amount, entered_currency, exchange_rate_at_payment, converted_amount_usd, converted_amount_lbp, payment_date, payment_time, note, created_at, created_by)
              VALUES(:s,:m,:a,:c,:a,:c,:r,:u,:l,:d,:tm,:n,:t,:by)`,
              { ':s': sub.lastId, ':m': memberId, ':a': paySnap.enteredAmount, ':c': paySnap.enteredCurrency, ':r': paySnap.rate, ':u': paySnap.usd, ':l': paySnap.lbp, ':d': now.slice(0, 10), ':tm': now.slice(11), ':n': 'دفعة اشتراك جديد', ':t': now, ':by': UI.username() });
          }
          UI.log(free ? 'اشتراك مجاني' : 'اشتراك جديد', 'subscriptions', sub.lastId, 'مشترك #' + memberId + (free ? ' — دخول مجاني' : ''));
        }
        UI.toast('تمت إضافة المشترك بنجاح');
      }
      md.close();
      onSaved();
    };
  }

  /* -------- Member profile -------- */
  async function showProfile(id, onChange) {
    const m = (await api.all('SELECT * FROM members WHERE id = :id', { ':id': id }))[0];
    if (!m) return;
    const subs = await api.all('SELECT * FROM subscriptions WHERE member_id = :id ORDER BY id DESC', { ':id': id });
    const pays = await api.all('SELECT * FROM payments WHERE member_id = :id ORDER BY id DESC LIMIT 20', { ':id': id });
    const pauses = await api.all('SELECT * FROM pauses WHERE member_id = :id ORDER BY id DESC LIMIT 15', { ':id': id });
    const today = Logic.today();

    // Outstanding balance: current subscription's owed amount, kept SEPARATE
    // from whatever is still owed on older (already-superseded) subscriptions.
    // subs is ORDER BY id DESC, so subs[0] is the current/latest subscription.
    // Different subscriptions can be in different currencies, so the combined
    // totals are normalized to USD (same convention as dashboard/reports);
    // only the single current-subscription figure is shown in its own currency.
    const rate = UI.lbpRate();
    const owedRows = subs.filter(s => s.manual_status !== 'cancelled' && Logic.subStatus(s, today).owed > 0);
    const totalOwedUSD = owedRows.reduce((s, r) => s + Logic.toUSD(Logic.subStatus(r, today).owed, r.currency, r.exchange_rate || rate), 0);
    const current = subs[0] || null;
    const currentOwed = current ? Logic.subStatus(current, today).owed : 0;
    const currentOwedUSD = current ? Logic.toUSD(currentOwed, current.currency, current.exchange_rate || rate) : 0;
    const previousOwedUSD = Math.max(0, totalOwedUSD - currentOwedUSD);

    const body = UI.el('div');
    const info = UI.el('div', { class: 'kv-list', style: 'margin-bottom:16px' });
    info.innerHTML =
      '<div class="kv"><span class="muted">رقم المشترك</span><b>#' + m.id + '</b></div>' +
      '<div class="kv"><span class="muted">الاسم</span><b>' + UI.esc(m.first_name + ' ' + m.last_name) + '</b></div>' +
      '<div class="kv"><span class="muted">الهاتف</span><b dir="ltr">' + UI.esc(m.phone || '—') + '</b></div>' +
      '<div class="kv"><span class="muted">العمر / الجنس</span><b>' + (m.age || '—') + ' / ' + (m.gender || '—') + '</b></div>' +
      '<div class="kv"><span class="muted">تاريخ التسجيل</span><b>' + Logic.arDateTime(m.created_at) + '</b></div>' +
      (totalOwedUSD > 0
        ? '<div class="kv"><span class="muted">المتبقي على الاشتراك الحالي</span><b style="color:var(--warn)">' + UI.money(currentOwed, current.currency) + '</b></div>' +
          (previousOwedUSD > 0.005 ? '<div class="kv"><span class="muted">المتبقي من اشتراكات سابقة</span><b style="color:var(--danger)">' + UI.money(previousOwedUSD, 'USD') + '</b></div>' : '') +
          '<div class="kv total"><span>إجمالي المبلغ المتبقي</span><b style="color:var(--danger)">' + UI.money(totalOwedUSD, 'USD') + '</b></div>'
        : '');
    body.appendChild(info);

    body.appendChild(UI.el('div', { class: 'card-title', text: 'سجل الاشتراكات والتجديدات' }));
    body.appendChild(UI.table({
      columns: [
        { label: 'من', num: true, render: r => Logic.arDate(r.start_date) },
        { label: 'إلى', num: true, render: r => Logic.arDate(r.end_date) },
        { label: 'القيمة', num: true, render: r => UI.money(r.price, r.currency) },
        { label: 'المدفوع', num: true, render: r => UI.money(r.paid, r.currency) },
        { label: 'الحالة', html: true, render: r => { const st = Logic.subStatus(r, today); return UI.badge(st.label, st.tone); } },
        { label: 'أدخلها', key: 'created_by' }
      ],
      rows: subs, empty: 'لا توجد اشتراكات'
    }));

    body.appendChild(UI.el('div', { class: 'card-title', text: 'آخر الدفعات', style: 'margin-top:16px' }));
    body.appendChild(UI.table({
      columns: [
        { label: 'التاريخ', num: true, render: r => Logic.arDateTime(r.created_at) },
        { label: 'المبلغ الأصلي', num: true, render: r => UI.money(r.entered_amount || r.amount, r.entered_currency || r.currency) },
        { label: 'المعادل بالدولار', num: true, render: r => UI.money(r.converted_amount_usd != null ? r.converted_amount_usd : Logic.toUSD(r.amount, r.currency, rate), 'USD') },
        { label: 'ملاحظة', key: 'note' },
        { label: 'الموظف', key: 'created_by' }
      ],
      rows: pays, empty: 'لا توجد دفعات'
    }));

    if (pauses.length) {
      body.appendChild(UI.el('div', { class: 'card-title', text: 'سجل التوقف المؤقت (Pause)', style: 'margin-top:16px' }));
      body.appendChild(UI.table({
        columns: [
          { label: 'بداية التوقف', num: true, render: r => Logic.arDate(r.start_date) },
          { label: 'تاريخ العودة', num: true, render: r => r.end_date ? Logic.arDate(r.end_date) : 'ما زال متوقفًا' },
          { label: 'عدد الأيام', num: true, render: r => r.end_date ? r.days : Logic.daysBetween(r.start_date, today) },
          { label: 'ملاحظة', key: 'note' },
          { label: 'سجّله', key: 'created_by' }
        ],
        rows: pauses
      }));
    }

    const name = m.first_name + ' ' + (m.last_name || '');
    const notes = await api.all('SELECT * FROM member_notes WHERE member_id = :id ORDER BY id DESC', { ':id': id });
    const notesTitle = UI.el('div', {
      class: 'card-title', text: 'الملاحظات', style: 'margin-top:16px'
    });
    const notesBtns = UI.el('div', { style: 'display:flex;gap:8px' });
    const addNoteBtn = UI.el('button', { class: 'btn btn-sm btn-primary', html: UI.icons.plus + ' إضافة ملاحظة' });
    const csvBtn = UI.el('button', { class: 'btn btn-sm', html: UI.icons.file + ' تصدير Excel' });
    const pdfBtn = UI.el('button', { class: 'btn btn-sm', html: UI.icons.printer + ' تصدير PDF' });
    notesBtns.appendChild(addNoteBtn); notesBtns.appendChild(csvBtn); notesBtns.appendChild(pdfBtn);
    notesTitle.appendChild(notesBtns);
    body.appendChild(notesTitle);
    const notesWrap = UI.el('div');
    if (!notes.length) notesWrap.appendChild(UI.el('div', { class: 'muted', text: 'لا توجد ملاحظات بعد' }));
    notes.forEach(n => {
      const card = UI.el('div', { class: 'note-card' });
      card.innerHTML = '<div class="note-text">' + UI.esc(n.text) + '</div>' +
        '<div class="note-meta"><span>' + Logic.arDateTime(n.created_at) + '</span><span>' + UI.esc(n.created_by) + '</span></div>';
      notesWrap.appendChild(card);
    });
    body.appendChild(notesWrap);

    addNoteBtn.onclick = () => {
      const fText = UI.el('textarea', { placeholder: 'اكتب الملاحظة…' });
      const nbody = UI.el('div');
      nbody.appendChild(UI.field('الملاحظة', fText));
      const nsave = UI.el('button', { class: 'btn btn-primary', text: 'حفظ الملاحظة' });
      const ncancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
      const nmd = UI.modal({ title: 'إضافة ملاحظة — ' + name, body: nbody, footer: [ncancel, nsave] });
      ncancel.onclick = () => nmd.close();
      nsave.onclick = async () => {
        if (!fText.value.trim()) { UI.toast('اكتب ملاحظة أولًا', 'error'); return; }
        await api.run('INSERT INTO member_notes(member_id, text, created_at, created_by) VALUES(:m,:t,:d,:by)',
          { ':m': id, ':t': fText.value.trim(), ':d': Logic.nowStr(), ':by': UI.username() });
        UI.log('إضافة ملاحظة', 'members', id, fText.value.trim());
        UI.toast('تم حفظ الملاحظة');
        nmd.close();
        md.close();
        showProfile(id, onChange);
      };
    };
    csvBtn.onclick = () => UI.exportCsv('ملاحظات-' + name + '.csv',
      ['التاريخ', 'الوقت', 'الملاحظة', 'بواسطة'],
      notes.map(n => [Logic.arDate(n.created_at), String(n.created_at).slice(11, 16), n.text, n.created_by]));
    pdfBtn.onclick = async () => {
      const printRoot = document.getElementById('print-notes-root');
      printRoot.innerHTML = '<div class="report-head"><img src="../assets/logo.png" alt="Legacy Gym"><div><h2>ملاحظات — ' + UI.esc(name) + '</h2><div class="rh-meta">' + UI.esc(UI.setting('gym_name_ar', '')) + ' — طُبع في ' + Logic.arDateTime(Logic.nowStr()) + '</div></div></div>' +
        (notes.length ? notes.map(n => '<div class="note-card"><div class="note-text">' + UI.esc(n.text) + '</div><div class="note-meta"><span>' + Logic.arDateTime(n.created_at) + '</span><span>' + UI.esc(n.created_by) + '</span></div></div>').join('') : '<div class="muted">لا توجد ملاحظات</div>');
      document.body.classList.add('printing-notes');
      const res = await api.exportPdf('ملاحظات-' + name + '.pdf');
      document.body.classList.remove('printing-notes');
      printRoot.innerHTML = '';
      if (res.ok) UI.toast('تم حفظ PDF: ' + res.path);
    };

    const editBtn = UI.el('button', { class: 'btn', text: 'تعديل البيانات' });
    const renewBtn = UI.el('button', { class: 'btn btn-primary', text: 'تجديد الاشتراك' });
    const md = UI.modal({ title: 'ملف المشترك — ' + m.first_name + ' ' + m.last_name, body, footer: [editBtn, renewBtn], wide: true });
    editBtn.onclick = () => { md.close(); memberForm(m, onChange); };
    renewBtn.onclick = () => { md.close(); window.SubActions.renewDialog(m, onChange); };
  }

  window.PAGES.members = {
    showProfile,
    memberForm,
    render: async (page) => {
      const rows = await fetchMembers();
      const shown = applyFilter(rows);

      const toolbar = UI.el('div', { class: 'toolbar' });
      const search = UI.el('div', { class: 'search-box' });
      const sInput = UI.input({ placeholder: 'بحث بالاسم أو الرقم أو الهاتف…', value: filter.q });
      search.innerHTML = UI.icons.search;
      search.appendChild(sInput);
      sInput.oninput = UI.debounce(() => { filter.q = sInput.value; refreshPage(); }, 300);
      toolbar.appendChild(search);

      const chips = UI.el('div', { class: 'chip-row' });
      [['all', 'الكل'], ['active', 'ناشط'], ['expired', 'منتهي'], ['owed', 'عليه مبلغ'], ['paused', 'متوقف'], ['none', 'بدون اشتراك'], ['archived', 'ملغى/مؤرشف']].forEach(([k, lbl]) => {
        chips.appendChild(UI.el('button', {
          class: 'chip' + (filter.status === k ? ' active' : ''), text: lbl,
          onclick: () => { filter.status = k; refreshPage(); }
        }));
      });
      toolbar.appendChild(chips);
      toolbar.appendChild(UI.el('div', { class: 'spacer' }));
      toolbar.appendChild(UI.el('button', {
        class: 'btn btn-sm', html: UI.icons.file + ' تصدير Excel',
        onclick: () => UI.exportCsv('المشتركين.csv',
          ['#', 'الاسم', 'الشهرة', 'الهاتف', 'العمر', 'الجنس', 'الحالة', 'نهاية الاشتراك', 'تاريخ التسجيل'],
          shown.map(r => [r.id, r.first_name, r.last_name, r.phone, r.age || '', r.gender, r.st.label, r.end_date ? Logic.arDate(r.end_date) : '', Logic.arDateTime(r.created_at)]))
      }));
      const addBtn = UI.el('button', { class: 'btn btn-primary', html: UI.icons.plus + ' مشترك جديد' });
      addBtn.onclick = () => memberForm(null, refreshPage);
      toolbar.appendChild(addBtn);
      page.appendChild(toolbar);

      page.appendChild(UI.el('div', { class: 'muted', style: 'margin-bottom:10px;font-size:13px', text: shown.length + ' مشترك' }));

      page.appendChild(UI.table({
        columns: [
          { label: '#', key: 'id', num: true },
          { label: 'الاسم', render: r => r.first_name + ' ' + r.last_name },
          { label: 'الهاتف', key: 'phone', num: true },
          { label: 'نهاية الاشتراك', num: true, render: r => r.end_date ? Logic.arDate(r.end_date) : '—' },
          { label: 'الحالة', html: true, render: r => UI.badge(r.st.label, r.st.tone) },
          { label: 'المتبقي', num: true, html: true, render: r => r.st.owed > 0 ? '<b style="color:var(--danger)">' + UI.money(r.st.owed, r.currency) + '</b>' : '—' },
          {
            label: '', cls: 'actions', render: r => {
              const name = r.first_name + ' ' + r.last_name;
              const within24h = Logic.canEdit(r.created_at, 'employee'); // added in the last 24 hours?
              return UI.actionBtns([
                !r.archived ? { icon: UI.icons.refresh, title: 'تجديد الاشتراك', onClick: () => window.SubActions.renewDialog(r, refreshPage) } : null,
                { icon: UI.icons.user, title: 'ملف المشترك', onClick: () => showProfile(r.id, refreshPage) },
                // restore an archived member (admin)
                UI.isAdmin() && r.archived ? {
                  icon: UI.icons.check, title: 'استعادة المشترك', onClick: async () => {
                    const yes = await UI.confirm('استعادة مشترك', 'إعادة "' + name + '" إلى قائمة المشتركين؟');
                    if (!yes) return;
                    await api.run('UPDATE members SET archived = 0 WHERE id=:id', { ':id': r.id });
                    UI.log('استعادة مشترك من الأرشيف', 'members', r.id, name);
                    UI.toast('تمت الاستعادة');
                    refreshPage();
                  }
                } : null,
                // within 24h: hard delete — after 24h: archive/cancel (admin only)
                UI.isAdmin() && !r.archived && within24h ? {
                  icon: UI.icons.trash, title: 'حذف نهائي (أُضيف خلال 24 ساعة)', danger: true, onClick: async () => {
                    const yes = await UI.confirm('حذف نهائي',
                      'المشترك "' + name + '" أُضيف خلال آخر 24 ساعة — سيُحذف نهائيًا مع كل اشتراكاته ودفعاته. لا يمكن التراجع.',
                      { danger: true, okText: 'حذف نهائي' });
                    if (!yes) return;
                    await api.run('DELETE FROM pauses WHERE member_id=:id', { ':id': r.id });
                    await api.run('DELETE FROM payments WHERE member_id=:id', { ':id': r.id });
                    await api.run('DELETE FROM subscriptions WHERE member_id=:id', { ':id': r.id });
                    await api.run('DELETE FROM members WHERE id=:id', { ':id': r.id });
                    UI.log('حذف مشترك نهائي (خلال 24 ساعة)', 'members', r.id, name);
                    UI.toast('تم الحذف نهائيًا');
                    refreshPage();
                  }
                } : null,
                UI.isAdmin() && !r.archived && !within24h ? {
                  icon: UI.icons.x, title: 'إلغاء / أرشفة المشترك', danger: true, onClick: async () => {
                    const yes = await UI.confirm('إلغاء / أرشفة مشترك',
                      'مرّ أكثر من 24 ساعة على تسجيل "' + name + '" — للحفاظ على السجلات المالية سيتم تحويله إلى "ملغى/مؤرشف" بدلًا من الحذف النهائي، مع إلغاء اشتراكه الحالي. يمكن استعادته لاحقًا من فلتر "ملغى/مؤرشف".',
                      { danger: true, okText: 'أرشفة المشترك' });
                    if (!yes) return;
                    await api.run('UPDATE members SET archived = 1 WHERE id=:id', { ':id': r.id });
                    if (r.sub_id) await api.run("UPDATE subscriptions SET manual_status = 'cancelled' WHERE id=:s AND manual_status != 'cancelled'", { ':s': r.sub_id });
                    UI.log('أرشفة مشترك (بعد 24 ساعة)', 'members', r.id, name);
                    UI.toast('تم نقل المشترك إلى الأرشيف');
                    refreshPage();
                  }
                } : null
              ]);
            }
          }
        ],
        rows: shown,
        empty: 'لا يوجد مشتركون مطابقون للبحث',
        rowAttrs: r => ({ class: 'clickable', ondblclick: () => showProfile(r.id, refreshPage) })
      }));
    }
  };
})();
