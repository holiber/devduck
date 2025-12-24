# Email

List unread email messages for the last week using the active email provider.

Usage:

```bash
/email
```

Run directly:

```bash
npx tsx modules/email/scripts/email.ts
```

## Provider selection

Provider is selected in this order:

1. `EMAIL_PROVIDER` env var
2. `workspace.config.json` → `moduleSettings.email.provider`
3. First discovered provider

