# Contributing

Use Node 24 and `npm ci`; run `npm test` before proposing changes. Add focused regression coverage for execution, authority, persistence and installer changes. Use synthetic account addresses in fixtures and isolate local profiles using DEPTHPILOT_HOME. Never include a real key, profile directory or live activation file in a patch.

Preserve exact integer sizing and the rule that pending transaction hashes are persisted before broadcast and reconciled before retry. Testnet writes require a separately bounded explicit approval; normal tests are deterministic or read-only.
