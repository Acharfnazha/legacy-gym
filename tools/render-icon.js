/*
 * Builds a proper multi-size Windows icon from the OFFICIAL assets/logo.png:
 *   assets/icon.ico  — 16, 24, 32, 48, 64, 128 (BMP entries) + 256 (PNG entry)
 *   assets/icon.png  — 256px preview
 * Black corners outside the hexagon are flood-filled transparent at full
 * resolution, then each size is produced by stepwise high-quality downscaling.
 * Run:  npx electron tools/render-icon.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const logoPath = path.join(root, 'assets', 'logo.png');
const SIZES = [256, 128, 64, 48, 32, 24, 16]; // ICO order: largest first

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 300, height: 300,
    webPreferences: { offscreen: true, webSecurity: false }
  });
  await win.loadURL('data:text/html,<html><body></body></html>');

  const result = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'file:///' + ${JSON.stringify(logoPath.replace(/\\/g, '/'))};
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

    // master canvas at 512 for maximum quality before downscaling
    const M = 512;
    const master = document.createElement('canvas');
    master.width = M; master.height = M;
    const mctx = master.getContext('2d');
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = 'high';
    // App ICON = just the emblem (triangle + dumbbells), so it stays recognizable
    // at 16–32px. Crop the top ~60% of the logo (emblem, excluding the LEGACY GYM
    // wordmark) and center it full-width on the logo's dark-blue background — no
    // flood-fill, the branded background is kept.
    mctx.fillStyle = '#060B16';
    mctx.fillRect(0, 0, M, M);
    const cropFrac = 0.53;                         // top portion holding the emblem
    const cropH = img.naturalHeight * cropFrac;
    const scale = M / img.naturalWidth;            // fit emblem to full square width
    const dh = cropH * scale;
    mctx.drawImage(img, 0, 0, img.naturalWidth, cropH, 0, (M - dh) / 2, M, dh);

    // stepwise downscale: halve until close to target, then final resize
    const scaleTo = (src, S) => {
      let cur = src;
      while (cur.width / 2 >= S) {
        const half = document.createElement('canvas');
        half.width = cur.width / 2; half.height = cur.height / 2;
        const hctx = half.getContext('2d');
        hctx.imageSmoothingEnabled = true;
        hctx.imageSmoothingQuality = 'high';
        hctx.drawImage(cur, 0, 0, half.width, half.height);
        cur = half;
      }
      const out = document.createElement('canvas');
      out.width = S; out.height = S;
      const octx = out.getContext('2d');
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(cur, 0, 0, S, S);
      return out;
    };

    const sizes = ${JSON.stringify(SIZES)};
    const out = {};
    for (const S of sizes) {
      const c = scaleTo(master, S);
      const raw = c.getContext('2d').getImageData(0, 0, S, S).data;
      let bin = '';
      for (let i = 0; i < raw.length; i += 8192) {
        bin += String.fromCharCode.apply(null, raw.subarray(i, Math.min(i + 8192, raw.length)));
      }
      out[S] = { rgba: btoa(bin), png: c.toDataURL('image/png').split(',')[1] };
    }
    return out;
  })()`);

  /* ---- encode ICO entries ---- */
  function bmpEntry(S, rgbaB64) {
    const rgba = Buffer.from(rgbaB64, 'base64');
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);            // biSize
    header.writeInt32LE(S, 4);              // biWidth
    header.writeInt32LE(S * 2, 8);          // biHeight (XOR + AND)
    header.writeUInt16LE(1, 12);            // biPlanes
    header.writeUInt16LE(32, 14);           // biBitCount
    header.writeUInt32LE(S * S * 4, 20);    // biSizeImage
    const xor = Buffer.alloc(S * S * 4);    // BGRA, rows bottom-up
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const src = ((y * S) + x) * 4;
        const dst = (((S - 1 - y) * S) + x) * 4;
        xor[dst] = rgba[src + 2];
        xor[dst + 1] = rgba[src + 1];
        xor[dst + 2] = rgba[src];
        xor[dst + 3] = rgba[src + 3];
      }
    }
    const maskRow = Math.ceil(S / 32) * 4;  // 1bpp rows padded to 32 bits
    const and = Buffer.alloc(maskRow * S);  // all 0 = fully visible (alpha rules)
    return Buffer.concat([header, xor, and]);
  }

  const entries = SIZES.map(S => ({
    size: S,
    data: S === 256 ? Buffer.from(result[S].png, 'base64') : bmpEntry(S, result[S].rgba)
  }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);               // type: icon
  header.writeUInt16LE(entries.length, 4);  // count
  const dir = [];
  let offset = 6 + entries.length * 16;
  for (const e of entries) {
    const ent = Buffer.alloc(16);
    ent[0] = e.size === 256 ? 0 : e.size;   // width (0 = 256)
    ent[1] = e.size === 256 ? 0 : e.size;   // height
    ent.writeUInt16LE(1, 4);                // planes
    ent.writeUInt16LE(32, 6);               // bpp
    ent.writeUInt32LE(e.data.length, 8);
    ent.writeUInt32LE(offset, 12);
    offset += e.data.length;
    dir.push(ent);
  }
  const ico = Buffer.concat([header, ...dir, ...entries.map(e => e.data)]);
  fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), ico);
  fs.writeFileSync(path.join(root, 'assets', 'icon.png'), Buffer.from(result[256].png, 'base64'));
  // small-size previews for visual verification
  fs.writeFileSync(path.join(root, 'assets', 'icon-32.png'), Buffer.from(result[32].png, 'base64'));
  fs.writeFileSync(path.join(root, 'assets', 'icon-16.png'), Buffer.from(result[16].png, 'base64'));
  console.log('icon.ico written: ' + entries.length + ' sizes [' + SIZES.join(', ') + '] — ' + ico.length + ' bytes');
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
