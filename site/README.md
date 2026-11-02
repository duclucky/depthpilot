# Public read-only website

The static `index.html` is deployed from this directory by `.github/workflows/pages.yml`. It does not expose a wallet connection, signer, local profile or bot-control endpoint. `app.mjs` reads the sanitized reference snapshot; `onboarding.mjs` only reveals/copies the installation command.

## Installation copy

The displayed PowerShell command and `Install-DepthPilot.ps1` contain the exact installation block from section 3 of the root README, pinned to Windows 0.3.2 and its published SHA-256. This site script is a directly inspectable copy of that block; the root `Install-DepthPilot.ps1` is the separate parameterized GitHub bootstrap. Keep the command, README, ZIP link, version and checksum in sync when preparing a future release. Website-only changes do not replace the immutable installer assets.

## Media provenance

- `local-market.png`, `local-setup.png`, `local-plan.png`, `local-history.png`: actual CUA screenshots of the 0.3.2 UI. Setup/plan captures grant no trading authority. The visible setup address belongs to a historical test and must not be reused by visitors. History displays a completed 0.3.1 session, explicitly labelled in its caption.
- `depthpilot-0.3.2-demo.mp4`: the reviewed 185.83-second edited product walkthrough with synthetic English narration. Real UI screenshots, historical receipt evidence and a labelled synthetic wait example are described beside the player. It is not a continuous live trading recording. SHA-256: `e720bc926e7ae4413b4d34b335c97364efdb7619b61232ae58c07df4a83880de`.
- `video-poster.jpg`: the reviewed cover of that same video.
- `demo.en.vtt`: WebVTT conversion of the original English SRT. Captions are already burned into the MP4; the optional text track is also available.

Images include native dimensions and alternate text, load lazily, and open at full size. Video uses `preload="none"`, native controls and a local poster. All assets are hosted with this site; no third-party embed is required.

## Verification

Run `npm test` from the repository root. Preview with `python -m http.server 55433 --bind 127.0.0.1 --directory site`, then check installation copy, command deep link/copy, FAQ, images, playback and the unchanged reference viewer. A preview does not install the bot or grant trading permission. Public decision history is explicitly limited to the latest 60 published steps; full user journals remain local.
