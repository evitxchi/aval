# Aval Desktop

Aval Desktop is a trusted Electron shell for the hosted Aval dashboard. It starts `codex app-server` locally and exposes a deliberately narrow bridge to the renderer so interactive Ask Aval questions can use the signed-in user's ChatGPT plan.

The desktop bridge uses an app-specific Codex home, never reads another Codex installation's `auth.json`, removes API-key environment variables from the child process, keeps authentication URLs and credentials out of the renderer, and runs model turns in an empty read-only workspace with network access disabled. Cloud automations remain server-hosted because they must keep running when the laptop is closed.

## Development

Requirements: Node.js 22+, the Codex CLI, and a ChatGPT account eligible for Codex.

```sh
cd desktop
npm install
npm test
npm start
```

Set `AVAL_DESKTOP_URL=http://localhost:3000` to point the shell at a local Aval development server. Set `AVAL_CODEX_PATH=/absolute/path/to/codex` only when the CLI is not discoverable on `PATH` or in a standard install location.

## Packaging

```sh
npm run package:mac
```

Unsigned local builds are suitable for development. Public distribution still requires platform code signing/notarization and confirmation that the Codex App Server's experimental interface is appropriate for the intended commercial release.

