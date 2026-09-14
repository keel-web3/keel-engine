# Security

## Reporting a vulnerability

Please report security issues privately. Use GitHub's "Report a
vulnerability" on https://github.com/keel-web3/keel-engine/security, or
contact the maintainers of the keel-web3 organization. Please don't open a
public issue for an unfixed vulnerability.

Include:

- the affected module(s) and version (or commit);
- what an attacker can do;
- a minimal reproduction.

We aim to acknowledge a report within a few days.

## What the engine promises, and what it doesn't

**Verified bytes.** Every module on chain is the reproducible build of this
repository's source at a pinned commit.

- The receipt (`keel-source-receipt@1`, disposition `reproducible-build`)
  binds the readable source's digest to the output digest.
- The catalog records both. `keel module verify` rebuilds the bytes from
  GitHub and compares.
- The resolver (`@keel-engine/keel/resolver`) uses a module's bytes only when
  their sha256 equals the catalog's output digest. The release record must
  match the pinned digest the caller chose.

A mismatch is reported, never silently replaced. Report these as
vulnerabilities:

- a module that rebuilds differently from what its receipt claims;
- a resolver path that runs bytes without checking them.

**What verification is not.** A digest proves identity, not safety: a
verified module is exactly the code in this repository, bugs included.

**Where engine modules run.** KEEL runs games inside its sandboxed viewer: an
opaque-origin iframe, with no network, no wallet and no storage privilege. See
keel-sdk `docs/SECURITY.md` and `docs/KEEL_VERIFICATION_SHELL.md`. The engine
adds one global, `KEEL_ENGINE`. Modules reach each other only through the
registry and the needs they declare.

**Vendored scripts.** Tone.js and keel-audio in `vendor/` are byte-identical
to KEEL's registered objects (see `NOTICE`), and a test checks their digests.

**Keys.** Nothing in this repository signs or sends a transaction.
`npm run modules:plan` is a dry run. Publishing happens through a wallet,
outside this repository.
