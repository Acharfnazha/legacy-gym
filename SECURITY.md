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

## Reporting a vulnerability

Do not open a public issue with keys, customer records, machine identifiers, or
other sensitive data. Contact the repository owner privately with a concise
description and reproduction steps.
