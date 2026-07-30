/* الإعدادات — Settings (admin) */
(function () {
  window.PAGES = window.PAGES || {};

  window.PAGES.settings = {
    render: async (page) => {
      await UI.loadSettings();
      const s = (k, fb) => UI.setting(k, fb);

      /* --- user management entry point --- */
      const usersCard = UI.el('div', { class: 'card', style: 'margin-bottom:14px' });
      usersCard.innerHTML = '<div class="card-title">إدارة المستخدمين</div>' +
        '<div class="muted" style="font-size:13px;margin-bottom:12px">إنشاء وتعديل حسابات المدراء والموظفين، الصلاحيات، الحالة، وكلمات المرور — بما فيها حسابك الشخصي.</div>';
      const goUsersBtn = UI.el('button', { class: 'btn btn-primary', html: UI.icons.employees + ' فتح إدارة المستخدمين' });
      goUsersBtn.onclick = () => navigate('usermanagement');
      usersCard.appendChild(goUsersBtn);
      page.appendChild(usersCard);

      const grid = UI.el('div', { class: 'grid grid-2', style: 'align-items:start' });

      /* --- club identity --- */
      const idCard = UI.el('div', { class: 'card' });
      idCard.innerHTML = '<div class="card-title">بيانات النادي</div>';
      const fNameAr = UI.input({ value: s('gym_name_ar', '') });
      const fNameEn = UI.input({ value: s('gym_name', ''), dir: 'ltr' });
      const fPhone = UI.input({ value: s('gym_phone', ''), dir: 'ltr', placeholder: '01 234567' });
      const fAddress = UI.input({ value: s('gym_address', ''), placeholder: 'العنوان' });
      idCard.appendChild(UI.field('اسم النادي (عربي)', fNameAr));
      idCard.appendChild(UI.field('اسم النادي (لاتيني)', fNameEn));
      idCard.appendChild(UI.field('هاتف النادي', fPhone));
      idCard.appendChild(UI.field('العنوان', fAddress));
      idCard.appendChild(UI.el('div', {
        class: 'muted', style: 'font-size:12.5px;margin-top:6px',
        html: 'شعار النادي: لاستبدال الشعار ضع ملف <b dir="ltr">logo.png</b> الجديد داخل مجلد <b dir="ltr">assets</b> ثم أعد تشغيل البرنامج.'
      }));
      grid.appendChild(idCard);

      /* --- pricing --- */
      const priceCard = UI.el('div', { class: 'card' });
      priceCard.innerHTML = '<div class="card-title">الأسعار والعملة</div>';
      const fMonthly = UI.input({ type: 'number', value: s('monthly_price', 30), min: 0, step: '0.01' });
      const fDay = UI.input({ type: 'number', value: s('day_price', 3), min: 0, step: '0.01' });
      const fRate = UI.input({ type: 'number', value: s('lbp_rate', 89000), min: 1 });
      priceCard.appendChild(UI.field('سعر الاشتراك الشهري الافتراضي ($)', fMonthly));
      priceCard.appendChild(UI.field('سعر اشتراك اليوم الواحد ($)', fDay));
      priceCard.appendChild(UI.field('سعر صرف الدولار (ل.ل لكل 1$)', fRate));
      priceCard.appendChild(UI.el('div', {
        class: 'muted', style: 'font-size:12.5px',
        text: 'يُستخدم سعر الصرف لتحويل مبيعات ومصاريف الليرة إلى دولار في التقارير والصندوق. الصندوق اليومي للموظف يعرض دائمًا جميع عمليات اليوم من كل المستخدمين — بنفس مجموع المدير.'
      }));
      grid.appendChild(priceCard);
      page.appendChild(grid);

      const saveBtn = UI.el('button', { class: 'btn btn-primary', style: 'margin-top:16px', html: UI.icons.check + ' حفظ الإعدادات' });
      saveBtn.onclick = async () => {
        const monthly = Number(fMonthly.value), dayP = Number(fDay.value), rate = Number(fRate.value);
        if (isNaN(monthly) || monthly < 0 || isNaN(dayP) || dayP < 0) { UI.toast('الأسعار لا يمكن أن تكون سلبية', 'error'); return; }
        if (isNaN(rate) || rate <= 0) { UI.toast('سعر صرف غير صالح', 'error'); return; }
        const pairs = {
          gym_name_ar: fNameAr.value.trim(), gym_name: fNameEn.value.trim(),
          gym_phone: fPhone.value.trim(), gym_address: fAddress.value.trim(),
          monthly_price: monthly, day_price: dayP, lbp_rate: rate
        };
        for (const [k, v] of Object.entries(pairs)) {
          await api.run('INSERT INTO settings(key, value) VALUES(:k,:v) ON CONFLICT(key) DO UPDATE SET value=:v', { ':k': k, ':v': String(v) });
        }
        await UI.loadSettings();
        document.getElementById('sidebar-gymname').textContent = UI.setting('gym_name_ar', 'ليجاسي جيم');
        UI.log('تعديل الإعدادات', 'settings', null, JSON.stringify(pairs));
        UI.toast('تم حفظ الإعدادات');
      };
      page.appendChild(saveBtn);

      /* --- about --- */
      const about = UI.el('div', { class: 'card', style: 'margin-top:16px' });
      const ver = await api.version();
      about.innerHTML = '<div class="card-title">حول النظام</div>' +
        '<div class="kv-list">' +
        '<div class="kv"><span class="muted">النظام</span><b>Legacy Gym Management</b></div>' +
        '<div class="kv"><span class="muted">الإصدار</span><b dir="ltr">v' + ver + '</b></div>' +
        '<div class="kv"><span class="muted">قاعدة البيانات</span><b>SQLite محلية — تعمل بدون إنترنت</b></div>' +
        '<div class="kv"><span class="muted">إدارة حسابات الدخول</span><b>من الإعدادات ← إدارة المستخدمين</b></div>' +
        '<div class="kv"><span class="muted">إعدادات النسخ الاحتياطي</span><b>من صفحة النسخ الاحتياطي</b></div>' +
        '</div>';
      page.appendChild(about);
    }
  };
})();
