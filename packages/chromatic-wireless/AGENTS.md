# Release requirements

Publish source on GitHub for every distributed helper build. Tag the exact source commit, attach SHA-256 checksums and retain dependency licenses. Never publish signing keys, notarization credentials, launch tokens, private device details or unverified binaries. Mac distribution must pass strict nested signature checks, Apple notarization, stapled-ticket validation and Gatekeeper assessment. Test the actual packaged runtime. Do not bypass Gatekeeper or strip quarantine to make a release appear valid.
