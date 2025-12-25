This fixture is a small multi-project workspace used for launch/smokecheck testing.

- `src/server`: Node.js HTTP server exposing `GET /api/tab4` -> `{ "message": "Hello from tab4 - server" }`
- `src/client`: Rspack + React + TypeScript SPA with 3 tabs and a Playwright e2e that clicks tabs and saves screenshots.

The intended workflow is described in `workspace.config.json` under `launch.dev`.

Notes:
- `launch.dev.processes[].ready.url` may be absolute (recommended) or relative. If relative, it is currently resolved against `launch.dev.baseURL`.

