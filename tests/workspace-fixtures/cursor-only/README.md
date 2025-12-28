Workspace fixture with **only** the `cursor` module listed in `workspace.config.yml`.

Used to verify that:
- dependency resolution pulls in `core`
- the Cursor module post-install hook creates `.cursor/*` outputs

