# Aval working preferences

- Preserve the existing Aval visual language unless a redesign is requested.
- Deliver a usable local build and refresh the macOS DMG when delivering Aval changes. The user explicitly requested this on September 7, 2026. State whether a DMG targets the local server or the hosted site, and whether it is notarized.
- Keep local packaging separate from production signing requirements. Do not weaken the release signing configuration.
- Run the relevant checks before committing or pushing. A push to `main` triggers Cloudflare deployment and the desktop release; report failures, including usage-limit failures, accurately.
- Never claim a provider is live-validated from fixtures alone. Keep credentials out of logs and source control.
