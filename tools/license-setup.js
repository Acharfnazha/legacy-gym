/*
 * DEVELOPER-ONLY setup — run ONCE before your first real delivery.
 *
 *   node tools/license-setup.js "your-secret-passphrase"
 *
 * Generates a fresh Ed25519 key pair:
 *   - tools/license-private-key.pem  → YOUR MASTER SECRET (encrypted with the
 *     passphrase). Keep it safe. It NEVER ships (tools/ is excluded from the
 *     build) and must NEVER be placed on a client machine. Whoever holds this
 *     file + the passphrase can generate activation codes — that is you, only.
 *   - main/license-pubkey.js         → the public key embedded in the app. Safe
 *     to ship. Cannot be used to forge codes.
 *
 * After running this you MUST rebuild the app (npm run dist) so the new public
 * key is baked into the exe. Any codes issued before a re-run stop working.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const passphrase = process.argv[2];
if (!passphrase || passphrase.length < 6) {
  console.error('Usage: node tools/license-setup.js "your-secret-passphrase"  (min 6 chars)');
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
});

const privPath = path.join(__dirname, 'license-private-key.pem');
const pubJsPath = path.join(__dirname, '..', 'main', 'license-pubkey.js');

fs.writeFileSync(privPath, privateKey, 'utf8');
fs.writeFileSync(pubJsPath,
  '/* Public activation key — safe to ship. Regenerate via tools/license-setup.js. */\n' +
  'module.exports = ' + JSON.stringify(publicKey) + ';\n', 'utf8');

console.log('✅ Key pair generated.');
console.log('   Private key (KEEP SECRET, never ship): ' + privPath);
console.log('   Public key written to:                 ' + pubJsPath);
console.log('\n⚠️  Next: rebuild the app (npm run dist) so the new public key is embedded.');
