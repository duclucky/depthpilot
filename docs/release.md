# Building a release

## Published 0.2.2 provenance

The GitHub `v0.2.2` runtime and tested-source assets are the immutable archives used in the verified installer/bridge/autonomous round-trip test. Their hashes are in the repository/release `SHA256SUMS.txt`. The repository adds an expanded README, screenshots and a pinned GitHub bootstrap after that runtime test; it does not silently rebuild or replace the Windows archive. The source ZIP retains its original shorter guide. GitHub's automatic tag source contains the documentation/bootstrap additions. Any later runtime build for publication needs a new version; CI packaging is a build smoke check, not an instruction to overwrite a release asset.

The README's pasteable PowerShell block and `Install-DepthPilot.ps1` both download that exact Windows archive and check its fixed SHA-256 before extracting or invoking the manifest installer. The saved script also accepts an offline archive, which must pass the same hash. Neither changes execution policy. User installation must not run as administrator.

Run `npm ci`, `npm test`, then `npm run release` on Windows with Node 24. The packager verifies the Node executable against the official version's SHA-256 list, includes its license, pinned production dependencies and package notices, and generates a dependency inventory. It copies an explicit source allowlist; no profile, author configuration, signing authority, cache or historical receipt archive is included.

Outputs are under `release/`: a Windows ZIP, a source ZIP and SHA256SUMS. `release.json` contains each distributed file's hash and size; installation verifies it and copies only those entries. A hash next to an untrusted download is not an independent authenticity guarantee. Publish checksums through the trusted project release channel; this release is not code-signed.

The installed batch/shortcut resolves a version selected in current.txt. Updates stage files into a new version directory and retain profiles. A version is immutable; changed contents need a new version number. There is no unattended updater or automatic rollback. Schema 1 compatibility must be checked before introducing migrations; do not claim rollback across unknown schemas.

Before publication, inspect the actual ZIP and complete a clean-user Windows smoke test, browser setup/review test, and separately authorized bounded live test for a new public profile. CI tests never sign or send chain transactions. Keep evidence outside the public source package unless deliberately sanitized and included.
