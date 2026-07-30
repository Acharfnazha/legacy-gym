/*
 * Legacy Gym — hardware-locked activation (offline, lifetime, no expiry).
 *
 * How it works (asymmetric / public-key, so the shipped app CANNOT forge codes):
 *   - A stable per-machine fingerprint is derived from the Windows MachineGuid
 *     (falls back to hostname+MAC). It survives RAM/USB/Windows-update changes;
 *     it only changes on a full OS reinstall or a genuinely different machine.
 *   - The developer's PRIVATE key (kept off the client, never shipped — lives in
 *     tools/) signs that fingerprint to produce an activation code.
 *   - Only the PUBLIC key is embedded here (main/license-pubkey.js). Anyone who
 *     extracts the app can read the public key but can NEVER generate a valid
 *     code for another machine — that requires the private key + passphrase.
 *   - The verified code is stored in data/license.dat. There is NO time limit,
 *     NO expiry, NO "phone home": once activated on a machine it works forever.
 *
 * Dev machine (`npm start`, not packaged) and smoke tests bypass activation
 * entirely, so development and automated testing are never blocked.
 */
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let PUBLIC_KEY = null;
try { PUBLIC_KEY = require('./license-pubkey.js'); } catch (e) { PUBLIC_KEY = null; }

/* ---- Stable machine fingerprint ---- */
function rawMachineId() {
  // Primary: Windows MachineGuid (very stable — only changes on OS reinstall).
  try {
    if (process.platform === 'win32') {
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
      if (m) return 'win:' + m[1];
    }
  } catch (e) { /* fall through */ }
  // Fallback: hostname + first non-internal MAC address.
  let mac = '';
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name]) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') { mac = ni.mac; break; }
    }
    if (mac) break;
  }
  return 'fb:' + os.hostname() + ':' + mac;
}

/* Public, human-readable machine id shown to the developer for code generation.
   Derived from the raw fingerprint via SHA-256, formatted IRON-XXXX-XXXX-XXXX-XXXX. */
function machineId() {
  const hash = crypto.createHash('sha256').update(rawMachineId()).digest('hex').toUpperCase();
  const chunk = hash.slice(0, 16);
  return 'IRON-' + chunk.match(/.{1,4}/g).join('-');
}

/* Verify an activation code (base64 Ed25519 signature over the machine id). */
function verifyCode(code, mid) {
  if (!PUBLIC_KEY || !code) return false;
  try {
    const sig = Buffer.from(String(code).replace(/\s+/g, ''), 'base64');
    if (sig.length !== 64) return false;
    return crypto.verify(null, Buffer.from(mid, 'utf8'), PUBLIC_KEY, sig);
  } catch (e) { return false; }
}

function licenseFilePath(dataDir) { return path.join(dataDir, 'license.dat'); }

/* Is this machine activated? Dev builds and smoke tests are always "activated". */
function isActivated(dataDir, opts) {
  const o = opts || {};
  if (o.devBypass) return true;
  const mid = machineId();
  try {
    const stored = fs.readFileSync(licenseFilePath(dataDir), 'utf8').trim();
    return verifyCode(stored, mid);
  } catch (e) { return false; }
}

/* Try to activate with a code the developer generated for THIS machine. */
function activate(dataDir, code, opts) {
  const o = opts || {};
  const mid = machineId();
  if (o.devBypass) return { ok: true, dev: true };
  if (!verifyCode(code, mid)) return { ok: false, error: 'كود التفعيل غير صحيح لهذا الجهاز' };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(licenseFilePath(dataDir), String(code).replace(/\s+/g, ''), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'تعذّر حفظ التفعيل: ' + e.message };
  }
}

module.exports = { machineId, rawMachineId, verifyCode, isActivated, activate };
