# Troubleshooting

## The dashboard does not open

Extract the whole Windows ZIP first and use Open DepthPilot.bat. Do not open individual files from inside the archive. Windows Script Host must be enabled by your normal system policy; the application will not change it. Check `%LOCALAPPDATA%\DepthPilot\profiles\default\logs\launcher.log` and `application.log`. Error messages appear visibly even though normal startup is hidden.

If another service uses the default port, DepthPilot chooses another loopback port and opens that exact address. Reopening the launcher checks instance identity rather than trusting whatever happens to answer on port 4320.

## My account is not ready

Copy the selected Somnia Account address from dreamDEX, not necessarily your login wallet. Check the official Link a Bot guide. Confirm that the bot address matches the one generated on this PC and that Perps access is present. The account's margin and the bot's fee balance are separate; top-ups are your own action in dreamDEX.

## The bot is waiting

Read its latest Activity explanation. It may be waiting for its entry interval, a tighter spread, fresh market data or room within the remaining limits. Waiting is a deliberate decision and does not mean an order was sent. Open Technical details only if you need the raw measurements.

## The bot needs attention

Keep its history. Check pending transactions, positions and open orders in dreamDEX. Do not delete state to retry an ambiguous order. A safety halt is not restarted automatically. This candidate does not provide a general halted-position recovery button; use dreamDEX to manage any remaining exposure and reconcile it before creating another plan.

## Stop, close the app or update

Stopping a plan and closing the browser are different. Use the Activity stop button and wait for a verified outcome. If an exit cannot complete, manage the actual position on dreamDEX. Once no active plan or unresolved exposure remains, use **Close local app** in the footer. It keeps your local profile and history for next time. A dedicated desktop tray is not included yet. Never force-close an active worker merely to install an update.

Updates retain the profile and reject installation while its recorded application process is alive. Removing the application files does not revoke exchange access or close positions. Revoke the operator in dreamDEX when you no longer need it. Keep your profile unless you deliberately intend to discard the bot's protected key and journal.
