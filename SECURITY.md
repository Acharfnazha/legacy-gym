# Security policy

## License signing key

`tools/license-private-key.pem` is the master signing key. It must remain outside
Git, shared archives, support tickets, and release installers. The repository's
`.gitignore` excludes it explicitly.

The public verification key in `main/license-pubkey.js` is safe to ship. The
desktop app needs that public key to verify activation and suspension signatures;
it cannot be used to create valid signatures.

To initialize licensing on a new secure workstation:

```bash
node tools/license-setup.js "a-long-unique-passphrase"
```

Back up the resulting private key in an encrypted secrets vault. Do not store the
passphrase beside the key.

## Application hardening

The renderer (UI) is treated as untrusted. Every privileged action is re-checked
in the Electron main process against the logged-in session:

- `main/guard.js` filters the generic SQL bridge (`db:all` / `db:run`): a login
  is required, one statement only, no schema changes (`DROP`, `ALTER`, `PRAGMA`,
  `ATTACH`…), no access to `password_hash` / `salt`, the `users` table is never
  written through raw SQL, and employees cannot read `users` or change `settings`.
- User management, backups/restores and the clock warning require an **admin**
  session; changing your own password requires your session + current password.
- Logins are rate-limited (lockout grows after 5 failures), use a constant-time
  hash comparison, and return one generic error (no username enumeration).
- DevTools are disabled in the packaged build, the window cannot navigate away
  from the local app page, and the old `openPath` bridge (which could launch any
  file) was removed.
- CSV exports neutralise spreadsheet formulas (`=`, `+`, `-`, `@`).
- An admin still using the factory password `123456` gets a warning on every login.

`npm test` covers these rules; `IRONCORE_SMOKE=1 IRONCORE_SMOKE_ROLE=employee npm start`
additionally attacks the IPC bridge as an employee and must report `ALL CHECKS OK`.

## Reporting a vulnerability

Do not open a public issue with keys, customer records, machine identifiers, or
other sensitive data. Contact the repository owner privately with a concise
description and reproduction steps.
