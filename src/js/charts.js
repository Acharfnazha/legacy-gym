/*
 * Legacy Gym — lightweight SVG charts (no external libs, offline-safe).
 */
(function () {
  const Charts = {};
  window.Charts = Charts;

  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    return e;
  };

  /* Vertical bars — data: [{label, value, value2?}] */
  Charts.bars = (data, opts) => {
    const o = Object.assign({ height: 220, color: '#1E9BFF', color2: '#9AA7B8', format: v => v }, opts);
    const W = 760, H = o.height, padB = 30, padT = 14, padX = 10;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
    const max = Math.max(1, ...data.map(d => Math.max(d.value || 0, d.value2 || 0)));
    const n = data.length || 1;
    const slot = (W - padX * 2) / n;
    const dual = data.some(d => d.value2 !== undefined);
    const bw = Math.min(dual ? 16 : 30, slot * (dual ? 0.3 : 0.55));
    // gridlines
    for (let i = 1; i <= 3; i++) {
      const y = padT + (H - padB - padT) * (1 - i / 3);
      svg.appendChild(s('line', { x1: padX, x2: W - padX, y1: y, y2: y, stroke: 'rgba(255,255,255,0.06)' }));
      const t = s('text', { x: W - padX, y: y - 4, fill: '#6b7280', 'font-size': 10, 'text-anchor': 'end' });
      t.textContent = o.format(Math.round(max * i / 3));
      svg.appendChild(t);
    }
    data.forEach((d, i) => {
      const cx = padX + slot * i + slot / 2;
      const drawBar = (val, color, offset) => {
        const h = Math.max(2, (H - padB - padT) * (val / max));
        const r = s('rect', {
          x: cx - bw / 2 + offset, y: H - padB - h, width: bw, height: h, rx: 4,
          fill: color, opacity: 0.9
        });
        const title = s('title'); title.textContent = d.label + ': ' + o.format(val);
        r.appendChild(title);
        svg.appendChild(r);
      };
      if (dual) { drawBar(d.value || 0, o.color, -bw / 2 - 2); drawBar(d.value2 || 0, o.color2, bw / 2 + 2); }
      else drawBar(d.value || 0, o.color, 0);
      if (n <= 16 || i % Math.ceil(n / 16) === 0) {
        const t = s('text', { x: cx, y: H - 10, fill: '#99a1b0', 'font-size': 10.5, 'text-anchor': 'middle' });
        t.textContent = d.label;
        svg.appendChild(t);
      }
    });
    const box = document.createElement('div');
    box.className = 'chart-box';
    box.appendChild(svg);
    return box;
  };

  /* Line chart — data: [{label, value}] */
  Charts.line = (data, opts) => {
    const o = Object.assign({ height: 200, color: '#1E9BFF', format: v => v }, opts);
    const W = 760, H = o.height, padB = 26, padT = 12, padX = 14;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}` });
    const max = Math.max(1, ...data.map(d => d.value || 0));
    const n = Math.max(2, data.length);
    const x = i => padX + (W - padX * 2) * (i / (n - 1));
    const y = v => padT + (H - padB - padT) * (1 - v / max);
    for (let i = 1; i <= 3; i++) {
      const gy = padT + (H - padB - padT) * (1 - i / 3);
      svg.appendChild(s('line', { x1: padX, x2: W - padX, y1: gy, y2: gy, stroke: 'rgba(255,255,255,0.06)' }));
    }
    let dPath = '', dArea = '';
    data.forEach((d, i) => {
      const px = x(i), py = y(d.value || 0);
      dPath += (i ? ' L' : 'M') + px + ' ' + py;
      dArea += (i ? ' L' : 'M') + px + ' ' + py;
    });
    if (data.length) {
      dArea += ` L${x(data.length - 1)} ${H - padB} L${x(0)} ${H - padB} Z`;
      const grad = s('linearGradient', { id: 'lg' + Math.random().toString(36).slice(2, 7), x1: 0, y1: 0, x2: 0, y2: 1 });
      const gid = grad.getAttribute('id');
      const st1 = s('stop', { offset: '0', 'stop-color': o.color, 'stop-opacity': 0.28 });
      const st2 = s('stop', { offset: '1', 'stop-color': o.color, 'stop-opacity': 0 });
      grad.appendChild(st1); grad.appendChild(st2);
      const defs = s('defs'); defs.appendChild(grad); svg.appendChild(defs);
      svg.appendChild(s('path', { d: dArea, fill: `url(#${gid})` }));
      svg.appendChild(s('path', { d: dPath, fill: 'none', stroke: o.color, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }));
      data.forEach((d, i) => {
        const c = s('circle', { cx: x(i), cy: y(d.value || 0), r: 3, fill: '#111827', stroke: o.color, 'stroke-width': 2 });
        const title = s('title'); title.textContent = d.label + ': ' + o.format(d.value || 0);
        c.appendChild(title);
        svg.appendChild(c);
        if (data.length <= 14 || i % Math.ceil(data.length / 14) === 0) {
          const t = s('text', { x: x(i), y: H - 8, fill: '#99a1b0', 'font-size': 10.5, 'text-anchor': 'middle' });
          t.textContent = d.label;
          svg.appendChild(t);
        }
      });
    }
    const box = document.createElement('div');
    box.className = 'chart-box';
    box.appendChild(svg);
    return box;
  };

  /* Horizontal bars for rankings — data: [{label, value}] */
  Charts.hbars = (data, opts) => {
    const o = Object.assign({ color: '#1E9BFF', format: v => v }, opts);
    const box = document.createElement('div');
    const max = Math.max(1, ...data.map(d => d.value || 0));
    data.forEach(d => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:9px';
      const label = document.createElement('div');
      label.style.cssText = 'width:130px;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      label.textContent = d.label;
      const track = document.createElement('div');
      track.style.cssText = 'flex:1;height:9px;border-radius:6px;background:var(--bg3);overflow:hidden';
      const fill = document.createElement('div');
      fill.style.cssText = `width:${(d.value / max * 100).toFixed(1)}%;height:100%;border-radius:6px;background:${o.color}`;
      track.appendChild(fill);
      const val = document.createElement('div');
      val.style.cssText = 'width:76px;text-align:end;font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums';
      val.textContent = o.format(d.value);
      row.appendChild(label); row.appendChild(track); row.appendChild(val);
      box.appendChild(row);
    });
    if (!data.length) {
      box.innerHTML = '<div class="muted" style="text-align:center;padding:18px">لا توجد بيانات</div>';
    }
    return box;
  };
})();
