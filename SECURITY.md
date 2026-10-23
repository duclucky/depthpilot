# Security

Do not post private keys, recovery phrases, encrypted key files, authorization files or full profile directories in issues. A public address and a redacted error message usually suffice for support. No telemetry or automatic log upload is included.

The primary wallet remains on dreamDEX. The local operator key is encrypted with Windows DPAPI CurrentUser and decrypted only in the signing worker or explicitly invoked gas-signing helper. DPAPI is not a sandbox against malicious programs already running as that Windows user. Browser code and the local HTTP server do not receive decrypted keys.

The dashboard binds to loopback and validates Host, Origin and a session token for writes. Do not expose it through a public tunnel. Review Link a Bot permissions and revoke unwanted operators using dreamDEX. Local plan limits do not narrow the underlying exchange grant.

Pending transactions survive a restart and are reconciled before another send. A missing receipt is not permission to retry. If the bot halts with exposure or an uncertain result, inspect the actual account and transaction in dreamDEX before further action.

Use [GitHub issues](https://github.com/duclucky/depthpilot/issues) for ordinary redacted bug reports. Do not disclose exploitable details or secrets publicly. If GitHub's private vulnerability reporting is available in the Security tab, use it; otherwise ask for a private reporting channel without including exploit details or credentials.
