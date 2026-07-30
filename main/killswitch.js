/*
 * Remote kill-switch (fail-open). Lets the developer suspend a client's copy
 * for non-payment WITHOUT any time limit and WITHOUT breaking offline use:
 *
 *   - On launch (and every few hours) the app tries to fetch the status file
 *     at killswitch-config.js -> statusUrl.
 *   - The file maps a suspended machine id to an Ed25519 signature the dev
 *     produced with the SAME private key used for activation. The app verifies
 *     it with the embedded public key, so a client can never forge/lift it.
 *   - If this machine is listed with a VALID signature  -> suspended (locks).
 *   - Anything else — no url, no internet, url blocked, machine not listed,
 *     bad signature — leaves the system WORKING (fail-open). No grace clock.
 *
 * Bypassed entirely on the dev build / smoke tests (see main.js licenseBypass).
 */
const crypto = require('crypto');

let PUBLIC_KEY = null;
try { PUBLIC_KEY = require('./license-pubkey.js'); } catch (e) { PUBLIC_KEY = null; }
let cfg = { statusUrl: '' };
try { cfg = require('./killswitch-config.js'); } catch (e) { cfg = { statusUrl: '' }; }

let state = 'ok'; // 'ok' | 'suspended'

/* A suspension entry is a signature over "<machineId>|suspended".
   pubKey defaults to the embedded public key; an override exists only for tests. */
function verifySuspension(sig, machineId, pubKey) {
  const key = pubKey || PUBLIC_KEY;
  if (!key || !sig) return false;
  try {
    const s = Buffer.from(String(sig).replace(/\s+/g, ''), 'base64');
    if (s.length !== 64) return false;
    return crypto.verify(null, Buffer.from(machineId + '|suspended', 'utf8'), key, s);
  } catch (e) { return false; }
}

async function refresh(machineId, urlOverride, pubKeyOverride) {
  const url = urlOverride || cfg.statusUrl;
  if (!url) { state = 'ok'; return state; }                   // disabled -> always works
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);         // fail fast when offline
  try {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(url + sep + 'cb=' + Date.now(), { signal: ctrl.signal, cache: 'no-store', headers: { connection: 'close' } });
    if (!res.ok) { state = 'ok'; return state; }
    const data = await res.json();
    const sig = data && typeof data === 'object' ? data[machineId] : null;
    state = verifySuspension(sig, machineId, pubKeyOverride) ? 'suspended' : 'ok';
  } catch (e) {
    state = 'ok';                                             // fail-open on ANY error
  } finally {
    clearTimeout(timer);                                      // always clear (even when fetch rejects)
  }
  return state;
}

function current() { return state; }

module.exports = { refresh, current, verifySuspension };
