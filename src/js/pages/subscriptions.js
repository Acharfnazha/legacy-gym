/* الاشتراكات — Subscriptions (renew / pay / pause / cancel) */
(function () {
  window.PAGES = window.PAGES || {};
  const SubActions = window.SubActions = {};

  let filter = { q: '', status: 'all' };

  /* ---- Renew / new subscription dialog ---- */
  SubActions.renewDialog = async function (member, onSaved) {
    const memberId = member.member_id || member.id;
    const rate = UI.lbpRate();
    const today0 = Logic.today();
    const priorSubs = await api.all('SELECT * FROM subscriptions WHERE member_id = :id', { ':id': memberId });
    const previousOwedUSD = priorSubs
      .filter(s => s.manual_status !== 'cancelled' && Logic.subStatus(s, today0).owed > 0)
      .reduce((s, r) => s + Logic.toUSD(Logic.subStatus(r, today0).owed, r.currency, r.exchange_rate || rate), 0);

    const fType = UI.select(Logic.SUB_TYPES.map(t => ({ value: t.key, label: t.label })), 'month');
    const fCount = UI.input({ type: 'number', value: 1, min: 1 });
    const fStart = UI.input({ type: 'date', value: Logic.today() });
    const fEnd = UI.input({ type: 'date', disabled: '' });
    const fPrice = UI.input({ type: 'number', value: UI.setting('monthly_price', 30), min: 0, step: '0.01' });
    const fCur = UI.currencySelect('USD');
    UI.wireCurrencyConvert(fPrice, fCur);
    const payment = UI.paymentEditor(fPrice, fCur, UI.setting('monthly_price', 30), 'USD', rate);
    const fNote = UI.input({ placeholder: 'ملاحظة (اختياري)' });
    const fAllocation = UI.select([
      { value: 'current', label: 'الاشتراك الحالي' },
      { value: 'previous', label: 'الرصيد السابق' },
      { value: 'both', label: 'الرصيد السابق ثم الاشتراك الحالي' }
    ], 'current');

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

    const body = UI.el('div');
    if (previousOwedUSD > 0.005) {
      const warn = UI.el('div', { class: 'alert warn', style: 'margin-bottom:12px' });
      const renderWarn = () => {
        const curUSD = Logic.toUSD(Number(fPrice.value) || 0, fCur.value, rate);
        warn.innerHTML = UI.icons.alert + '<div><b>يوجد مبلغ متبقٍ على هذا المشترك.</b>' +
          '<div class="kv-list" style="margin-top:8px">' +
          '<div class="kv"><span class="muted">قيمة الاشتراك الحالي</span><b>' + UI.money(Number(fPrice.value) || 0, fCur.value) + '</b></div>' +
          '<div class="kv"><span class="muted">المتبقي من اشتراكات سابقة</span><b>' + UI.money(previousOwedUSD, 'USD') + '</b></div>' +
          '<div class="kv total"><span>الإجمالي المطلوب</span><b>' + UI.money(curUSD + previousOwedUSD, 'USD') + '</b></div>' +
          '</div></div>';
      };
      renderWarn();
      fPrice.addEventListener('input', renderWarn);
      fCur.addEventListener('change', renderWarn);
      body.appendChild(warn);
      body.appendChild(UI.field('تخصيص الدفعة', fAllocation));
    }
    const r1 = UI.el('div', { class: 'form-row-3' });
    r1.appendChild(UI.field('نوع الاشتراك', fType));
    r1.appendChild(countField);
    r1.appendChild(UI.field('تاريخ البداية', fStart));
    body.appendChild(r1);
    const r2 = UI.el('div', { class: 'form-row-3' });
    r2.appendChild(UI.field('تاريخ النهاية (تلقائي)', fEnd));
    r2.appendChild(UI.field('قيمة الاشتراك', fPrice));
    r2.appendChild(UI.field('العملة', fCur));
    body.appendChild(r2);
    const r3 = UI.el('div', { class: 'form-row' });
    r3.appendChild(UI.field('المبلغ المدفوع الآن', payment.amount));
    r3.appendChild(UI.field('عملة الدفع', payment.currency));
    body.appendChild(r3);
    body.appendChild(UI.field('تجديد مجاني (لا يُدفع شيء)', payment.saveWithoutPayment));
    body.appendChild(payment.summary);
    body.appendChild(UI.field('ملاحظة', fNote));

    const save = UI.el('button', { class: 'btn btn-primary', text: 'تسجيل التجديد' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const name = member.first_name + ' ' + (member.last_name || '');
    const md = UI.modal({ title: 'تجديد اشتراك — ' + name, body, footer: [cancel, save], wide: true });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      const free = payment.saveWithoutPayment.checked;
      const snapshots = payment.get();
      const subSnap = snapshots.subscription, paySnap = snapshots.payment;
      if (!subSnap) { UI.toast('أدخل سعر اشتراك وسعر صرف صالحين', 'error'); return; }
      if (!fStart.value) { UI.toast('تاريخ البداية مطلوب', 'error'); return; }
      const endDate = Logic.subEnd(fType.value, fCount.value, fStart.value);
      const memberId = member.member_id || member.id;

      // Free renewal: price 0, paid 0, no payment records, no balance allocation.
      if (free) {
        const freeSub = await api.run(`INSERT INTO subscriptions(member_id, type, duration_days, start_date, end_date, price, paid, currency, exchange_rate, price_usd, price_lbp, paid_usd, notes, created_at, created_by)
          VALUES(:m,:ty,:d,:s,:e,0,0,:c,:r,0,0,0,:n,:t,:by)`, {
          ':m': memberId, ':ty': fType.value, ':d': Logic.daysBetween(fStart.value, endDate), ':s': fStart.value,
          ':e': endDate, ':c': fCur.value, ':r': rate, ':n': fNote.value.trim(), ':t': Logic.nowStr(), ':by': UI.username()
        });
        UI.log('تجديد مجاني', 'subscriptions', freeSub.lastId, name + ' — تجديد مجاني');
        UI.toast('تم التجديد المجاني');
        md.close();
        if (onSaved) onSaved();
        return;
      }

      if (!paySnap) { UI.toast('أدخل مبالغ وسعر صرف صالحين', 'error'); return; }
      if (paySnap.enteredAmount === 0) { UI.toast('أدخل دفعة أو فعّل "تجديد مجاني"', 'error'); return; }
      const allocation = previousOwedUSD > 0.00001 ? fAllocation.value : 'current';
      const maxPaymentUSD = allocation === 'current' ? subSnap.usd : allocation === 'previous' ? previousOwedUSD : subSnap.usd + previousOwedUSD;
      if (paySnap.usd > maxPaymentUSD + 0.00001) { UI.toast('المدفوع أكبر من الرصيد المحدد', 'error'); return; }
      let remainingPaymentUSD = paySnap.usd;
      const previousAllocations = [];
      if (allocation === 'previous' || allocation === 'both') {
        const owedPrevious = priorSubs.filter(s => s.manual_status !== 'cancelled' && Logic.subStatus(s, today0).owed > 0).sort((a, b) => a.id - b.id);
        for (const oldSub of owedPrevious) {
          if (remainingPaymentUSD <= 0.00001) break;
          const oldRate = Number(oldSub.exchange_rate) || rate;
          const oldOwedUSD = Logic.toUSD(Logic.subStatus(oldSub, today0).owed, oldSub.currency, oldRate);
          const allocatedUSD = Math.min(remainingPaymentUSD, oldOwedUSD);
          previousAllocations.push({ sub: oldSub, usd: allocatedUSD, rate: oldRate });
          remainingPaymentUSD = Logic.roundUSD(remainingPaymentUSD - allocatedUSD);
        }
      }
      const currentPaymentUSD = allocation === 'previous' ? 0 : Math.min(remainingPaymentUSD, subSnap.usd);
      const paidInSubCurrency = Logic.convert(currentPaymentUSD, 'USD', fCur.value, rate);
      const sub = await api.run(`INSERT INTO subscriptions(member_id, type, duration_days, start_date, end_date, price, paid, currency, exchange_rate, price_usd, price_lbp, paid_usd, notes, created_at, created_by)
        VALUES(:m,:ty,:d,:s,:e,:p,:pd,:c,:r,:pu,:pl,:pdu,:n,:t,:by)`, {
        ':m': memberId, ':ty': fType.value, ':d': Logic.daysBetween(fStart.value, endDate), ':s': fStart.value,
        ':e': endDate, ':p': subSnap.price, ':pd': paidInSubCurrency, ':c': fCur.value,
        ':r': rate, ':pu': subSnap.usd, ':pl': subSnap.lbp, ':pdu': currentPaymentUSD,
        ':n': fNote.value.trim(), ':t': Logic.nowStr(), ':by': UI.username()
      });
      const recordAllocation = async (subscriptionId, allocatedUSD, note) => {
        if (allocatedUSD <= 0.00001) return;
        const now = Logic.nowStr();
        const enteredAmount = paySnap.enteredCurrency === 'LBP' ? Math.round(allocatedUSD * paySnap.rate) : Logic.roundUSD(allocatedUSD);
        await api.run(`INSERT INTO payments(subscription_id, member_id, amount, currency, entered_amount, entered_currency, exchange_rate_at_payment, converted_amount_usd, converted_amount_lbp, payment_date, payment_time, note, created_at, created_by)
          VALUES(:s,:m,:a,:c,:a,:c,:r,:u,:l,:d,:tm,:n,:t,:by)`,
          { ':s': subscriptionId, ':m': memberId, ':a': enteredAmount, ':c': paySnap.enteredCurrency, ':r': paySnap.rate, ':u': allocatedUSD, ':l': Math.round(allocatedUSD * paySnap.rate), ':d': now.slice(0, 10), ':tm': now.slice(11), ':n': note, ':t': now, ':by': UI.username() });
      };
      for (const alloc of previousAllocations) {
        const paidOldCurrency = Logic.convert(alloc.usd, 'USD', alloc.sub.currency, alloc.rate);
        await api.run('UPDATE subscriptions SET paid=paid+:a, paid_usd=paid_usd+:u WHERE id=:id', { ':a': paidOldCurrency, ':u': alloc.usd, ':id': alloc.sub.id });
        await recordAllocation(alloc.sub.id, alloc.usd, 'تسديد رصيد سابق');
      }
      await recordAllocation(sub.lastId, currentPaymentUSD, 'تجديد اشتراك');
      UI.log('تجديد اشتراك', 'subscriptions', sub.lastId, name + ' — ' + UI.money(paySnap.enteredAmount, paySnap.enteredCurrency));
      UI.toast('تم تجديد الاشتراك');
      md.close();
      if (onSaved) onSaved();
    };
  };

  /* ---- Pay remaining ---- */
  SubActions.payDialog = function (sub, onSaved) {
    const rate = UI.lbpRate();
    const subRate = Number(sub.exchange_rate) || rate;
    const priceUSD = Number(sub.price_usd) || Logic.toUSD(sub.price, sub.currency, subRate);
    const paidUSD = sub.paid_usd != null ? Number(sub.paid_usd) || 0 : Logic.toUSD(sub.paid, sub.currency, subRate);
    const owedUSD = Math.max(0, Logic.roundUSD(priceUSD - paidUSD));
    const owedPrice = UI.input({ value: owedUSD });
    const owedCurrency = UI.currencySelect('USD');
    const payment = UI.paymentEditor(owedPrice, owedCurrency, owedUSD, 'USD', rate);
    const fNote = UI.input({ placeholder: 'ملاحظة (اختياري)' });
    const body = UI.el('div');
    body.appendChild(UI.el('div', { class: 'alert info', html: 'المتبقي على هذا الاشتراك: <b>' + UI.money(owedUSD, 'USD') + ' = ' + UI.money(Math.round(owedUSD * rate), 'LBP') + '</b>' }));
    const payRow = UI.el('div', { class: 'form-row' });
    payRow.appendChild(UI.field('المبلغ المدفوع', payment.amount));
    payRow.appendChild(UI.field('عملة الدفع', payment.currency));
    body.appendChild(payRow);
    body.appendChild(payment.summary);
    body.appendChild(UI.field('ملاحظة', fNote));
    const save = UI.el('button', { class: 'btn btn-primary', text: 'تسجيل الدفعة' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: 'دفع المبلغ المتبقي — ' + sub.first_name + ' ' + sub.last_name, body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      const paySnap = payment.get().payment;
      if (!paySnap || paySnap.enteredAmount <= 0) { UI.toast('أدخل مبلغًا صحيحًا', 'error'); return; }
      if (paySnap.usd > owedUSD + 0.00001) { UI.toast('المبلغ أكبر من المتبقي', 'error'); return; }
      // paying an old (24h+) subscription is allowed but flagged in the log for admin review
      const old = !Logic.canEdit(sub.created_at, 'employee');
      const paidInSubCurrency = Logic.convert(paySnap.usd, 'USD', sub.currency, subRate);
      await api.run('UPDATE subscriptions SET paid = paid + :a, paid_usd = paid_usd + :u WHERE id = :id', { ':a': paidInSubCurrency, ':u': paySnap.usd, ':id': sub.id });
      const now = Logic.nowStr();
      await api.run(`INSERT INTO payments(subscription_id, member_id, amount, currency, entered_amount, entered_currency, exchange_rate_at_payment, converted_amount_usd, converted_amount_lbp, payment_date, payment_time, note, created_at, created_by)
        VALUES(:s,:m,:a,:c,:a,:c,:r,:u,:l,:d,:tm,:n,:t,:by)`,
        { ':s': sub.id, ':m': sub.member_id, ':a': paySnap.enteredAmount, ':c': paySnap.enteredCurrency, ':r': paySnap.rate, ':u': paySnap.usd, ':l': paySnap.lbp, ':d': now.slice(0, 10), ':tm': now.slice(11), ':n': fNote.value.trim() || 'دفع متبقٍ', ':t': now, ':by': UI.username() });
      UI.log(old ? 'دفعة على اشتراك قديم (بانتظار مراجعة المدير)' : 'دفعة متبقٍ', 'subscriptions', sub.id, sub.first_name + ' ' + sub.last_name + ' — ' + UI.money(paySnap.enteredAmount, paySnap.enteredCurrency));
      UI.toast('تم تسجيل الدفعة' + (old ? ' — ستظهر للمدير في سجل العمليات' : ''));
      md.close();
      if (onSaved) onSaved();
    };
  };

  /* ---- Pause / resume (with pause-history ledger) / cancel ---- */
  SubActions.togglePause = function (sub, onSaved) {
    if (sub.manual_status === 'paused') SubActions.resumeDialog(sub, onSaved);
    else SubActions.pauseDialog(sub, onSaved);
  };

  SubActions.pauseDialog = function (sub, onSaved) {
    const fNote = UI.input({ placeholder: 'سبب التوقف (اختياري) — سفر، إصابة…' });
    const body = UI.el('div');
    body.appendChild(UI.el('div', {
      class: 'alert info',
      html: 'سيصبح الاشتراك <b>متوقفًا مؤقتًا</b>: لا يُحسب متأخرًا، لا تُحسب عليه أيام تأخير، ولا يظهر كاشتراك منتهٍ يحتاج تجديدًا حتى يُستأنف.'
    }));
    body.appendChild(UI.field('ملاحظة التوقف', fNote));
    const save = UI.el('button', { class: 'btn btn-primary', text: 'إيقاف مؤقت الآن' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: 'إيقاف مؤقت — ' + sub.first_name + ' ' + sub.last_name, body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      const today = Logic.today();
      await api.run('UPDATE subscriptions SET manual_status = \'paused\', pause_date = :d WHERE id = :id', { ':d': today, ':id': sub.id });
      await api.run(`INSERT INTO pauses(subscription_id, member_id, start_date, end_date, days, note, created_at, created_by)
        VALUES(:s,:m,:d,'',0,:n,:t,:by)`,
        { ':s': sub.id, ':m': sub.member_id, ':d': today, ':n': fNote.value.trim(), ':t': Logic.nowStr(), ':by': UI.username() });
      UI.log('إيقاف اشتراك مؤقت', 'subscriptions', sub.id, sub.first_name + ' ' + sub.last_name + (fNote.value.trim() ? ' — ' + fNote.value.trim() : ''));
      UI.toast('تم إيقاف الاشتراك مؤقتًا');
      md.close();
      if (onSaved) onSaved();
    };
  };

  SubActions.resumeDialog = function (sub, onSaved) {
    const today = Logic.today();
    const pausedDays = Math.max(0, Logic.daysBetween(sub.pause_date || today, today));
    const fMode = UI.select([
      { value: 'extend', label: 'تمديد نهاية الاشتراك بعدد أيام التوقف (+' + pausedDays + ' يوم)' },
      { value: 'keep', label: 'متابعة من تاريخ النهاية القديم (' + Logic.arDate(sub.end_date) + ') بدون تمديد' }
    ], 'extend');
    const body = UI.el('div');
    body.appendChild(UI.el('div', {
      class: 'alert info',
      html: 'مدة التوقف: <b>' + pausedDays + ' يوم</b> (من ' + (sub.pause_date ? Logic.arDate(sub.pause_date) : '—') + ' حتى اليوم)'
    }));
    body.appendChild(UI.field('طريقة الاستئناف', fMode));
    const save = UI.el('button', { class: 'btn btn-primary', text: 'استئناف الاشتراك' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: 'استئناف اشتراك — ' + sub.first_name + ' ' + sub.last_name, body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      const newEnd = fMode.value === 'extend' ? Logic.addDays(sub.end_date, pausedDays) : sub.end_date;
      await api.run('UPDATE subscriptions SET manual_status = \'\', pause_date = \'\', end_date = :e WHERE id = :id',
        { ':e': newEnd, ':id': sub.id });
      // close the open pause-history row
      await api.run(`UPDATE pauses SET end_date = :e, days = :d
        WHERE id = (SELECT MAX(id) FROM pauses WHERE subscription_id = :s AND end_date = '')`,
        { ':e': today, ':d': pausedDays, ':s': sub.id });
      UI.log('استئناف اشتراك', 'subscriptions', sub.id,
        sub.first_name + ' ' + sub.last_name + ' — توقف ' + pausedDays + ' يوم، ' + (fMode.value === 'extend' ? 'مع تمديد النهاية إلى ' + newEnd : 'بدون تمديد'));
      UI.toast('تم استئناف الاشتراك — النهاية: ' + Logic.arDate(newEnd));
      md.close();
      if (onSaved) onSaved();
    };
  };

  /* ---- quick note on a subscription ---- */
  SubActions.noteDialog = function (sub, onSaved) {
    const fNote = UI.el('textarea', { placeholder: 'اكتب الملاحظة…' });
    const body = UI.el('div');
    if (sub.notes) body.appendChild(UI.el('div', { class: 'alert info', html: 'الملاحظات الحالية: ' + UI.esc(sub.notes) }));
    body.appendChild(UI.field('ملاحظة جديدة', fNote));
    const save = UI.el('button', { class: 'btn btn-primary', text: 'حفظ الملاحظة' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: 'ملاحظة — ' + sub.first_name + ' ' + sub.last_name, body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      if (!fNote.value.trim()) { UI.toast('اكتب ملاحظة أولًا', 'error'); return; }
      const combined = (sub.notes ? sub.notes + ' | ' : '') + Logic.arDate(Logic.today()) + ': ' + fNote.value.trim();
      await api.run('UPDATE subscriptions SET notes = :n WHERE id = :id', { ':n': combined, ':id': sub.id });
      UI.log('إضافة ملاحظة', 'subscriptions', sub.id, fNote.value.trim());
      UI.toast('تم حفظ الملاحظة');
      md.close();
      if (onSaved) onSaved();
    };
  };

  SubActions.cancel = async function (sub, onSaved) {
    if (!UI.isAdmin()) { UI.toast('إلغاء الاشتراك من صلاحية المدير فقط', 'error'); return; }
    const yes = await UI.confirm('إلغاء الاشتراك', 'سيتم وضع الاشتراك كملغى. لن تُحذف الدفعات المسجلة.', { danger: true, okText: 'إلغاء الاشتراك' });
    if (!yes) return;
    await api.run('UPDATE subscriptions SET manual_status = \'cancelled\' WHERE id = :id', { ':id': sub.id });
    UI.log('إلغاء اشتراك', 'subscriptions', sub.id, sub.first_name + ' ' + sub.last_name);
    UI.toast('تم إلغاء الاشتراك');
    if (onSaved) onSaved();
  };

  /* ---- Edit subscription (admin or <24h) ---- */
  SubActions.editDialog = function (sub, onSaved) {
    if (!UI.canEditRow(sub.created_at, sub.created_by)) { UI.toast(UI.editLockMsg, 'error'); return; }
    const fStart = UI.input({ type: 'date', value: sub.start_date });
    const fEnd = UI.input({ type: 'date', value: sub.end_date });
    const fPrice = UI.input({ type: 'number', value: sub.price, min: 0, step: '0.01' });
    const fPaid = UI.input({ type: 'number', value: sub.paid, min: 0, step: '0.01' });
    const fNote = UI.input({ value: sub.notes || '' });
    const body = UI.el('div');
    const r1 = UI.el('div', { class: 'form-row' });
    r1.appendChild(UI.field('تاريخ البداية', fStart));
    r1.appendChild(UI.field('تاريخ النهاية', fEnd));
    body.appendChild(r1);
    const r2 = UI.el('div', { class: 'form-row' });
    r2.appendChild(UI.field('قيمة الاشتراك', fPrice));
    r2.appendChild(UI.field('المدفوع', fPaid));
    body.appendChild(r2);
    body.appendChild(UI.field('ملاحظة', fNote));
    const save = UI.el('button', { class: 'btn btn-primary', text: 'حفظ' });
    const cancel = UI.el('button', { class: 'btn btn-ghost', text: 'إلغاء' });
    const md = UI.modal({ title: 'تعديل اشتراك #' + sub.id, body, footer: [cancel, save] });
    cancel.onclick = () => md.close();
    save.onclick = async () => {
      if (fEnd.value <= fStart.value) { UI.toast('تاريخ النهاية يجب أن يكون بعد البداية', 'error'); return; }
      const price = Number(fPrice.value), paid = Number(fPaid.value);
      if (price < 0 || paid < 0) { UI.toast('لا يمكن إدخال مبلغ سلبي', 'error'); return; }
      const before = `قيمة:${sub.price} مدفوع:${sub.paid} من:${Logic.arDate(sub.start_date)} إلى:${Logic.arDate(sub.end_date)}`;
      const rate = Number(sub.exchange_rate) || UI.lbpRate();
      const priceUSD = Logic.toUSD(price, sub.currency, rate);
      const paidUSD = Logic.toUSD(paid, sub.currency, rate);
      await api.run('UPDATE subscriptions SET start_date=:s, end_date=:e, price=:p, paid=:pd, exchange_rate=:r, price_usd=:pu, price_lbp=:pl, paid_usd=:pdu, notes=:n WHERE id=:id',
        { ':s': fStart.value, ':e': fEnd.value, ':p': price, ':pd': paid, ':r': rate, ':pu': priceUSD, ':pl': priceUSD * rate, ':pdu': paidUSD, ':n': fNote.value.trim(), ':id': sub.id });
      UI.log('تعديل اشتراك', 'subscriptions', sub.id, 'قبل التعديل → ' + before);
      UI.toast('تم حفظ التعديلات');
      md.close();
      if (onSaved) onSaved();
    };
  };

  /* ---- Page ---- */
  window.PAGES.subscriptions = {
    render: async (page) => {
      const today = Logic.today();
      let rows = await api.all(`
        SELECT s.*, m.first_name, m.last_name, m.phone FROM subscriptions s
        JOIN members m ON m.id = s.member_id
        WHERE m.archived = 0 AND s.id IN (SELECT MAX(id) FROM subscriptions GROUP BY member_id)
        ORDER BY s.end_date ASC`);
      rows = rows.map(r => ({ ...r, st: Logic.subStatus(r, today) }));

      if (filter.q) {
        const q = filter.q.trim();
        rows = rows.filter(r => (r.first_name + ' ' + r.last_name).includes(q) || (r.phone || '').includes(q) || String(r.member_id) === q);
      }
      const counts = { all: rows.length, today: 0, late: 0, owed: 0, paused: 0, active: 0 };
      rows.forEach(r => {
        if (r.st.key === 'expires_today') counts.today++;
        if (r.st.key === 'expired') counts.late++;
        if (r.st.owed > 0 && r.st.key !== 'cancelled') counts.owed++;
        if (r.st.key === 'paused') counts.paused++;
        if (r.st.key === 'active' || r.st.key === 'active_owed') counts.active++;
      });
      let shown = rows;
      if (filter.status === 'today') shown = rows.filter(r => r.st.key === 'expires_today');
      else if (filter.status === 'late') shown = rows.filter(r => r.st.key === 'expired');
      else if (filter.status === 'owed') shown = rows.filter(r => r.st.owed > 0 && r.st.key !== 'cancelled');
      else if (filter.status === 'paused') shown = rows.filter(r => r.st.key === 'paused');
      else if (filter.status === 'active') shown = rows.filter(r => r.st.key === 'active' || r.st.key === 'active_owed');

      const toolbar = UI.el('div', { class: 'toolbar' });
      const search = UI.el('div', { class: 'search-box' });
      const sInput = UI.input({ placeholder: 'بحث…', value: filter.q });
      search.innerHTML = UI.icons.search;
      search.appendChild(sInput);
      sInput.oninput = UI.debounce(() => { filter.q = sInput.value; refreshPage(); }, 300);
      toolbar.appendChild(search);
      const chips = UI.el('div', { class: 'chip-row' });
      [['all', 'الكل (' + counts.all + ')'], ['active', 'ناشط (' + counts.active + ')'], ['today', 'تنتهي اليوم (' + counts.today + ')'], ['late', 'متأخر (' + counts.late + ')'], ['owed', 'عليه مبلغ (' + counts.owed + ')'], ['paused', 'متوقف (' + counts.paused + ')']].forEach(([k, lbl]) => {
        chips.appendChild(UI.el('button', { class: 'chip' + (filter.status === k ? ' active' : ''), text: lbl, onclick: () => { filter.status = k; refreshPage(); } }));
      });
      toolbar.appendChild(chips);
      toolbar.appendChild(UI.el('div', { class: 'spacer' }));
      toolbar.appendChild(UI.el('button', {
        class: 'btn btn-sm', html: UI.icons.file + ' تصدير Excel',
        onclick: () => UI.exportCsv('الاشتراكات.csv',
          ['المشترك', 'الهاتف', 'من', 'إلى', 'القيمة', 'المدفوع', 'المتبقي', 'العملة', 'الحالة'],
          shown.map(r => [r.first_name + ' ' + r.last_name, r.phone, Logic.arDate(r.start_date), Logic.arDate(r.end_date), r.price, r.paid, Math.max(0, r.price - r.paid), r.currency, r.st.label]))
      }));
      page.appendChild(toolbar);

      page.appendChild(UI.table({
        columns: [
          { label: 'ID', key: 'member_id', num: true },
          { label: 'المشترك', render: r => r.first_name + ' ' + r.last_name },
          { label: 'الهاتف', key: 'phone', num: true },
          { label: 'بداية الاشتراك', num: true, render: r => Logic.arDate(r.start_date) },
          { label: 'نهاية الاشتراك', num: true, render: r => Logic.arDate(r.end_date) },
          {
            label: 'أيام التأخير', num: true, html: true, render: r =>
              r.st.lateDays > 0 ? '<b style="color:var(--danger)">' + r.st.lateDays + '</b>' : '—'
          },
          { label: 'المبلغ المطلوب', num: true, html: true, render: r => r.st.owed > 0 ? '<b style="color:var(--danger)">' + UI.money(r.st.owed, r.currency) + '</b>' : '—' },
          { label: 'الحالة', html: true, render: r => UI.badge(r.st.label, r.st.tone) },
          {
            label: '', cls: 'actions', render: r => UI.actionBtns([
              { icon: UI.icons.refresh, title: 'تجديد', onClick: () => SubActions.renewDialog(r, refreshPage) },
              r.st.owed > 0 ? { icon: UI.icons.money, title: 'دفع المتبقي', onClick: () => SubActions.payDialog(r, refreshPage) } : null,
              r.st.key !== 'cancelled' ? { icon: UI.icons.pause, title: r.manual_status === 'paused' ? 'استئناف' : 'إيقاف مؤقت (Pause)', onClick: () => SubActions.togglePause(r, refreshPage) } : null,
              { icon: UI.icons.file, title: 'ملاحظة', onClick: () => SubActions.noteDialog(r, refreshPage) },
              { icon: UI.icons.edit, title: 'تعديل', onClick: () => SubActions.editDialog(r, refreshPage) },
              UI.isAdmin() && r.st.key !== 'cancelled' ? { icon: UI.icons.x, title: 'إلغاء الاشتراك', danger: true, onClick: () => SubActions.cancel(r, refreshPage) } : null
            ])
          }
        ],
        rows: shown,
        empty: 'لا توجد اشتراكات في هذه الفئة',
        rowAttrs: r => ({ class: 'clickable', ondblclick: () => window.PAGES.members.showProfile(r.member_id, refreshPage) })
      }));
    }
  };
})();
