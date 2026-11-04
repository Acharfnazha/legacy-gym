/*
 * Legacy Gym — main-process security guards.
 *
 * The renderer is NOT trusted: anything reachable through the preload bridge can
 * be called directly (DevTools, an injected script, a tampered build). So every
 * privileged IPC handler re-checks the authenticated session HERE, in the main
 * process, instead of relying on the UI hiding buttons.
 *
 *   - checkSql():   policy for the generic db:all / db:run bridge.
 *   - LoginLimiter: brute-force protection for auth:login.
 */

/* SQL the renderer may never send, whatever the role:
   - schema changes / engine-level statements (DROP, ALTER, CREATE, PRAGMA, ATTACH…)
   - SQLite internals (sqlite_master, sqlite_schema…)
   - password material (hashes / salts) — those stay inside main/db.js only. */
const FORBIDDEN_ALWAYS = [
  /\b(drop|alter|create|pragma|attach|detach|vacuum|reindex|analyze)\b/i,
  /\bsqlite_\w*/i,
  /\bload_extension\b/i,
  /\bpassword_hash\b/i,
  /\bsalt\b/i
];

/* The `users` table (login accounts) is only ever changed through the dedicated
   auth:* handlers, never through raw SQL — not even by an admin. */
const USERS_TABLE = /\busers\b/i;
const WRITE_STMT = /^\s*(insert|update|delete|replace)\b/i;
const READ_STMT = /^\s*(select|with)\b/i;
const SETTINGS_TABLE = /\bsettings\b/i;

/* Strip quoted string literals so that words inside data ('users', 'salt'…)
   never trigger the keyword filters. Parameters are bound separately and are
   never part of the SQL text, so this only matters for constant literals. */
function stripLiterals(sql) {
  return String(sql).replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * @param {string} sql     SQL text coming from the renderer
 * @param {'read'|'write'} kind  db:all => read, db:run => write
 * @param {{role:string}|undefined} session  authenticated session (or undefined)
 * @returns {{ok:true}|{ok:false,error:string}}
 */
function checkSql(sql, kind, session) {
  if (!session) return { ok: false, error: 'not authenticated' };
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, error: 'empty sql' };
  const s = stripLiterals(sql);
  // one statement only (a trailing ";" is tolerated)
  if (/;\s*\S/.test(s)) return { ok: false, error: 'multiple statements are not allowed' };
  if (s.includes('--') || s.includes('/*')) return { ok: false, error: 'comments are not allowed' };
  for (const re of FORBIDDEN_ALWAYS) if (re.test(s)) return { ok: false, error: 'forbidden sql' };
  if (kind === 'read' && !READ_STMT.test(s)) return { ok: false, error: 'only SELECT is allowed here' };
  if (kind === 'write' && !WRITE_STMT.test(s)) return { ok: false, error: 'only INSERT/UPDATE/DELETE are allowed here' };
  if (USERS_TABLE.test(s)) {
    if (kind === 'write') return { ok: false, error: 'users can only be changed via auth handlers' };
    if (session.role !== 'admin') return { ok: false, error: 'admin only' };
  }
  if (kind === 'write' && SETTINGS_TABLE.test(s) && session.role !== 'admin') {
    return { ok: false, error: 'admin only' };
  }
  return { ok: true };
}

/* Brute-force protection: after MAX_FAILS consecutive failures for a username
   (and, separately, for the whole app) further attempts are refused for an
   exponentially growing period. A successful login resets that username. */
class LoginLimiter {
  constructor(opts) {
    const o = opts || {};
    this.maxFails = o.maxFails || 5;
    this.baseLockMs = o.baseLockMs || 30 * 1000;
    this.maxLockMs = o.maxLockMs || 15 * 60 * 1000;
    this.now = o.now || (() => Date.now());
    this.byUser = new Map();
  }
  _key(username) { return String(username || '').trim().toLowerCase(); }
  _entry(key) {
    if (!this.byUser.has(key)) this.byUser.set(key, { fails: 0, lockedUntil: 0 });
    return this.byUser.get(key);
  }
  /* ms remaining before this username may try again (0 = allowed). */
  retryAfter(username) {
    const now = this.now();
    const e = this.byUser.get(this._key(username));
    const g = this.byUser.get('*');
    return Math.max(0, (e ? e.lockedUntil : 0) - now, (g ? g.lockedUntil : 0) - now);
  }
  fail(username) {
    for (const key of [this._key(username), '*']) {
      const e = this._entry(key);
      e.fails++;
      // global bucket is more tolerant: several staff may mistype in a day
      const limit = key === '*' ? this.maxFails * 4 : this.maxFails;
      if (e.fails >= limit) {
        const steps = e.fails - limit;
        e.lockedUntil = this.now() + Math.min(this.maxLockMs, this.baseLockMs * Math.pow(2, steps));
      }
    }
  }
  success(username) {
    this.byUser.delete(this._key(username));
    const g = this.byUser.get('*');
    if (g) { g.fails = 0; g.lockedUntil = 0; }
  }
}

const ROLES = ['admin', 'employee'];
const MIN_PASSWORD = 6;
const MAX_FIELD = 200;

function validPassword(p) { return typeof p === 'string' && p.length >= MIN_PASSWORD && p.length <= 256; }
function validUsername(u) { return typeof u === 'string' && u.trim().length > 0 && u.trim().length <= 64; }
function validRole(r) { return ROLES.includes(r); }
function validId(id) { return Number.isInteger(Number(id)) && Number(id) > 0; }

module.exports = {
  checkSql, stripLiterals, LoginLimiter,
  validPassword, validUsername, validRole, validId,
  MIN_PASSWORD, MAX_FIELD
};
