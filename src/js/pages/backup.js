/* النسخ الاحتياطي — Backup & Restore */
(function () {
  window.PAGES = window.PAGES || {};

  /* Backup file NAMES must stay ISO-stamped on disk (Windows forbids "/" in
     filenames, so a literal DD/MM/YYYY name is impossible) — but whatever we
     DISPLAY to the user is reformatted here so no raw ISO date ever shows. */
  function prettyBackupName(name) {
    const m = String(name).match(/^ironcore-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.db$/);
    if (!m) return name;
    const [, y, mo, d, h, mi] = m;
    return 'نسخة ' + d + '/' + mo + '/' + y + ' — ' + h + ':' + mi;
  }

  window.PAGES.backup = {
    render: async (page) => {
      const lastBackup = UI.setting('last_backup', '');
      const dir = UI.setting('backup_dir', '') || '(مجلد backups بجانب النظام)';

      const infoCard = UI.el('div', { class: 'card', style: 'margin-bottom:14px' });
      infoCard.innerHTML = '<div class="card-title">حالة النسخ الاحتياطي</div>';
      const kv = UI.el('div', { class: 'kv-list' });
      kv.innerHTML =
        `<div class="kv"><span class="muted">آخر نسخة احتياطية</span><b>${lastBackup ? Logic.arDateTime(lastBackup) : 'لم يتم بعد'}</b></div>` +
        `<div class="kv"><span class="muted">مجلد الحفظ</span><b dir="ltr" style="font-size:12px">${UI.esc(dir)}</b></div>` +
        `<div class="kv"><span class="muted">نسخة تلقائية</span><b>يوميًا عند فتح البرنامج (تُحفظ آخر 30 نسخة)</b></div>`;
      infoCard.appendChild(kv);

      const btns = UI.el('div', { style: 'display:flex;gap:10px;margin-top:16px;flex-wrap:wrap' });
      const backupBtn = UI.el('button', { class: 'btn btn-primary', html: UI.icons.backup + ' نسخ احتياطي الآن' });
      backupBtn.onclick = async () => {
        backupBtn.disabled = true;
        const r = await api.backupNow();
        backupBtn.disabled = false;
        if (r.ok) {
          UI.log('نسخ احتياطي يدوي', 'backup', null, r.path);
          await UI.loadSettings();
          UI.toast('تم إنشاء النسخة: ' + r.path);
          refreshPage();
        }
      };
      const dirBtn = UI.el('button', { class: 'btn', html: UI.icons.settings + ' تغيير مجلد الحفظ' });
      dirBtn.onclick = async () => {
        const d = await api.backupChooseDir();
        if (d) { await UI.loadSettings(); UI.toast('تم تغيير مجلد النسخ إلى: ' + d); refreshPage(); }
      };
      const openBtn = UI.el('button', { class: 'btn', html: UI.icons.file + ' فتح مجلد النسخ' });
      openBtn.onclick = () => api.backupOpenDir();
      const restoreBtn = UI.el('button', { class: 'btn btn-danger', html: UI.icons.refresh + ' استرجاع من ملف…' });
      restoreBtn.onclick = async () => {
        const yes = await UI.confirm('استرجاع نسخة احتياطية',
          'سيتم استبدال كل البيانات الحالية بالنسخة المختارة. تُحفظ نسخة أمان من البيانات الحالية تلقائيًا قبل الاسترجاع.',
          { danger: true, okText: 'متابعة الاسترجاع' });
        if (!yes) return;
        const r = await api.backupRestore(null);
        if (r.ok) {
          UI.toast('تم الاسترجاع بنجاح — أعد تسجيل الدخول');
          setTimeout(() => location.reload(), 1200);
        } else if (!r.cancelled) UI.toast(r.error || 'فشل الاسترجاع', 'error');
      };
      btns.appendChild(backupBtn); btns.appendChild(dirBtn); btns.appendChild(openBtn); btns.appendChild(restoreBtn);
      infoCard.appendChild(btns);
      page.appendChild(infoCard);

      const list = await api.backupList();
      const listCard = UI.el('div', { class: 'card' });
      listCard.innerHTML = '<div class="card-title">النسخ المتوفرة (' + list.length + ')</div>';
      listCard.appendChild(UI.table({
        columns: [
          { label: 'الملف', render: r => prettyBackupName(r.name) },
          { label: 'التاريخ', num: true, render: r => Logic.arDateTime(Logic.nowStr(new Date(r.mtime))) },
          { label: 'الحجم', num: true, render: r => (r.size / 1024).toFixed(0) + ' KB' },
          {
            label: '', cls: 'actions', render: r => UI.actionBtns([
              {
                icon: UI.icons.refresh, title: 'استرجاع هذه النسخة', danger: true, onClick: async () => {
                  const yes = await UI.confirm('استرجاع', 'استرجاع النسخة "' + prettyBackupName(r.name) + '"؟ ستُستبدل البيانات الحالية.', { danger: true, okText: 'استرجاع' });
                  if (!yes) return;
                  const res = await api.backupRestore(r.path);
                  if (res.ok) { UI.toast('تم الاسترجاع'); setTimeout(() => location.reload(), 1200); }
                  else UI.toast(res.error || 'فشل الاسترجاع', 'error');
                }
              }
            ])
          }
        ],
        rows: list,
        empty: 'لا توجد نسخ بعد — اضغط "نسخ احتياطي الآن"'
      }));
      page.appendChild(listCard);
    }
  };
})();
