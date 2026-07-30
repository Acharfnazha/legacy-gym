/*
 * Embeds the app icon into the built exe using rcedit.
 * Runs automatically after `electron-builder --dir` (see the "dist" npm script).
 *
 * We build with `signAndEditExecutable: false` so electron-builder never needs
 * winCodeSign (whose archive contains macOS symlinks that Windows can't extract
 * without admin/Developer-Mode — a common "A required privilege is not held by
 * the client" build failure). The trade-off is that electron-builder no longer
 * sets the exe icon, so we set it here ourselves.
 */
import { rcedit } from 'rcedit';
import { existsSync } from 'node:fs';

const exe = 'dist/win-unpacked/LegacyGym.exe';
if (!existsSync(exe)) {
  console.error('embed-icon: exe not found at ' + exe + ' — did electron-builder succeed?');
  process.exit(1);
}
await rcedit(exe, { icon: 'assets/icon.ico' });
console.log('embed-icon: icon embedded into ' + exe);
