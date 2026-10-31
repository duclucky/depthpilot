# Architecture and integration provenance

## 0.3.0 workbench boundaries

`market-lab.mjs` owns single-flight, short-lived read-only SDK snapshots and passes validated input into the existing integer `planChild` function. Preview does not check account capacity or create an executable plan. Its API is outside the trading-control queue so slow market reads cannot occupy the queue used for stop requests.

`session-library.mjs` reads only exact UUID metadata/state/journal paths under the current profile. It derives allowlisted reports from confirmed receipts, deduplicates hashes, keeps actual gas separate from unresolved reservations, and exposes paginated historical activity without selecting/restarting that run. A report contains no signing material or authority. Missing gas is explicit; saved metrics are not a fresh account observation or PnL.

`plan-template.mjs` validates reusable settings through the existing normalizer using inert validation-only identifiers. Exported settings omit identities, absolute deadlines and authority. Import rejects unknown keys. The UI populates fields but invalidates previous reviews and clears confirmation and recovery opt-in. A new live review still checks the actual account, market and permissions.

`public/workbench.mjs` handles Market/History/settings interactions and inherits the existing design. The original worker, signing adapters, receipt reconciliation and recovery version checks remain unchanged. The candidate uses a new application version; stop/reconcile before installing over an older running app.

The Setup gas helper uses the pinned SDK's native STT bridge from Shannon 50312 to Tokyo 50383 / network ID 50000259, always to the same generated operator. The HTTP process invokes an isolated helper; only its explicitly confirmed send operation unlocks DPAPI. Reviews expire after five minutes, cap origin fees at 0.02 STT and retain 0.01 STT on Shannon. Before broadcasting, it persists the signed transaction hash and exact reviewed fields without persisting the raw signature. Uncertain sends are reconciled, never resent. Arrival requires the exact origin receipt, its DispatchId from the SDK mailbox, the destination delivered flag and expected destination balance. A pending bridge blocks plan activation; an active plan blocks gas moves. All amounts and fees are testnet STT. This optional one-validator test bridge is not a production custody or delivery guarantee.

Node 24 and browser ES modules; no frontend framework, browser wallet provider or key import. The loopback HTTP server handles profile configuration and explicit plan review. A detached worker owns signing, exact intent persistence, SDK submission and receipt reconciliation. Read-only account checks and configuration fields remain available without a wallet extension.

The public candidate reuses the existing exact integer planner, continuous policy and finite runner. Source was copied into an isolated candidate rather than editing the active operator deployment. This candidate is the intended reusable engine; a future private deployment consumes a pinned tested release rather than a second edited source tree.

`@somnia-chain/markets-sdk` is pinned to **0.32.1**, `viem` to **2.57.7**. `gateway.mjs` discovers Perps markets, reads account capacity, constructs SDK IOC calls and verifies exact receipts. Delegation encodes owner-scoped `placeOrderFor`; owner margin and operator nonce/gas are separate. The account compatibility check and actual pool permissions are decisive; pasting an address is not authenticated ownership.

Official operator reference: [dreamDEX bot kit](https://github.com/somnia-chain/dreamdex-bot-kit), investigated revision `25798660bbe4674a6f83a960b202852896e2fed4`. Official user flow: [Link a Bot](https://app.dreamdex.io/docs/trading/common/link-a-bot). Tokyo chain ID is 50383, network version 50000259; SDK identifiers retain the historical Hideki name.

The [official dreamDEX Go CLI](https://github.com/somnia-chain/somnia-dex-cli) is a separate diagnostics integration. The investigated binary was built from revision `65cce8c8ee9efb23a793277e67b24e985f35325c`. `npm run cli:check` executes `dreamdex markets --testnet --json`; set `DREAMDEX_CLI` if it is installed elsewhere. This is spot diagnostics on the CLI's configured testnet, not proof of Tokyo Perps execution. The public Windows package does not redistribute that CLI binary; it is not needed for the user trading flow. No generic Perps API-key signer has been established.

Profiles are outside replaceable application versions. An immutable run definition, digest-bound authority, pending intents, state and segmented decision log persist independently. Only one worker uses a profile; new plans are blocked while an existing run has a pending intent or owned exposure. The current public candidate supports one default profile per Windows user, with separate test directories via DEPTHPILOT_HOME. A multi-profile selector and the separate private-deployment read-only viewer are not part of this candidate.

The launcher uses a tiny Windows Script Host wrapper to start Node without leaving a PowerShell console. It verifies the existing loopback instance identity before opening it and starts a new instance only when the previous process is absent. Unknown/hung processes cause a visible failure instead of forced termination.

## 0.3.1 owned-close and gas boundaries

The round adapter supplies an observed signed `closingPositionSize` only for its own cycle. The planner validates direction, exact remaining position and the lot grid. Its sole minimum exception is the exact full subminimum close; account max quantity, freshness, price, participation and depth remain binding. Partial larger closes remain bounded and actual receipt quantities determine the next owned remainder. The signer re-reads position/open orders before opening the protected key. Ordinary orders have no onchain reduce-only flag: other actors on the same account can still race after a read. Use a dedicated account/market and retain the mismatch halt.

One 30M gas ceiling is shared by SDK construction, simulation and estimates. Selected ceilings and actual fees stay inside digest-bound cumulative budgets. New round configs reserve three closing order slots and compute closing STT reserve from half the selected total, capped at 0.3; finite execution preserves a separate 1 STT native floor. Review and activation both check the current round reserves. No authority or counter is migrated automatically across application versions.

The standalone GitHub bootstrap/checksum are published-release references independent of local application version. Windows packages omit them; source packages retain them for reproducible bootstrap checks. Publication must reconcile the new immutable ZIP hash, bootstrap and README before a new online install is advertised.
