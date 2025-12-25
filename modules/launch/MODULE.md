---
name: launch
version: 0.1.0
description: Run workspace "launch" scenarios (start apps, run e2e, take screenshots)
dependencies: [core]
---

This module runs workspace-defined launch scenarios from `workspace.config.json`:

```json
{
  "launch": {
    "dev": [
      { "name": "server", "type": "start", "project": "server", "command": "npm run dev" },
      { "name": "server-api", "type": "http", "url": "http://localhost:3004/api/tab4", "expectText": "Hello from tab4 - server" },
      { "name": "client", "type": "start", "project": "client", "command": "npm run dev" },
      { "name": "e2e", "type": "playwright", "project": "client", "command": "npm run test:e2e" }
    ]
  }
}
```

Run via API CLI:

```bash
npm run api launch.dev
```

