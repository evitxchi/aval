# Aval working preferences

- Preserve the existing Aval visual language unless a redesign is requested.
- Deliver a usable local build and refresh the macOS DMG when delivering Aval changes. The user explicitly requested this on September 7, 2026. State whether a DMG targets the local server or the hosted site, and whether it is notarized.
- Update the GitHub `desktop-latest` release with the refreshed, verified DMG every time Aval changes are delivered; a local DMG refresh or source push alone is not a complete delivery. This is standing user authorization from September 9, 2026. Include matching checksums and accurate release notes identifying the source commit, local-server or hosted target, and notarization status. Label local development assets separately from signed hosted assets and preserve production signing requirements. Verify the uploaded asset digest before reporting success.
- Keep local packaging separate from production signing requirements. Do not weaken the release signing configuration.
- Run the relevant checks before committing or pushing. A push to `main` triggers Cloudflare deployment and the desktop release; report failures, including usage-limit failures, accurately.
- Never claim a provider is live-validated from fixtures alone. Keep credentials out of logs and source control.
