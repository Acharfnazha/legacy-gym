/*
 * DEVELOPER-ONLY: produce the signed entry that suspends ONE client's copy for
 * non-payment. Run on YOUR machine, then paste the line into your status gist.
 *
 *   node tools/suspend.js IRON-XXXX-XXXX-XXXX-XXXX "your-secret-passphrase"
 *
 * It prints a JSON line like:
 *   "IRON-XXXX-XXXX-XXXX-XXXX": "<signature>"
 *
 * Put it inside the {} of your status file:
 *   { "IRON-XXXX-XXXX-XXXX-XXXX": "<signature>" }
 *
 * To RE-ACTIVATE that client later: just delete their line from the file and
 * save. (No signature is needed to re-activate — absence means active.)
 *
 * Requires tools/license-private-key.pem + your passphrase (same as keygen).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const machineId = (process.argv[2] || '').trim().toUpperCase();
const passphrase = process.argv[3];

if (!/^IRON(-[0-9A-F]{4}){4}$/.test(machineId) || !passphrase) {
  console.error('Usage: node tools/suspend.js IRON-XXXX-XXXX-XXXX-XXXX "your-secret-passphrase"');
  process.exit(1);
}

const privPath = path.join(__dirname, 'license-private-key.pem');
if (!fs.existsSync(privPath)) {
  console.error('Private key not found. Run: node tools/license-setup.js "your-passphrase" first.');
  process.exit(1);
}

let privateKey;
try {
  privateKey = crypto.createPrivateKey({ key: fs.readFileSync(privPath, 'utf8'), format: 'pem', passphrase });
} catch (e) {
  console.error('❌ Wrong passphrase (or corrupted key file).');
  process.exit(1);
}

const sig = crypto.sign(null, Buffer.from(machineId + '|suspended', 'utf8'), privateKey).toString('base64');

console.log('\nAdd this line inside the { } of your status file to SUSPEND this machine:\n');
console.log('  "' + machineId + '": "' + sig + '"');
console.log('\nTo re-activate later, just delete that line and save.');
