# Building a release

## Source 0.3.1 and local installer candidate

The 0.3.1 source is published on `main`. The verified local Windows/source candidate ZIPs are not GitHub Release assets yet. Their SHA-256 values are `43c5763388849d289663062f1887aee540f76e584e5e339f7f93ebca7bf0c431` and `74042088bcdf6d02434bb729bcc7c85874c1a59e6ed4395658dcd20f090d5030`, respectively. Preserve those exact archives. Repository documentation and the captioned demo were added for source publication after candidate packaging; the Windows/source ZIPs remain their verified snapshots. The installer bootstrap and stable download links continue to target published 0.3.0.

Candidate verification includes 100 passing tests in both the working tree and extracted source package, manifest hashes, isolated Windows install/batch reopen, real read-only Tokyo market data, responsive review and historical report export. The 84-second demo explicitly separates real read-only data, disabled synthetic setup and historical 0.2.2 receipts. No new 0.3.1 live trade is established by those checks. Existing profiles are preserved; a completed old plan is never rearmed merely by installing this version.

## Published 0.3.0 provenance

The v0.3.0 Windows/tested-source ZIPs are the exact verified local candidate archives. They passed 92 tests, responsive and read-only SDK checks and an isolated actual ZIP installation. They are not rebuilt during publication. The GitHub tag/source and standalone README/bootstrap/checksums add final 0.3.0 publication instructions. The extra GitHub download bootstrap/checksum embedded in the frozen candidate still describes 0.2.2; normal ZIP users launch Open DepthPilot.bat or the local install.ps1. The current separately uploaded Install-DepthPilot.ps1 and README command are pinned to the tested 0.3.0 ZIP. CI packaging is a build check and must never replace the published archives.

No new live trade was sent for 0.3.0. Live order evidence remains the separately identified historical 0.2.2 test. Old 0.2.2 release assets stay unchanged. Stop/reconcile and close older running apps before installation; report compatibility is independent of worker recovery.

## Published 0.2.2 provenance

The GitHub `v0.2.2` runtime and tested-source assets are the immutable archives used in the verified installer/bridge/autonomous round-trip test. Their hashes are in the repository/release `SHA256SUMS.txt`. The repository adds an expanded README, screenshots and a pinned GitHub bootstrap after that runtime test; it does not silently rebuild or replace the Windows archive. The source ZIP retains its original shorter guide. GitHub's automatic tag source contains the documentation/bootstrap additions. Any later runtime build for publication needs a new version; CI packaging is a build smoke check, not an instruction to overwrite a release asset.

The README's pasteable PowerShell block and `Install-DepthPilot.ps1` both download that exact Windows archive and check its fixed SHA-256 before extracting or invoking the manifest installer. The saved script also accepts an offline archive, which must pass the same hash. Neither changes execution policy. User installation must not run as administrator.

Run `npm ci`, `npm test`, then `npm run release` on Windows with Node 24. The packager verifies the Node executable against the official version's SHA-256 list, includes its license, pinned production dependencies and package notices, and generates a dependency inventory. It copies an explicit source allowlist; no profile, author configuration, signing authority, cache or historical receipt archive is included.

Outputs are under `release/`: a Windows ZIP, a source ZIP and SHA256SUMS. `release.json` contains each distributed file's hash and size; installation verifies it and copies only those entries. A hash next to an untrusted download is not an independent authenticity guarantee. Publish checksums through the trusted project release channel; this release is not code-signed.

The installed batch/shortcut resolves a version selected in current.txt. Updates stage files into a new version directory and retain profiles. A version is immutable; changed contents need a new version number. There is no unattended updater or automatic rollback. Schema 1 compatibility must be checked before introducing migrations; do not claim rollback across unknown schemas.

Before publication, inspect the actual ZIP and complete a clean-user Windows smoke test, browser setup/review test, and separately authorized bounded live test for a new public profile. CI tests never sign or send chain transactions. Keep evidence outside the public source package unless deliberately sanitized and included.
