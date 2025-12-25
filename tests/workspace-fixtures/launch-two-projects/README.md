Workspace fixture with 2 local projects under `src/`:

- `src/server` - a minimal Node.js HTTP server exposing `getTab4()` at `GET /api/tab4`
- `src/client` - a React + TypeScript SPA built with Rspack

This fixture also demonstrates the new `launch` section in `workspace.config.json`:

```bash
npm run api launch.dev
```

That scenario should:

1. Start the server, verify `GET /api/tab4`
2. Start the client in dev mode
3. Run Playwright e2e tests that switch tabs and take screenshots

