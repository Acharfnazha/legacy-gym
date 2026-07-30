/*
 * DEVELOPER-ONLY activation-code generator. Run this on YOUR machine when you
 * install the system on a client's laptop. It never touches the client machine.
 *
 *   node tools/keygen.js IRON-XXXX-XXXX-XXXX-XXXX "your-secret-passphrase"
 *
 * Steps at the client site:
 *   1. Client laptop's activation screen shows a Machine ID (IRON-...-....).
 *   2. Type that Machine ID + your passphrase into this tool (on your laptop).
 *   3. It prints an activation code.
 *   4. Type/paste that code into the client laptop's activation screen. Done —
 *      lifetime activation for that one machine.
 *
 * Requires tools/license-private-key.pem (created by license-setup.js) + your
 * passphrase. Without both, no code can be generated.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const machineId = (process.argv[2] || '').trim().toUpperCase();
const passphrase = process.argv[3];

if (!/^IRON(-[0-9A-F]{4}){4}$/.test(machineId) || !passphrase) {
  console.error('Usage: node tools/keygen.js IRON-XXXX-XXXX-XXXX-XXXX "your-secret-passphrase"');
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

const sig = crypto.sign(null, Buffer.from(machineId, 'utf8'), privateKey);
const code = sig.toString('base64');

console.log('\nMachine ID:      ' + machineId);
console.log('Activation code:\n\n  ' + code + '\n');
console.log('Paste this code into the client\'s activation screen.');
